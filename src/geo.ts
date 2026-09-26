// Countries, states/provinces and cities from GeoNames (seeded by migrations/0005_geo.sql).

export interface GeoCountry {
  code: string;
  name: string;
}
export interface GeoRegion {
  country: string;
  code: string;
  name: string;
}
export interface GeoCity {
  id: number;
  name: string;
  country: string;
  region: string | null;
  region_name: string | null;
  population: number;
  lat: number;
  lng: number;
}

export async function listCountries(env: Env): Promise<GeoCountry[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.code, c.name FROM geo_countries c ORDER BY c.name`,
  ).all<GeoCountry>();
  return results;
}

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const codes = (list: string[]) => list.filter((c) => /^[A-Za-z]{2}$/.test(c)).map((c) => lit(c.toUpperCase()));

// Country and region codes are validated and inlined, so any number can be picked
// (D1 allows at most 100 bound parameters per query).
export async function listRegions(env: Env, countries: string[]): Promise<GeoRegion[]> {
  const list = codes(countries);
  if (!list.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT r.country, r.code, r.name
     FROM geo_regions r WHERE r.country IN (${list.join(", ")})
     ORDER BY r.country, r.name`,
  ).all<GeoRegion>();
  return results;
}

/** Biggest cities first. `regions` are "CC.code" keys (e.g. "US.FL", "IN.16"). */
export async function listCities(
  env: Env,
  opts: { countries: string[]; regions: string[]; q?: string; limit?: number },
): Promise<GeoCity[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  const pairs = opts.regions.map((k) => k.split(".")).filter(([c, r]) => /^[A-Za-z]{2}$/.test(c ?? "") && /^[A-Za-z0-9]{1,20}$/.test(r ?? ""));
  if (pairs.length) {
    clauses.push(`(${pairs.map(([c, r]) => `(g.country = ${lit(c.toUpperCase())} AND g.region = ${lit(r)})`).join(" OR ")})`);
  } else if (codes(opts.countries).length) {
    clauses.push(`g.country IN (${codes(opts.countries).join(", ")})`);
  }
  if (opts.q?.trim()) {
    clauses.push("(g.name LIKE ? OR g.ascii LIKE ?)");
    binds.push(`${opts.q.trim()}%`, `${opts.q.trim()}%`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 300, 1), 2000);
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.name, g.country, g.region, r.name AS region_name, g.population, g.lat, g.lng
     FROM geo_cities g LEFT JOIN geo_regions r ON r.country = g.country AND r.code = g.region
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY g.population DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<GeoCity>();
  return results;
}

export async function countryName(env: Env, code: string): Promise<string | null> {
  return env.DB.prepare(`SELECT name FROM geo_countries WHERE code = ?`).bind(code).first<string>("name");
}

export async function regionName(env: Env, country: string, code: string): Promise<string | null> {
  return env.DB.prepare(`SELECT name FROM geo_regions WHERE country = ? AND code = ?`).bind(country, code).first<string>("name");
}
