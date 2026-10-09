// Overview page: how big the database is, how complete the contact details are, where the
// leads are in the pipeline, what each rep is working, growth over the last two weeks, and
// who opened a report or demo lately (hot leads). A handful of aggregate queries.

import { cached } from "./cache";

/** Hours between UTC and the team's time zone right now (e.g. -4 for New York in summer). */
function tzOffsetHours(tz: string, at = new Date()): number {
  const local = new Date(at.toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((local.getTime() - utc.getTime()) / 3_600_000);
}

/**
 * The totals use the Database list's usual view (open, verified or not known, not do-not-contact),
 * so a tile's number is what its Database view shows. The pipeline numbers count every business
 * being worked (closed or not verified too); only do-not-contact is left out.
 */
const USUAL_VIEW = "suppressed IS NULL AND business_status = 'operational' AND COALESCE(is_claimed, 1) = 1";

/** Kept for 5 minutes: the totals read every business. */
export async function overview(env: Env) {
  return cached(env, "overview", 300, () => computeOverview(env));
}

async function computeOverview(env: Env) {
  const off = tzOffsetHours(env.LEAD_TIMEZONE || "America/New_York");
  const shift = `${off >= 0 ? "+" : ""}${off} hours`;
  const [totals, stages, reps, growth, hot, activity] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(created_at > datetime('now', '-7 days')) AS week,
              SUM(owner_name IS NOT NULL AND owner_name <> '') AS owners,
              SUM(EXISTS (SELECT 1 FROM lead_emails e WHERE e.lead_id = leads.id)) AS emails,
              SUM(EXISTS (SELECT 1 FROM lead_emails e JOIN email_checks c ON c.email = e.email WHERE e.lead_id = leads.id AND c.result = 'ok')) AS verified,
              SUM(gbp_phone_formatted IS NOT NULL) AS phones,
              SUM(phone_type = 'mobile') AS mobiles,
              SUM(phone_type IS NOT NULL AND gbp_phone_formatted IS NOT NULL) AS phones_checked,
              SUM(website_domain IS NOT NULL) AS websites,
              SUM(presence_score IS NOT NULL) AS scored,
              SUM(presence_score < 40) AS weak,
              SUM(report_token IS NOT NULL) AS reports_shared,
              SUM(report_views > 0) AS reports_opened,
              SUM(demo_token IS NOT NULL) AS demos_shared,
              SUM(assigned_to IS NOT NULL) AS assigned
       FROM leads WHERE ${USUAL_VIEW}`,
    ),
    env.DB.prepare(`SELECT COALESCE(lead_status, 'Untouched') AS stage, COUNT(*) AS n FROM leads WHERE suppressed IS NULL GROUP BY 1`),
    env.DB.prepare(
      // Only real (assigned, not do-not-contact) businesses count: a person with none shows zeros.
      `SELECT u.id, COALESCE(NULLIF(u.name, ''), 'Team member') AS name, COUNT(l.id) AS total,
              COALESCE(SUM(l.id IS NOT NULL AND COALESCE(l.lead_status, 'Untouched') = 'Untouched'), 0) AS untouched,
              COALESCE(SUM(l.lead_status IN ('Contacted', 'Follow-up')), 0) AS working,
              COALESCE(SUM(l.lead_status = 'Interested'), 0) AS interested,
              COALESCE(SUM(l.lead_status = 'Won'), 0) AS won
       FROM users u LEFT JOIN leads l ON l.assigned_to = u.id AND l.suppressed IS NULL
       WHERE u.active = 1 GROUP BY u.id ORDER BY total DESC, name`,
    ),
    env.DB.prepare(`SELECT date(created_at, ?) AS day, COUNT(*) AS n FROM leads WHERE created_at > datetime('now', '-15 days') AND suppressed IS NULL GROUP BY 1 ORDER BY 1`).bind(shift),
    env.DB.prepare(
      `SELECT id, business_name, city, state, lead_status, report_views, report_viewed_at,
              (SELECT COALESCE(NULLIF(name, ''), 'Team member') FROM users u WHERE u.id = leads.assigned_to) AS rep
       FROM leads WHERE report_viewed_at > datetime('now', '-14 days') AND suppressed IS NULL ORDER BY report_viewed_at DESC LIMIT 10`,
    ),
    env.DB.prepare(`SELECT kind, COUNT(*) AS n FROM lead_events WHERE created_at > datetime('now', '-7 days') GROUP BY kind`),
  ]);
  // Every one of the last 14 days, zero when nothing was added.
  const byDay = new Map((growth.results as { day: string; n: number }[]).map((r) => [r.day, r.n]));
  const days = Array.from({ length: 14 }, (_, i) => {
    // The team's calendar days (not UTC), today last.
    const d = new Date(Date.now() + off * 3_600_000 - (13 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day: d, n: byDay.get(d) ?? 0 };
  });
  return {
    totals: totals.results[0],
    stages: stages.results,
    reps: reps.results,
    growth: days,
    hot: hot.results,
    activity: Object.fromEntries((activity.results as { kind: string; n: number }[]).map((r) => [r.kind, r.n])),
  };
}
