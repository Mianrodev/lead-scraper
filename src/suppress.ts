// Do-not-contact list: existing clients, people who asked not to be contacted, anyone else to
// leave alone. Entries are phone numbers, email addresses or website domains. A business that
// matches any entry is marked (leads.suppressed = the reason) and is hidden from lists and
// downloads by default, now and for businesses collected later.

import { toE164, websiteDomain } from "./normalize";
import { ValidationError } from "./pipeline";
import { clearCountCaches, sqlString } from "./leads";
import { logEvent } from "./events";

export const REASONS = ["client", "asked_to_stop", "other"] as const;
export type Reason = (typeof REASONS)[number];
export const REASON_WORDS: Record<Reason, string> = { client: "Client", asked_to_stop: "Asked not to be contacted", other: "Do not contact" };

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/gi;

/** Finds phones, emails and websites in pasted text or a CSV (any columns, any order). */
export function parseSuppressionText(text: string): { phones: string[]; emails: string[]; domains: string[] } {
  const t = (text ?? "").slice(0, 2_000_000);
  const emails = [...new Set((t.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
  const withoutEmails = t.replace(EMAIL_RE, " ");
  const phones = [...new Set((withoutEmails.match(PHONE_RE) ?? []).map((p) => toE164(p, "US")).filter((p): p is string => !!p))];
  const domains = [...new Set((withoutEmails.match(URL_RE) ?? []).map((u) => websiteDomain(u)).filter((d): d is string => !!d && d.includes(".")))];
  return { phones, emails, domains };
}

const lit = (values: string[]) => values.map(sqlString).join(", ");

/** Marks every business matching these values (in chunks, using the phone / domain / email indexes). */
async function markMatches(env: Env, kind: string, values: string[], reason: string) {
  for (let i = 0; i < values.length; i += 90) {
    const list = lit(values.slice(i, i + 90));
    // A phone can be the main (Google) number or one found on the business's website.
    const where = kind === "phone" ? `(gbp_phone_formatted IN (${list}) OR id IN (SELECT lead_id FROM lead_phones WHERE phone IN (${list})))`
      : kind === "domain" ? `website_domain IN (${list})`
        : `id IN (SELECT lead_id FROM lead_emails WHERE email IN (${list}))`;
    await env.DB.prepare(`UPDATE leads SET suppressed = ? WHERE suppressed IS NULL AND ${where}`).bind(reason).run();
  }
}

export async function addSuppressions(env: Env, text: string, reason: string, note: string | null, userId: string | null) {
  if (!(REASONS as readonly string[]).includes(reason)) throw new ValidationError("Pick a reason.");
  const { phones, emails, domains } = parseSuppressionText(text);
  const items = [...phones.map((v) => ["phone", v]), ...emails.map((v) => ["email", v]), ...domains.map((v) => ["domain", v])];
  if (!items.length) throw new ValidationError("No phone numbers, emails or websites found in that text.");
  if (items.length > 20000) throw new ValidationError("Up to 20,000 entries at a time.");
  // RETURNING gives the ids of the entries actually created (ones already listed are skipped).
  const st = items.map(([kind, value]) => env.DB.prepare(
    `INSERT OR IGNORE INTO suppressions (kind, value, reason, note, added_by) VALUES (?, ?, ?, ?, ?) RETURNING id`,
  ).bind(kind, value, reason, note?.slice(0, 200) ?? null, userId));
  const entryIds: number[] = [];
  let added = 0;
  for (let i = 0; i < st.length; i += 90) {
    const res = await env.DB.batch<{ id: number }>(st.slice(i, i + 90));
    for (const r of res) {
      const ids = (r.results ?? []).map((x) => Number(x.id)).filter(Number.isFinite);
      entryIds.push(...ids);
      added += r.results ? ids.length : (r.meta?.changes ?? 0);
    }
  }
  await markMatches(env, "phone", phones, reason);
  await markMatches(env, "email", emails, reason);
  await markMatches(env, "domain", domains, reason);
  await clearCountCaches(env);
  const matched = await env.DB.prepare(`SELECT COUNT(*) AS n FROM leads WHERE suppressed IS NOT NULL`).first<number>("n");
  return { found: items.length, added, entryIds, phones: phones.length, emails: emails.length, domains: domains.length, businessesHidden: matched ?? 0 };
}

/**
 * Puts one business (its phone, website and emails) on the list. entryIds are the list entries
 * created, so the page can offer Undo (DELETE /api/dnc/:id for each).
 */
export async function suppressLead(env: Env, leadId: string, reason: string, userId: string | null) {
  const l = await env.DB.prepare(
    `SELECT business_name AS name, gbp_phone_formatted AS phone, website_domain AS domain, (SELECT group_concat(email, ' ') FROM lead_emails e WHERE e.lead_id = leads.id) AS emails
     FROM leads WHERE id = ?`,
  ).bind(leadId).first<{ name: string | null; phone: string | null; domain: string | null; emails: string | null }>();
  if (!l) throw new ValidationError("That business wasn't found.");
  const text = [l.phone, l.domain, l.emails].filter(Boolean).join(" ");
  if (!text) {
    // Nothing to match on later: mark just this business.
    await env.DB.prepare(`UPDATE leads SET suppressed = ? WHERE id = ?`).bind(reason, leadId).run();
    await clearCountCaches(env);
    await logEvent(env, leadId, "dnc", `Do not contact (${reason})`, userId).catch((err) => console.error("lead history write failed", err));
    return { found: 0, added: 0, entryIds: [] as number[], business: l.name };
  }
  const r = await addSuppressions(env, text, reason, dncNote(l.name), userId);
  await env.DB.prepare(`UPDATE leads SET suppressed = ? WHERE id = ?`).bind(reason, leadId).run();
  await logEvent(env, leadId, "dnc", `Do not contact (${reason})`, userId).catch((err) => console.error("lead history write failed", err));
  return { ...r, business: l.name };
}

/** "Chase Roofing (added from its business window)", kept within the note's 200 characters. */
export function dncNote(business: string | null): string {
  const tail = " (added from its business window)";
  const name = (business ?? "").trim().replace(/\s+/g, " ");
  if (!name) return "Added from a business window";
  return (name.length + tail.length > 200 ? `${name.slice(0, 200 - tail.length - 1)}…` : name) + tail;
}

/** "+18137829400" -> "(813) 782-9400"; other countries "+<digits>" (how the list shows a phone entry). */
export function displayPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return digits ? `+${digits}` : e164;
}

/** Takes an entry off the list and re-checks the businesses it was hiding. */
export async function removeSuppression(env: Env, id: number) {
  const s = await env.DB.prepare(`SELECT kind, value FROM suppressions WHERE id = ?`).bind(id).first<{ kind: string; value: string }>();
  if (!s) return;
  await env.DB.prepare(`DELETE FROM suppressions WHERE id = ?`).bind(id).run();
  const where = s.kind === "phone" ? "(gbp_phone_formatted = ?1 OR id IN (SELECT lead_id FROM lead_phones WHERE phone = ?1))" : s.kind === "domain" ? "website_domain = ?" : "id IN (SELECT lead_id FROM lead_emails WHERE email = ?)";
  const { results } = await env.DB.prepare(`SELECT id FROM leads WHERE ${where}`).bind(s.value).all<{ id: string }>();
  const ids = results.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 90) {
    await env.DB.prepare(`UPDATE leads SET suppressed = NULL WHERE id IN (${lit(ids.slice(i, i + 90))})`).run();
  }
  await applyToLeads(env, ids);
  await clearCountCaches(env);
  return s;
}

/**
 * Checks these businesses against the whole list: new businesses, after a removal, and whenever
 * a phone, email or website is added to an existing business (website check, Google details).
 */
export async function applyToLeads(env: Env, leadIds: string[]) {
  if (!leadIds.length || !(await env.DB.prepare(`SELECT 1 AS x FROM suppressions LIMIT 1`).first())) return;
  for (let i = 0; i < leadIds.length; i += 90) {
    const ids = lit(leadIds.slice(i, i + 90));
    await env.DB.batch([
      env.DB.prepare(`UPDATE leads SET suppressed = (SELECT reason FROM suppressions s WHERE s.kind = 'phone' AND s.value = leads.gbp_phone_formatted)
        WHERE id IN (${ids}) AND suppressed IS NULL AND gbp_phone_formatted IN (SELECT value FROM suppressions WHERE kind = 'phone')`),
      env.DB.prepare(`UPDATE leads SET suppressed = (SELECT reason FROM suppressions s WHERE s.kind = 'domain' AND s.value = leads.website_domain)
        WHERE id IN (${ids}) AND suppressed IS NULL AND website_domain IN (SELECT value FROM suppressions WHERE kind = 'domain')`),
      env.DB.prepare(`UPDATE leads SET suppressed = (SELECT s.reason FROM suppressions s JOIN lead_emails e ON e.email = s.value WHERE s.kind = 'email' AND e.lead_id = leads.id LIMIT 1)
        WHERE id IN (${ids}) AND suppressed IS NULL AND id IN (SELECT e.lead_id FROM lead_emails e JOIN suppressions s ON s.kind = 'email' AND s.value = e.email)`),
      env.DB.prepare(`UPDATE leads SET suppressed = (SELECT s.reason FROM suppressions s JOIN lead_phones p ON p.phone = s.value WHERE s.kind = 'phone' AND p.lead_id = leads.id LIMIT 1)
        WHERE id IN (${ids}) AND suppressed IS NULL AND id IN (SELECT p.lead_id FROM lead_phones p JOIN suppressions s ON s.kind = 'phone' AND s.value = p.phone)`),
    ]);
  }
}

/** Minute job: new businesses are checked against the list (in saving order). */
export async function suppressStep(env: Env): Promise<number> {
  const marker = Number(await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'suppress_rowid'`).first<string>("value")) || 0;
  const { results } = await env.DB.prepare(`SELECT rowid AS rid, id FROM leads WHERE rowid > ? ORDER BY rowid LIMIT 500`).bind(marker).all<{ rid: number; id: string }>();
  if (!results.length) return 0;
  await applyToLeads(env, results.map((r) => r.id));
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('suppress_rowid', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(String(results[results.length - 1].rid)).run();
  return results.length;
}

export async function listSuppressions(env: Env, search: string, page: number) {
  const q = `%${(search ?? "").trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const limit = 100, offset = Math.max(0, (page - 1) * limit);
  const [rows, count, hidden] = await env.DB.batch([
    env.DB.prepare(`SELECT id, kind, value, reason, note, created_at, (SELECT COALESCE(NULLIF(name, ''), 'Team member') FROM users u WHERE u.id = suppressions.added_by) AS added_by
      FROM suppressions WHERE lower(value) LIKE ? ESCAPE '\\' OR lower(COALESCE(note, '')) LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ? OFFSET ?`).bind(q, q, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM suppressions`),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM leads WHERE suppressed IS NOT NULL`),
  ]);
  // display: how to show the entry ("(813) 782-9400" for a phone; emails and websites as stored).
  const results = (rows.results as { id: number; kind: string; value: string; reason: string; note: string | null; created_at: string; added_by: string | null }[]).map((r) => ({ ...r, display: r.kind === "phone" ? displayPhone(r.value) : r.value }));
  return { results, total: (count.results[0] as { n: number }).n, businessesHidden: (hidden.results[0] as { n: number }).n };
}
