// Operational helpers: activity log, notifications, and the monthly spending limit.

import type { User } from "./auth";

// --- Activity log -------------------------------------------------------------

/** Records an action, the owner's (super admin) included, so every change to the team, budget, settings or lists is on record. */
export async function audit(env: Env, user: Pick<User, "id" | "name" | "role"> | null, action: string, details: Record<string, unknown> = {}) {
  try {
    await env.DB.prepare(`INSERT INTO audit_log (user_id, user_name, action, details) VALUES (?, ?, ?, ?)`)
      .bind(user?.id ?? null, user?.name ?? null, action, JSON.stringify(details))
      .run();
  } catch (err) {
    console.error("audit log write failed", err); // never block the action itself
  }
}

export async function listAudit(env: Env, params: URLSearchParams) {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (params.get("user")) {
    clauses.push("user_id = ?");
    binds.push(params.get("user"));
  }
  if (params.get("action")) {
    clauses.push("action = ?");
    binds.push(params.get("action"));
  }
  const range = dayRange(params.get("from"), params.get("to"), params.get("tzo"));
  if (range.from) {
    clauses.push("at >= ?");
    binds.push(range.from);
  }
  if (range.to) {
    clauses.push("at < ?");
    binds.push(range.to);
  }
  const page = Math.max(Number(params.get("page")) || 1, 1);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows, total, actions] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT 100 OFFSET ?`).bind(...binds, (page - 1) * 100),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log ${where}`).bind(...binds),
    env.DB.prepare(`SELECT DISTINCT action FROM audit_log ORDER BY action`),
  ]);
  return {
    total: (total.results[0] as { n: number }).n,
    page,
    results: rows.results.map((r) => {
      const row = r as { action: string; details: string | null };
      let details: unknown = null;
      try {
        details = row.details ? JSON.parse(row.details) : null;
      } catch {
        details = row.details;
      }
      return { ...row, details, summary: auditSummary(row.action, details) };
    }),
    actions: actions.results.map((a) => (a as { action: string }).action),
  };
}

// --- Dates in the viewer's own time zone ---------------------------------------------

/** The browser's Date.getTimezoneOffset() (minutes, e.g. 240 in New York in summer), or null. */
export function parseTzo(value: string | null | undefined): number | null {
  if (value == null || !/^-?\d{1,4}$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= -840 && n <= 840 ? n : null;
}

/** Start of a local day (YYYY-MM-DD, plus `plusDays`) as a stored UTC time "YYYY-MM-DD HH:MM:SS". */
export function localDayStartUtc(ymd: string, tzo: number, plusDays = 0): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + plusDays) + tzo * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * from / to (YYYY-MM-DD, both days included) as bounds on a stored UTC time: [from, to).
 * With `tzo` the days are the viewer's local days; without it, UTC days (as before).
 */
export function dayRange(from: string | null, to: string | null, tzoParam?: string | null): { from: string | null; to: string | null } {
  const ok = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const tzo = parseTzo(tzoParam) ?? 0;
  const f = ok(from), t = ok(to);
  return { from: f ? localDayStartUtc(f, tzo) : null, to: t ? localDayStartUtc(t, tzo, 1) : null };
}

// --- Activity log in plain words ---------------------------------------------------------

