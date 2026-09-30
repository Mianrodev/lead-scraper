// Free-audit form for the agency's own website ("Get a free online presence check").
// Embed it with an <iframe src="https://<app>/f/<form key>">. A business owner fills it in;
// the business is saved as a lead (source "Website form"), its website is checked and scored
// automatically, the team gets a notification, and a webhook fires. The team then shares the
// audit report link. Limited to a few requests per visitor per hour, with a hidden trap field.

import { safeWebsite, toE164, websiteDomain } from "./normalize";
import { formatLeadDate, formatLeadDateTime, stateCode } from "./format";
import { notify } from "./ops";
import { logEvent } from "./events";
import { emitEvent } from "./api-keys";
import type { AgencySettings } from "./report";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const PER_HOUR = 5;

export async function formKey(env: Env): Promise<string> {
  return (await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'form_key'`).first<string>("value")) ?? "";
}

const page = (title: string, body: string, color = "#4f46e5") => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; } body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2430; background: transparent; }
  .box { max-width: 520px; margin: 0 auto; padding: 18px; background: #fff; border: 1px solid #e3e6ee; border-radius: 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 14px; color: #555e70; }
  label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; margin-bottom: 10px; }
  input { font: inherit; padding: 10px 12px; border: 1px solid #cfd5e1; border-radius: 10px; width: 100%; }
  button { width: 100%; background: ${color}; color: #fff; border: none; padding: 12px; border-radius: 10px; font: inherit; font-weight: 700; cursor: pointer; }
  .trap { position: absolute; left: -5000px; } .small { font-size: 12px; color: #6b7385; margin-top: 10px; } .err { color: #b91c1c; }
</style></head><body><div class="box">${body}</div></body></html>`;

export function formPage(key: string, agency: AgencySettings, error = ""): string {
  return page("Free online presence check", `<h1>Free online presence check</h1>
<p>See how your business shows up online: website, Google, and what to fix first. Free, no obligation.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="/f/${esc(key)}">
  <label>Business name<input name="business" required maxlength="120"></label>
  <label>Website (if you have one)<input name="website" maxlength="200" placeholder="yourbusiness.com"></label>
  <label>Your name<input name="name" maxlength="80"></label>
  <label>Email<input name="email" type="email" required maxlength="120"></label>
  <label>Phone<input name="phone" maxlength="30"></label>
  <label>City and state<input name="city" maxlength="80" placeholder="Orlando, FL"></label>
  <input class="trap" name="company_url" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button type="submit">Get my free check</button>
</form>
<div class="small">${esc(agency.name || "We")} will send your report within one business day.</div>`);
}

export function thanksPage(agency: AgencySettings): string {
  return page("Thanks", `<h1>Thanks! We're on it.</h1><p>We're checking your website and online presence now. ${esc(agency.name || "We")} will send your report within one business day.</p>`);
}

async function hashIp(ip: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`form:${ip}`));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface FormInput { business?: string; website?: string; name?: string; email?: string; phone?: string; city?: string; company_url?: string }

/** Checks a submission; returns an error for the visitor, or the cleaned values. */
export function checkForm(f: FormInput): { error: string } | { business: string; website: string | null; domain: string | null; name: string | null; email: string; phone: string | null; phoneRaw: string | null; city: string | null; state: string | null } {
  const business = (f.business ?? "").trim().slice(0, 120);
  const email = (f.email ?? "").trim().toLowerCase().slice(0, 120);
  if (!business) return { error: "Please enter your business name." };
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return { error: "Please enter a valid email address." };
  const website = safeWebsite((f.website ?? "").trim().slice(0, 200) || null);
  const [cityRaw, stateRaw] = (f.city ?? "").split(",").map((s) => s.trim());
  return {
    business, website, domain: websiteDomain(website), name: (f.name ?? "").trim().slice(0, 80) || null, email,
    phone: toE164((f.phone ?? "").trim() || null, "US"), phoneRaw: (f.phone ?? "").trim().slice(0, 30) || null,
    city: cityRaw?.slice(0, 60) || null, state: stateRaw ? (stateCode(stateRaw) || stateRaw.slice(0, 20)) : null,
  };
}

/** Saves a free-audit request as a lead. Returns null when it should be ignored (trap / limit). */
export async function submitForm(env: Env, f: FormInput, ip: string): Promise<{ error?: string; leadId?: string } | null> {
  if ((f.company_url ?? "").trim()) return null; // filled by a bot
  const ipHash = await hashIp(ip);
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM form_hits WHERE ip_hash = ? AND at > datetime('now', '-1 hour')`).bind(ipHash).first<number>("n");
  if ((recent ?? 0) >= PER_HOUR) return null;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO form_hits (ip_hash) VALUES (?)`).bind(ipHash),
    env.DB.prepare(`DELETE FROM form_hits WHERE at < datetime('now', '-2 days')`),
  ]);
  const v = checkForm(f);
  if ("error" in v) return { error: v.error };

  // Same business already in the database (phone or website)? Use it; else add it.
  const existing = await env.DB.prepare(
    `SELECT id, suppressed, lead_status FROM leads WHERE ${[v.phone ? "gbp_phone_formatted = ?" : "", v.domain ? "website_domain = ?" : ""].filter(Boolean).join(" OR ") || "0"} LIMIT 1`,
  ).bind(...[v.phone, v.domain].filter(Boolean)).first<{ id: string; suppressed: string | null; lead_status: string | null }>();
  const now = new Date();
  const id = existing?.id ?? crypto.randomUUID();
  const st: D1PreparedStatement[] = [];
  if (!existing) {
    st.push(env.DB.prepare(
      `INSERT INTO leads (id, google_place_id, business_name, gbp_phone_raw, gbp_phone_formatted, website, website_domain, city, state, country,
         business_status, data_source, lead_source, owner_name, owner_source, source_code, lead_date, lead_datetime, lead_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USA', 'operational', 'form', 'Website form', ?, ?, ?, ?, ?, 'Interested')`,
    ).bind(id, `form:${id}`, v.business, v.phoneRaw, v.phone, v.website, v.domain, v.city, v.state, v.name, v.name ? "form" : null,
      env.SOURCE_CODE_DEFAULT, formatLeadDate(now, env.LEAD_TIMEZONE), formatLeadDateTime(now, env.LEAD_TIMEZONE)));
    st.push(env.DB.prepare(`INSERT OR IGNORE INTO lead_emails (lead_id, email, position) VALUES (?, ?, 0)`).bind(id, v.email));
  } else if (!existing.suppressed && (existing.lead_status ?? "Untouched") === "Untouched") {
    // A business we already have: the form is public, so it never overwrites what the team
    // recorded (stage, emails, owner). It only lifts an untouched business to Interested; the
    // details they typed go in its activity for the team to check.
    st.push(env.DB.prepare(`UPDATE leads SET lead_status = 'Interested', status_changed_at = datetime('now') WHERE id = ? AND COALESCE(lead_status, 'Untouched') = 'Untouched'`).bind(id));
  }
  // Check the website straight away (it's a hot lead).
  if (v.domain && !existing) st.push(env.DB.prepare(`UPDATE leads SET website_audit_status = 'queued', website_audit_at = NULL WHERE id = ? AND website_domain IS NOT NULL`).bind(id));
  if (st.length) await env.DB.batch(st);
  await logEvent(env, id, "form", `Asked for a free check (${[v.name, v.email, v.phoneRaw].filter(Boolean).join(", ")})`, null);
  await notify(env, {
    kind: "form", level: "info",
    message: existing?.suppressed
      ? `Free-check request from ${v.business} (${v.email}), which is on your do-not-contact list. Check before replying.`
      : `New free-check request: ${v.business}${v.city ? ` (${v.city})` : ""} · ${v.email}${v.phoneRaw ? ` · ${v.phoneRaw}` : ""}. ${existing ? "You already have this business: its details are in its activity." : "Its website is being checked; share the report from the business's pop-up."}`,
    dedupeKey: `form-${id}-${now.toISOString().slice(0, 13)}`,
  });
  await emitEvent(env, "form.submitted", { leadId: id, business: v.business, email: v.email, phone: v.phoneRaw, website: v.website, city: v.city, state: v.state, existing: !!existing });
  return { leadId: id };
}
