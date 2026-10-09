// What store customers can search, buy and download. Only sellable businesses: from open data
// or Google (never the agency's own form requests or uploaded lists), open, and not on the
// do-not-contact list. Contact details (phone, email, owner, website, street address) are only
// ever read from the database for leads the customer owns, so they can't leak through a bug
// in the page. The same filter engine as the internal app (src/leads.ts) does the searching.

import { buildLeadQuery, resolveFilters, sqlString } from "../leads";
import { cached, filterKey } from "../cache";
import { canText, csvCell, nationalPhone } from "../export";
import { bestFirst, firstNameFrom } from "../emails";
import { LOCAL_LABELS_SQL, labelsFromJson, rangeText, revenueText, sizeNote } from "../company-facts";
import { buildOpener } from "../openers";
import { stateName } from "../format";
import type { StoreEnv } from "./types";
import { StoreError } from "./types";
import type { StoreAccount } from "./auth";
import { listName, pluralWord, saveList } from "./lists";
import { cityKey, displayCity, groupCities } from "./public";
import { retryRead } from "./brand";

export const SELLABLE_SOURCES = ["free", "google", "free+google"] as const;
const SELLABLE_SQL = `data_source IN ('free', 'google', 'free+google') AND business_status = 'operational' AND suppressed IS NULL`;
export const MAX_PER_PURCHASE = 5000;
const PAGE_MAX = 50;
/** Deepest page of search results (10,000 rows at 50 a page); narrower filters show the rest. */
export const MAX_PAGE = 200;

// Customer filters -> the internal engine's parameters. Anything not listed is ignored, so a
// customer can never filter by (and so learn) the team's stages, assignments, sources, etc.
const PASS_MULTI = ["state", "city", "industry", "category", "postal_code", "score"];
const PASS_ONE: Record<string, (v: string) => boolean> = {
  phone: (v) => v === "yes", email: (v) => v === "yes", owner: (v) => v === "yes",
  website: (v) => ["yes", "no", "no_real"].includes(v),
  min_rating: (v) => /^\d(\.\d)?$/.test(v), min_reviews: (v) => /^\d{1,6}$/.test(v), max_reviews: (v) => /^\d{1,6}$/.test(v),
  q: (v) => v.length <= 80, near: (v) => v.length <= 80, radius_miles: (v) => /^\d{1,3}$/.test(v), area: (v) => v.length <= 1200,
};

export function engineParams(input: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of PASS_MULTI) for (const v of input.getAll(k).slice(0, 200)) if (v && v.length <= 120) p.append(k, v);
  for (const [k, ok] of Object.entries(PASS_ONE)) { const v = input.get(k)?.trim(); if (v && ok(v)) p.set(k, v); }
  const tier = input.get("tier");
  for (const d of tier === "free" ? ["free"] : tier === "google" ? ["google", "free+google"] : SELLABLE_SOURCES) p.append("data_source", d);
  p.set("status", "operational"); // only open businesses (the do-not-contact list is always applied by the engine)
  return p;
}

