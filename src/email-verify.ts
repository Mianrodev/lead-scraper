// Email verification with MillionVerifier (about $0.50-2.50 per 1,000, prepaid credits on the
// team's own MillionVerifier account). Only on request: "Verify emails" on a list checks the
// best email of each business in it. Results are kept per address (email_checks), so the same
// address is never paid for twice, and downloads leave out addresses that would bounce.
//
// Results: ok = safe to send; catch_all = the domain accepts everything (can't be sure);
// unknown = the server didn't say; invalid / disposable = don't send.

import { bestFirst } from "./emails";
import { ValidationError } from "./pipeline";
import { sqlString } from "./leads";

const API = "https://api.millionverifier.com/api/v3/";
const PER_TICK = 20;          // outside requests per minute job (the free plan allows 50 per run)
const MAX_PER_REQUEST = 5000; // businesses per "Verify emails"
const RECHECK_DAYS = 90;
export const BAD_RESULTS = ["invalid", "disposable"];
const RESULTS = ["ok", "catch_all", "unknown", "invalid", "disposable"];

type VerifyEnv = Env & { MILLIONVERIFIER_API_KEY?: string };

const upsert = (env: Env, key: string, value: string) => env.DB.prepare(
  `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
).bind(key, value);

/** The email that would be used for each business: its best one (a person's first). */
async function bestEmails(env: Env, leadIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < leadIds.length; i += 90) {
    const { results } = await env.DB.prepare(
      `SELECT lead_id, email FROM lead_emails WHERE lead_id IN (${leadIds.slice(i, i + 90).map(sqlString).join(", ")}) ORDER BY lead_id, position`,
    ).all<{ lead_id: string; email: string }>();
    const by = new Map<string, string[]>();
    for (const r of results) by.set(r.lead_id, [...(by.get(r.lead_id) ?? []), r.email.toLowerCase()]);
    for (const [id, list] of by) out.set(id, bestFirst(list)[0]);
  }
  return out;
}

async function known(env: Env, emails: string[]): Promise<Map<string, { result: string; checked_at: string | null }>> {
  const out = new Map<string, { result: string; checked_at: string | null }>();
  for (let i = 0; i < emails.length; i += 90) {
    const { results } = await env.DB.prepare(
      `SELECT email, result, checked_at FROM email_checks WHERE email IN (${emails.slice(i, i + 90).map(sqlString).join(", ")})`,
    ).all<{ email: string; result: string; checked_at: string | null }>();
    for (const r of results) out.set(r.email, r);
  }
  return out;
}

/** "Verify emails" for these businesses: preview (dryRun) or queue the ones not checked yet. */
export async function requestVerification(env: VerifyEnv, leadIds: string[], opts: { dryRun?: boolean } = {}) {
  if (!env.MILLIONVERIFIER_API_KEY) throw new ValidationError("Email verification needs the MillionVerifier key (MILLIONVERIFIER_API_KEY).");
  const ids = [...new Set(leadIds)].slice(0, MAX_PER_REQUEST);
  const emails = [...new Set((await bestEmails(env, ids)).values())];
  const have = await known(env, emails);
  const cutoff = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  const fresh = (e: string) => {
    const k = have.get(e);
    return k && (k.result === "queued" || (k.checked_at && k.checked_at > cutoff));
  };
  const todo = emails.filter((e) => !fresh(e));
  const credits = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'millionverifier_credits'`).first<string>("value");
  const summary = {
    businesses: ids.length, withEmail: emails.length, alreadyChecked: emails.length - todo.length, toCheck: todo.length,
    credits: credits == null || credits === "" ? null : Number(credits),
  };
  if (opts.dryRun || !todo.length) return { ...summary, queued: 0 };
  const st = todo.map((e) => env.DB.prepare(
    `INSERT INTO email_checks (email, result, queued_at) VALUES (?, 'queued', datetime('now'))
     ON CONFLICT(email) DO UPDATE SET result = 'queued', queued_at = datetime('now')`,
  ).bind(e));
  for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));
  return { ...summary, queued: todo.length };
}

