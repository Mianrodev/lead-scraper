// Company facts shown with a business: size ranges (employees, revenue), founded year, and how
// it compares with similar businesses nearby ("above / below local average", "low review
// count"). Sizes are always ranges with their source: the public PPP loan records (2020-21) or
// an estimate from the business type and reviews. Never exact figures.

/** "10–19", "500+", or "" when unknown. */
export function rangeText(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null) return "";
  if (max == null) return `${min.toLocaleString("en-US")}+`;
  return min === max ? min.toLocaleString("en-US") : `${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}`;
}

/** 250000 -> "$250k", 1000000 -> "$1M", 2500000 -> "$2.5M". */
export function money(n: number): string {
  if (n >= 1_000_000) return `$${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

/** "$1M–$2.5M", "$25M+", "under $250k", or "". */
export function revenueText(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null && max == null) return "";
  if (!min && max != null) return `under ${money(max)}`;
  if (max == null) return `${money(min!)}+`;
  return `${money(min!)}–${money(max)}`;
}

/** Where a size came from, in plain words. */
export function sizeNote(source: string | null | undefined, year: number | null | undefined): string {
  if (source === "ppp") return `PPP loan record${year ? ` (${year})` : ""}`;
  if (source === "estimate") return "estimated";
  return "";
}

export interface LocalAverage { avg_rating: number | null; avg_reviews: number | null; businesses: number }

/** "Above local average" / "Below local average" / "Low review count" for a business. */
export function localLabels(rating: number | null | undefined, reviews: number | null | undefined, avg: LocalAverage | null | undefined): string[] {
  if (!avg || avg.businesses < 3) return [];
  const out: string[] = [];
  if (rating != null && avg.avg_rating != null) {
    if (rating >= avg.avg_rating + 0.2) out.push("Above local average");
    else if (rating <= avg.avg_rating - 0.2) out.push("Below local average");
  }
  if (reviews != null && avg.avg_reviews != null && reviews < Math.max(5, avg.avg_reviews * 0.3)) out.push("Low review count");
  return out;
}

/** SQL (over leads aliased `x`) for a business's labels, joining the local averages. */
export const LOCAL_LABELS_SQL = `(SELECT json_object('r', la.avg_rating, 'v', la.avg_reviews, 'n', la.businesses) FROM local_averages la
  WHERE la.state = x.state AND la.city = x.city AND la.category = x.gbp_category)`;

/** Labels from the JSON the SQL above returns. */
export function labelsFromJson(rating: number | null, reviews: number | null, json: string | null): string[] {
  if (!json) return [];
  try {
    const a = JSON.parse(json) as { r: number | null; v: number | null; n: number };
    return localLabels(rating, reviews, { avg_rating: a.r, avg_reviews: a.v, businesses: a.n });
  } catch {
    return [];
  }
}

/**
 * Daily: averages per business type and city, from businesses with Google ratings (3 or more
 * in a group). Small: one row per group, rewritten once a day.
 */
export async function refreshLocalAverages(env: Env): Promise<number> {
  const last = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'local_averages_at'`).first<string>("value");
  if (last && Date.parse(last.replace(" ", "T") + "Z") > Date.now() - 20 * 3_600_000) return 0;
  const r = await env.DB.batch([
    env.DB.prepare(`DELETE FROM local_averages`),
    env.DB.prepare(
      `INSERT INTO local_averages (state, city, category, businesses, avg_rating, avg_reviews)
       SELECT state, city, gbp_category, COUNT(*), ROUND(AVG(rating), 2), ROUND(AVG(review_count), 1) FROM leads
       WHERE rating IS NOT NULL AND state IS NOT NULL AND city IS NOT NULL AND gbp_category IS NOT NULL AND suppressed IS NULL
       GROUP BY state, city, gbp_category HAVING COUNT(*) >= 3`,
    ),
    env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('local_averages_at', datetime('now'), datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
  ]);
  return r[1].meta?.changes ?? 0;
}