const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `$${v.toFixed(2)}` : null);
const count = (v: unknown, one: string, many = `${one}s`) => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString("en-US")} ${n === 1 ? one : many}` : null;
};
const words = (v: unknown, max = 3): string => {
  const list = (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String).filter(Boolean);
  if (list.length <= max) return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0] ?? "";
  return `${list.slice(0, max).join(", ")} and ${list.length - max} more`;
};
const placeOf = (d: Record<string, unknown>) => [d.city, d.state].filter((x) => typeof x === "string" && x).join(", ");
const what = (d: Record<string, unknown>) => {
  const types = words(d.types ?? d.category), places = words(d.places) || placeOf(d);
  return [types, places].filter(Boolean).join(" in ");
};
const REASON_TEXT: Record<string, string> = { client: "client", asked_to_stop: "asked not to be contacted", other: "do not contact" };
const ROLE_TEXT: Record<string, string> = { admin: "an admin", member: "a member", super_admin: "the owner" };
// Download filters in plain words (the usual "open" and "verified" filters go without saying).
const FILTER_TEXT: Record<string, (v: string) => string | null> = {
  status: (v) => (v === "operational" ? null : `open / closed: ${v.replace(/_/g, " ").replace("operational", "open")}`),
  verified: (v) => (v === "verified" ? null : `verified: ${v}`),
  category: (v) => `type: ${v}`, industry: (v) => `industry: ${v}`, city: (v) => `city: ${v.replace(/\|/g, ", ")}`, state: (v) => `state: ${v}`,
  lead_status: (v) => `stage: ${v}`, q: (v) => `name contains “${v}”`, format: (v) => (v === "cold_email" ? "cold email file" : v === "simple" ? "simple spreadsheet" : "GoHighLevel file"),
  data_source: (v) => `data: ${v.replace("free+google", "open map data + Google").replace("free", "open map data").replace("google", "Google Maps")}`,
  search_id: () => "chosen searches", id: (v) => count(v.split(",").length, "picked business", "picked businesses"), assigned: () => "assigned to someone",
  phone_type: (v) => `phone type: ${v.replace(/_/g, " ")}`, website: (v) => `website: ${v.replace(/_/g, " ")}`, email: (v) => `email: ${v}`,
  dnc: (v) => (v === "only" ? "only do-not-contact" : "including do-not-contact"),
  page: () => null, page_size: () => null, sort: () => null, dir: () => null,
};

/** One plain sentence for an activity-log row (no raw keys). */
export function auditSummary(action: string, detailsIn: unknown): string {
  const d = (detailsIn && typeof detailsIn === "object" ? detailsIn : {}) as Record<string, unknown>;
  const name = typeof d.name === "string" && d.name ? d.name : "a team member";
  const cost = (k: string, prefix = "about ") => (money(d[k]) ? ` (${prefix}${money(d[k])})` : "");
  switch (action) {
    case "signed_in": return "Signed in";
    case "signed_out": return "Signed out";
    case "sign_in_failed": return "Tried to sign in with a wrong password";
    case "password_changed": return "Changed their password";
    case "team_member_added": return `Added ${name} to the team as ${ROLE_TEXT[String(d.role)] ?? "a member"}`;
    case "team_member_changed": {
      const parts = [
        d.active === true ? "switched on" : d.active === false ? "switched off" : "",
        typeof d.role === "string" ? `made ${ROLE_TEXT[d.role] ?? d.role}` : "",
        d.passwordReset ? "password reset" : "",
        typeof d.newName === "string" ? `renamed to ${d.newName}` : "",
      ].filter(Boolean);
      return `Changed ${name}’s account${parts.length ? `: ${parts.join(", ")}` : ""}`;
    }
    case "pull_started": {
      const n = Number(d.searches);
      const searches = Number.isFinite(n) && n > 1 ? `${n} searches` : "a search";
      const limit = typeof d.maxResults === "number" && d.maxResults > 0 ? `, up to ${d.maxResults.toLocaleString("en-US")} each` : "";
      return `Started ${searches} for ${what(d) || "businesses"}${limit}${cost(d.estimatedCostUsd != null ? "estimatedCostUsd" : "costUsd")}`;
    }
    case "pull_resumed": return `Resumed the search for ${what(d)}`;
    case "pull_cancelled": return `Stopped the search for ${what(d)}`;
    case "counts_checked": return `Checked Google counts for ${what(d)}${cost("costUsd", "")}`;
    case "phone_checks_started": return `Started phone checks for ${what(d)}${cost("estimatedCostUsd")}`;
    case "phone_checks_requested": return `Asked for phone checks on ${count(d.count, "business", "businesses") ?? "some businesses"}${d.recheck ? " (checking again)" : ""}${cost("maxCostUsd", "at most ")}`;
    case "csv_downloaded": {
      const f = (d.filters && typeof d.filters === "object" ? d.filters : {}) as Record<string, unknown>;
      const parts = Object.entries(f).map(([k, v]) => (FILTER_TEXT[k] ? FILTER_TEXT[k](String(v)) : `${k.replace(/_/g, " ")}: ${String(v)}`)).filter(Boolean);
      return `Downloaded a list${parts.length ? ` (${parts.join("; ")})` : ""}`;
    }
    case "harvest_added": return `Added ${count(d.added, "search", "searches") ?? "searches"} to the daily free collection`;
    case "harvest_removed": return "Removed a search from the daily free collection";
    case "harvest_settings_changed": return `Daily free collection ${d.enabled ? "switched on" : "switched off"}${typeof d.target === "number" ? `, ${d.target.toLocaleString("en-US")} a day` : ""}`;
    case "google_details_started": return `Started Google details for ${count(d.count, "business", "businesses") ?? "some businesses"}${cost("estimatedCostUsd")}`;
    case "leads_updated": {
      const n = count(d.count, "business", "businesses") ?? "some businesses";
      if (d.undo) return `Undid a change to ${n}`;
      // assignedName: a name, or null for "unassigned" (absent when the assignment didn't change).
      const assign = typeof d.assignedName === "string" ? `assigned to ${d.assignedName}`
        : "assignedName" in d && d.assignedName === null ? "unassigned"
          : typeof d.assigned === "string" ? "assigned to a team member" : "";
      const parts = [typeof d.status === "string" ? `stage set to ${d.status}` : "", assign].filter(Boolean);
      return `Changed ${n}${parts.length ? `: ${parts.join(", ")}` : ""}`;
    }
    case "list_uploaded": return `Uploaded the list “${typeof d.name === "string" ? d.name : "list"}”${d.rows != null ? ` (${count(d.rows, "row")}, ${count(d.added, "new business", "new businesses") ?? "0 new"})` : ""}`;
    case "api_key_created": return `Created the API key “${name}”${d.canCollect ? " (can start searches)" : ""}`;
    case "api_key_revoked": return "Revoked an API key";
    case "webhook_added": return `Added a webhook${typeof d.url === "string" ? ` to ${d.url}` : ""}`;
    case "webhook_deleted": return "Deleted a webhook";
    case "store_settings_changed": {
      if (d.launch) return "Changed the store’s launch settings (packs, email sender, card payments)";
      const parts = [
        money(d.priceFree) ? `open-data lead ${money(d.priceFree)}` : "", money(d.priceGoogle) ? `Google lead ${money(d.priceGoogle)}` : "",
        typeof d.signupOpen === "boolean" ? `sign-up ${d.signupOpen ? "open" : "closed"}` : "",
        typeof d.welcomeCredits === "number" ? `${count(d.welcomeCredits, "welcome credit")}` : "",
        typeof d.freePerMonth === "number" ? `${count(d.freePerMonth, "free lead")} a month` : "",
      ].filter(Boolean);
      return `Changed the store settings${parts.length ? `: ${parts.join(", ")}` : ""}`;
    }
    case "store_account_status": return `Set a store account to ${String(d.status ?? "a new status")}${d.previous ? ` (was ${String(d.previous)})` : ""}${Number(d.welcomeCredits) > 0 ? `, ${count(d.welcomeCredits, "welcome credit")} given` : ""}`;
    case "store_credits_changed": {
      const delta = Number(d.delta);
      return `${delta < 0 ? "Took" : "Gave"} ${count(Math.abs(delta), "credit") ?? "credits"} ${delta < 0 ? "from" : "to"} a store account${d.balance != null ? ` (now ${count(d.balance, "credit")})` : ""}`;
    }
    case "store_password_reset": return "Reset a store customer’s password";
    case "store_removal_request": return `${d.action === "approve" || d.action === "done" ? "Handled" : "Answered"} a removal request${typeof d.business === "string" && d.business ? ` for ${d.business}` : ""}${Number(d.added) > 0 ? ` (${count(d.added, "do-not-contact entry", "do-not-contact entries")} added)` : ""}`;
    case "emails_verification_started": return `Started email checks for ${count(d.count, "address", "addresses") ?? "some addresses"}`;
    case "dnc_added": return `Added ${count(d.entries, "entry", "entries") ?? "entries"} to do-not-contact${typeof d.business === "string" && d.business ? ` for ${d.business}` : ""}${d.reason ? ` (${REASON_TEXT[String(d.reason)] ?? String(d.reason)})` : ""}`;
    case "dnc_removed": {
      const v = typeof d.value === "string" ? d.value : "";
      const us = d.kind === "phone" ? v.replace(/\D/g, "").match(/^1(\d{3})(\d{3})(\d{4})$/) : null;
      return `Took ${us ? `(${us[1]}) ${us[2]}-${us[3]}` : v || "an entry"} off do-not-contact`;
    }
    case "opener_templates_changed": return "Changed the opener wording";
    case "form_link_changed": return "Made a new link for the free-check form";
    case "score_weights_changed": return "Changed how the scores are weighted";
    case "saved_search_added": return `Saved the search “${name}”`;
    case "saved_search_deleted": return `Deleted the saved search${typeof d.name === "string" ? ` “${d.name}”` : ""}`;
    case "website_check_settings": return `Website checks ${d.enabled ? "switched on" : "switched off"}${typeof d.limit === "number" ? `, up to ${d.limit.toLocaleString("en-US")} a day` : ""}`;
    case "website_check_started": return `Started website checks for ${count(d.count, "business", "businesses") ?? "some businesses"}${d.recheck ? " (checking again)" : ""}`;
    case "maintenance_backfill": return "Recomputed stored details (maintenance)";
    case "notification_dismissed": return "Dismissed a notification";
    case "notifications_dismissed_all": return `Dismissed all notifications${d.count != null ? ` (${Number(d.count).toLocaleString("en-US")})` : ""}`;
    case "budget_changed": return `Set the monthly budget to ${money(d.amount) ?? "a new amount"}${money(d.previous) ? ` (was ${money(d.previous)})` : ""}`;
    case "free_limit_changed": return Number(d.dailyLimit) === 0 ? "Removed the daily limit on free saving" : `Set the daily free saving limit to ${count(d.dailyLimit, "business", "businesses")}`;
    case "agency_settings_changed": return "Changed the agency details (name, contact, report wording)";
    case "backup_started": return "Started a backup";
    default: {
      const s = action.replace(/_/g, " ");
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
  }
}

// --- Notifications --------------------------------------------------------------

export async function notify(
  env: Env,
  n: { kind: string; level?: "info" | "warn" | "error"; message: string; dedupeKey?: string },
) {
  try {
    if (n.dedupeKey) {
      // Any earlier one with the same key (even dismissed) suppresses it: the keys carry their
      // period (day, month, pull), so a dismissed alert doesn't come straight back.
      const open = await env.DB.prepare(`SELECT id FROM notifications WHERE dedupe_key = ?`)
        .bind(n.dedupeKey)
        .first();
      if (open) return;
    }
    await env.DB.prepare(`INSERT INTO notifications (kind, level, message, dedupe_key) VALUES (?, ?, ?, ?)`)
      .bind(n.kind, n.level ?? "warn", n.message.slice(0, 1000), n.dedupeKey ?? null)
      .run();
  } catch (err) {
    console.error("notification write failed", err);
  }
}

/** Warnings that can come back day after day: shown once, and dismissing clears them all. */
const REPEATING = ["credit", "counts", "phones_paused", "budget"];

export async function listNotifications(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, level, kind, message FROM notifications
     WHERE dismissed_at IS NULL AND created_at >= datetime('now', '-30 days')
       -- Service warnings (credit, counts, phone checks, budget): only the newest of each kind.
       AND (kind NOT IN (${REPEATING.map((k) => `'${k}'`).join(", ")})
            OR id = (SELECT MAX(n2.id) FROM notifications n2 WHERE n2.kind = notifications.kind AND n2.dismissed_at IS NULL))
     ORDER BY id DESC LIMIT 50`,
  ).all();
  return results;
}

