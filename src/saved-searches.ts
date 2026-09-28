// Saved searches with "new businesses" alerts.
// A saved search is a Find request (types + places + options) the team wants to come back to.
// Alerts are free: once a day we count businesses of those types in those places that were
// added since the team last looked (the daily free collection keeps bringing new ones), and
// post a notification when the number has grown. "Run" re-checks the search in Find.

import { resolveRequest, type FindRequest, type ResolvedPlace } from "./find";
import { notify } from "./ops";
import { ValidationError } from "./pipeline";

export interface SavedSearchRow {
  id: string;
  name: string;
  request: string;
  created_by: string | null;
  created_at: string;
  alert_new: number;
  last_count: number | null;
  last_count_at: string | null;
  last_alert_at: string | null;
  last_run_at: string | null;
}

const MAX_SAVED = 200;
/** Alerts run once a day, from this hour (UTC; 13:00 = 9 am New York). */
const ALERT_HOUR_UTC = 13;

/** "Plumber, Roofer in Orlando, FL and 2 more places (free data)". */
export function describeRequest(req: Pick<FindRequest, "categories" | "locations" | "radiusMiles" | "source">): string {
  const cats = req.categories ?? [];
  const locs = (req.locations ?? []).map((l) => [l.city, l.region ?? l.state].filter(Boolean).join(", ") || l.country || "US");
  const what = cats.length > 2 ? `${cats.slice(0, 2).join(", ")} and ${cats.length - 2} more types` : cats.join(", ");
  const where = locs.length > 2 ? `${locs.slice(0, 2).join("; ")} and ${locs.length - 2} more places` : locs.join("; ");
  return `${what} in ${where}${req.radiusMiles ? ` (within ${req.radiusMiles} mi)` : ""}${req.source === "google" ? " (Google Maps)" : " (free data)"}`;
}

/** Only what a saved search needs to remember from a Find request. */
export function cleanRequest(r: FindRequest): FindRequest {
  if (!r || !Array.isArray(r.categories) || !r.categories.length) throw new ValidationError("Pick at least one type of business first");
  if (!Array.isArray(r.locations) || !r.locations.length) throw new ValidationError("Pick at least one place first");
  return {
    source: r.source === "google" ? "google" : "free",
    categories: r.categories.map(String).slice(0, 40),
    locations: r.locations.slice(0, 40).map((l) => ({ country: l.country ?? null, region: l.region ?? l.state ?? null, city: l.city ?? null })),
    maxResults: Number.isInteger(r.maxResults) ? r.maxResults : undefined,
    radiusMiles: r.radiusMiles ?? null,
    checkPhones: r.checkPhones === true,
  };
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * SQL condition (over `leads l`) for "a business of these types in these places".
 * Places: a city (any capitals, same state), a circle around a city, a state, or a country.
 */
export function matchCondition(categories: string[], places: ResolvedPlace[]): string {
  // Exact type names (as picked in Find), so the category index is used.
  const types = `l.gbp_category IN (${categories.map(q).join(", ")})`;
  const where = places.map((p) => {
    if (p.city && p.radiusMiles && p.lat != null && p.lng != null) {
      const lngMiles = 69.172 * Math.cos((p.lat * Math.PI) / 180);
      return `(l.latitude IS NOT NULL AND ((l.latitude - ${p.lat}) * 69.0) * ((l.latitude - ${p.lat}) * 69.0)
               + ((l.longitude - ${p.lng}) * ${lngMiles}) * ((l.longitude - ${p.lng}) * ${lngMiles}) <= ${p.radiusMiles * p.radiusMiles})`;
    }
    if (p.city) return `(l.city = ${q(p.city)} COLLATE NOCASE AND COALESCE(l.state, '') = ${q(p.state)})`;
    if (p.state) return `l.state = ${q(p.state)}`;
    return `l.country = ${q(p.countryCode === "US" ? "USA" : p.countryName)}`;
  });
  return `${types} AND (${where.join(" OR ")})`;
}

async function placesOf(env: Env, req: FindRequest) {
  const { categories, places } = await resolveRequest(env, req);
  return { categories, places };
}

export async function listSavedSearches(env: Env) {
  const { results } = await env.DB.prepare(`SELECT * FROM saved_searches ORDER BY created_at DESC LIMIT ?`).bind(MAX_SAVED).all<SavedSearchRow>();
  const out = [];
  for (const s of results) {
    const req = JSON.parse(s.request) as FindRequest;
    let newSince: number | null = null;
    let total: number | null = null;
    try {
      const { categories, places } = await placesOf(env, req);
      const cond = matchCondition(categories, places);
      const r = await env.DB.prepare(
        `SELECT COUNT(*) AS total, SUM(l.created_at > ?) AS fresh FROM leads l WHERE ${cond}`,
      ).bind(s.last_count_at ?? s.created_at).first<{ total: number; fresh: number | null }>();
      total = r?.total ?? 0;
      newSince = r?.fresh ?? 0;
    } catch { /* a place that no longer resolves: show without counts */ }
    out.push({ ...s, request: req, description: describeRequest(req), total, newSince, since: s.last_count_at ?? s.created_at });
  }
  return out;
}

export async function saveSearch(env: Env, name: string, request: FindRequest, createdBy: string | null) {
  const n = (name ?? "").trim().slice(0, 100);
  if (!n) throw new ValidationError("Give the search a name");
  const req = cleanRequest(request);
  await resolveRequest(env, req); // the places must resolve now
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM saved_searches`).first<number>("n");
  if ((count ?? 0) >= MAX_SAVED) throw new ValidationError(`You can keep up to ${MAX_SAVED} saved searches. Delete some first.`);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO saved_searches (id, name, request, created_by, alert_new, last_count, last_count_at) VALUES (?, ?, ?, ?, 1, 0, datetime('now'))`,
  ).bind(id, n, JSON.stringify(req), createdBy).run();
  return { id };
}

