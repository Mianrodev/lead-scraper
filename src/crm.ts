// Working the leads: a stage for each business (the "Lead Status" column of the GHL sheet),
// who it's assigned to, and notes from the team. Assign a whole filtered list to a rep, and
// each rep sees "My leads".

import { ValidationError } from "./pipeline";
import { sqlString } from "./leads";
import { logEvent, logEvents } from "./events";

export const STAGES = ["Untouched", "Contacted", "Follow-up", "Interested", "Won", "Lost"] as const;
const MAX_BULK = 5000;

export async function teamList(env: Env) {
  const { results } = await env.DB.prepare(`SELECT id, COALESCE(name, 'Team member') AS name FROM users WHERE active = 1 ORDER BY name`).all<{ id: string; name: string }>();
  return results;
}

async function assignee(env: Env, value: unknown, me: string): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const id = value === "me" ? me : String(value);
  const ok = await env.DB.prepare(`SELECT 1 AS x FROM users WHERE id = ? AND active = 1`).bind(id).first();
  if (!ok) throw new ValidationError("That team member wasn't found.");
  return id;
}

function stage(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const s = STAGES.find((x) => x.toLowerCase() === String(value).toLowerCase());
  if (!s) throw new ValidationError(`Pick a stage: ${STAGES.join(", ")}`);
  return s;
}

/** Stage and / or assignment for some businesses. */
export async function updateLeads(env: Env, ids: string[], changes: { status?: unknown; assignedTo?: unknown }, me: string) {
  const list = [...new Set(ids)].filter((x) => /^[\w:-]+$/.test(x)).slice(0, MAX_BULK);
  const st = stage(changes.status);
  const who = await assignee(env, changes.assignedTo, me);
  if (st === undefined && who === undefined) return { updated: 0 };
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (st !== undefined) { sets.push("lead_status = ?", "status_changed_at = datetime('now')"); binds.push(st); }
  if (who !== undefined) { sets.push("assigned_to = ?"); binds.push(who); }
  let updated = 0;
  for (let i = 0; i < list.length; i += 90) {
    const r = await env.DB.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id IN (${list.slice(i, i + 90).map(sqlString).join(", ")})`)
      .bind(...binds).run();
    updated += r.meta.changes ?? 0;
  }
  if (st !== undefined) await logEvents(env, list, "stage", `Stage: ${st}`, me);
  if (who !== undefined) {
    const name = who ? await env.DB.prepare(`SELECT COALESCE(name, 'Team member') AS n FROM users WHERE id = ?`).bind(who).first<string>("n") : null;
    await logEvents(env, list, "assigned", name ? `Assigned to ${name}` : "Unassigned", me);
  }
  return { updated };
}

export async function leadDetail(env: Env, id: string) {
  const lead = await env.DB.prepare(
    `SELECT l.id, l.business_name, l.gbp_category, l.city, l.state, l.website, l.gbp_phone_formatted, l.lead_status, l.assigned_to,
            l.owner_name, l.owner_title, l.owner_source, l.registry_name, l.registry_id, l.presence_score, l.score_notes,
            l.report_views, l.report_viewed_at, l.demo_token IS NOT NULL AS has_demo,
            (SELECT COALESCE(name, 'Team member') FROM users u WHERE u.id = l.assigned_to) AS assigned_name,
            (SELECT group_concat(email, ', ') FROM lead_emails e WHERE e.lead_id = l.id) AS emails,
            a.email_provider, a.domain_created, a.ssl_expires, a.builder, a.has_google_ads, a.call_tracking
     FROM leads l LEFT JOIN website_audits a ON a.lead_id = l.id WHERE l.id = ?`,
  ).bind(id).first();
  if (!lead) return null;
  const { results: notes } = await env.DB.prepare(
    `SELECT n.id, n.body, n.created_at, n.user_id, (SELECT COALESCE(name, 'Team member') FROM users u WHERE u.id = n.user_id) AS author
     FROM lead_notes n WHERE n.lead_id = ? ORDER BY n.id DESC LIMIT 200`,
  ).bind(id).all();
  return { lead, notes, stages: STAGES };
}

export async function addNote(env: Env, leadId: string, body: string, userId: string) {
  const text = (body ?? "").trim().slice(0, 4000);
  if (!text) throw new ValidationError("Write something first");
  const exists = await env.DB.prepare(`SELECT 1 AS x FROM leads WHERE id = ?`).bind(leadId).first();
  if (!exists) throw new ValidationError("That business wasn't found.");
  await env.DB.prepare(`INSERT INTO lead_notes (lead_id, user_id, body) VALUES (?, ?, ?)`).bind(leadId, userId, text).run();
  await logEvent(env, leadId, "note", text.length > 120 ? `${text.slice(0, 117)}...` : text, userId);
}

/** Authors delete their own notes; admins any. */
export async function deleteNote(env: Env, noteId: number, user: { id: string; role: string }) {
  const n = await env.DB.prepare(`SELECT user_id FROM lead_notes WHERE id = ?`).bind(noteId).first<{ user_id: string | null }>();
  if (!n) return;
  if (n.user_id !== user.id && user.role === "member") throw new ValidationError("Only the author or an admin can delete this note.");
  await env.DB.prepare(`DELETE FROM lead_notes WHERE id = ?`).bind(noteId).run();
}