/** Dismisses every notification still showing; returns how many. */
export async function dismissAllNotifications(env: Env, userId: string): Promise<number> {
  const r = await env.DB.prepare(`UPDATE notifications SET dismissed_at = datetime('now'), dismissed_by = ? WHERE dismissed_at IS NULL`).bind(userId).run();
  return r.meta.changes ?? 0;
}

// --- Retrying a read once ----------------------------------------------------------------

/** Errors D1 sometimes gives for a moment (a restart, a busy or locked database). */
export function isTransientDbError(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err);
  return /internal error|busy|locked|network connection lost|connection reset|timed? ?out|overloaded/i.test(m)
    && !/exceeded|limit|syntax|no such|constraint/i.test(m);
}

/**
 * Runs a read; on a passing database hiccup, logs the real error and tries once more.
 * Only for reads (or idempotent work): a write could happen twice.
 */
export async function retryRead<T>(what: string, fn: () => Promise<T>, waitMs = 150): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    console.error(`${what}: database hiccup, trying again`, err);
    await new Promise((r) => setTimeout(r, waitMs));
    try {
      return await fn();
    } catch (err2) {
      console.error(`${what}: failed again`, err2);
      throw err2;
    }
  }
}

export async function dismissNotification(env: Env, id: number, userId: string) {
  await env.DB.prepare(
    `UPDATE notifications SET dismissed_at = datetime('now'), dismissed_by = ?
     WHERE dismissed_at IS NULL AND (id = ? OR (kind IN (${REPEATING.map((k) => `'${k}'`).join(", ")}) AND kind = (SELECT kind FROM notifications WHERE id = ?)))`,
  ).bind(userId, id, id).run();
}

