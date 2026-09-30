// Numbers for the public website and the business catalogue (/leads/...). Only sellable leads
// (open, from open data or Google, not on the do-not-contact list), never contact details.
// Everything is cached for hours: these pages can be visited by anyone, including crawlers.

import { cached } from "../cache";
import { stateName } from "../format";
import type { StoreEnv } from "./types";
import { StoreError } from "./types";

const SELLABLE = `data_source IN ('free', 'google', 'free+google') AND business_status = 'operational' AND suppressed IS NULL`;
const HOURS6 = 6 * 3600;
const c = <T,>(env: StoreEnv, key: string, ttl: number, f: () => Promise<T>) => cached(env as unknown as Env, key, ttl, f);

/** "Fort Lauderdale" -> "fort-lauderdale"; "HVAC contractor" -> "hvac-contractor". */
export function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const validSt = (st: string) => (/^[a-z]{2}$/i.test(st) ? st.toUpperCase() : null);

export async function publicStats(env: StoreEnv) {
  return c(env, "pub-stats", HOURS6, async () => {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS businesses, SUM(gbp_phone_formatted IS NOT NULL) AS withPhone,
              SUM(EXISTS (SELECT 1 FROM lead_emails e WHERE e.lead_id = leads.id)) AS withEmail,
              SUM(website_domain IS NOT NULL) AS withWebsite, SUM(owner_name IS NOT NULL AND owner_name <> '') AS withOwner,
              COUNT(DISTINCT state) AS states, COUNT(DISTINCT gbp_category) AS categories
       FROM leads WHERE ${SELLABLE}`,
    ).first<Record<string, number | null>>();
    const n = (k: string) => Number(r?.[k] ?? 0);
    return { businesses: n("businesses"), withPhone: n("withPhone"), withEmail: n("withEmail"), withWebsite: n("withWebsite"), withOwner: n("withOwner"), states: n("states"), categories: n("categories") };
  });
}

export async function catalogStates(env: StoreEnv) {
  return c(env, "pub-states", HOURS6, async () => {
    const { results } = await env.DB.prepare(`SELECT state AS st, COUNT(*) AS n FROM leads WHERE ${SELLABLE} AND state IS NOT NULL GROUP BY state ORDER BY n DESC`)
      .all<{ st: string; n: number }>();
    return results.filter((r) => /^[A-Z]{2}$/.test(r.st)).map((r) => ({ st: r.st, name: stateName(r.st) ?? r.st, n: r.n }));
  });
}

export async function catalogCities(env: StoreEnv, stIn: string) {
  const st = validSt(stIn);
  if (!st) return [];
  return c(env, `pub-cities:${st}`, HOURS6, async () => {
    const { results } = await env.DB.prepare(
      `SELECT city, COUNT(*) AS n FROM leads WHERE ${SELLABLE} AND state = ? AND city IS NOT NULL AND city <> '' GROUP BY city HAVING COUNT(*) >= 3 ORDER BY n DESC LIMIT 500`,
    ).bind(st).all<{ city: string; n: number }>();
    return results.map((r) => ({ city: r.city, slug: slug(r.city), n: r.n })).filter((r) => r.slug);
  });
}

async function cityFor(env: StoreEnv, st: string, citySlug: string): Promise<string | null> {
  return (await catalogCities(env, st)).find((x) => x.slug === citySlug)?.city ?? null;
}

export async function catalogCategories(env: StoreEnv, stIn: string, citySlug: string) {
  const st = validSt(stIn);
  if (!st) return null;
  const city = await cityFor(env, st, citySlug);
  if (!city) return null;
  return c(env, `pub-cats:${st}:${citySlug}`, HOURS6, async () => {
    const { results } = await env.DB.prepare(
      `SELECT gbp_category AS category, COUNT(*) AS n FROM leads WHERE ${SELLABLE} AND state = ? AND city = ? AND gbp_category IS NOT NULL
       GROUP BY gbp_category ORDER BY n DESC LIMIT 300`,
    ).bind(st, city).all<{ category: string; n: number }>();
    return { city, categories: results.map((r) => ({ category: r.category, slug: slug(r.category), n: r.n })).filter((r) => r.slug) };
  });
}

export async function catalogPage(env: StoreEnv, stIn: string, citySlug: string, catSlug: string) {
  const st = validSt(stIn);
  if (!st) return null;
  const cats = await catalogCategories(env, st, citySlug);
  const cat = cats?.categories.find((x) => x.slug === catSlug);
  if (!cats || !cat) return null;
  return c(env, `pub-page:${st}:${citySlug}:${catSlug}`, HOURS6, async () => {
    const where = `${SELLABLE} AND state = ? AND city = ? AND gbp_category = ?`;
    const [agg, samples] = await env.DB.batch([
      env.DB.prepare(
        `SELECT COUNT(*) AS n, SUM(gbp_phone_formatted IS NOT NULL) AS withPhone,
                SUM(EXISTS (SELECT 1 FROM lead_emails e WHERE e.lead_id = leads.id)) AS withEmail,
                SUM(website_domain IS NOT NULL) AS withWebsite, SUM(owner_name IS NOT NULL AND owner_name <> '') AS withOwner,
                ROUND(AVG(presence_score)) AS avgScore FROM leads WHERE ${where}`,
      ).bind(st, cats.city, cat.category),
      env.DB.prepare(
        `SELECT business_name AS name, rating, review_count AS reviews, presence_score AS score FROM leads WHERE ${where} AND business_name IS NOT NULL
         ORDER BY review_count IS NULL, review_count DESC, business_name LIMIT 12`,
      ).bind(st, cats.city, cat.category),
    ]);
    const a = (agg.results[0] ?? {}) as Record<string, number | null>;
    const num = (k: string) => Number(a[k] ?? 0);
    return {
      st, stateName: stateName(st) ?? st, city: cats.city, category: cat.category, n: num("n"),
      withPhone: num("withPhone"), withEmail: num("withEmail"), withWebsite: num("withWebsite"), withOwner: num("withOwner"),
      avgScore: a.avgScore == null ? null : Number(a.avgScore),
      samples: samples.results as { name: string; rating: number | null; reviews: number | null; score: number | null }[],
    };
  });
}

export async function publicPrices(env: StoreEnv) {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN ('store_price_free', 'store_price_google', 'store_free_per_month')`,
  ).all<{ key: string; value: string }>();
  const v = Object.fromEntries(results.map((r) => [r.key, Math.max(0, Math.floor(Number(r.value) || 0))]));
  return { free: v.store_price_free ?? 1, google: v.store_price_google ?? 3, freePerMonth: v.store_free_per_month ?? 50 };
}

/** "Remove my business": saved for the owner to review (Admin page). At most 5 per network per day. */
export async function saveRemovalRequest(
  env: StoreEnv,
  input: { business?: unknown; phone?: unknown; website?: unknown; email?: unknown; name?: unknown; contactEmail?: unknown; message?: unknown },
  ip: string,
) {
  const t = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const business = t(input.business, 160);
  const phone = t(input.phone, 40), website = t(input.website, 300), email = t(input.email, 160);
  if (!business) throw new StoreError("Enter the business name.");
  if (!phone && !website && !email) throw new StoreError("Add the business's phone number, website or email, so we can find it.");
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`removal:${ip}`));
  const ipHash = [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM store_removal_requests WHERE ip_hash = ? AND created_at > datetime('now', '-1 day')`)
    .bind(ipHash).first<number>("n");
  if ((recent ?? 0) >= 5) throw new StoreError("We've received several requests from you today. We'll handle them shortly.", 429);
  await env.DB.prepare(
    `INSERT INTO store_removal_requests (business, phone, website, email, name, contact_email, message, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(business, phone || null, website || null, email || null, t(input.name, 120) || null, t(input.contactEmail, 160) || null, t(input.message, 1000) || null, ipHash).run();
  return { ok: true as const };
}
