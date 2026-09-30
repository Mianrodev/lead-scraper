// Activity timeline for a business: stage and assignment changes, notes, reports and demo
// websites shared and opened, form requests, do-not-contact. Newest first in the pop-up.

import { notify } from "./ops";
import { emitEvent } from "./api-keys";

export type EventKind = "stage" | "assigned" | "note" | "report_shared" | "report_viewed" | "demo_shared" | "demo_viewed" | "dnc" | "form";

export async function logEvent(env: Env, leadId: string, kind: EventKind, detail: string | null, userId: string | null) {
  await env.DB.prepare(`INSERT INTO lead_events (lead_id, user_id, kind, detail) VALUES (?, ?, ?, ?)`)
    .bind(leadId, userId, kind, detail ? detail.slice(0, 300) : null).run();
}

/** One event for many businesses (bulk changes); skipped above `max` to spare the database's daily writes. */
export async function logEvents(env: Env, leadIds: string[], kind: EventKind, detail: string | null, userId: string | null, max = 300) {
  if (!leadIds.length || leadIds.length > max) return;
  const st = leadIds.map((id) => env.DB.prepare(`INSERT INTO lead_events (lead_id, user_id, kind, detail) VALUES (?, ?, ?, ?)`).bind(id, userId, kind, detail));
  for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));
}

export async function listEvents(env: Env, leadId: string) {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.kind, e.detail, e.created_at, (SELECT COALESCE(name, email) FROM users u WHERE u.id = e.user_id) AS who
     FROM lead_events e WHERE e.lead_id = ? ORDER BY e.id DESC LIMIT 100`,
  ).bind(leadId).all();
  return results;
}

/** Link previews (Slack, iMessage, Gmail, WhatsApp...) fetch pages too; they aren't the prospect opening it. */
export function isBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").toLowerCase();
  return !ua || /bot|crawl|spider|preview|slack|facebookexternalhit|whatsapp|telegram|discord|skype|embedly|iframely|curl|wget|python|go-http|headless|google-pagerenderer|proofpoint|mimecast|barracuda|outlook-ios|linkexpander|monitor/.test(ua);
}

/**
 * A prospect opened their report or demo website. Counts every open; the timeline entry, the
 * team notification ("hot lead") and the webhook only once per 30 minutes per business, which
 * keeps the database's daily writes low. Link previews and signed-in team members don't count.
 */
export async function trackView(env: Env, kind: "report" | "demo", leadId: string, userAgent: string | null | undefined, isTeam: boolean) {
  if (isTeam || isBot(userAgent)) return;
  const ev: EventKind = kind === "report" ? "report_viewed" : "demo_viewed";
  const recent = await env.DB.prepare(`SELECT 1 AS x FROM lead_events WHERE lead_id = ? AND kind = ? AND created_at > datetime('now', '-30 minutes') LIMIT 1`)
    .bind(leadId, ev).first();
  const l = await env.DB.prepare(`SELECT business_name, city, report_views, (SELECT COALESCE(name, email) FROM users u WHERE u.id = leads.assigned_to) AS rep FROM leads WHERE id = ?`)
    .bind(leadId).first<{ business_name: string | null; city: string | null; report_views: number; rep: string | null }>();
  if (!l) return;
  if (kind === "report") await env.DB.prepare(`UPDATE leads SET report_views = report_views + 1, report_viewed_at = datetime('now') WHERE id = ?`).bind(leadId).run();
  if (recent) return;
  const what = kind === "report" ? "audit report" : "demo website";
  await logEvent(env, leadId, ev, `Opened the ${what}`, null);
  await notify(env, {
    kind: "hot_lead", level: "info",
    message: `Hot lead: ${l.business_name ?? "A business"}${l.city ? ` (${l.city})` : ""} just opened their ${what}${l.rep ? `. Assigned to ${l.rep}` : ""}. Good time to call.`,
    dedupeKey: `hot-${kind}-${leadId}-${new Date().toISOString().slice(0, 10)}`,
  });
  await emitEvent(env, "report.viewed", { leadId, business: l.business_name, city: l.city, what: kind, views: kind === "report" ? l.report_views + 1 : null });
}