// --- Daily credit checks -------------------------------------------------------------

const LOW_DATAFORSEO_USD = 2;
const APIFY_WARN_SHARE = 0.8;

/**
 * Once a day (from the minute cron): look at DataForSEO balance and Apify monthly usage
 * (both free account calls) and raise a notification when either is running low.
 */
export async function dailyChecks(env: Env) {
  const today = new Date().toISOString().slice(0, 10);
  const last = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'last_daily_check'`).first<string>("value");
  if (last === today) return;
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('last_daily_check', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(today)
    .run();

  if (env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD) {
    try {
      const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
        headers: { Authorization: `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}` },
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json()) as { tasks?: { result?: { money?: { balance?: number } }[] }[] };
      const balance = body.tasks?.[0]?.result?.[0]?.money?.balance;
      if (typeof balance === "number" && balance < LOW_DATAFORSEO_USD) {
        await notify(env, {
          kind: "credit",
          level: balance < 0.1 ? "error" : "warn",
          message: `The Google count service is almost out of credit ($${Math.max(0, balance).toFixed(2)} left). Exact Google counts stop when it runs out; searches, estimates and collecting still work.`,
          dedupeKey: `dfs-low-${today.slice(0, 7)}`,
        });
      }
    } catch (err) {
      console.error("DataForSEO balance check failed", err);
    }
  }

  if (env.APIFY_API_TOKEN) {
    try {
      const res = await fetch("https://api.apify.com/v2/users/me/limits", {
        headers: { Authorization: `Bearer ${env.APIFY_API_TOKEN}` },
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json()) as { data?: { current?: { monthlyUsageUsd?: number }; limits?: { maxMonthlyUsageUsd?: number } } };
      const used = body.data?.current?.monthlyUsageUsd, max = body.data?.limits?.maxMonthlyUsageUsd;
      if (typeof used === "number" && typeof max === "number" && max > 0 && used >= max * APIFY_WARN_SHARE) {
        await notify(env, {
          kind: "credit",
          level: used >= max ? "error" : "warn",
          message: `The scraping account (Apify) has used $${used.toFixed(2)} of its $${max.toFixed(2)} monthly limit. Pulls fail once it’s reached.`,
          dedupeKey: `apify-usage-${today.slice(0, 7)}-${used >= max ? "full" : "near"}`,
        });
      }
    } catch (err) {
      console.error("Apify usage check failed", err);
    }
  }
}

// --- Monthly spending limit -------------------------------------------------------

export class BudgetError extends Error {}

export async function getBudget(env: Env): Promise<number> {
  const v = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'monthly_budget_usd'`).first<string>("value");
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 25;
}

