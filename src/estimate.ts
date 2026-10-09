// Quick answers for "Find leads": how many of a search are already in the database (exact), and
// roughly how many exist in places we haven't collected yet (an estimate from our own data, so
// it's instant and free; the Google count stays optional and paid).
//
// The estimate: for each business type, how many businesses per person we found in the places we
// already collected it (cities with 15,000+ people from our city list stand in for population),
// times the population of the new place. Types we've never collected use the average of all types.

import { cached } from "./cache";
import type { ResolvedPlace } from "./find";
import { buildWhere, parseFilters } from "./leads";

export interface PlaceKey { state: string; city: string; countryCode: string }

const placeKey = (p: PlaceKey) => `${p.countryCode}|${(p.state || "").toUpperCase()}|${(p.city || "").toLowerCase()}`;

/**
 * The Database list's usual filters (what "See them in your database" opens with): open,
 * verified on Google or not known, not on the do-not-contact list. Built by the list's own
 * code, so the Find answer and the list always count the same businesses.
 */
export const DATABASE_DEFAULTS = buildWhere(parseFilters(new URLSearchParams("status=operational&verified=verified")));

/** Exact: businesses of these types in each place, with the Database list's usual filters (DATABASE_DEFAULTS). */
export async function inDatabase(env: Env, categories: string[], places: ResolvedPlace[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(); // `${category lower}|${placeKey}` -> n
  const cats = [...new Set(categories)];
  const byState = new Map<string, ResolvedPlace[]>();
  for (const p of places) {
    const k = `${p.countryCode}|${p.state}`;
    if (!byState.has(k)) byState.set(k, []);
    byState.get(k)!.push(p);
  }
  for (const list of byState.values()) {
    const state = list[0].state;
    if (!state) continue; // whole countries: no quick count
    for (let i = 0; i < cats.length; i += 90) {
      const part = cats.slice(i, i + 90);
      // One grouped query per state (index on state, city), split into the places afterwards.
      const { results } = await env.DB.prepare(
        `SELECT l.gbp_category AS c, lower(COALESCE(l.city, '')) AS ci, COUNT(*) AS n FROM leads l
         ${DATABASE_DEFAULTS.sql} AND l.state = ? AND l.gbp_category IN (${part.map(() => "?").join(", ")})
         GROUP BY l.gbp_category, lower(COALESCE(l.city, ''))`,
      ).bind(...DATABASE_DEFAULTS.binds, state, ...part).all<{ c: string; ci: string; n: number }>();
      for (const p of list) {
        const city = p.city.toLowerCase();
        for (const r of results) {
          if (city && r.ci !== city) continue;
          const k = `${r.c.toLowerCase()}|${placeKey(p)}`;
          out.set(k, (out.get(k) ?? 0) + r.n);
        }
      }
    }
  }
  return out;
}
export const dbKey = (category: string, p: PlaceKey) => `${category.toLowerCase()}|${placeKey(p)}`;

interface Densities { perType: Record<string, number>; average: number | null }

/** Businesses per person for each type we've collected (from finished searches), refreshed daily. */
async function densities(env: Env): Promise<Densities> {
  return cached(env, "estimate-densities-v1", 86_400, async () => {
    const [{ results: searches }, { results: pops }] = await env.DB.batch([
      env.DB.prepare(
        `SELECT lower(category) AS c, COALESCE(country_code, 'US') AS cc, upper(COALESCE(state, '')) AS st, lower(city) AS ci, MAX(leads_saved) AS n
         FROM searches WHERE status = 'done' AND cancelled_at IS NULL AND leads_saved > 0 AND COALESCE(radius_miles, 0) = 0 AND source IN ('google', 'free')
         GROUP BY 1, 2, 3, 4`,
      ),
      env.DB.prepare(`SELECT country AS cc, upper(COALESCE(region, '')) AS st, SUM(population) AS pop FROM geo_cities GROUP BY country, region`),
    ]) as unknown as [{ results: { c: string; cc: string; st: string; ci: string; n: number }[] }, { results: { cc: string; st: string; pop: number }[] }];
    const regionPop = new Map(pops.map((r) => [`${r.cc}|${r.st}`, r.pop]));
    const cityPops = new Map<string, number>();
    const cities = [...new Set(searches.filter((s) => s.ci).map((s) => `${s.cc}|${s.st}|${s.ci}`))];
    for (let i = 0; i < cities.length; i += 50) {
      const part = cities.slice(i, i + 50).map((k) => k.split("|"));
      const { results } = await env.DB.prepare(
        `SELECT country AS cc, upper(COALESCE(region, '')) AS st, lower(ascii) AS ci, MAX(population) AS pop FROM geo_cities
         WHERE ${part.map(() => "(country = ? AND upper(COALESCE(region, '')) = ? AND ascii = ? COLLATE NOCASE)").join(" OR ")} GROUP BY 1, 2, 3`,
      ).bind(...part.flat()).all<{ cc: string; st: string; ci: string; pop: number }>();
      for (const r of results) cityPops.set(`${r.cc}|${r.st}|${r.ci}`, r.pop);
    }
    const sums = new Map<string, { n: number; pop: number }>();
    for (const s of searches) {
      const pop = s.ci ? cityPops.get(`${s.cc}|${s.st}|${s.ci}`) : regionPop.get(`${s.cc}|${s.st}`);
      if (!pop || pop < 1000) continue;
      const t = sums.get(s.c) ?? { n: 0, pop: 0 };
      t.n += s.n; t.pop += pop;
      sums.set(s.c, t);
    }
    const perType: Record<string, number> = {};
    let rateSum = 0;
    for (const [c, t] of sums) { perType[c] = t.n / t.pop; rateSum += t.n / t.pop; }
    return { perType, average: sums.size ? rateSum / sums.size : null };
  });
}

/** Population that stands in for a place: the city's, or the state's / region's cities added up. */
async function placePopulation(env: Env, p: ResolvedPlace): Promise<number | null> {
  if (p.city) {
    const r = await env.DB.prepare(
      `SELECT MAX(population) AS pop FROM geo_cities WHERE country = ? AND (ascii = ? COLLATE NOCASE OR name = ?) ${p.countryCode === "US" && p.state ? "AND region = ?" : ""}`,
    ).bind(...[p.countryCode, p.city, p.city, ...(p.countryCode === "US" && p.state ? [p.state] : [])]).first<number>("pop");
    // Radius searches cover the area around the city, roughly twice the city itself.
    return r ? (p.radiusMiles ? r * (p.radiusMiles >= 25 ? 3 : 2) : r) : null;
  }
  const regionCode = p.countryCode === "US" ? p.state : await env.DB.prepare(`SELECT code FROM geo_regions WHERE country = ? AND name = ?`).bind(p.countryCode, p.regionName).first<string>("code");
  const pops = await cached(env, `estimate-region-pop-v1|${p.countryCode}|${regionCode ?? ""}`, 86_400, async () =>
    (await env.DB.prepare(regionCode ? `SELECT SUM(population) AS pop FROM geo_cities WHERE country = ? AND region = ?` : `SELECT SUM(population) AS pop FROM geo_cities WHERE country = ?`)
      .bind(...(regionCode ? [p.countryCode, regionCode] : [p.countryCode])).first<number>("pop")));
  return pops ?? null;
}

/** Roughly how many businesses of this type are in the place (null = no way to tell yet). */
export async function makeEstimator(env: Env) {
  const d = await densities(env);
  const popCache = new Map<string, Promise<number | null>>();
  return async (category: string, p: ResolvedPlace): Promise<number | null> => {
    const rate = d.perType[category.toLowerCase()] ?? d.average;
    if (rate == null) return null;
    const k = `${placeKey(p)}|${p.radiusMiles ?? 0}`;
    if (!popCache.has(k)) popCache.set(k, placePopulation(env, p));
    const pop = await popCache.get(k)!;
    if (!pop) return null;
    const n = rate * pop;
    // Rounded so it reads as the estimate it is.
    return n < 10 ? Math.max(1, Math.round(n)) : n < 100 ? Math.round(n / 5) * 5 : n < 1000 ? Math.round(n / 10) * 10 : Math.round(n / 100) * 100;
  };
}
