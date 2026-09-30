// API keys and webhooks, so other tools (a CRM, Zapier / Make, a reseller's own app) can read
// leads, download lists, start collections, and hear when something finishes.
//
// Keys: "Authorization: Bearer lf_..." on the same /api/* routes the app uses. Only the routes
// in API_ROUTES are open to keys; starting a collection needs a key marked "can collect"
// (Google searches cost money; the monthly budget still applies). The key is shown once;
// only its SHA-256 is stored.
//
// Webhooks: a POST with JSON to each subscribed URL, signed with the webhook's secret:
//   X-LeadFinder-Event: search.finished | saved_search.new | list.uploaded | report.viewed | form.submitted
//   X-LeadFinder-Timestamp: <unix seconds when it was sent>
//   X-LeadFinder-Signature: sha256=<hex HMAC-SHA256, with the secret, of "<timestamp>.<body>">
// To check a delivery: build "<timestamp>.<raw body>", HMAC it with the secret, compare with the
// signature, and refuse it if the timestamp is more than 5 minutes old (stops replays).
// Deliveries go through an outbox and are retried (1, 5, 30, 120, 480 minutes). Redirects are
// not followed: a 3xx answer counts as a failure.

import { ValidationError } from "./pipeline";

export const WEBHOOK_EVENTS = ["search.finished", "saved_search.new", "list.uploaded", "report.viewed", "form.submitted"] as const;
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

/** IPv4 ranges that aren't the public internet (private, loopback, link-local, carrier NAT, test, multicast...). */
const PRIVATE_V4: [number, number][] = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0000200, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24], [0xe0000000, 3],
];

/** True for an IP address (v4 dotted, or v6 in [brackets]) that isn't a normal public one. */
export function isPrivateAddress(hostname: string): boolean {
  const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const n = v4.slice(1).reduce((acc, p) => acc * 256 + Number(p), 0);
    return PRIVATE_V4.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
  }
  if (hostname.startsWith("[")) {
    // Only ordinary public IPv6 (2000::/3) is allowed; this rules out ::1, ::, ::ffff:127.0.0.1,
    // fc00::/7 (private), fe80::/10 (link-local) and ff00::/8 (multicast).
    const first = hostname.slice(1).split(":")[0];
    if (!first) return true; // starts with "::"
    const n = parseInt(first, 16);
    return !(first.length === 4 && n >= 0x2000 && n <= 0x3fff) || /^\[2002:/i.test(hostname) || /^\[2001:0?db8:/i.test(hostname);
  }
  return false;
}

export function checkWebhookUrl(url: string): string {
  let u: URL;
  try { u = new URL(String(url ?? "").trim()); } catch { throw new ValidationError("That isn't a web address."); }
  if (u.protocol !== "https:") throw new ValidationError("Webhook addresses must start with https://");
  // The URL reader turns odd IP spellings (2130706433, 0x7f.1, 0177.0.0.1) into the normal
  // 1.2.3.4 form first, so they're checked like any other address.
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const blockedName = !host.includes(".") && !host.startsWith("[") // a bare name like "intranet"
    || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|localdomain)$/.test(host);
  if (blockedName || isPrivateAddress(host) || u.username || u.password) {
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

/** The headers that go with one delivery: the signature covers "<timestamp>.<body>" so an old call can't be replayed. */
export async function webhookHeaders(secret: string, event: string, body: string, nowMs = Date.now()): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    "Content-Type": "application/json",
    "User-Agent": "Lead-Finder-Webhooks/1",
    "X-LeadFinder-Event": event,
    "X-LeadFinder-Timestamp": timestamp,
    "X-LeadFinder-Signature": await signBody(secret, `${timestamp}.${body}`),
  };
}

/** How long to wait before retry number `attempts` (1 = first retry); null once every retry is used up. */
export function retryDelayMinutes(attempts: number): number | null {
  return attempts >= 1 && attempts <= RETRY_MINUTES.length ? RETRY_MINUTES[attempts - 1] : null;
}