export async function setBudget(env: Env, amount: number) {
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) throw new BudgetError("Enter a monthly budget between $0 and $100,000.");
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('monthly_budget_usd', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(String(Math.round(amount * 100) / 100))
    .run();
}

/**
 * When this month started, as a UTC "YYYY-MM-DD HH:MM:SS" string: midnight on the 1st in the
 * team's timezone (LEAD_TIMEZONE), so the budget resets when the team's month does.
 */
export function monthStartUtc(timeZone: string, now = new Date()): string {
  const part = (d: Date, type: string) =>
    Number(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(d).find((p) => p.type === type)?.value);
  const y = part(now, "year"), m = part(now, "month");
  // Midnight on the 1st as if it were UTC, then shift by the zone's offset at that moment.
  const guess = new Date(Date.UTC(y, m - 1, 1));
  const shown = Date.UTC(part(guess, "year"), part(guess, "month") - 1, part(guess, "day"), part(guess, "hour"), part(guess, "minute"));
  const start = new Date(guess.getTime() - (shown - guess.getTime()));
  return start.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Spent this month: finished pulls at their real Apify cost, running pulls at their estimate,
 * failed pulls that got as far as the scraper at their estimate unless the real cost is known,
 * phone checks, and counts.
 */
export async function monthSpend(env: Env) {
  const since = monthStartUtc(env.LEAD_TIMEZONE || "America/New_York");
  const row = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE
         WHEN status = 'done' THEN COALESCE(cost_apify, 0)
         WHEN status = 'failed' AND apify_run_id IS NOT NULL AND COALESCE(cost_apify, 0) = 0 THEN COALESCE(estimated_cost, 0)
         WHEN status = 'failed' THEN COALESCE(cost_apify, 0)
         ELSE MAX(COALESCE(estimated_cost, 0), COALESCE(cost_apify, 0)) END), 0) AS pulls,
       0 AS phones
     FROM searches WHERE created_at >= ?`,
  ).bind(since).first<{ pulls: number; phones: number }>();
  const log = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'count' THEN amount_usd END), 0) AS counts,
            COALESCE(SUM(CASE WHEN kind = 'phone' THEN amount_usd END), 0) AS phones
     FROM spend_log WHERE at >= ?`,
  ).bind(since).first<{ counts: number; phones: number }>();
  const counts = log?.counts ?? 0;
  const pulls = row?.pulls ?? 0, phones = log?.phones ?? 0;
  const budget = await getBudget(env);
  const spent = pulls + phones + counts;
  return { budget, spent, pulls, phones, counts, left: Math.max(0, budget - spent) };
}