export interface MvAnswer { result: string; subresult: string | null; quality: string | null; role: boolean | null; free: boolean | null; credits: number | null; error: string | null }

/** Reads MillionVerifier's answer (never trusts its shape). */
export function parseMvAnswer(v: unknown): MvAnswer {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" && x ? x.slice(0, 60) : null);
  const result = typeof o.result === "string" && RESULTS.includes(o.result) ? o.result : "error";
  return {
    result, subresult: s(o.subresult), quality: s(o.quality),
    role: typeof o.role === "boolean" ? o.role : null, free: typeof o.free === "boolean" ? o.free : null,
    credits: typeof o.credits === "number" ? o.credits : null, error: s(o.error),
  };
}

/** Minute job: checks up to PER_TICK queued addresses. */
export async function verifyStep(env: VerifyEnv): Promise<{ checked: number }> {
  const key = env.MILLIONVERIFIER_API_KEY;
  if (!key) return { checked: 0 };
  const { results } = await env.DB.prepare(`SELECT email FROM email_checks WHERE result = 'queued' ORDER BY queued_at LIMIT ?`).bind(PER_TICK).all<{ email: string }>();
  if (!results.length) return { checked: 0 };
  let credits: number | null = null;
  let stop = false;
  const answers = await Promise.all(results.map(async ({ email }) => {
    try {
      const res = await fetch(`${API}?${new URLSearchParams({ api: key, email, timeout: "20" })}`, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) return null; // try again next minute
      const a = parseMvAnswer(await res.json().catch(() => null));
      if (a.credits != null) credits = a.credits;
      // Out of credits / bad key: leave everything queued and say so on the Admin page.
      if (a.result === "error" && a.error && /credit|api key|apikey|invalid key/i.test(a.error)) { stop = true; return { email, a, keep: true }; }
      return { email, a, keep: false };
    } catch {
      return null;
    }
  }));
  const st: D1PreparedStatement[] = [];
  for (const x of answers) {
    if (!x || x.keep) continue;
    st.push(env.DB.prepare(
      `UPDATE email_checks SET result = ?, subresult = ?, quality = ?, is_role = ?, is_free = ?, checked_at = datetime('now'), error = ? WHERE email = ?`,
    ).bind(x.a.result, x.a.subresult, x.a.quality, x.a.role == null ? null : x.a.role ? 1 : 0, x.a.free == null ? null : x.a.free ? 1 : 0, x.a.error, x.email));
  }
  if (credits != null) st.push(upsert(env, "millionverifier_credits", String(credits)));
  const problem = answers.find((x) => x?.keep)?.a.error;
  st.push(upsert(env, "millionverifier_problem", stop && problem ? problem : ""));
  if (st.length) await env.DB.batch(st);
  return { checked: answers.filter((x) => x && !x.keep).length };
}

export async function verifyStatus(env: VerifyEnv) {
  const r = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM email_checks WHERE result = 'queued') AS queued,
            (SELECT COUNT(*) FROM email_checks WHERE result = 'ok') AS ok,
            (SELECT COUNT(*) FROM email_checks WHERE result IN ('catch_all', 'unknown')) AS risky,
            (SELECT COUNT(*) FROM email_checks WHERE result IN ('invalid', 'disposable')) AS bad,
            (SELECT value FROM app_settings WHERE key = 'millionverifier_credits') AS credits,
            (SELECT value FROM app_settings WHERE key = 'millionverifier_problem') AS problem`,
  ).first<{ queued: number; ok: number; risky: number; bad: number; credits: string | null; problem: string | null }>();
  return { enabled: !!env.MILLIONVERIFIER_API_KEY, ...r, credits: r?.credits ? Number(r.credits) : null, problem: r?.problem || null };
}
