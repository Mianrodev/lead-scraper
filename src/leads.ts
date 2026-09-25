// Filtered, sorted, paginated lead queries for the dashboard. Filters apply to every
// lead collected so far, not just one search. The same query (buildLeadQuery) will back
// "select all matching" and CSV export, so every filter is plain SQL over lead columns.

import { INDUSTRIES, TOP_100 } from "./taxonomy";

export const OTHER_INDUSTRY = "Other";

export interface NearCenter {
  lat: number;
  lng: number;
  radiusMiles: number;
}

export interface LeadFilters {
  industries: string[];
  /** Only the 100 most-targeted categories. */
  top100: boolean;
  excludeCategories: string[];
  postalCodes: string[];
  /** "City|ST" or "zip:12345"; resolved to `nearCenter` by resolveFilters(). */
  near?: string;
  radiusMiles?: number;
  nearCenter?: NearCenter | null;
  /** Top N percent of the results of any search that found the lead. */
  topPercent?: number;
  updatedFrom?: string;
  updatedTo?: string;
  priceLevels: string[];
  minPhotos?: number;
  /** Google profile attributes; a lead must have all of them. */
  attributes: string[];
  searchIds: string[];
  states: string[];
  cities: string[];
  categories: string[];
  /** mobile | landline | toll_free | voip | unknown | unchecked */
  phoneTypes: string[];
  /** operational | temporarily_closed | permanently_closed */
  statuses: string[];
  leadStatuses: string[];
  sourceCodes: string[];
  verified?: "verified" | "unverified";
  website?: "yes" | "no";
  phone?: "yes" | "no";
  /** storefront = has a street address; service_area = no address shown on Google */
  location?: "storefront" | "service_area";
  minRating?: number;
  maxRating?: number;
  minReviews?: number;
  maxReviews?: number;
  /** Position in Google's results for the search that found it: top N. */
  maxRank?: number;
  addedFrom?: string;
  addedTo?: string;
  q?: string;
  /** Keep one business per website (the most-reviewed). */
  dedupeWebsite: boolean;
  /** Keep one business per phone number. */
  dedupePhone: boolean;
  /** Keep one business per Google Maps listing number (CID). */
  dedupeListing: boolean;
}

const PHONE_TYPES = ["mobile", "landline", "toll_free", "voip", "unknown", "unchecked"];
const BUSINESS_STATUSES = ["operational", "temporarily_closed", "permanently_closed"];

const SORTS: Record<string, string> = {
  name: "business_name COLLATE NOCASE",
  rating: "rating",
  reviews: "review_count",
  category: "gbp_category COLLATE NOCASE",
  city: "city COLLATE NOCASE",
  rank: "gbp_rank",
  added: "created_at",
};

// Which copy to keep when removing duplicates: most reviews, then best rating, then best position.
const BEST_FIRST = "COALESCE(review_count, 0) DESC, COALESCE(rating, 0) DESC, COALESCE(gbp_rank, 999999), created_at, id";