export async function updateSavedSearch(env: Env, id: string, changes: { name?: string; alert?: boolean; seen?: boolean; ran?: boolean }) {
  const st: D1PreparedStatement[] = [];
  if (typeof changes.name === "string" && changes.name.trim()) st.push(env.DB.prepare(`UPDATE saved_searches SET name = ? WHERE id = ?`).bind(changes.name.trim().slice(0, 100), id));
  if (typeof changes.alert === "boolean") st.push(env.DB.prepare(`UPDATE saved_searches SET alert_new = ? WHERE id = ?`).bind(changes.alert ? 1 : 0, id));
  // "Seen": the new-businesses count starts again from now.
  if (changes.seen) st.push(env.DB.prepare(`UPDATE saved_searches SET last_count_at = datetime('now'), last_count = 0 WHERE id = ?`).bind(id));
  if (changes.ran) st.push(env.DB.prepare(`UPDATE saved_searches SET last_run_at = datetime('now') WHERE id = ?`).bind(id));
  if (st.length) await env.DB.batch(st);
}

export async function deleteSavedSearch(env: Env, id: string) {
  await env.DB.prepare(`DELETE FROM saved_searches WHERE id = ?`).bind(id).run();
}

/**
 * Once a day: for each saved search with alerts on, count the businesses added since the team
 * last looked; when that number has grown, post a notification.
 */
export async function savedSearchAlerts(env: Env, now = new Date()): Promise<{ checked: number; alerts: number } | null> {
  if (now.getUTCHours() < ALERT_HOUR_UTC) return null;
  const today = now.toISOString().slice(0, 10);
  const marker = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'saved_search_check_at'`).first<string>("value");
  if (marker === today) return null;
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('saved_search_check_at', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(today).run();
  const { results } = await env.DB.prepare(`SELECT * FROM saved_searches WHERE alert_new = 1 LIMIT ?`).bind(MAX_SAVED).all<SavedSearchRow>();
  let alerts = 0;
  for (const s of results) {
    try {
      const req = JSON.parse(s.request) as FindRequest;
      const { categories, places } = await placesOf(env, req);
      const since = s.last_count_at ?? s.created_at;
      const fresh = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM leads l WHERE l.created_at > ? AND ${matchCondition(categories, places)}`)
        .bind(since).first<number>("n")) ?? 0;
      if (fresh > (s.last_count ?? 0)) {
        alerts++;
        await notify(env, {
          kind: "saved_search", level: "info",
          message: `Saved search "${s.name}": ${fresh.toLocaleString("en-US")} new business${fresh === 1 ? "" : "es"} since ${since.slice(0, 10)} (${describeRequest(req)}). Open Find → Saved searches to see them.`,
          dedupeKey: `saved-${s.id}-${today}`,
        });
        await env.DB.prepare(`UPDATE saved_searches SET last_count = ?, last_alert_at = datetime('now') WHERE id = ?`).bind(fresh, s.id).run();
      }
    } catch (err) {
      console.error("saved search alert failed", s.id, err);
    }
  }
  return { checked: results.length, alerts };
}