/** Refuses when `planned` would take this month's spend over the budget. Also raises the budget notifications. */
export async function assertWithinBudget(env: Env, planned: number | null, what: string) {
  const m = await monthSpend(env);
  if (planned == null) {
    throw new BudgetError(`The cost of ${what} can’t be estimated, so it can’t be checked against the monthly budget. Pick a number under “Up to”.`);
  }
  if (m.spent + planned > m.budget + 1e-9) {
    await notify(env, {
      kind: "budget",
      level: "error",
      message: `${what === "these phone checks" ? "Phone checks were" : "A search was"} refused: it would cost about $${planned.toFixed(2)}, but only $${m.left.toFixed(2)} of this month’s $${m.budget.toFixed(2)} budget is left.`,
      dedupeKey: `budget-refused-${new Date().toISOString().slice(0, 10)}`,
    });
    throw new BudgetError(
      `Over the monthly budget: this would cost about $${planned.toFixed(2)}, and $${m.left.toFixed(2)} of $${m.budget.toFixed(2)} is left this month. The super admin can raise the budget.`,
    );
  }
  if (m.spent + planned >= m.budget * 0.8) {
    await notify(env, {
      kind: "budget",
      level: "warn",
      message: `Over 80% of this month’s $${m.budget.toFixed(2)} budget is used or committed.`,
      dedupeKey: `budget-80-${new Date().toISOString().slice(0, 7)}`,
    });
  }
}
