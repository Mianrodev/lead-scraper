// Operational helpers: activity log, notifications, and the monthly spending limit.

import type { User } from "./auth";

// --- Activity log -------------------------------------------------------------

/** Records an action. The super admin's own actions are deliberately not recorded. */
export async function audit(env: Env, user: Pick<User, "id" | "name" | "role"> | null, action: string, details: Record<string, unknown> = {}) {
  if (user?.role === "super_admin") return;
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
  const from = params.get("from"), to = params.get("to");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    clauses.push("at >= ?");
    binds.push(from);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    clauses.push("at < date(?, '+1 day')");
    binds.push(to);
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
      const row = r as { details: string | null };
      let details: unknown = null;
      try {
        details = row.details ? JSON.parse(row.details) : null;
      } catch {
        details = row.details;
      }
      return { ...row, details };
    }),
    actions: actions.results.map((a) => (a as { action: string }).action),
  };
}

// --- Notifications --------------------------------------------------------------

export async function notify(
  env: Env,
  n: { kind: string; level?: "info" | "warn" | "error"; message: string; dedupeKey?: string },
) {
  try {
    if (n.dedupeKey) {
      const open = await env.DB.prepare(`SELECT id FROM notifications WHERE dedupe_key = ? AND dismissed_at IS NULL`)
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

export async function listNotifications(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, level, kind, message FROM notifications
     WHERE dismissed_at IS NULL AND created_at >= datetime('now', '-30 days')
     ORDER BY id DESC LIMIT 50`,
  ).all();
  return results;
}

export async function dismissNotification(env: Env, id: number, userId: string) {
  await env.DB.prepare(`UPDATE notifications SET dismissed_at = datetime('now'), dismissed_by = ? WHERE id = ?`).bind(userId, id).run();
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
          message: `DataForSEO credit is low: $${balance.toFixed(2)} left (about ${Math.floor(balance / 0.0124)} more counts). "How many exist" stops when it runs out; pulling isn't affected.`,
          dedupeKey: `dfs-low-${today}`,
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
          message: `The scraping account (Apify) has used $${used.toFixed(2)} of its $${max.toFixed(2)} monthly limit. Pulls fail once it's reached.`,
          dedupeKey: `apify-usage-${today}`,
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
 * Spent this calendar month (UTC): finished pulls at their real Apify cost, running pulls
 * at their estimate, phone checks, and counts.
 */
export async function monthSpend(env: Env) {
  const row = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('done', 'failed') THEN COALESCE(cost_apify, 0)
                         ELSE MAX(COALESCE(estimated_cost, 0), COALESCE(cost_apify, 0)) END), 0) AS pulls,
       0 AS phones
     FROM searches WHERE created_at >= strftime('%Y-%m-01', 'now')`,
  ).first<{ pulls: number; phones: number }>();
  const log = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'count' THEN amount_usd END), 0) AS counts,
            COALESCE(SUM(CASE WHEN kind = 'phone' THEN amount_usd END), 0) AS phones
     FROM spend_log WHERE at >= strftime('%Y-%m-01', 'now')`,
  ).first<{ counts: number; phones: number }>();
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
    throw new BudgetError(`The cost of ${what} can't be estimated, so it can't be checked against the monthly budget. Tick "Check how many exist" or set a number of businesses.`);
  }
  if (m.spent + planned > m.budget + 1e-9) {
    await notify(env, {
      kind: "budget",
      level: "error",
      message: `A pull was refused: it would cost about $${planned.toFixed(2)}, but only $${m.left.toFixed(2)} of this month's $${m.budget.toFixed(2)} budget is left.`,
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
      message: `Over 80% of this month's $${m.budget.toFixed(2)} budget is used or committed.`,
      dedupeKey: `budget-80-${new Date().toISOString().slice(0, 7)}`,
    });
  }
}
