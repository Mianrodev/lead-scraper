// Website check: what each business's website tells us (loads? secure? phone friendly? booking,
// contact form, Meta pixel / Google tag, builder, emails, social pages, copyright year).
//
// The visiting is done by the free collector on GitHub Actions (scripts/website_check.py), not
// here: the Workers free plan allows only milliseconds of work per request, and GitHub's runners
// are free for this public repository. The flow:
//   1. queueNewWebsites (minute job) marks newly saved businesses that have a website 'queued'.
//   2. The collector asks claimWebsites for a batch (status -> 'checking'), within the daily limit.
//   3. It posts findings to saveWebsiteResults: website_audits row, emails, social pages, status
//      'done' / 'failed', and the lead is re-scored (src/scoring.ts).
//   4. websiteWatchdog puts batches a collector never finished back in the queue.

import { rescoreLeads } from "./scoring";
import { startWorkflow } from "./free";
import { registryWaiting } from "./registry";
import { applyToLeads } from "./suppress";

export const BUILDERS = ["wordpress", "wix", "squarespace", "shopify", "godaddy", "weebly", "duda", "webflow", "highlevel", "other"] as const;
const MAX_BATCH = 400;
const STALE_MINUTES = 90;

export interface WebsiteFindings {
  id: string;
  finalUrl: string | null;
  httpStatus: number | null;
  reachable: boolean;
  https: boolean | null;
  socialOnly: boolean;
  title: string | null;
  builder: string | null;
  hasMetaPixel: boolean;
  hasGoogleTag: boolean;
  hasTiktokPixel: boolean;
  hasBooking: boolean;
  bookingTool: string | null;
  hasContactForm: boolean;
  hasChatWidget: boolean;
  mobileViewport: boolean;
  emails: string[];
  socials: string[];
  copyrightYear: number | null;
  pagesChecked: number;
  error: string | null;
  ownerName: string | null;
  ownerTitle: string | null;
  hasGoogleAds: boolean;
  hasBingAds: boolean;
  callTrackingTool: string | null;
  emailProvider: string | null;
  domainCreated: string | null;
  sslExpires: string | null;
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const date = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/** Checks and tidies one result sent by the collector (never trusts its shape). */
export function sanitizeFindings(v: unknown): WebsiteFindings | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 64);
  if (!id || !/^[\w-]+$/.test(id)) return null;
  const builder = str(o.builder, 20)?.toLowerCase() ?? null;
  const emails = Array.isArray(o.emails)
    ? [...new Set(o.emails.map((e) => (typeof e === "string" ? e.trim().toLowerCase() : "")).filter((e) => /^[^@\s]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/.test(e)))].slice(0, 5)
    : [];
  const socials = Array.isArray(o.socials)
    ? [...new Set(o.socials.map((s) => (typeof s === "string" ? s.trim() : "")).filter((s) => /^https:\/\/[^\s"'<>]{4,300}$/i.test(s)))].slice(0, 8)
    : [];
  const year = new Date().getUTCFullYear();
  return {
    id,
    finalUrl: str(o.finalUrl, 500),
    httpStatus: int(o.httpStatus, 100, 599),
    reachable: bool(o.reachable),
    https: o.https == null ? null : bool(o.https),
    socialOnly: bool(o.socialOnly),
    title: str(o.title, 200),
    builder: builder && (BUILDERS as readonly string[]).includes(builder) ? builder : null,
    hasMetaPixel: bool(o.hasMetaPixel),
    hasGoogleTag: bool(o.hasGoogleTag),
    hasTiktokPixel: bool(o.hasTiktokPixel),
    hasBooking: bool(o.hasBooking),
    bookingTool: str(o.bookingTool, 40),
    hasContactForm: bool(o.hasContactForm),
    hasChatWidget: bool(o.hasChatWidget),
    mobileViewport: bool(o.mobileViewport),
    emails,
    socials,
    copyrightYear: int(o.copyrightYear, 1995, year + 1),
    pagesChecked: int(o.pagesChecked, 0, 5) ?? 1,
    error: str(o.error, 200),
    ownerName: str(o.ownerName, 60) && /^[A-Za-z][A-Za-z.'\- ]{2,59}$/.test(String(o.ownerName).trim()) ? str(o.ownerName, 60) : null,
    ownerTitle: str(o.ownerTitle, 40),
    hasGoogleAds: bool(o.hasGoogleAds),
    hasBingAds: bool(o.hasBingAds),
    callTrackingTool: str(o.callTrackingTool, 40),
    emailProvider: str(o.emailProvider, 40),
    domainCreated: date(o.domainCreated),
    sslExpires: date(o.sslExpires),
  };
}

/** Merges social page lists (stored as "url, url"), keeping at most 8. */
export function mergeSocials(existing: string | null, found: string[]): string | null {
  const list = [...(existing ?? "").split(/,\s*/).filter(Boolean), ...found];
  const seen = new Set<string>();
  const out = list.filter((u) => {
    const k = u.toLowerCase().replace(/\/+$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return out.length ? out.slice(0, 8).join(", ") : null;
}

// ---------------------------------------------------------------------------------------
// Settings and daily allowance (writes on the free plan are limited, so checks are paced).

interface CheckSettings { enabled: boolean; limit: number; today: string; checked: number }

async function settings(env: Env): Promise<CheckSettings> {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN ('website_check_enabled', 'website_check_daily_limit', 'website_checks_today')`,
  ).all<{ key: string; value: string }>();
  const v = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const today = new Date().toISOString().slice(0, 10);
  const [day, n] = String(v.website_checks_today ?? "").split(":");
  return { enabled: v.website_check_enabled !== "0", limit: Number(v.website_check_daily_limit) || 3000, today, checked: day === today ? Number(n) || 0 : 0 };
}

const upsert = (env: Env, key: string, value: string) => env.DB.prepare(
  `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
).bind(key, value);

export async function setWebsiteCheckSettings(env: Env, s: { enabled: boolean; limit: number }) {
  if (!Number.isInteger(s.limit) || s.limit < 100 || s.limit > 20000) throw new Error("Pick between 100 and 20,000 website checks a day.");
  await env.DB.batch([upsert(env, "website_check_enabled", s.enabled ? "1" : "0"), upsert(env, "website_check_daily_limit", String(s.limit))]);
}

// Repeats the partial index's own condition (idx_leads_audit_work): SQLite only uses a partial
// index when the query contains its WHERE term, otherwise it reads every business.
const WORK = "website_audit_status IN ('queued', 'checking')";

export async function websiteCheckStatus(env: Env) {
  const s = await settings(env);
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM leads WHERE ${WORK} AND website_audit_status = 'queued') AS queued,
            (SELECT COUNT(*) FROM leads WHERE ${WORK} AND website_audit_status = 'checking') AS checking,
            (SELECT COUNT(*) FROM website_audits) AS done,
            (SELECT value FROM app_settings WHERE key = 'website_checker_seen_at') AS seen`,
  ).first<{ queued: number; checking: number; done: number; seen: string | null }>();
  return { enabled: s.enabled, limit: s.limit, checkedToday: s.checked, queued: counts?.queued ?? 0, checking: counts?.checking ?? 0, done: counts?.done ?? 0, checkerSeenAt: counts?.seen ?? null };
}

// ---------------------------------------------------------------------------------------
// Queueing

const QUEUE_PAGE = 500;

/** Minute job: marks newly saved businesses with a website for checking (in saving order). */
export async function queueNewWebsites(env: Env): Promise<number> {
  const s = await settings(env);
  if (!s.enabled) return 0;
  const marker = Number(await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'website_queue_rowid'`).first<string>("value")) || 0;
  const last = await env.DB.prepare(`SELECT MAX(rid) AS m FROM (SELECT rowid AS rid FROM leads WHERE rowid > ? ORDER BY rowid LIMIT ?)`)
    .bind(marker, QUEUE_PAGE).first<number>("m");
  if (!last) return 0;
  const r = await env.DB.prepare(
    `UPDATE leads SET website_audit_status = 'queued' WHERE rowid > ? AND rowid <= ? AND website_domain IS NOT NULL AND website_audit_status IS NULL`,
  ).bind(marker, last).run();
  await upsert(env, "website_queue_rowid", String(last)).run();
  return r.meta.changes ?? 0;
}

/** "Check websites" for chosen businesses (or re-check). Up to 5,000 at a time. */
export async function queueWebsiteChecks(env: Env, leadIds: string[], opts: { recheck?: boolean } = {}) {
  const ids = [...new Set(leadIds)].slice(0, 5000);
  let queued = 0;
  for (let i = 0; i < ids.length; i += 90) {
    const list = ids.slice(i, i + 90).map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
    const r = await env.DB.prepare(
      `UPDATE leads SET website_audit_status = 'queued'
       WHERE id IN (${list}) AND website_domain IS NOT NULL
         AND (website_audit_status IS NULL OR website_audit_status = 'failed' ${opts.recheck ? "OR website_audit_status = 'done'" : ""})`,
    ).run();
    queued += r.meta.changes ?? 0;
  }
  return { queued };
}

// ---------------------------------------------------------------------------------------
// The collector's side

/** Hands the collector the next batch of websites (within today's allowance). */
export async function claimWebsites(env: Env, max = MAX_BATCH): Promise<{ id: string; url: string }[]> {
  await upsert(env, "website_checker_seen_at", new Date().toISOString().slice(0, 19).replace("T", " ")).run();
  const s = await settings(env);
  const take = Math.min(max, MAX_BATCH, s.limit - s.checked);
  if (!s.enabled || take <= 0) return [];
  const { results } = await env.DB.prepare(
    `SELECT id, website FROM leads WHERE ${WORK} AND website_audit_status = 'queued' ORDER BY website_audit_status, website_audit_at LIMIT ?`,
  ).bind(take).all<{ id: string; website: string }>();
  if (!results.length) return [];
  const list = results.map((r) => `'${r.id.replace(/'/g, "''")}'`).join(", ");
  await env.DB.batch([
    env.DB.prepare(`${CLAIM_SQL} WHERE id IN (${list})`),
    upsert(env, "website_checks_today", `${s.today}:${s.checked + results.length}`),
  ]);
  return results.map((r) => ({ id: r.id, url: r.website }));
}

const AUDIT_COLUMNS = [
  "final_url", "http_status", "reachable", "https", "social_only", "title", "builder",
  "has_meta_pixel", "has_google_tag", "has_tiktok_pixel", "has_booking", "booking_tool", "has_contact_form", "has_chat_widget", "mobile_viewport",
  "emails_found", "socials_found", "copyright_year", "pages_checked", "error", "psi_status",
  "owner_name", "owner_title", "has_google_ads", "has_bing_ads", "call_tracking", "email_provider", "domain_created", "ssl_expires",
];
/**
 * One row per business, updated in place (INSERT OR REPLACE would delete and re-insert, writing
 * every index twice). The old speed result is cleared, as the new check queues a fresh one.
 */
export const AUDIT_UPSERT_SQL = `INSERT INTO website_audits (lead_id, checked_at, ${AUDIT_COLUMNS.join(", ")})
  VALUES (?, datetime('now'), ${AUDIT_COLUMNS.map(() => "?").join(", ")})
  ON CONFLICT(lead_id) DO UPDATE SET checked_at = excluded.checked_at, ${AUDIT_COLUMNS.map((c) => `${c} = excluded.${c}`).join(", ")},
    psi_score = NULL, psi_lcp_ms = NULL, psi_checked_at = NULL, psi_error = NULL`;

/** Saves the collector's findings and re-scores those businesses. */
export async function saveWebsiteResults(env: Env, raw: unknown[]): Promise<{ saved: number }> {
  const found = raw.map(sanitizeFindings).filter((f): f is WebsiteFindings => !!f).slice(0, 500);
  if (!found.length) return { saved: 0 };
  const list = found.map((f) => `'${f.id}'`).join(", ");
  const { results: leads } = await env.DB.prepare(
    `SELECT id, socials, (SELECT COUNT(*) FROM lead_emails e WHERE e.lead_id = leads.id) AS n_emails,
            (SELECT group_concat(email, ' ') FROM lead_emails e WHERE e.lead_id = leads.id) AS emails
     FROM leads WHERE id IN (${list})`,
  ).all<{ id: string; socials: string | null; n_emails: number; emails: string | null }>();
  const byId = new Map(leads.map((l) => [l.id, l]));
  const st: D1PreparedStatement[] = [];
  const saved: string[] = [];
  const newEmails: string[] = [];
  for (const f of found) {
    const lead = byId.get(f.id);
    if (!lead) continue;
    saved.push(f.id);
    const b = (x: boolean) => (x ? 1 : 0);
    st.push(env.DB.prepare(AUDIT_UPSERT_SQL).bind(
      f.id, f.finalUrl, f.httpStatus, b(f.reachable), f.https == null ? null : b(f.https), b(f.socialOnly), f.title, f.builder,
      b(f.hasMetaPixel), b(f.hasGoogleTag), b(f.hasTiktokPixel), b(f.hasBooking), f.bookingTool, b(f.hasContactForm), b(f.hasChatWidget),
      b(f.mobileViewport), f.emails.length, f.socials.length, f.copyrightYear, f.pagesChecked, f.error,
      // Speed is measured separately (src/pagespeed.ts), for sites that load.
      f.reachable && !f.socialOnly ? "queued" : null,
      f.ownerName, f.ownerName ? f.ownerTitle : null, b(f.hasGoogleAds), b(f.hasBingAds), f.callTrackingTool,
      f.emailProvider, f.domainCreated, f.sslExpires,
    ));
    const socials = f.socials.length ? mergeSocials(lead.socials, f.socials) : lead.socials;
    st.push(env.DB.prepare(
      `UPDATE leads SET website_audit_status = ?, website_audit_at = datetime('now'), socials = ?,
         owner_title = CASE WHEN owner_name IS NULL AND ? IS NOT NULL THEN ? ELSE owner_title END,
         owner_source = CASE WHEN owner_name IS NULL AND ? IS NOT NULL THEN 'website' ELSE owner_source END,
         owner_name = COALESCE(owner_name, ?) WHERE id = ?`,
    ).bind(f.reachable || f.socialOnly ? "done" : "failed", socials, f.ownerName, f.ownerTitle, f.ownerName, f.ownerName, f.id));
    const have = new Set((lead.emails ?? "").split(" ").filter(Boolean));
    let pos = lead.n_emails;
    for (const e of f.emails) {
      if (pos >= 5 || have.has(e)) continue;
      have.add(e);
      st.push(env.DB.prepare(`INSERT OR IGNORE INTO lead_emails (lead_id, email, position) VALUES (?, ?, ?)`).bind(f.id, e, pos++));
      if (newEmails[newEmails.length - 1] !== f.id) newEmails.push(f.id);
    }
  }
  for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));
  // An email found on the website may be on the do-not-contact list.
  await applyToLeads(env, newEmails);
  await rescoreLeads(env, saved);
  return { saved: saved.length };
}

// How often the watchdog puts a site back before giving up on it ('failed'): a site that
// crashes the checker every time would otherwise eat the daily allowance forever. The count
// rides on website_audit_at as a suffix ("2026-09-30 10:00:00 #2"); it's only read here, the
// time part still sorts and compares as before, and a finished check clears it.
export const MAX_REQUEUES = 2;
const requeues = "CAST(COALESCE(substr(website_audit_at, 22), '0') AS INTEGER)";

/** Taking sites for a batch: the claim time, keeping any re-queue count. */
export const CLAIM_SQL = `UPDATE leads SET website_audit_status = 'checking',
  website_audit_at = datetime('now') || COALESCE(substr(website_audit_at, 20), '')`;

/**
 * Stale batches: back in the queue (spread over the next hour's order, so the same sites don't
 * travel together again) with the count raised, or 'failed' after MAX_REQUEUES.
 */
export const WATCHDOG_SQL = `UPDATE leads SET
    website_audit_status = CASE WHEN ${requeues} >= ${MAX_REQUEUES} THEN 'failed' ELSE 'queued' END,
    website_audit_at = CASE WHEN ${requeues} >= ${MAX_REQUEUES} THEN datetime('now')
      ELSE datetime('now', '+' || (abs(random()) % 3600) || ' seconds') || ' #' || (${requeues} + 1) END
  WHERE ${WORK} AND website_audit_status = 'checking' AND website_audit_at < datetime('now', ?)`;

/** Batches the collector took but never finished go back in the queue. */
export async function websiteWatchdog(env: Env): Promise<number> {
  const r = await env.DB.prepare(WATCHDOG_SQL).bind(`-${STALE_MINUTES} minutes`).run();
  return r.meta.changes ?? 0;
}

const NUDGE_MINUTES = 15;

/**
 * GitHub's 10-minute schedule is best-effort (it can be late or skipped), so when websites are
 * waiting and the checker hasn't asked for work in a while, start it directly (needs the
 * GitHub token; without one the schedule is the only way).
 */
export async function nudgeChecker(env: Env): Promise<boolean> {
  if (!(env as { GITHUB_DISPATCH_TOKEN?: string }).GITHUB_DISPATCH_TOKEN) return false;
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN ('website_checker_seen_at', 'website_dispatch_at', 'registry_seen_at')`,
  ).all<{ key: string; value: string }>();
  const v = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const recent = (t?: string) => !!t && Date.parse(t.replace(" ", "T") + "Z") > Date.now() - NUDGE_MINUTES * 60_000;
  if (recent(v.website_dispatch_at)) return false;
  // Websites waiting and the checker quiet, or registry look-ups waiting and that job quiet.
  const sites = !recent(v.website_checker_seen_at) && (await websitesWaiting(env));
  const registry = !sites && !recent(v.registry_seen_at) && (await registryWaiting(env)).length > 0;
  if (!sites && !registry) return false;
  await upsert(env, "website_dispatch_at", new Date().toISOString().slice(0, 19).replace("T", " ")).run();
  const res = await startWorkflow(env).catch(() => null);
  return res?.status === 204;
}

/** Is anything waiting? (cheap; the collector's scheduled check asks this first) */
export async function websitesWaiting(env: Env): Promise<boolean> {
  const s = await settings(env);
  if (!s.enabled || s.checked >= s.limit) return false;
  return !!(await env.DB.prepare(`SELECT 1 AS x FROM leads WHERE ${WORK} AND website_audit_status = 'queued' LIMIT 1`).first());
}
