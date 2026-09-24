// Filtered, sorted, paginated lead queries for the dashboard. Filters apply to
// every lead collected so far, not just one search.

export interface LeadFilters {
  searchId?: string;
  states: string[];
  cities: string[];
  categories: string[];
  /** mobile | landline | toll_free | voip | unknown | unchecked */
  phoneTypes: string[];
  website?: "yes" | "no";
  minRating?: number;
  minReviews?: number;
  maxReviews?: number;
  q?: string;
}

const SORTS: Record<string, string> = {
  name: "l.business_name COLLATE NOCASE",
  rating: "l.rating",
  reviews: "l.review_count",
  category: "l.gbp_category COLLATE NOCASE",
  city: "l.city COLLATE NOCASE",
  added: "l.created_at",
};

const PHONE_TYPES = ["mobile", "landline", "toll_free", "voip", "unknown"];

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

export function parseFilters(params: URLSearchParams): LeadFilters {
  const website = params.get("website");
  return {
    searchId: params.get("search_id") || undefined,
    states: list(params, "state"),
    cities: list(params, "city"),
    categories: list(params, "category"),
    phoneTypes: list(params, "phone_type").filter((t) => t === "unchecked" || PHONE_TYPES.includes(t)),
    website: website === "yes" || website === "no" ? website : undefined,
    minRating: optionalNumber(params.get("min_rating")),
    minReviews: optionalNumber(params.get("min_reviews")),
    maxReviews: optionalNumber(params.get("max_reviews")),
    q: params.get("q")?.trim() || undefined,
  };
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

/** WHERE clause + bindings shared by the listing, the count, and (later) export/bulk actions. */
export function buildWhere(f: LeadFilters): { sql: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];

  if (f.searchId) {
    clauses.push("l.id IN (SELECT lead_id FROM search_leads WHERE search_id = ?)");
    binds.push(f.searchId);
  }
  if (f.states.length) {
    clauses.push(`l.state IN (${placeholders(f.states)})`);
    binds.push(...f.states);
  }
  if (f.cities.length) {
    clauses.push(`l.city IN (${placeholders(f.cities)})`);
    binds.push(...f.cities);
  }
  if (f.categories.length) {
    clauses.push(`l.gbp_category IN (${placeholders(f.categories)})`);
    binds.push(...f.categories);
  }
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
  if (f.website === "yes") clauses.push("l.website IS NOT NULL AND l.website <> ''");
  if (f.website === "no") clauses.push("(l.website IS NULL OR l.website = '')");
  if (f.minRating != null) {
    clauses.push("l.rating >= ?");
    binds.push(f.minRating);
  }
  if (f.minReviews != null) {
    clauses.push("COALESCE(l.review_count, 0) >= ?");
    binds.push(f.minReviews);
  }
  if (f.maxReviews != null) {
    clauses.push("COALESCE(l.review_count, 0) <= ?");
    binds.push(f.maxReviews);
  }
  if (f.q) {
    clauses.push("l.business_name LIKE ? ESCAPE '\\'");
    binds.push(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", binds };
}

const LIST_COLUMNS = `l.id, l.business_name, l.gbp_category, l.sub_category, l.gbp_phone_raw, l.gbp_phone_formatted,
  l.phone_type, l.phone_carrier, l.website, l.gbp_url, l.rating, l.review_count, l.address, l.city, l.state,
  l.country, l.is_claimed, l.source_code, l.lead_status, l.lead_date, l.created_at`;

export async function listLeads(env: Env, params: URLSearchParams) {
  const filters = parseFilters(params);
  const { sql: where, binds } = buildWhere(filters);
  const sortCol = SORTS[params.get("sort") ?? ""] ?? SORTS.added;
  const dir = params.get("dir") === "asc" ? "ASC" : "DESC";
  const pageSize = Math.min(Math.max(Number(params.get("page_size")) || 50, 1), 200);
  const page = Math.max(Number(params.get("page")) || 1, 1);

  const [rows, count] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ${LIST_COLUMNS} FROM leads l ${where}
       ORDER BY ${sortCol} ${dir} NULLS LAST, l.id LIMIT ? OFFSET ?`,
    ).bind(...binds, pageSize, (page - 1) * pageSize),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM leads l ${where}`).bind(...binds),
  ]);
  return {
    total: (count.results[0] as { n: number }).n,
    page,
    pageSize,
    results: rows.results,
  };
}

/** Values for the filter dropdowns, with counts. */
export async function leadFacets(env: Env) {
  const [states, cities, categories, phoneTypes] = await env.DB.batch<{ value: string | null; n: number }>([
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
  ]);
  return {
    states: states.results,
    cities: cities.results.map((r) => {
      const [city, state] = (r.value ?? "").split("|");
      return { city, state: state || null, n: r.n };
    }),
    categories: categories.results,
    phoneTypes: phoneTypes.results,
  };
}
