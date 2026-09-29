// API keys and webhooks, so other tools (a CRM, Zapier / Make, a reseller's own app) can read
// leads, download lists, start collections, and hear when something finishes.
//
// Keys: "Authorization: Bearer lf_..." on the same /api/* routes the app uses. Only the routes
// in API_ROUTES are open to keys; starting a collection needs a key marked "can collect"
// (Google searches cost money; the monthly budget still applies). The key is shown once;
// only its SHA-256 is stored.
//
// Webhooks: a POST with JSON to each subscribed URL, signed with the webhook's secret:
//   X-LeadFinder-Event: search.finished | saved_search.new | list.uploaded
//   X-LeadFinder-Signature: sha256=<hex HMAC of the body>
// Deliveries go through an outbox and are retried (1, 5, 30, 120, 480 minutes).

import { ValidationError } from "./pipeline";

export const WEBHOOK_EVENTS = ["search.finished", "saved_search.new", "list.uploaded"] as const;
const RETRY_MINUTES = [1, 5, 30, 120, 480];

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
function randomToken(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return hex(b.buffer);
}

/** Which routes a key may call. */
export function apiAllowed(method: string, path: string, canCollect: boolean): boolean {
  const get = method === "GET" || method === "HEAD";
  if (get && (/^\/api\/leads(\/facets)?$/.test(path) || path === "/api/export" || /^\/api\/searches(\/[\w-]+)?$/.test(path)
    || path === "/api/saved-searches" || path === "/api/categories" || path.startsWith("/api/geo/") || path === "/api/websites/status")) return true;
  if (method === "POST" && (path === "/api/find" || path === "/api/uploads" || path === "/api/websites/check")) return canCollect;
  return false;
}

export interface ApiUser { id: string; email: string; name: string; role: "member"; must_change_password: 0; apiKeyId: string; canCollect: boolean }

/** The key's pseudo-user, or null when the key is unknown / revoked. */
export async function userForApiKey(env: Env, key: string): Promise<ApiUser | null> {
  if (!/^lf_[0-9a-f]{40}$/.test(key)) return null;
  const row = await env.DB.prepare(`SELECT id, name, can_collect FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`)
    .bind(await sha256Hex(key)).first<{ id: string; name: string; can_collect: number }>();
  if (!row) return null;
  await env.DB.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-10 minutes'))`)
    .bind(row.id).run();
  return { id: `api:${row.id}`, email: "", name: `API: ${row.name}`, role: "member", must_change_password: 0, apiKeyId: row.id, canCollect: row.can_collect === 1 };
}

export async function createApiKey(env: Env, name: string, canCollect: boolean, createdBy: string) {
  const n = (name ?? "").trim().slice(0, 60);
  if (!n) throw new ValidationError("Give the key a name (e.g. the tool that will use it)");
  const key = `lf_${randomToken(20)}`;
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO api_keys (id, name, prefix, key_hash, can_collect, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, n, key.slice(0, 9), await sha256Hex(key), canCollect ? 1 : 0, createdBy).run();
  return { id, key }; // shown once
}

export async function listApiKeys(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, prefix, can_collect, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC`,
  ).all();
  return results;
}

export async function revokeApiKey(env: Env, id: string) {
  await env.DB.prepare(`UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`).bind(id).run();
}

// ------------------------------------------------------------------------------------------
// Webhooks

export function checkWebhookUrl(url: string): string {
  let u: URL;
  try { u = new URL(url.trim()); } catch { throw new ValidationError("That isn't a web address."); }
  if (u.protocol !== "https:") throw new ValidationError("Webhook addresses must start with https://");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || u.hostname.endsWith(".local") || u.hostname.endsWith(".internal")) {
    throw new ValidationError("Use a public web address for webhooks.");
  }
  return u.toString();
}

export async function createWebhook(env: Env, url: string, events: string[], createdBy: string) {
  const ev = events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!ev.length) throw new ValidationError(`Pick at least one event: ${WEBHOOK_EVENTS.join(", ")}`);
  const id = crypto.randomUUID();
  const secret = `whsec_${randomToken(24)}`;
  await env.DB.prepare(`INSERT INTO webhooks (id, url, secret, events, created_by) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, checkWebhookUrl(url), secret, ev.join(","), createdBy).run();
  return { id, secret }; // the secret is shown once, for checking signatures
}