function list(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

function optionalNumber(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function optionalDate(value: string | null): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

const flag = (params: URLSearchParams, key: string) => ["1", "true", "yes"].includes(params.get(key) ?? "");

const TOP_PERCENTS = [1, 5, 10, 25];
const PRICE_LEVELS = ["$", "$$", "$$$", "$$$$"];

export function parseFilters(params: URLSearchParams): LeadFilters {
  const topPercent = optionalNumber(params.get("top_pct"));
  const radius = optionalNumber(params.get("radius_miles"));
  return {
    industries: list(params, "industry"),
    top100: flag(params, "top100"),
    excludeCategories: list(params, "exclude_category"),
    postalCodes: list(params, "postal_code"),
    near: params.get("near")?.trim() || undefined,
    radiusMiles: radius != null && radius > 0 && radius <= 500 ? radius : undefined,
    topPercent: topPercent != null && TOP_PERCENTS.includes(topPercent) ? topPercent : undefined,
    updatedFrom: optionalDate(params.get("updated_from")),
    updatedTo: optionalDate(params.get("updated_to")),
    priceLevels: list(params, "price").filter((p) => PRICE_LEVELS.includes(p)),
    minPhotos: optionalNumber(params.get("min_photos")),
    attributes: list(params, "attribute"),
    searchIds: list(params, "search_id"),
    states: list(params, "state"),
    cities: list(params, "city"),
    categories: list(params, "category"),
    phoneTypes: list(params, "phone_type").filter((t) => PHONE_TYPES.includes(t)),
    statuses: list(params, "status").filter((s) => BUSINESS_STATUSES.includes(s)),
    leadStatuses: list(params, "lead_status"),
    sourceCodes: list(params, "source_code"),
    verified: oneOf(params.get("verified"), ["verified", "unverified"] as const),
    website: oneOf(params.get("website"), ["yes", "no"] as const),
    phone: oneOf(params.get("phone"), ["yes", "no"] as const),
    location: oneOf(params.get("location"), ["storefront", "service_area"] as const),
    minRating: optionalNumber(params.get("min_rating")),
    maxRating: optionalNumber(params.get("max_rating")),
    minReviews: optionalNumber(params.get("min_reviews")),
    maxReviews: optionalNumber(params.get("max_reviews")),
    maxRank: optionalNumber(params.get("max_rank")),
    addedFrom: optionalDate(params.get("added_from")),
    addedTo: optionalDate(params.get("added_to")),
    q: params.get("q")?.trim() || undefined,
    dedupeWebsite: flag(params, "dedupe_website"),
    dedupePhone: flag(params, "dedupe_phone"),
    dedupeListing: flag(params, "dedupe_listing"),
  };
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

/** Quoted SQL string literal. Used for long lists, since D1 allows at most 100 bound parameters. */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Lists longer than this are inlined as escaped literals instead of bound parameters.
const MAX_BOUND_LIST = 20;

/**
 * Where a filter needs a center point (e.g. "within 10 miles of Orlando, FL") we use the
 * average position of the businesses we already have there, so no geocoding service is needed.
 */
export async function resolveFilters(env: Env, params: URLSearchParams): Promise<LeadFilters> {
  const f = parseFilters(params);
  if (f.near && f.radiusMiles) {
    const zip = f.near.match(/^zip:(.+)$/i)?.[1]?.trim();
    const [city, state] = f.near.split("|");
    const center = await (zip
      ? env.DB.prepare(
          `SELECT AVG(latitude) AS lat, AVG(longitude) AS lng FROM leads WHERE postal_code = ? AND latitude IS NOT NULL`,
        ).bind(zip)
      : env.DB.prepare(
          `SELECT AVG(latitude) AS lat, AVG(longitude) AS lng FROM leads
           WHERE city = ? AND COALESCE(state, '') = COALESCE(?, '') AND latitude IS NOT NULL`,
        ).bind(city?.trim() ?? "", state?.trim() || null)
    ).first<{ lat: number | null; lng: number | null }>();
    f.nearCenter = center?.lat != null && center.lng != null ? { lat: center.lat, lng: center.lng, radiusMiles: f.radiusMiles } : null;
  }
  return f;
}

/** WHERE clause (over `leads l`) + bindings for every non-dedup filter. */
export function buildWhere(f: LeadFilters): { sql: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  const inList = (column: string, values: string[], negate = false) => {
    if (!values.length) return;
    const op = negate ? "NOT IN" : "IN";
    if (values.length > MAX_BOUND_LIST) {
      clauses.push(`${negate ? `COALESCE(${column}, '')` : column} ${op} (${values.map(sqlString).join(", ")})`);
      return;
    }
    clauses.push(`${negate ? `COALESCE(${column}, '')` : column} ${op} (${placeholders(values)})`);
    binds.push(...values);
  };

  if (f.industries.length) {
    const named = f.industries.filter((i) => i !== OTHER_INDUSTRY);
    const parts: string[] = [];
    if (named.length) {
      parts.push(`l.industry IN (${placeholders(named)})`);
      binds.push(...named);
    }
    if (f.industries.includes(OTHER_INDUSTRY)) parts.push("l.industry IS NULL");
    clauses.push(`(${parts.join(" OR ")})`);
  }
  if (f.top100) clauses.push(`l.gbp_category IN (${TOP_100.map(sqlString).join(", ")})`);
  inList("l.gbp_category", f.excludeCategories, true);
  inList("l.postal_code", f.postalCodes);
  inList("l.price_level", f.priceLevels);
  if (f.nearCenter) {
    // Flat-earth distance: accurate to well under 1% at city scale. Degrees -> miles.
    const lngMiles = 69.172 * Math.cos((f.nearCenter.lat * Math.PI) / 180);
    clauses.push(
      `l.latitude IS NOT NULL AND ((l.latitude - ?) * 69.0) * ((l.latitude - ?) * 69.0)
         + ((l.longitude - ?) * ?) * ((l.longitude - ?) * ?) <= ? * ?`,
    );
    const { lat, lng, radiusMiles } = f.nearCenter;
    binds.push(lat, lat, lng, lngMiles, lng, lngMiles, radiusMiles, radiusMiles);
  } else if (f.near && f.radiusMiles && f.nearCenter === null) {
    clauses.push("0 = 1"); // center couldn't be found: match nothing rather than everything
  }
  if (f.topPercent != null) {
    clauses.push(
      `EXISTS (SELECT 1 FROM search_leads sl JOIN searches s ON s.id = sl.search_id
               WHERE sl.lead_id = l.id AND sl.rank IS NOT NULL
                 AND sl.rank <= MAX(1, (COALESCE(s.results_count, 0) * ? + 99) / 100))`,
    );
    binds.push(f.topPercent);
  }
  if (f.updatedFrom) {
    clauses.push("l.updated_at >= ?");
    binds.push(f.updatedFrom);
  }
  if (f.updatedTo) {
    clauses.push("l.updated_at < date(?, '+1 day')");
    binds.push(f.updatedTo);
  }
  if (f.minPhotos != null) {
    clauses.push("COALESCE(l.photos_count, 0) >= ?");
    binds.push(f.minPhotos);
  }
  if (f.attributes.length) {
    clauses.push(
      `l.id IN (SELECT lead_id FROM lead_attributes WHERE name IN (${placeholders(f.attributes)})
                GROUP BY lead_id HAVING COUNT(DISTINCT name) = ?)`,
    );
    binds.push(...f.attributes, f.attributes.length);
  }

  if (f.searchIds.length) {
    clauses.push(`l.id IN (SELECT lead_id FROM search_leads WHERE search_id IN (${placeholders(f.searchIds)}))`);
    binds.push(...f.searchIds);
  }
  inList("l.state", f.states);
  inList("l.city", f.cities);
  inList("l.gbp_category", f.categories);
  inList("l.business_status", f.statuses);
  inList("l.lead_status", f.leadStatuses);
  inList("l.source_code", f.sourceCodes);

  if (f.phoneTypes.length) {
    const types = f.phoneTypes.filter((t) => t !== "unchecked");
    const parts: string[] = [];
    if (types.length) {
      parts.push(`l.phone_type IN (${placeholders(types)})`);
      binds.push(...types);
    }
    if (f.phoneTypes.includes("unchecked")) parts.push("(l.phone_type IS NULL AND l.gbp_phone_formatted IS NOT NULL)");
    clauses.push(`(${parts.join(" OR ")})`);
  }
  // Unknown claim status counts as verified: only an explicit "unclaimed" is unverified.
  if (f.verified === "verified") clauses.push("COALESCE(l.is_claimed, 1) = 1");
  if (f.verified === "unverified") clauses.push("l.is_claimed = 0");
  if (f.website === "yes") clauses.push("l.website IS NOT NULL AND l.website <> ''");
  if (f.website === "no") clauses.push("(l.website IS NULL OR l.website = '')");
  if (f.phone === "yes") clauses.push("l.gbp_phone_formatted IS NOT NULL");
  if (f.phone === "no") clauses.push("l.gbp_phone_formatted IS NULL");
  if (f.location === "storefront") clauses.push("l.has_street_address = 1");
  if (f.location === "service_area") clauses.push("l.has_street_address = 0");

  const range = (sql: string, value: number | undefined) => {
    if (value == null) return;
    clauses.push(sql);
    binds.push(value);
  };
  range("l.rating >= ?", f.minRating);
  range("l.rating <= ?", f.maxRating);
  range("COALESCE(l.review_count, 0) >= ?", f.minReviews);
  range("COALESCE(l.review_count, 0) <= ?", f.maxReviews);
  range("l.gbp_rank <= ?", f.maxRank);

  if (f.addedFrom) {
    clauses.push("l.created_at >= ?");
    binds.push(f.addedFrom);
  }
  if (f.addedTo) {
    clauses.push("l.created_at < date(?, '+1 day')");
    binds.push(f.addedTo);
  }
  if (f.q) {
    clauses.push("l.business_name LIKE ? ESCAPE '\\'");
    binds.push(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", binds };
}

/**
 * The full filtered set as a chain of CTEs. `source` names the final CTE to select from.
 * Duplicate removal runs in sequence (website, then phone, then listing) on what's left
 * after the filters, keeping the best copy each time.
 */
export function buildLeadQuery(f: LeadFilters): { with: string; source: string; binds: unknown[] } {
  const { sql: where, binds } = buildWhere(f);
  const ctes = [`f AS (SELECT l.* FROM leads l ${where})`];
  let source = "f";
  const dedupe = (name: string, key: string) => {
    ctes.push(
      `${name} AS (SELECT * FROM (SELECT ${source}.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(${key}, id) ORDER BY ${BEST_FIRST}) AS rn_${name}
        FROM ${source}) WHERE rn_${name} = 1)`,
    );
    source = name;
  };
  if (f.dedupeWebsite) dedupe("d_site", "website_domain");
  if (f.dedupePhone) dedupe("d_phone", "gbp_phone_formatted");
  if (f.dedupeListing) dedupe("d_cid", "cid");
  return { with: `WITH ${ctes.join(",\n")}`, source, binds };
}

const LIST_COLUMNS = `id, business_name, gbp_category, sub_category, gbp_phone_raw, gbp_phone_formatted,
  phone_type, phone_carrier, website, website_domain, gbp_url, gbp_rank, rating, review_count, address, city, state,
  postal_code, country, is_claimed, business_status, has_street_address, industry, price_level, photos_count,
  source_code, lead_status, lead_date, created_at, updated_at`;

export async function listLeads(env: Env, params: URLSearchParams) {
  const filters = await resolveFilters(env, params);
  const q = buildLeadQuery(filters);
  const sortCol = SORTS[params.get("sort") ?? ""] ?? SORTS.added;
  const dir = params.get("dir") === "asc" ? "ASC" : "DESC";
  const pageSize = Math.min(Math.max(Number(params.get("page_size")) || 50, 1), 200);
  const page = Math.max(Number(params.get("page")) || 1, 1);

  const [rows, count] = await env.DB.batch([
    env.DB.prepare(
      `${q.with} SELECT ${LIST_COLUMNS} FROM ${q.source}
       ORDER BY ${sortCol} IS NULL, ${sortCol} ${dir}, id LIMIT ? OFFSET ?`,
    ).bind(...q.binds, pageSize, (page - 1) * pageSize),
    env.DB.prepare(`${q.with} SELECT (SELECT COUNT(*) FROM ${q.source}) AS n, (SELECT COUNT(*) FROM f) AS before_dedupe`).bind(
      ...q.binds,
    ),
  ]);
  const counts = count.results[0] as { n: number; before_dedupe: number };
  return {
    total: counts.n,
    duplicatesHidden: counts.before_dedupe - counts.n,
    // Tells the page when a "within X miles" center couldn't be found.
    nearNotFound: filters.near && filters.radiusMiles ? filters.nearCenter === null : false,
    page,
    pageSize,
    results: rows.results,
  };
}

/** The industry -> category list, with how many stored leads each category has. */
export async function categoryTree(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT gbp_category AS value, COUNT(*) AS n FROM leads WHERE gbp_category IS NOT NULL GROUP BY gbp_category`,
  ).all<{ value: string; n: number }>();
  const counts = new Map(results.map((r) => [r.value.toLowerCase(), r.n]));
  const listed = new Set(INDUSTRIES.flatMap((i) => i.categories.map((c) => c.toLowerCase())));
  return {
    industries: INDUSTRIES.map((i) => ({
      industry: i.industry,
      categories: i.categories.map((c) => ({ name: c, n: counts.get(c.toLowerCase()) ?? 0, top100: TOP_100.includes(c) })),
    })),
    // Categories we've collected that aren't in the list.
    other: results.filter((r) => !listed.has(r.value.toLowerCase())).map((r) => ({ name: r.value, n: r.n })),
    top100: TOP_100,
  };
}

type FacetRow = { value: string | null; n: number };

/** Values for the filter dropdowns, with counts over everything stored. */
export async function leadFacets(env: Env) {
  const [
    states, cities, categories, phoneTypes, statuses, verified, location, leadStatuses, sourceCodes,
    industries, postalCodes, prices, attributes,
  ] = await env.DB.batch<FacetRow>([
      env.DB.prepare(`SELECT state AS value, COUNT(*) AS n FROM leads WHERE state IS NOT NULL GROUP BY state ORDER BY state`),
      env.DB.prepare(
        `SELECT city || '|' || COALESCE(state, '') AS value, COUNT(*) AS n FROM leads WHERE city IS NOT NULL
         GROUP BY city, state ORDER BY city`,
      ),
      env.DB.prepare(
        `SELECT gbp_category AS value, COUNT(*) AS n FROM leads WHERE gbp_category IS NOT NULL
         GROUP BY gbp_category ORDER BY n DESC, gbp_category`,
      ),
      env.DB.prepare(
        `SELECT CASE WHEN phone_type IS NULL AND gbp_phone_formatted IS NOT NULL THEN 'unchecked'
                     WHEN gbp_phone_formatted IS NULL THEN 'no_phone' ELSE phone_type END AS value,
                COUNT(*) AS n FROM leads GROUP BY value`,
      ),
      env.DB.prepare(`SELECT business_status AS value, COUNT(*) AS n FROM leads GROUP BY business_status`),
      env.DB.prepare(
        `SELECT CASE WHEN is_claimed = 0 THEN 'unverified' ELSE 'verified' END AS value, COUNT(*) AS n FROM leads GROUP BY value`,
      ),
      env.DB.prepare(
        `SELECT CASE has_street_address WHEN 1 THEN 'storefront' WHEN 0 THEN 'service_area' ELSE 'unknown' END AS value,
                COUNT(*) AS n FROM leads GROUP BY value`,
      ),
      env.DB.prepare(`SELECT lead_status AS value, COUNT(*) AS n FROM leads GROUP BY lead_status ORDER BY n DESC`),
      env.DB.prepare(
        `SELECT source_code AS value, COUNT(*) AS n FROM leads WHERE source_code IS NOT NULL GROUP BY source_code ORDER BY n DESC`,
      ),
      env.DB.prepare(
        `SELECT COALESCE(industry, '${OTHER_INDUSTRY}') AS value, COUNT(*) AS n FROM leads GROUP BY value ORDER BY n DESC`,
      ),
      env.DB.prepare(
        `SELECT postal_code AS value, COUNT(*) AS n FROM leads WHERE postal_code IS NOT NULL
         GROUP BY postal_code ORDER BY n DESC, postal_code LIMIT 200`,
      ),
      env.DB.prepare(
        `SELECT price_level AS value, COUNT(*) AS n FROM leads WHERE price_level IS NOT NULL GROUP BY price_level ORDER BY length(price_level)`,
      ),
      env.DB.prepare(
        `SELECT name AS value, COUNT(*) AS n FROM lead_attributes GROUP BY name ORDER BY n DESC, name LIMIT 80`,
      ),
    ]);
  return {
    countries: [{ value: "USA", n: null }],
    states: states.results,
    cities: cities.results.map((r) => {
      const [city, state] = (r.value ?? "").split("|");
      return { city, state: state || null, n: r.n };
    }),
    categories: categories.results,
    phoneTypes: phoneTypes.results,
    statuses: statuses.results,
    verified: verified.results,
    location: location.results,
    leadStatuses: leadStatuses.results,
    sourceCodes: sourceCodes.results,
    industries: industries.results,
    postalCodes: postalCodes.results,
    prices: prices.results,
    attributes: attributes.results,
  };
}

/** Pull history with its own filters: category / city / state text, status, date range. */
export async function listSearches(env: Env, params: URLSearchParams) {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  const like = (column: string, value: string | null) => {
    if (!value?.trim()) return;
    clauses.push(`${column} LIKE ? ESCAPE '\\'`);
    binds.push(`%${value.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  };
  like("s.category", params.get("category"));
  like("s.city", params.get("city"));
  if (params.get("state")?.trim()) {
    clauses.push("upper(s.state) = upper(?)");
    binds.push(params.get("state")!.trim());
  }
  const statuses = list(params, "status");
  if (statuses.length) {
    clauses.push(`s.status IN (${placeholders(statuses)})`);
    binds.push(...statuses);
  }
  const from = optionalDate(params.get("from"));
  const to = optionalDate(params.get("to"));
  if (from) {
    clauses.push("s.created_at >= ?");
    binds.push(from);
  }
  if (to) {
    clauses.push("s.created_at < date(?, '+1 day')");
    binds.push(to);
  }
  const limit = Math.min(Math.max(Number(params.get("limit")) || 100, 1), 500);
  const { results } = await env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM search_leads sl WHERE sl.search_id = s.id) AS leads_in_database
     FROM searches s ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY s.created_at DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all();
  return results;
}
