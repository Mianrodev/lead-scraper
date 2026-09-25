// Countries, states/provinces and cities from GeoNames (seeded by migrations/0005_geo.sql).

export interface GeoCountry {
  code: string;
  name: string;
  cities: number;
}
export interface GeoRegion {
  country: string;
  code: string;
  name: string;
  cities: number;
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
    `SELECT c.code, c.name, (SELECT COUNT(*) FROM geo_cities g WHERE g.country = c.code) AS cities
     FROM geo_countries c ORDER BY c.name`,
  ).all<GeoCountry>();
  return results;
}

export async function listRegions(env: Env, countries: string[]): Promise<GeoRegion[]> {
  if (!countries.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT r.country, r.code, r.name,
            (SELECT COUNT(*) FROM geo_cities g WHERE g.country = r.country AND g.region = r.code) AS cities
     FROM geo_regions r WHERE r.country IN (${countries.map(() => "?").join(", ")})
     ORDER BY r.country, r.name`,
  )
    .bind(...countries.slice(0, 50))
    .all<GeoRegion>();
  return results;
}

/** Biggest cities first. `regions` are "CC.code" keys (e.g. "US.FL", "IN.16"). */
export async function listCities(
  env: Env,
  opts: { countries: string[]; regions: string[]; q?: string; limit?: number },
): Promise<GeoCity[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (opts.regions.length) {
    const pairs = opts.regions.slice(0, 40).map((k) => k.split("."));
    clauses.push(`(${pairs.map(() => "(g.country = ? AND g.region = ?)").join(" OR ")})`);
    for (const [c, r] of pairs) binds.push(c, r);
  } else if (opts.countries.length) {
    clauses.push(`g.country IN (${opts.countries.slice(0, 50).map(() => "?").join(", ")})`);
    binds.push(...opts.countries.slice(0, 50));
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