export async function listWebhooks(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id, url, events, active, created_at, last_status, last_sent_at, failures,
            (SELECT COUNT(*) FROM webhook_outbox o WHERE o.webhook_id = webhooks.id) AS waiting
     FROM webhooks ORDER BY created_at DESC`,
  ).all();
  return results;
}

export async function deleteWebhook(env: Env, id: string) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM webhook_outbox WHERE webhook_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM webhooks WHERE id = ?`).bind(id),
  ]);
}

/** Queues an event for every active webhook that wants it (cheap when there are none). */
export async function emitEvent(env: Env, event: (typeof WEBHOOK_EVENTS)[number], data: Record<string, unknown>) {
  const { results } = await env.DB.prepare(`SELECT id, events FROM webhooks WHERE active = 1`).all<{ id: string; events: string }>();
  const targets = results.filter((w) => w.events.split(",").includes(event));
  if (!targets.length) return 0;
  const payload = JSON.stringify({ event, sentAt: new Date().toISOString(), data });
  await env.DB.batch(targets.map((w) => env.DB.prepare(`INSERT INTO webhook_outbox (webhook_id, event, payload) VALUES (?, ?, ?)`).bind(w.id, event, payload)));
  return targets.length;
}

export async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `sha256=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))}`;
}

/** Minute job: delivers up to 10 due webhook calls. */
export async function deliverWebhooks(env: Env): Promise<{ sent: number; failed: number }> {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.event, o.payload, o.attempts, w.id AS webhook_id, w.url, w.secret FROM webhook_outbox o JOIN webhooks w ON w.id = o.webhook_id
     WHERE o.next_at <= datetime('now') AND w.active = 1 ORDER BY o.id LIMIT 10`,
  ).all<{ id: number; event: string; payload: string; attempts: number; webhook_id: string; url: string; secret: string }>();
  let sent = 0, failed = 0;
  for (const o of results) {
    let status = "no answer";
    try {
      const res = await fetch(o.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Lead-Finder-Webhooks/1", "X-LeadFinder-Event": o.event, "X-LeadFinder-Signature": await signBody(o.secret, o.payload) },
        body: o.payload,
        signal: AbortSignal.timeout(15_000),
      });
      status = String(res.status);
      if (res.ok) {
        sent++;
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM webhook_outbox WHERE id = ?`).bind(o.id),
          env.DB.prepare(`UPDATE webhooks SET last_status = ?, last_sent_at = datetime('now'), failures = 0 WHERE id = ?`).bind(status, o.webhook_id),
        ]);
        continue;
      }
    } catch (err) {
      status = err instanceof Error ? err.message.slice(0, 80) : "error";
    }
    failed++;
    const attempts = o.attempts + 1;
    await env.DB.batch([
      attempts >= RETRY_MINUTES.length
        ? env.DB.prepare(`DELETE FROM webhook_outbox WHERE id = ?`).bind(o.id)
        : env.DB.prepare(`UPDATE webhook_outbox SET attempts = ?, next_at = datetime('now', ?) WHERE id = ?`).bind(attempts, `+${RETRY_MINUTES[attempts]} minutes`, o.id),
      env.DB.prepare(`UPDATE webhooks SET last_status = ?, failures = failures + 1 WHERE id = ?`).bind(`failed: ${status}`, o.webhook_id),
    ]);
  }
  return { sent, failed };
}

/** Minute job: "search.finished" for searches that finished since the last look. */
export async function emitFinishedSearches(env: Env) {
  const any = await env.DB.prepare(`SELECT 1 AS x FROM webhooks WHERE active = 1 AND events LIKE '%search.finished%' LIMIT 1`).first();
  const marker = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'webhook_search_marker'`).first<string>("value");
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const setMarker = env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('webhook_search_marker', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(now);
  if (!any || !marker) { await setMarker.run(); return 0; }
  const { results } = await env.DB.prepare(
    `SELECT id, category, city, state, region_name, source, status, leads_saved, new_leads_count, error, finished_at FROM searches
     WHERE finished_at > ? AND finished_at <= ? AND status IN ('done', 'failed') AND source <> 'upload' LIMIT 100`,
  ).bind(marker, now).all<Record<string, unknown>>();
  for (const s of results) await emitEvent(env, "search.finished", s);
  await setMarker.run();
  return results.length;
}