/** Minute job: delivers up to 10 due webhook calls. */
export async function deliverWebhooks(env: Env): Promise<{ sent: number; failed: number }> {
  // Claim the calls first, in one step (they're pushed 5 minutes ahead), so a second run of
  // this job starting at the same time can't send the same ones again.
  const { results: claimed } = await env.DB.prepare(
    `UPDATE webhook_outbox SET next_at = datetime('now', '+5 minutes')
     WHERE id IN (SELECT o.id FROM webhook_outbox o JOIN webhooks w ON w.id = o.webhook_id
                  WHERE o.next_at <= datetime('now') AND w.active = 1 ORDER BY o.id LIMIT 10)
       AND next_at <= datetime('now')
     RETURNING id, event, payload, attempts, webhook_id`,
  ).all<{ id: number; event: string; payload: string; attempts: number; webhook_id: string }>();
  if (!claimed.length) return { sent: 0, failed: 0 };
  const ids = [...new Set(claimed.map((o) => o.webhook_id))];
  const { results: hooks } = await env.DB.prepare(`SELECT id, url, secret FROM webhooks WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids).all<{ id: string; url: string; secret: string }>();
  const hookById = new Map(hooks.map((w) => [w.id, w]));
  let sent = 0, failed = 0;
  for (const o of claimed.sort((a, b) => a.id - b.id)) {
    const hook = hookById.get(o.webhook_id);
    if (!hook) continue; // deleted meanwhile (its calls were deleted with it)
    let status = "no answer";
    try {
      const res = await fetch(checkWebhookUrl(hook.url), {
        method: "POST",
        headers: await webhookHeaders(hook.secret, o.event, o.payload),
        body: o.payload,
        redirect: "manual", // a redirect could point somewhere private; it counts as a failure
        signal: AbortSignal.timeout(15_000),
      });
      status = res.status >= 300 && res.status < 400 ? `${res.status} (redirects aren't followed)` : String(res.status);
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
    const wait = retryDelayMinutes(attempts);
    await env.DB.batch([
      wait === null
        ? env.DB.prepare(`DELETE FROM webhook_outbox WHERE id = ?`).bind(o.id)
        : env.DB.prepare(`UPDATE webhook_outbox SET attempts = ?, next_at = datetime('now', ?) WHERE id = ?`).bind(attempts, `+${wait} minutes`, o.id),
      env.DB.prepare(`UPDATE webhooks SET last_status = ?, failures = failures + 1 WHERE id = ?`).bind(`failed: ${status}`, o.webhook_id),
    ]);
  }
  return { sent, failed };
}

/**
 * Minute job: "search.finished" for searches that finished since the last look. Nothing is
 * written unless there's something to send: a webhook added later starts from the moment it was
 * created (never older searches), so the marker doesn't need moving every minute.
 */
export async function emitFinishedSearches(env: Env) {
  const since = await env.DB.prepare(
    `SELECT MIN(created_at) AS since FROM webhooks WHERE active = 1 AND (',' || events || ',') LIKE '%,search.finished,%'`,
  ).first<string | null>("since");
  if (!since) return 0;
  const marker = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'webhook_search_marker'`).first<string>("value");
  const from = marker && marker > since ? marker : since;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const { results } = await env.DB.prepare(
    `SELECT id, category, city, state, region_name, source, status, leads_saved, new_leads_count, error, finished_at FROM searches
     WHERE finished_at > ? AND finished_at <= ? AND status IN ('done', 'failed') AND source <> 'upload'
     ORDER BY finished_at, id LIMIT ?`,
  ).bind(from, now, FINISHED_BATCH).all<Record<string, unknown> & { finished_at: string }>();
  const { emit, next } = finishedBatch(results, FINISHED_BATCH);
  if (!emit.length || next === marker) return 0; // nothing new: no write
  // Move the marker only if it's still what we read, so two runs at once can't both send the same searches.
  const moved = marker == null
    ? await env.DB.prepare(`INSERT INTO app_settings (key, value) VALUES ('webhook_search_marker', ?) ON CONFLICT(key) DO NOTHING`).bind(next).run()
    : await env.DB.prepare(`UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = 'webhook_search_marker' AND value = ?`).bind(next, marker).run();
  if (!moved.meta.changes) return 0;
  for (const s of emit) await emitEvent(env, "search.finished", s);
  return emit.length;
}

const FINISHED_BATCH = 100;

/**
 * Which finished searches (oldest first) to send now, and where the marker moves to: the finish
 * time of the last one sent. When the batch is full the rest go next minute; searches sharing
 * the batch's last finish time are held back together so none is skipped.
 */
export function finishedBatch<T extends { finished_at: string }>(rows: T[], limit: number): { emit: T[]; next: string | null } {
  if (!rows.length) return { emit: [], next: null };
  const last = rows[rows.length - 1].finished_at;
  if (rows.length < limit) return { emit: rows, next: last };
  const before = rows.filter((r) => r.finished_at < last);
  if (!before.length) return { emit: rows, next: last }; // all at the very same second: send them all
  return { emit: before, next: before[before.length - 1].finished_at };
}
