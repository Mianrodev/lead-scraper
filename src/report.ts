// Audit report page: a one-page "online presence check" for a business, with the agency's
// contact details, to send as a link in an email or text. Public (no sign-in) at /r/<token>;
// the token is random and unguessable, and the page asks search engines not to index it.

export interface AgencySettings { name: string; phone: string; email: string; website: string; blurb: string }
export const AGENCY_KEYS = ["agency_name", "agency_phone", "agency_email", "agency_website", "agency_blurb"] as const;

export interface LeadForReport {
  business_name: string | null; gbp_category: string | null; city: string | null; state: string | null; website: string | null;
  presence_score: number | null; gbp_score: number | null; website_score: number | null; score_notes: string | null;
  rating: number | null; review_count: number | null; data_source: string | null;
  reachable: number | null; https: number | null; mobile_viewport: number | null; has_contact_form: number | null; has_booking: number | null;
  has_meta_pixel: number | null; has_google_tag: number | null; has_chat_widget: number | null; copyright_year: number | null;
  psi_score: number | null; audit_error: string | null; social_only: number | null; email_provider: string | null; checked_at: string | null;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function verdict(score: number | null): string {
  if (score == null) return "Not measured";
  return score >= 80 ? "Strong" : score >= 60 ? "Good, with room to grow" : score >= 40 ? "Basic" : "Needs attention";
}

function ring(label: string, score: number | null, note: string): string {
  const pct = score ?? 0;
  const color = score == null ? "#9aa3b2" : score >= 80 ? "#15803d" : score >= 40 ? "#b45309" : "#b91c1c";
  return `<div class="tile"><div class="ring" style="background:conic-gradient(${color} ${pct * 3.6}deg,#e7e9ef 0)"><span>${score == null ? "–" : pct}</span></div>
    <div><div class="k">${esc(label)}</div><div class="v">${esc(verdict(score))}</div><div class="s">${esc(note)}</div></div></div>`;
}

/** The report page (self-contained HTML, light theme, prints well). */
export function renderReport(l: LeadForReport, agency: AgencySettings, today = new Date()): string {
  let notes: { gbpComment?: string; websiteComment?: string; suggestions?: string[] } = {};
  try { notes = l.score_notes ? JSON.parse(l.score_notes) : {}; } catch { notes = {}; }
  const where = [l.gbp_category, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const readable = l.reachable === 1 && !l.social_only && !(l.audit_error ?? "").startsWith("blocked:");
  const checks: [boolean, string, string][] = [];
  if (!l.website) checks.push([false, "", "No website: customers searching online can't find out about you"]);
  else if (l.social_only) checks.push([false, "", "Only a social media page, no website of your own"]);
  else if (l.reachable === 0) checks.push([false, "", (l.audit_error ?? "").includes("parked") ? "Your web address is parked or for sale" : "Your website doesn't load"]);
  if (readable) {
    checks.push([true, "Your website loads", ""]);
    checks.push([!!l.https, "Secure (https)", "Not secure: browsers warn visitors"]);
    checks.push([!!l.mobile_viewport, "Works on phones", "Hard to use on phones, where most visitors are"]);
    checks.push([!!l.has_contact_form, "Contact form", "No contact form, so visitors have to call"]);
    checks.push([!!l.has_booking, "Online booking", "No online booking"]);
    checks.push([!!(l.has_meta_pixel || l.has_google_tag), "Visitor tracking (Meta pixel / Google tag)", "No visitor tracking, so ads can't find past visitors"]);
    checks.push([!!l.has_chat_widget, "Chat on the website", "No chat for quick questions"]);
    const year = today.getUTCFullYear();
    if (l.copyright_year) checks.push([l.copyright_year > year - 3, `Kept up to date (© ${l.copyright_year})`, `Looks out of date (© ${l.copyright_year})`]);
    if (l.psi_score != null) checks.push([l.psi_score >= 50, `Loads quickly on phones (${l.psi_score}/100)`, `Slow on phones (${l.psi_score}/100)`]);
  }
  if (l.email_provider === "No email on this domain") checks.push([false, "", "No email on your own web address"]);
  if (l.data_source !== "free" && l.data_source !== "upload" && l.review_count != null) {
    checks.push([(l.review_count ?? 0) >= 20, `${l.review_count} Google reviews${l.rating ? `, ${l.rating.toFixed(1)}★` : ""}`, `Only ${l.review_count} Google reviews${l.rating ? ` (${l.rating.toFixed(1)}★)` : ""}`]);
  }
  const good = checks.filter(([ok, yes]) => ok && yes).map(([, yes]) => yes);
  const bad = checks.filter(([ok]) => !ok).map(([, , no]) => no);
  const fixes = (notes.suggestions ?? []).slice(0, 5);
  const date = today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const contact = [agency.phone && `<a href="tel:${esc(agency.phone.replace(/[^\d+]/g, ""))}">${esc(agency.phone)}</a>`,
    agency.email && `<a href="mailto:${esc(agency.email)}">${esc(agency.email)}</a>`,
    agency.website && /^https?:\/\//i.test(agency.website) && `<a href="${esc(agency.website)}" rel="noopener">${esc(agency.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""))}</a>`].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Online presence check · ${esc(l.business_name)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2430; background: #f4f5f8; }
  main { max-width: 760px; margin: 0 auto; padding: 28px 16px 40px; }
  .card { background: #fff; border: 1px solid #e3e6ee; border-radius: 16px; padding: 22px; margin-top: 16px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 0 0 12px; }
  .muted { color: #6b7385; } .small { font-size: 13px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
  .tile { display: flex; gap: 12px; align-items: center; border: 1px solid #e3e6ee; border-radius: 12px; padding: 12px; }
  .ring { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; flex: none; }
  .ring span { width: 50px; height: 50px; border-radius: 50%; background: #fff; display: grid; place-items: center; font-weight: 800; font-size: 18px; }
  .k { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #6b7385; } .v { font-weight: 700; } .s { font-size: 12px; color: #6b7385; }
  ul { margin: 0; padding: 0; list-style: none; } li { padding: 6px 0 6px 28px; position: relative; border-top: 1px solid #f0f1f5; }
  li:first-child { border-top: none; }
  .ok li::before { content: "✓"; color: #15803d; position: absolute; left: 4px; font-weight: 800; }
  .no li::before { content: "✗"; color: #b91c1c; position: absolute; left: 4px; font-weight: 800; }
  ol { margin: 0; padding-left: 22px; } ol li { padding-left: 4px; border-top: none; } ol li::before { content: none; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 620px) { .cols { grid-template-columns: 1fr; } }
  .agency { background: #1f2a44; color: #fff; border: none; } .agency a { color: #c7d2fe; } .agency .muted { color: #c9cfdd; }
  @media print { body { background: #fff; } .card { break-inside: avoid; } }
</style></head><body><main>
<div class="muted small">Online presence check · ${esc(date)}</div>
<h1>${esc(l.business_name)}</h1>
<div class="muted">${esc(where)}${l.website ? ` · ${esc(l.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""))}` : ""}</div>
<div class="card"><div class="tiles">
  ${ring("Overall", l.presence_score, "How easy you are to find and choose online")}
  ${ring("Website", l.website_score, notes.websiteComment ?? "")}
  ${l.gbp_score != null ? ring("Google profile", l.gbp_score, notes.gbpComment ?? "") : ""}
</div></div>
<div class="cols">
  <div class="card"><h2>What's working</h2>${good.length ? `<ul class="ok">${good.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : `<div class="muted">Nothing yet, which means plenty of room to grow.</div>`}</div>
  <div class="card"><h2>What's missing</h2>${bad.length ? `<ul class="no">${bad.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : `<div class="muted">No gaps found in what we checked.</div>`}</div>
</div>
${fixes.length ? `<div class="card"><h2>What we'd fix first</h2><ol>${fixes.map((f) => `<li>${esc(f)}</li>`).join("")}</ol></div>` : ""}
<div class="card agency"><h2>${esc(agency.name || "We can help")}</h2>
  ${agency.blurb ? `<p>${esc(agency.blurb)}</p>` : `<p>We help local businesses get found online and turn visitors into customers.</p>`}
  ${contact ? `<div>${contact}</div>` : ""}</div>
<p class="muted small">Checked from public information${l.checked_at ? ` (website checked ${esc(l.checked_at.slice(0, 10))})` : ""}. Prepared by ${esc(agency.name || "your local marketing team")}.</p>
</main></body></html>`;
}

function token(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** The business's report link token (created the first time). */
export async function ensureReportToken(env: Env, leadId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT report_token FROM leads WHERE id = ?`).bind(leadId).first<{ report_token: string | null }>();
  if (!row) return null;
  if (row.report_token) return row.report_token;
  const t = token();
  await env.DB.prepare(`UPDATE leads SET report_token = ? WHERE id = ? AND report_token IS NULL`).bind(t, leadId).run();
  return (await env.DB.prepare(`SELECT report_token FROM leads WHERE id = ?`).bind(leadId).first<string>("report_token")) ?? t;
}

export async function agencySettings(env: Env): Promise<AgencySettings> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN (${AGENCY_KEYS.map((k) => `'${k}'`).join(", ")})`)
    .all<{ key: string; value: string }>();
  const v = Object.fromEntries(results.map((r) => [r.key, r.value ?? ""]));
  return { name: v.agency_name ?? "", phone: v.agency_phone ?? "", email: v.agency_email ?? "", website: v.agency_website ?? "", blurb: v.agency_blurb ?? "" };
}

export async function saveAgencySettings(env: Env, a: Partial<AgencySettings>) {
  const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
  const site = clip(a.website, 200);
  const values: Record<string, string> = {
    agency_name: clip(a.name, 100), agency_phone: clip(a.phone, 40), agency_email: clip(a.email, 120),
    agency_website: site && !/^https?:\/\//i.test(site) ? `https://${site}` : site, agency_blurb: clip(a.blurb, 600),
  };
  await env.DB.batch(Object.entries(values).map(([k, v]) => env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(k, v)));
}

/** The report for a token, or null. */
export async function reportPage(env: Env, t: string): Promise<string | null> {
  if (!/^[0-9a-f]{32}$/.test(t)) return null;
  const l = await env.DB.prepare(
    `SELECT l.business_name, l.gbp_category, l.city, l.state, l.website, l.presence_score, l.gbp_score, l.website_score, l.score_notes,
            l.rating, l.review_count, l.data_source, a.reachable, a.https, a.mobile_viewport, a.has_contact_form, a.has_booking, a.has_meta_pixel,
            a.has_google_tag, a.has_chat_widget, a.copyright_year, a.psi_score, a.error AS audit_error, a.social_only, a.email_provider, a.checked_at
     FROM leads l LEFT JOIN website_audits a ON a.lead_id = l.id WHERE l.report_token = ?`,
  ).bind(t).first<LeadForReport>();
  if (!l) return null;
  return renderReport(l, await agencySettings(env));
}

