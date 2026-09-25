// "How many businesses exist?" via DataForSEO Business Listings (total_count with limit 1).
// About $0.0124 per question; answers are cached for a week in count_cache.

const ENDPOINT = "https://api.dataforseo.com/v3/business_data/business_listings/search/live";
const CACHE_DAYS = 7;

export interface CountQuestion {
  category: string;
  /** ISO country code, e.g. "US", "IN". */
  country: string;
  /** Region name as Google writes it, e.g. "Florida", "Maharashtra". */
  region?: string | null;
  city?: string | null;
  website?: "yes" | "no" | null;
  verifiedOnly?: boolean;
}

export interface CountAnswer {
  total: number | null;
  cached: boolean;
  costUsd: number;
  error?: string;
}

/** DataForSEO category ids are the Google category name in snake_case: "Insurance broker" -> "insurance_broker". */
export function dfsCategoryId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function countKey(q: CountQuestion): string {
  return [dfsCategoryId(q.category), q.country, q.region ?? "", q.city ?? "", q.website ?? "", q.verifiedOnly ? 1 : 0]
    .map((p) => String(p).toLowerCase())
    .join("|");
}

export function countTask(q: CountQuestion) {
  const filters: unknown[] = [["address_info.country_code", "=", q.country.toUpperCase()]];
  const and = (f: unknown) => filters.push("and", f);
  if (q.region) and(["address_info.region", "=", q.region]);
  if (q.city) and(["address_info.city", "=", q.city]);
  if (q.website === "no") and(["url", "=", null]);
  if (q.website === "yes") and(["url", "<>", null]);
  return [{ categories: [dfsCategoryId(q.category)], filters, ...(q.verifiedOnly ? { is_claimed: true } : {}), limit: 1 }];
}

export async function countBusinesses(env: Env, q: CountQuestion): Promise<CountAnswer> {
  const key = countKey(q);
  const hit = await env.DB.prepare(`SELECT total FROM count_cache WHERE key = ? AND created_at >= datetime('now', ?)`)
    .bind(key, `-${CACHE_DAYS} days`)
    .first<number>("total");
  if (hit != null) return { total: hit, cached: true, costUsd: 0 };

  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    return { total: null, cached: false, costUsd: 0, error: "Counting isn't set up (DataForSEO login missing)." };
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(countTask(q)),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json()) as {
      cost?: number;
      status_message?: string;
      tasks?: { status_code?: number; status_message?: string; result?: { total_count?: number }[] | null }[];
    };
    const task = body.tasks?.[0];
    if (!res.ok || task?.status_code !== 20000) {
      return { total: null, cached: false, costUsd: body.cost ?? 0, error: `Count failed: ${task?.status_message ?? body.status_message ?? res.status}` };
    }
    const total = task.result?.[0]?.total_count ?? 0;
    await env.DB.prepare(`INSERT OR REPLACE INTO count_cache (key, total, cost_usd, created_at) VALUES (?, ?, ?, datetime('now'))`)
      .bind(key, total, body.cost ?? 0)
      .run();
    return { total, cached: false, costUsd: body.cost ?? 0 };
  } catch (err) {
    return { total: null, cached: false, costUsd: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