async function prices(env: StoreEnv): Promise<{ free: number; google: number; freePerMonth: number }> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN ('store_price_free', 'store_price_google', 'store_free_per_month')`)
    .all<{ key: string; value: string }>();
  const v = Object.fromEntries(results.map((r) => [r.key, Math.max(0, Math.floor(Number(r.value) || 0))]));
  return { free: v.store_price_free ?? 1, google: v.store_price_google ?? 3, freePerMonth: v.store_free_per_month ?? 50 };
}

/** This calendar month (UTC), e.g. "2026-10": the free allowance starts again each month. */
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

/** The account's free leads this month: allowance, used, left. */
export async function freeAllowance(env: StoreEnv, accountId: string) {
  const perMonth = (await prices(env)).freePerMonth;
  const row = await env.DB.prepare(`SELECT free_period, free_used FROM store_accounts WHERE id = ?`).bind(accountId)
    .first<{ free_period: string | null; free_used: number }>();
  const used = row?.free_period === monthKey() ? row.free_used : 0;
  return { perMonth, used, left: Math.max(0, perMonth - used) };
}

/**
 * Which new leads the free allowance covers (the priciest first, so customers get the most from
 * it) and what's left to pay in credits.
 */
export function splitFree(fresh: { tier: "free" | "google" }[], freeLeft: number, price: { free: number; google: number }) {
  const cost = (t: "free" | "google") => (t === "free" ? price.free : price.google);
  const sorted = [...fresh].sort((a, b) => cost(b.tier) - cost(a.tier));
  const covered = Math.min(freeLeft, sorted.length);
  const credits = sorted.slice(covered).reduce((sum, x) => sum + cost(x.tier), 0);
  return { freeLeads: covered, credits };
}
export { prices as storePrices };

const tierOf = (source: string | null) => (source === "free" ? "free" : "google");

export interface CitySpellings { city: string; n: number; names: string[] }

/**
 * A state's cities with every spelling in the data grouped under one name ("St. Petersburg" =
 * "St Petersburg", "Saint Petersburg", ...), biggest first. One cached read per state (an hour).
 */
export async function cityGroups(env: StoreEnv, st: string): Promise<CitySpellings[]> {
  const ST = /^[A-Za-z]{2}$/.test(st) ? st.toUpperCase() : "";
  if (!ST) return [];
  return cached(env as unknown as Env, `store-cities2:${ST}`, 3600, async () => {
    const { results } = await retryRead(() => env.DB.prepare(
      `SELECT city, COUNT(*) AS n FROM leads WHERE ${SELLABLE_SQL} AND state = ? AND city IS NOT NULL AND city <> '' GROUP BY city`,
    ).bind(ST).all<{ city: string; n: number }>(), "store read");
    return groupCities(results.map((r) => ({ city: r.city, category: null, n: r.n })), ST, 1).map((g) => ({ city: g.city, n: g.n, names: g.names }));
  });
}

/** The spellings of "City|ST" in the data (the city itself when it isn't known). */
export async function spellingsOf(env: StoreEnv, value: string): Promise<string[]> {
  const [city, st] = value.split("|");
  if (!city || !st) return [city ?? ""].filter(Boolean);
  const key = cityKey(city, st);
  const g = (await cityGroups(env, st)).find((x) => cityKey(x.city, st) === key || x.names.includes(city));
  return g ? g.names : [city];
}

/**
 * Searches by city cover all its spellings: "city=St. Petersburg|FL" becomes one city= per
 * spelling; "near=St. Petersburg|FL" uses the most common spelling (the one with the most map points).
 */
export async function expandCities(env: StoreEnv, input: URLSearchParams): Promise<URLSearchParams> {
  const cities = input.getAll("city"), near = input.get("near") ?? "";
  if (!cities.some((c) => c.includes("|")) && !near.includes("|")) return input;
  const out = new URLSearchParams(input);
  out.delete("city");
  const seen = new Set<string>();
  for (const c of cities.slice(0, 20)) {
    if (!c.includes("|")) { out.append("city", c); continue; }
    const st = c.split("|")[1];
    for (const name of await spellingsOf(env, c)) {
      const v = `${name}|${st}`;
      if (!seen.has(v.toLowerCase()) && seen.size < 200) { seen.add(v.toLowerCase()); out.append("city", v); }
    }
  }
  if (near.includes("|")) out.set("near", `${(await spellingsOf(env, near))[0] ?? near.split("|")[0]}|${near.split("|")[1]}`);
  return out;
}

/** The engine's query for a customer's filters, plus the "own it / don't" filter. */
async function query(env: StoreEnv, input: URLSearchParams, accountId: string) {
  const q = buildLeadQuery(await resolveFilters(env as unknown as Env, engineParams(await expandCities(env, input))));
  const owned = input.get("owned");
  const ownedSql = owned === "yes" || owned === "no"
    ? `WHERE ${owned === "no" ? "NOT " : ""}EXISTS (SELECT 1 FROM store_purchases p WHERE p.account_id = ${sqlString(accountId)} AND p.lead_id = x.id)`
    : "";
  return { ...q, ownedSql };
}

/**
 * Cache key for a search count. Counts that depend on what the account owns ("hide leads I
 * already have") also carry the time of its latest purchase (one index lookup), so getting leads
 * shows the new count at once instead of a stale cached one.
 */
async function countKey(env: StoreEnv, q: { ownedSql: string }, accountId: string, input: URLSearchParams): Promise<string> {
  let prefix = "store-count";
  if (q.ownedSql) {
    const last = await env.DB.prepare(`SELECT MAX(purchased_at) AS t FROM store_purchases WHERE account_id = ?`).bind(accountId).first<string>("t");
    prefix += `:${accountId}:${last ?? ""}`;
  }
  return filterKey(prefix, input, ["page", "page_size", "sort", "dir"]);
}

/** "+18135550101" -> "(813) •••-••••"; other countries: the first 3 characters + "•••". Never the full number. */
export function maskPhone(head: unknown): string | null {
  if (typeof head !== "string" || !head.trim()) return null;
  const h = head.trim();
  const us = /^\+1(\d{3})/.exec(h) ?? /^\((\d{3})\)/.exec(h);
  return us ? `(${us[1]}) •••-••••` : `${h.slice(0, 3)}•••`;
}

const SORTS: Record<string, string> = {
  score: "presence_score", rating: "rating", reviews: "review_count", name: "business_name",
  // "Best data first": email, owner, website and rating, so the first rows show what the data has.
  best: "(CASE WHEN EXISTS (SELECT 1 FROM lead_emails be WHERE be.lead_id = x.id) THEN 4 ELSE 0 END + CASE WHEN x.owner_name IS NOT NULL THEN 2 ELSE 0 END" +
    " + CASE WHEN x.website IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN x.rating IS NOT NULL THEN 1 ELSE 0 END)",
};

/** ORDER BY for the chosen sort (empty values last, then id so the order is always the same). */
function orderBy(input: URLSearchParams): string {
  const col = SORTS[input.get("sort") ?? ""] ?? SORTS.best;
  const dir = input.get("dir") === "desc" ? "DESC" : input.get("dir") === "asc" ? "ASC" : col === "presence_score" || col === "business_name" ? "ASC" : "DESC";
  // "Weakest online first": real low scores first; 0 (no website / site down) after them.
  if (col === "presence_score" && dir === "ASC") return `ORDER BY ${col} IS NULL, ${col} = 0, ${col} ASC, id`;
  return `ORDER BY ${col} IS NULL, ${col} ${dir}, id`;
}

/** The first few "what to fix" suggestions from the website check (score_notes JSON). */
export function topFixes(scoreNotes: unknown, n = 3): string[] {
  if (typeof scoreNotes !== "string" || !scoreNotes) return [];
  try {
    const s = (JSON.parse(scoreNotes) as { suggestions?: unknown }).suggestions;
    return Array.isArray(s) ? s.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, n) : [];
  } catch { return []; }
}

/** Columns for a result row. Contact details only when this account owns the lead. */
function rowColumns(accountSql: string) {
  const own = `EXISTS (SELECT 1 FROM store_purchases p WHERE p.account_id = ${accountSql} AND p.lead_id = x.id)`;
  return `id, business_name AS name, gbp_category AS category, city, state, postal_code AS zip, rating, review_count AS reviews,
    presence_score AS score, data_source, gbp_phone_formatted IS NOT NULL AS hasPhone,
    EXISTS (SELECT 1 FROM lead_emails e WHERE e.lead_id = x.id) AS hasEmail,
    (owner_name IS NOT NULL AND owner_name <> '') AS hasOwner, website_domain IS NOT NULL AS hasWebsite, ${own} AS owned,
    CASE WHEN ${own} THEN gbp_phone_formatted END AS phone,
    CASE WHEN NOT ${own} THEN substr(gbp_phone_formatted, 1, 5) END AS phone_head,
    CASE WHEN ${own} THEN (SELECT group_concat(e.email, ' ') FROM lead_emails e WHERE e.lead_id = x.id
      AND NOT EXISTS (SELECT 1 FROM email_checks c WHERE c.email = e.email AND c.result IN ('invalid', 'disposable'))) END AS emails,
    CASE WHEN ${own} THEN owner_name END AS owner, CASE WHEN ${own} THEN owner_title END AS ownerTitle,
    CASE WHEN ${own} THEN website END AS website, CASE WHEN ${own} THEN address END AS address,
    employees_min, employees_max, revenue_min, revenue_max, size_source, size_year, substr(founded, 1, 4) AS foundedYear,
    (SELECT COUNT(*) FROM lead_contacts lc WHERE lc.lead_id = x.id) + (CASE WHEN owner_name IS NOT NULL AND owner_name <> ''
      AND NOT EXISTS (SELECT 1 FROM lead_contacts lc2 WHERE lc2.lead_id = x.id) THEN 1 ELSE 0 END) AS contactsCount,
    (gbp_phone_formatted IS NOT NULL) + (SELECT COUNT(*) FROM lead_phones lp WHERE lp.lead_id = x.id) AS phonesCount,
    (SELECT COUNT(*) FROM lead_emails e WHERE e.lead_id = x.id) AS emailsCount,
    ${LOCAL_LABELS_SQL} AS local_avg,
    CASE WHEN ${own} THEN (SELECT json_group_array(json_object('name', lc.name, 'title', lc.title)) FROM lead_contacts lc WHERE lc.lead_id = x.id) END AS contacts_json,
    CASE WHEN ${own} THEN (SELECT json_group_array(lp.phone) FROM lead_phones lp WHERE lp.lead_id = x.id) END AS phones_json,
    CASE WHEN ${own} THEN score_notes END AS notes_json`;
}

type RawRow = Record<string, unknown> & { data_source: string | null; emails: string | null; website: string | null };
function shapeRow(r: RawRow) {
  const { data_source, emails, local_avg, contacts_json, phones_json, notes_json, employees_min, employees_max, revenue_min, revenue_max, size_source, size_year, phone_head, ...rest } = r;
  const parse = <T,>(v: unknown): T[] => { try { return typeof v === "string" ? (JSON.parse(v) as T[]) : []; } catch { return []; } };
  const facts = {
    employees: rangeText(employees_min as number | null, employees_max as number | null) || null,
    revenue: revenueText(revenue_min as number | null, revenue_max as number | null) || null,
    sizeSource: sizeNote(size_source as string | null, size_year as number | null) || null,
    labels: labelsFromJson(r.rating as number | null, r.reviews as number | null, local_avg as string | null),
  };
  const list = emails ? bestFirst(emails.split(" ").filter(Boolean)) : [];
  const out: Record<string, unknown> = {
    ...rest, ...facts, tier: tierOf(data_source), hasPhone: !!r.hasPhone, hasEmail: !!r.hasEmail, hasOwner: !!r.hasOwner, hasWebsite: !!r.hasWebsite, owned: !!r.owned,
  };
  if (out.owned) {
    out.email = list[0] ?? null; out.emails = list;
    out.contacts = parse<{ name: string; title: string | null }>(contacts_json);
    out.phones = [r.phone, ...parse<string>(phones_json)].filter((p, i, a): p is string => typeof p === "string" && a.indexOf(p) === i);
    // What to fix (the pitch notes) only for leads the customer owns, like the contact details.
    out.fixes = topFixes(notes_json);
    // The street alone (the page adds the city, state and ZIP once).
    out.street = streetOnly(r.address as string | null, r.city as string | null, r.state as string | null);
  } else {
    for (const k of ["phone", "owner", "ownerTitle", "website", "address"]) delete out[k];
    // Only the area code, worked out here from the first 5 characters (the full number is never read).
    out.phoneMasked = maskPhone(phone_head);
  }
  return out;
}

// When nothing matches: which filter to drop first (the most likely culprits), with the plain
// action the button says ("Any category (2,828)"; the page adds the count).
const DROP_ORDER: [string, string][] = [
  ["q", "Any name"], ["email", "With or without email"], ["owner", "With or without owner name"], ["phone", "With or without phone"], ["website", "Any website"],
  ["min_rating", "Any rating"], ["min_reviews", "Any number of reviews"], ["max_reviews", "Any number of reviews"], ["score", "Any online presence"],
  ["tier", "Any lead type"], ["owned", "Show leads I already have"], ["category", "Any category"], ["industry", "Any industry"], ["area", "Remove the drawn area"],
];
/** Filters narrow enough (indexed) that counting with one filter dropped stays cheap. */
const NARROW = ["city", "postal_code", "category", "area", "near"];

export interface Suggestion { label: string; query: string; n: number | null }

/**
 * Ideas for an empty result: drop one filter (at most 3, counted only when the search is still
 * narrow, and cached like the main count), search the whole state, or look within 25 miles.
 */
export async function zeroResultHelp(env: StoreEnv, account: StoreAccount, input: URLSearchParams): Promise<Suggestion[]> {
  const base = new URLSearchParams(input);
  for (const k of ["page", "page_size", "sort", "dir"]) base.delete(k);
  const without = (keys: string[], add: [string, string][] = []) => {
    const p = new URLSearchParams(base);
    for (const k of keys) p.delete(k);
    for (const [k, v] of add) p.set(k, v);
    return p;
  };
  const count = async (p: URLSearchParams): Promise<number | null> => {
    if (!NARROW.some((k) => p.get(k))) return null;
    const q = await query(env, p, account.id);
    const key = await countKey(env, q, account.id, p);
    const c = await cached(env as unknown as Env, key, 120, async () =>
      (await env.DB.prepare(`${q.with} SELECT COUNT(*) AS total, COALESCE(SUM(data_source = 'free'), 0) AS free FROM ${q.source} AS x ${q.ownedSql}`)
        .bind(...q.binds).first<{ total: number; free: number }>()) ?? { total: 0, free: 0 });
    return Number(c.total) || 0;
  };
  const out: Suggestion[] = [];
  for (const [k, label] of DROP_ORDER) {
    if (out.length >= 3) break;
    if (!base.get(k) || (k === "owned" && base.get(k) === "all") || (k === "max_reviews" && base.get("min_reviews"))) continue;
    // "Show leads I already have too" is owned=all (no owned filter means the app's default: hide them).
    const p = k === "owned" ? without(["owned"], [["owned", "all"]]) : without(k === "min_reviews" || k === "max_reviews" ? ["min_reviews", "max_reviews"] : [k]);
    const n = await count(p);
    if (n === 0) continue;
    out.push({ label, query: p.toString(), n });
  }
  const cities = base.getAll("city");
  if (cities.length === 1 && cities[0].includes("|")) {
    const [city, st] = cities[0].split("|");
    out.push({ label: `All of ${stateName(st) ?? st}`, query: without(["city", "near", "radius_miles"], [["state", st]]).toString(), n: null });
    out.push({ label: `Within 25 miles of ${city}`, query: without(["city", "state", "area"], [["near", cities[0]], ["radius_miles", "25"]]).toString(), n: null });
  }
  return out;
}

export async function searchLeads(env: StoreEnv, account: StoreAccount, input: URLSearchParams) {
  const q = await query(env, input, account.id);
  const pageSize = Math.min(Math.max(Number(input.get("page_size")) || PAGE_MAX, 1), PAGE_MAX);
  const page = Math.min(Math.max(Number(input.get("page")) || 1, 1), MAX_PAGE); // 10,000 rows deep at most
  const rows = await retryRead(() => env.DB.prepare(
    `${q.with} SELECT ${rowColumns(sqlString(account.id))} FROM ${q.source} AS x ${q.ownedSql}
     ${orderBy(input)} LIMIT ? OFFSET ?`,
  ).bind(...q.binds, pageSize, (page - 1) * pageSize).all<RawRow>(), "store search");
  const key = await countKey(env, q, account.id, input);
  const counts = await cached(env as unknown as Env, key, 120, async () =>
    (await retryRead(() => env.DB.prepare(`${q.with} SELECT COUNT(*) AS total, COALESCE(SUM(data_source = 'free'), 0) AS free FROM ${q.source} AS x ${q.ownedSql}`)
      .bind(...q.binds).first<{ total: number; free: number }>(), "store count")) ?? { total: 0, free: 0 });
  return {
    total: counts.total, page, pageSize, maxPage: MAX_PAGE, counts: { free: counts.free, google: counts.total - counts.free },
    results: rows.results.map(shapeRow),
    ...(counts.total === 0 && page === 1 ? { suggestions: await zeroResultHelp(env, account, input) } : {}),
  };
}

/**
 * States and cities for the Where box: one suggestion per real city (its spellings grouped and
 * counted together, the same names and counts as the catalog). With `state`: all of its cities;
 * without: the 300 biggest cities everywhere.
 */
export async function places(env: StoreEnv, state: string | null) {
  const st = state && /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : null;
  const states = await cached(env as unknown as Env, "store-states", 3600, async () =>
    (await retryRead(() => env.DB.prepare(`SELECT state AS value, COUNT(*) AS n FROM leads WHERE ${SELLABLE_SQL} AND state IS NOT NULL GROUP BY state ORDER BY state`)
      .all<{ value: string; n: number }>(), "store read")).results);
  if (st) return { states, cities: (await cityGroups(env, st)).map((g) => ({ value: `${g.city}|${st}`, n: g.n })) };
  const cities = await cached(env as unknown as Env, "store-places2", 3600, async () => {
    const { results } = await retryRead(() => env.DB.prepare(
      `SELECT city, state, COUNT(*) AS n FROM leads WHERE ${SELLABLE_SQL} AND city IS NOT NULL AND city <> '' AND state IS NOT NULL
       GROUP BY city, state ORDER BY n DESC LIMIT 3000`,
    ).all<{ city: string; state: string; n: number }>(), "store read");
    const byState = new Map<string, { city: string; category: null; n: number }[]>();
    for (const r of results) byState.set(r.state, [...(byState.get(r.state) ?? []), { city: r.city, category: null, n: r.n }]);
    return [...byState].flatMap(([s, rows]) => groupCities(rows, s, 5).map((g) => ({ value: `${g.city}|${s}`, n: g.n })))
      .sort((a, b) => b.n - a.n).slice(0, 300);
  });
  return { states, cities };
}

/**
 * Categories and industries with how many sellable businesses each has: in the whole database,
 * or in one place when `input` has city=City|ST or state=ST (uses the (state, city) index; the
 * answer then says `place`, so the page knows the counts are for that place). Cached for an hour.
 */
export async function categories(env: StoreEnv, input?: URLSearchParams) {
  const city = (input?.get("city") ?? "").trim().slice(0, 120);
  const [c, cst] = city.split("|");
  const st = (cst || input?.get("state") || "").trim().toUpperCase();
  const place = /^[A-Z]{2}$/.test(st) ? (c && cst ? `${c}|${st}` : st) : "";
  return cached(env as unknown as Env, `store-categories2:${place}`, 3600, async () => {
    // A city counts all its spellings (like the search).
    const names = place.includes("|") ? (await spellingsOf(env, place)).slice(0, 90) : [];
    const where = names.length ? `AND state = ? AND city IN (${names.map(() => "?").join(", ")})` : place ? "AND state = ?" : "";
    const binds = names.length ? [st, ...names] : place ? [st] : [];
    const { results } = await retryRead(() => env.DB.prepare(
      `SELECT COALESCE(industry, 'Other') AS industry, gbp_category AS value, COUNT(*) AS n FROM leads
       WHERE ${SELLABLE_SQL} AND gbp_category IS NOT NULL ${where} GROUP BY 1, 2 ORDER BY n DESC`,
    ).bind(...binds).all<{ industry: string; value: string; n: number }>(), "store read");
    const byIndustry = new Map<string, number>();
    for (const r of results) byIndustry.set(r.industry, (byIndustry.get(r.industry) ?? 0) + r.n);
    return {
      ...(place ? { place } : {}),
      industries: [...byIndustry].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n),
      categories: results.map((r) => ({ value: r.value, n: r.n, industry: r.industry })),
    };
  });
}

/** The ledger note of a purchase: "1 lead (free this month)", "12 leads (10 standard, 2 with Google rating; 5 free this month)". */
export function purchaseNote(count: number, standard: number, google: number, freeLeads: number): string {
  const n = (x: number) => x.toLocaleString("en-US");
  const parts: string[] = [];
  if (standard && google) parts.push(`${n(standard)} standard, ${n(google)} with Google rating`);
  else if (google) parts.push("with Google rating");
  if (freeLeads) parts.push(freeLeads >= count ? "free this month" : `${n(freeLeads)} free this month`);
  return `${n(count)} lead${count === 1 ? "" : "s"}${parts.length ? ` (${parts.join("; ")})` : ""}`;
}

/**
 * Three example searches for the empty search screen ("Plumbers in Miami"), from the biggest
 * category + city pairs, each with a different category and city. Cached for 6 hours.
 */
export async function examples(env: StoreEnv) {
  return cached(env as unknown as Env, "store-examples", 6 * 3600, async () => {
    const { results } = await env.DB.prepare(
      `SELECT gbp_category AS category, city, state, COUNT(*) AS n FROM leads
        WHERE ${SELLABLE_SQL} AND gbp_category IS NOT NULL AND city IS NOT NULL AND city <> '' AND state IS NOT NULL
        GROUP BY gbp_category, city, state ORDER BY n DESC LIMIT 30`,
    ).all<{ category: string; city: string; state: string; n: number }>();
    const out: { label: string; query: string; n: number }[] = [];
    const usedCat = new Set<string>(), usedCity = new Set<string>();
    for (const r of results) {
      if (out.length >= 3) break;
      if (usedCat.has(r.category) || usedCity.has(r.city + "|" + r.state)) continue;
      usedCat.add(r.category); usedCity.add(r.city + "|" + r.state);
      const city = displayCity(r.city, r.state);
      const q = new URLSearchParams();
      q.set("category", r.category); q.set("city", `${city}|${r.state}`);
      out.push({ label: `${pluralWord(r.category.split("/")[0].trim())} in ${city}`, query: q.toString(), n: Number(r.n) || 0 });
    }
    return out;
  });
}

// ----------------------------------------------------------------------------------------
// Buying

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * The most leads the free allowance + credit balance pays for, cheapest first (standard before
 * premium). `costs` must already be cheapest first. Returns how many of them to take.
 */
export function affordableCount(costs: number[], freeLeft: number, balance: number): number {
  // Of the first k, the allowance covers the priciest min(k, freeLeft); the rest (the cheapest
  // k - freeLeft) are paid in credits.
  let paid = 0, j = 0;
  while (j < costs.length - Math.min(freeLeft, costs.length) && paid + costs[j] <= balance) { paid += costs[j]; j++; }
  return Math.min(costs.length, Math.min(freeLeft, costs.length) + j);
}

export interface BuyBody { ids?: unknown; all?: unknown; dryRun?: unknown; expectedCredits?: unknown; affordable?: unknown }

export async function buy(env: StoreEnv, account: StoreAccount, body: BuyBody, input: URLSearchParams, userId: string) {
  // The candidates: picked ids (checked to be sellable), or everything matching the filters
  // (in the order the customer sees them, so "the first 5,000" are the ones on screen first).
  let candidates: { id: string; data_source: string }[];
  let capped = false;
  if (body.all === true) {
    const q = await query(env, input, account.id);
    const { results } = await env.DB.prepare(`${q.with} SELECT id, data_source FROM ${q.source} AS x ${q.ownedSql} ${orderBy(input)} LIMIT ${MAX_PER_PURCHASE + 1}`)
      .bind(...q.binds).all<{ id: string; data_source: string }>();
    capped = results.length > MAX_PER_PURCHASE;
    candidates = results.slice(0, MAX_PER_PURCHASE);
  } else {
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).filter((x): x is string => typeof x === "string" && /^[\w:-]{1,80}$/.test(x)))];
    if (!ids.length) throw new StoreError("Pick at least one lead.");
    if (ids.length > MAX_PER_PURCHASE) throw new StoreError(`At most ${MAX_PER_PURCHASE.toLocaleString("en-US")} leads at a time.`);
    candidates = [];
    for (const part of chunks(ids, 90)) {
      const { results } = await env.DB.prepare(`SELECT id, data_source FROM leads WHERE id IN (${part.map(sqlString).join(", ")}) AND ${SELLABLE_SQL}`)
        .all<{ id: string; data_source: string }>();
      candidates.push(...results);
    }
  }
  const owned = new Set<string>();
  for (const part of chunks(candidates.map((c) => c.id), 90)) {
    const { results } = await env.DB.prepare(`SELECT lead_id FROM store_purchases WHERE account_id = ? AND lead_id IN (${part.map(sqlString).join(", ")})`)
      .bind(account.id).all<{ lead_id: string }>();
    for (const r of results) owned.add(r.lead_id);
  }
  let fresh = candidates.filter((c) => !owned.has(c.id));
  const price = await prices(env);
  const cost = (c: { data_source: string }) => (tierOf(c.data_source) === "free" ? price.free : price.google);
  const allowance = await freeAllowance(env, account.id);
  // How many the allowance + balance can pay for, cheapest first (standard before premium).
  const cheapest = fresh.map((c, i) => ({ c, i })).sort((a, b) => cost(a.c) - cost(b.c)
    || (tierOf(a.c.data_source) === tierOf(b.c.data_source) ? 0 : tierOf(a.c.data_source) === "free" ? -1 : 1) || a.i - b.i).map((x) => x.c);
  const coverable = affordableCount(cheapest.map(cost), allowance.left, account.credits);
  if (body.affordable === true) fresh = cheapest.slice(0, coverable);
  const free = fresh.filter((c) => tierOf(c.data_source) === "free").length;
  const google = fresh.length - free;
  const tiered = fresh.map((c) => ({ ...c, tier: tierOf(c.data_source) as "free" | "google" }));
  // The allowance covers the priciest leads (splitFree).
  const { freeLeads, credits } = splitFree(tiered, allowance.left, price);
  // The list this request is saved as: "Plumbers · Tampa, FL", or "12 picked leads".
  const name = listName(input, body.all === true ? 0 : candidates.length);
  if (body.dryRun === true) {
    return { count: fresh.length, alreadyOwned: owned.size, free, google, freeLeads, credits, balance: account.credits, freeLeft: allowance.left, capped, coverable, name };
  }
  if (account.status !== "active") throw new StoreError(account.status === "pending" ? "Your account is waiting for approval." : "Your account is paused.", 403);
  // Everything already owned: nothing to pay, but the request is still saved as a list.
  if (!fresh.length) {
    const list = body.affordable === true || !owned.size ? null : await listFor(env, account.id, userId, name, input, [...owned]);
    return { bought: 0, free: 0, google: 0, freeLeads: 0, credits: 0, balance: account.credits, at: null, ...list };
  }
  // Never charge more than the customer was shown (the matches or the free leads may have changed).
  const expected = typeof body.expectedCredits === "number" && Number.isFinite(body.expectedCredits) ? body.expectedCredits : null;
  if (expected != null && credits > expected) {
    throw new StoreError(`The price changed since you checked it: this now costs ${credits.toLocaleString("en-US")} credits. Nothing was charged; please check the new price.`, 409);
  }

  // The database's clock when this purchase starts, so the page can download exactly these leads.
  const at = (await env.DB.prepare(`SELECT datetime('now') AS t`).first<string>("t")) ?? null;
  // Take the credits and the free leads in one step that fails if there aren't enough of either
  // (so two tabs buying at once can't spend the same credits or allowance twice).
  const month = monthKey();
  const usedNow = `(CASE WHEN free_period = ? THEN free_used ELSE 0 END)`;
  const after = await env.DB.prepare(
    `UPDATE store_accounts SET credits = credits - ?, free_used = ${usedNow} + ?, free_period = ?
     WHERE id = ? AND status = 'active' AND credits >= ? AND ${usedNow} + ? <= ? RETURNING credits`,
  ).bind(credits, month, freeLeads, month, account.id, credits, month, freeLeads, allowance.perMonth).first<number>("credits");
  if (after == null) {
    const now = await freeAllowance(env, account.id);
    if (now.left < freeLeads) throw new StoreError("Your free leads changed while you were buying. Please try again.", 409);
    throw new StoreError(`That needs ${credits.toLocaleString("en-US")} credits and you have ${account.credits.toLocaleString("en-US")}.`, 402);
  }
  await env.DB.prepare(`INSERT INTO store_ledger (account_id, delta, balance, kind, note, created_by) VALUES (?, ?, ?, 'purchase', ?, ?)`)
    .bind(account.id, -credits, after, purchaseNote(fresh.length, free, google, freeLeads), userId).run();

  // Record the leads. One that was bought at the same moment by another tab isn't charged twice.
  let notSaved = 0;
  for (const part of chunks(fresh, 90)) {
    const res = await env.DB.batch(part.map((c) => env.DB.prepare(`INSERT OR IGNORE INTO store_purchases (account_id, lead_id, tier, credits) VALUES (?, ?, ?, ?)`)
      .bind(account.id, c.id, tierOf(c.data_source), tierOf(c.data_source) === "free" ? price.free : price.google)));
    res.forEach((r, i) => { if (!r.meta?.changes) notSaved += tierOf(part[i].data_source) === "free" ? price.free : price.google; });
  }
  // Never give back more than was paid in credits (free leads aren't refunded as credits).
  notSaved = Math.min(notSaved, credits);
  let balance = after;
  if (notSaved > 0) {
    balance = (await env.DB.prepare(`UPDATE store_accounts SET credits = credits + ? WHERE id = ? RETURNING credits`).bind(notSaved, account.id).first<number>("credits")) ?? after;
    await env.DB.prepare(`INSERT INTO store_ledger (account_id, delta, balance, kind, note) VALUES (?, ?, ?, 'refund', 'Already owned (bought at the same time)')`)
      .bind(account.id, notSaved, balance).run();
  }
  // Then the list: all the leads of this request, including ones the account already had. The
  // purchase above is already recorded, so a failure here never loses it (listFor never throws).
  const list = await listFor(env, account.id, userId, name, input, [...owned, ...fresh.map((c) => c.id)]);
  return { bought: fresh.length, free, google, freeLeads, credits: credits - notSaved, balance, at, ...list };
}

/** Saves the list of a purchase; `{ listId: null }` (and a log line) if that fails. */
async function listFor(env: StoreEnv, accountId: string, userId: string, name: string, input: URLSearchParams, ids: string[]) {
  const query = new URLSearchParams(input);
  for (const k of ["page", "page_size"]) query.delete(k);
  try {
    const l = await saveList(env, accountId, userId || null, name, query.toString(), ids);
    return { listId: l.id as string | null, listName: l.name, listCount: l.count };
  } catch (err) {
    console.error("store list save failed", err);
    return { listId: null as string | null, listName: name, listCount: 0 };
  }
}

// ----------------------------------------------------------------------------------------
// The customer's own leads

/** My leads filters: q (name contains), city ("City|ST"), category, list (id), since. Over `store_purchases p JOIN leads x`. */
export function mineFilter(accountId: string, input: URLSearchParams): { where: string; binds: unknown[] } {
  const q = (input.get("q") ?? "").trim().slice(0, 80).replace(/[%_]/g, "");
  const city = (input.get("city") ?? "").trim().slice(0, 120);
  const category = (input.get("category") ?? "").trim().slice(0, 120);
  const parts = ["p.account_id = ?"];
  const binds: unknown[] = [accountId];
  if (q) { parts.push("x.business_name LIKE ?"); binds.push(`%${q}%`); }
  if (city.includes("|")) { const [c, st] = city.split("|"); parts.push("x.city = ? AND x.state = ?"); binds.push(c, st); }
  if (category) { parts.push("x.gbp_category = ?"); binds.push(category); }
  // One of the account's lists (the list must belong to this account too, not just the leads).
  const list = (input.get("list") ?? "").trim().slice(0, 80);
  if (list) {
    parts.push("p.lead_id IN (SELECT ll.lead_id FROM store_list_leads ll JOIN store_lists sl ON sl.id = ll.list_id WHERE ll.list_id = ? AND sl.account_id = ?)");
    binds.push(list, accountId);
  }
  // Got at or after this moment (UTC "YYYY-MM-DD HH:MM:SS"): "download what I just got".
  const since = (input.get("since") ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since)) { parts.push("p.purchased_at >= ?"); binds.push(since); }
  return { where: parts.join(" AND "), binds };
}

const GOOD_EMAIL_EXISTS = `EXISTS (SELECT 1 FROM lead_emails e WHERE e.lead_id = x.id
  AND NOT EXISTS (SELECT 1 FROM email_checks c WHERE c.email = e.email AND c.result IN ('invalid', 'disposable')))`;

export async function myLeads(env: StoreEnv, account: StoreAccount, input: URLSearchParams) {
  const pageSize = Math.min(Math.max(Number(input.get("page_size")) || PAGE_MAX, 1), PAGE_MAX);
  const page = Math.max(Number(input.get("page")) || 1, 1);
  const { where, binds } = mineFilter(account.id, input);
  const facets = input.get("facets") === "1";
  const [rows, count, cities, cats] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ${rowColumns(sqlString(account.id))}, p.purchased_at AS purchasedAt FROM store_purchases p JOIN leads x ON x.id = p.lead_id
       WHERE ${where} ORDER BY p.purchased_at DESC, x.business_name LIMIT ? OFFSET ?`,
    ).bind(...binds, pageSize, (page - 1) * pageSize),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(${GOOD_EMAIL_EXISTS}), 0) AS withEmail FROM store_purchases p JOIN leads x ON x.id = p.lead_id WHERE ${where}`).bind(...binds),
    // The account's own cities and categories, for the filter lists (only when asked).
    ...(facets ? [
      env.DB.prepare(`SELECT x.city || '|' || x.state AS value, COUNT(*) AS n FROM store_purchases p JOIN leads x ON x.id = p.lead_id
        WHERE p.account_id = ? AND x.city IS NOT NULL AND x.city <> '' AND x.state IS NOT NULL GROUP BY x.city, x.state ORDER BY n DESC LIMIT 300`).bind(account.id),
      env.DB.prepare(`SELECT x.gbp_category AS value, COUNT(*) AS n FROM store_purchases p JOIN leads x ON x.id = p.lead_id
        WHERE p.account_id = ? AND x.gbp_category IS NOT NULL GROUP BY x.gbp_category ORDER BY n DESC LIMIT 300`).bind(account.id),
    ] : []),
  ]);
  const c = count.results[0] as { n: number; withEmail: number };
  return {
    total: Number(c.n) || 0, withEmail: Number(c.withEmail) || 0, page, pageSize, results: (rows.results as RawRow[]).map(shapeRow),
    ...(facets ? { facets: { cities: cities?.results ?? [], categories: cats?.results ?? [] } } : {}),
  };
}

export async function creditHistory(env: StoreEnv, account: StoreAccount) {
  // "by": who on the team did it (purchases are made by a team member; the owner's grants show no name).
  const { results } = await env.DB.prepare(
    `SELECT l.created_at AS at, l.delta, l.balance, l.kind, l.note, COALESCE(NULLIF(u.name, ''), u.email) AS byName
       FROM store_ledger l LEFT JOIN store_users u ON u.id = l.created_by AND u.account_id = l.account_id
      WHERE l.account_id = ? ORDER BY l.id DESC LIMIT 100`,
  ).bind(account.id).all();
  return { balance: account.credits, history: results };
}

// ----------------------------------------------------------------------------------------
// Downloads: only the customer's own leads.

export const SIMPLE_COLUMNS = ["Business Name", "Owner", "Owner Title", "Category", "Phone", "Can Text", "Email", "Email 2", "Email 3", "Website",
  "Address", "City", "State", "Zip", "Rating", "Reviews", "Score", "Website Comment", "Top Fix", "Type", "Unlocked On",
  "Phone 2", "Phone 3", "Other Contacts", "Employees", "Revenue (estimated)", "Size Source", "Founded"] as const;
export const COLD_COLUMNS = ["Email", "First Name", "Company Name", "Website", "Phone", "Can Text", "City", "State", "Category", "Score", "Top Fix", "Opener"] as const;

interface DlRow {
  id: string; business_name: string | null; owner_name: string | null; owner_title: string | null; gbp_category: string | null;
  gbp_phone_formatted: string | null; gbp_phone_raw: string | null; phone_type: string | null; website: string | null; address: string | null;
  city: string | null; state: string | null; postal_code: string | null; rating: number | null; review_count: number | null;
  presence_score: number | null; score_notes: string | null; data_source: string | null; purchased_at: string;
  employees_min?: number | null; employees_max?: number | null; revenue_min?: number | null; revenue_max?: number | null;
  size_source?: string | null; size_year?: number | null; founded?: string | null; extra_phones?: string | null; contacts?: string | null;
}

/**
 * The street part of a full address, for the Address column (City, State and Zip have their own):
 * "16221 SW 100th Ct, Fl MIAMI, Miami, FL 33157" -> "16221 SW 100th Ct". The trailing city, state,
 * ZIP and country go, and so do repeats of the city ("Fl MIAMI", "Miami, Miami"). An address that
 * is only "Marco Island, FL 34145" has no street: "".
 */
export function streetOnly(address: string | null | undefined, city: string | null | undefined, state: string | null | undefined): string {
  const parts = String(address ?? "").split(",").map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (!parts.length) return "";
  const norm = (s: string) => s.toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
  const ck = city ? cityKey(city, state ?? "") : "", st = norm(state ?? "");
  const zip = /^\d{5}(-\d{4})?$/;
  const isPlace = (p: string) => {
    const l = norm(p);
    if (!l) return true;
    if (/^(usa|us|united states)$/.test(l) || zip.test(l)) return true;
    const words = l.split(" ");
    if (zip.test(words[words.length - 1])) words.pop(); // "FL 33157", "Miami FL 33157"
    if (st && words[words.length - 1] === st) words.pop(); // "Miami FL"
    if (st && words[0] === st) words.shift(); // "Fl MIAMI"
    if (!words.length) return true;
    return !!ck && cityKey(words.join(" "), state ?? "") === ck;
  };
  const fullAddress = parts.length > 1 && isPlace(parts[parts.length - 1]);
  if (!fullAddress) return parts.join(", ");
  while (parts.length && isPlace(parts[parts.length - 1])) parts.pop();
  const kept = parts.filter((p, i) => i === 0 || !isPlace(p));
  // "1900 N Bayshore Drive Miami": the city written at the end of the street.
  if (kept.length && city) {
    const last = kept[kept.length - 1], tail = " " + city.trim().toLowerCase();
    if (/^\d/.test(last) && last.toLowerCase().endsWith(tail) && last.split(" ").length > 3) kept[kept.length - 1] = last.slice(0, -tail.length).trim();
  }
  return kept.join(", ");
}

export function downloadRow(format: "simple" | "cold_email", l: DlRow, emails: string[]): string[] | null {
  let notes: { websiteComment?: string; suggestions?: string[] } = {};
  try { notes = l.score_notes ? JSON.parse(l.score_notes) : {}; } catch { notes = {}; }
  const phone = nationalPhone(l.gbp_phone_formatted, l.gbp_phone_raw);
  const num = (n: number | null) => (n == null ? "" : String(n));
  if (format === "cold_email") {
    if (!emails.length) return null;
    const first = (l.owner_name ?? "").trim().split(/\s+/)[0] || firstNameFrom(emails[0]);
    // A ready first line from the top fix (simple template, no AI), e.g. "I was looking at Joe's
    // Plumbing online and noticed customers can't book with you online."
    const opener = buildOpener({ business: l.business_name, ownerName: l.owner_name, firstNameFromEmail: firstNameFrom(emails[0]), city: l.city,
      category: l.gbp_category, suggestions: notes.suggestions ?? [], agency: { name: "", phone: "", email: "", website: "" } }).firstLine;
    return [emails[0], first, l.business_name ?? "", l.website ?? "", phone, canText(l.phone_type, phone), l.city ?? "", l.state ?? "",
      l.gbp_category ?? "", num(l.presence_score), notes.suggestions?.[0] ?? "", opener];
  }
  return [l.business_name ?? "", l.owner_name ?? "", l.owner_title ?? "", l.gbp_category ?? "", phone, canText(l.phone_type, phone),
    emails[0] ?? "", emails[1] ?? "", emails[2] ?? "", l.website ?? "", streetOnly(l.address, l.city, l.state), l.city ?? "", l.state ?? "", l.postal_code ?? "",
    num(l.rating), num(l.review_count), num(l.presence_score), notes.websiteComment ?? "", notes.suggestions?.[0] ?? "",
    tierOf(l.data_source) === "free" ? "Standard" : "With Google rating", l.purchased_at.slice(0, 10),
    ...[0, 1].map((i) => nationalPhone((l.extra_phones ?? "").split(" ").filter(Boolean)[i] ?? null, null)),
    l.contacts ?? "", rangeText(l.employees_min, l.employees_max), revenueText(l.revenue_min, l.revenue_max), sizeNote(l.size_source, l.size_year), l.founded ?? ""];
}

/**
 * The account's leads as a file: the given ids, else everything matching the My leads filters
 * (`q`, `city`, `category` in `filters`; none = all of them).
 */
export async function downloadCsv(env: StoreEnv, account: StoreAccount, format: "simple" | "cold_email" | "json", ids: string[],
  filters: URLSearchParams = new URLSearchParams()): Promise<ReadableStream<Uint8Array>> {
  const pick = ids.filter((x) => /^[\w:-]{1,80}$/.test(x)).slice(0, 20000);
  const f = mineFilter(account.id, pick.length ? new URLSearchParams() : filters);
  const filtered = f.binds.length > 1;
  const { results: order } = await (pick.length || !filtered
    ? env.DB.prepare(
      `SELECT lead_id FROM store_purchases WHERE account_id = ?${pick.length ? ` AND lead_id IN (${pick.map(sqlString).join(", ")})` : ""} ORDER BY purchased_at, lead_id`,
    ).bind(account.id)
    : env.DB.prepare(`SELECT p.lead_id FROM store_purchases p JOIN leads x ON x.id = p.lead_id WHERE ${f.where} ORDER BY p.purchased_at, p.lead_id`).bind(...f.binds)
  ).all<{ lead_id: string }>();
  const encoder = new TextEncoder();
  let next = 0, header = false, first = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!header) {
          header = true;
          controller.enqueue(encoder.encode(format === "json" ? "[" : "\uFEFF" + (format === "cold_email" ? COLD_COLUMNS : SIMPLE_COLUMNS).map(csvCell).join(",") + "\r\n"));
          return;
        }
        const part = order.slice(next, next + 500).map((r) => r.lead_id);
        if (!part.length) { if (format === "json") controller.enqueue(encoder.encode("]\n")); controller.close(); return; }
        next += part.length;
        const list = part.map(sqlString).join(", ");
        const [leads, mails] = await env.DB.batch([
          env.DB.prepare(
            `SELECT l.id, l.business_name, l.owner_name, l.owner_title, l.gbp_category, l.gbp_phone_formatted, l.gbp_phone_raw, l.phone_type, l.website,
                    l.address, l.city, l.state, l.postal_code, l.rating, l.review_count, l.presence_score, l.score_notes, l.data_source, p.purchased_at,
                    l.employees_min, l.employees_max, l.revenue_min, l.revenue_max, l.size_source, l.size_year, l.founded,
                    (SELECT group_concat(lp.phone, ' ') FROM lead_phones lp WHERE lp.lead_id = l.id AND lp.phone <> COALESCE(l.gbp_phone_formatted, '')) AS extra_phones,
                    (SELECT group_concat(lc.name || COALESCE(' (' || lc.title || ')', ''), '; ') FROM lead_contacts lc WHERE lc.lead_id = l.id) AS contacts
             FROM leads l JOIN store_purchases p ON p.lead_id = l.id AND p.account_id = ? WHERE l.id IN (${list})`,
          ).bind(account.id),
          env.DB.prepare(
            `SELECT e.lead_id, e.email FROM lead_emails e WHERE e.lead_id IN (${list})
               AND NOT EXISTS (SELECT 1 FROM email_checks c WHERE c.email = e.email AND c.result IN ('invalid', 'disposable')) ORDER BY e.lead_id, e.position`,
          ),
        ]);
        const byLead = new Map<string, string[]>();
        for (const m of mails.results as { lead_id: string; email: string }[]) byLead.set(m.lead_id, [...(byLead.get(m.lead_id) ?? []), m.email]);
        const byId = new Map((leads.results as DlRow[]).map((l) => [l.id, l]));
        const rows = part.map((id) => byId.get(id)).filter((l): l is DlRow => !!l)
          .map((l) => downloadRow(format === "json" ? "simple" : format, l, bestFirst(byLead.get(l.id) ?? [])))
          .filter((r): r is string[] => !!r);
        if (format === "json") {
          // Same fields as the spreadsheet, as one JSON array of objects.
          const text = rows.map((r) => JSON.stringify(Object.fromEntries(SIMPLE_COLUMNS.map((k, i) => [k, r[i]])))).join(",\n");
          if (text) { controller.enqueue(encoder.encode((first ? "\n" : ",\n") + text)); first = false; }
        } else {
          const text = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
          if (text) controller.enqueue(encoder.encode(text + "\r\n"));
        }
      } catch (err) {
        console.error("store download failed", err);
        controller.error(err);
      }
    },
  });
}

// ----------------------------------------------------------------------------------------
// Map: dots for the businesses matching the filters (at most 3,000, lowest scores first).

export async function mapPoints(env: StoreEnv, account: StoreAccount, input: URLSearchParams) {
  const q = await query(env, input, account.id);
  const owned = `EXISTS (SELECT 1 FROM store_purchases p WHERE p.account_id = ${sqlString(account.id)} AND p.lead_id = x.id)`;
  const where = q.ownedSql ? `${q.ownedSql} AND latitude IS NOT NULL` : "WHERE latitude IS NOT NULL";
  const { results } = await env.DB.prepare(
    `${q.with} SELECT id, business_name AS name, gbp_category AS category, latitude AS lat, longitude AS lng, presence_score AS score, data_source, ${owned} AS owned,
       substr(gbp_phone_formatted, 1, 5) AS phone_head, (owner_name IS NOT NULL AND owner_name <> '') AS hasOwner,
       EXISTS (SELECT 1 FROM lead_emails e WHERE e.lead_id = x.id) AS hasEmail, website_domain IS NOT NULL AS hasWebsite
     FROM ${q.source} AS x ${where} AND longitude IS NOT NULL ORDER BY presence_score IS NULL, presence_score LIMIT 3001`,
  ).bind(...q.binds).all<{ id: string; name: string; category: string | null; lat: number; lng: number; score: number | null; data_source: string; owned: number;
    phone_head: string | null; hasOwner: number; hasEmail: number; hasWebsite: number }>();
  return {
    // For the popup: the area code only (like the results), and yes/no for email, owner and website
    // (a score of 0 reads "No website" or "Site down").
    points: results.slice(0, 3000).map(({ data_source, owned: o, phone_head, hasOwner, hasEmail, hasWebsite, ...p }) => ({
      ...p, tier: tierOf(data_source), owned: !!o, phoneMasked: maskPhone(phone_head), hasEmail: !!hasEmail, hasOwner: !!hasOwner, hasWebsite: !!hasWebsite,
    })),
    total: results.length > 3000 ? 3001 : results.length,
    capped: results.length > 3000,
  };
}
