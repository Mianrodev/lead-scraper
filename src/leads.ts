// Filtered, sorted, paginated lead queries for the dashboard. Filters apply to every
// lead collected so far, not just one search. The same query (buildLeadQuery) will back
// "select all matching" and CSV export, so every filter is plain SQL over lead columns.

export interface LeadFilters {
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

export function parseFilters(params: URLSearchParams): LeadFilters {
  return {
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

/** WHERE clause (over `leads l`) + bindings for every non-dedup filter. */
export function buildWhere(f: LeadFilters): { sql: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  const inList = (column: string, values: string[]) => {
    if (!values.length) return;
    clauses.push(`${column} IN (${placeholders(values)})`);
    binds.push(...values);
  };

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
  country, is_claimed, business_status, has_street_address, source_code, lead_status, lead_date, created_at`;

export async function listLeads(env: Env, params: URLSearchParams) {
  const filters = parseFilters(params);
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
    page,
    pageSize,
    results: rows.results,
  };
}

type FacetRow = { value: string | null; n: number };

/** Values for the filter dropdowns, with counts over everything stored. */
export async function leadFacets(env: Env) {
  const [states, cities, categories, phoneTypes, statuses, verified, location, leadStatuses, sourceCodes] =
    await env.DB.batch<FacetRow>([
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
