// Numbers for the public website and the business catalogue (/leads/...). Only sellable leads
// (open, from open data or Google, not on the do-not-contact list), never contact details.
// Everything is cached for hours: these pages can be visited by anyone, including crawlers.
// One cached answer per state (cities, their spellings and their trades) drives the state page,
// the city pages and the sitemap; only a trade page runs its own (cached) query.

import { cached } from "../cache";
import { stateName } from "../format";
import { parsePacks, type CreditPack } from "./launch";
import { notifyOwner } from "./payments";
import { retryRead } from "./brand";
import type { StoreEnv } from "./types";
import { StoreError } from "./types";

const SELLABLE = `data_source IN ('free', 'google', 'free+google') AND business_status = 'operational' AND suppressed IS NULL`;
const HOURS6 = 6 * 3600;

/** A city needs this many businesses to get a page. */
export const CITY_MIN = 3;
/** A trade in a city needs this many businesses to get a page (and a sitemap entry). */
export const CATEGORY_MIN = 5;
/** States with fewer businesses are shown as "coming soon" (no links on the home page or the catalog). */
export const STATE_MIN = 500;

/** Runs a read once more after a short pause when the database is busy (first loads under load). */
const retry = <T,>(f: () => Promise<T>) => retryRead(f, "public read");
const c = <T,>(env: StoreEnv, key: string, ttl: number, f: () => Promise<T>) => retry(() => cached(env as unknown as Env, key, ttl, f));

/** "Fort Lauderdale" -> "fort-lauderdale"; "HVAC contractor" -> "hvac-contractor". */
export function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const validSt = (st: string) => (/^[a-z]{2}$/i.test(st) ? st.toUpperCase() : null);

// Words that are spelled several ways in the source data ("Saint" / "St." / "St").
const CITY_WORDS: Record<string, string> = {
  saint: "st", fort: "ft", mount: "mt", bch: "beach", spg: "springs", spgs: "springs", hts: "heights", hgts: "heights",
};
const CITY_FIRST: Record<string, string> = { n: "north", s: "south", e: "east", w: "west" };

/**
 * One key per city however it is spelled: "St. Petersburg", "Saint Petersburg" and
 * "saint-petersburg" are all "st petersburg"; "West Palm Bch" is "west palm beach";
 * "Fort Myers Fl" (state code at the end) is "ft myers".
 */
export function cityKey(raw: string, st = ""): string {
  const words = String(raw ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "").replace(/[-.,_/]+/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length > 1 && st && words[words.length - 1] === st.toLowerCase()) words.pop();
  const key = words.map((w, i) => (i === 0 && words.length > 1 && CITY_FIRST[w]) || CITY_WORDS[w] || w).join(" ");
  return (!st || st.toUpperCase() === "FL") && FL_ALIASES[key] ? FL_ALIASES[key] : key;
}

// Florida places known by two names (the old and the new, or the short and the full one): one page.
const FL_ALIASES: Record<string, string> = {
  dania: "dania beach", hallandale: "hallandale beach", "lake worth": "lake worth beach", "ponte vedra": "ponte vedra beach",
  grant: "grant valkaria", "la belle": "labelle", "de bary": "debary", "de land": "deland", "de funiak springs": "defuniak springs",
};
// How a city is written, when the data's most common spelling isn't it (by city key).
const CITY_DISPLAY: Record<string, string> = {
  "opa locka": "Opa-locka", "land o lakes": "Land O' Lakes", labelle: "LaBelle", debary: "DeBary", deland: "DeLand", "defuniak springs": "DeFuniak Springs",
  "dania beach": "Dania Beach", "hallandale beach": "Hallandale Beach", "lake worth beach": "Lake Worth Beach", "ponte vedra beach": "Ponte Vedra Beach",
  "grant valkaria": "Grant-Valkaria",
};

/**
 * A city name for people: "ST PETERSBURG" / "saint petersburg" -> "St. Petersburg", "Saint Cloud" ->
 * "St. Cloud", "opa locka" -> "Opa-locka", "Dania" -> "Dania Beach".
 */
export function displayCity(raw: string, st = ""): string {
  const known = CITY_DISPLAY[cityKey(raw, st)];
  if (known) return known;
  let s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (s === s.toLowerCase() || (s === s.toUpperCase() && /[A-Z]/.test(s))) s = s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, a: string, ch: string) => a + ch.toUpperCase());
  return s.replace(/\b(?:Saint|St)\b\.?\s*(?=[A-Za-z])/gi, "St. ");
}

export interface CityGroup {
  /** The most common spelling (shown on the site). */
  city: string;
  slug: string;
  n: number;
  /** Every raw spelling in the data, most common first (the pages query all of them). */
  names: string[];
  /** Trades with at least CATEGORY_MIN businesses: [category, count], biggest first. */
  cats: [string, number][];
}

const nicer = (a: string, b: string) => {
  // Same count: prefer a spelling with capitals and without hyphens.
  const score = (s: string) => (s !== s.toLowerCase() ? 2 : 0) + (s.includes("-") ? 0 : 1);
  return score(b) - score(a);
};

/** Groups (city, category, count) rows by city key. Cities under `min` businesses (CITY_MIN) are left out. */
export function groupCities(rows: { city: string | null; category: string | null; n: number }[], st: string, min = CITY_MIN): CityGroup[] {
  const byKey = new Map<string, { n: number; names: Map<string, number>; cats: Map<string, number> }>();
  for (const r of rows) {
    const raw = String(r.city ?? "").trim();
    const key = cityKey(raw, st);
    if (!key) continue;
    const g = byKey.get(key) ?? { n: 0, names: new Map(), cats: new Map() };
    byKey.set(key, g);
    const n = Number(r.n) || 0;
    g.n += n;
    g.names.set(raw, (g.names.get(raw) ?? 0) + n);
    if (r.category) g.cats.set(r.category, (g.cats.get(r.category) ?? 0) + n);
  }
  const out = new Map<string, CityGroup>();
  for (const g of [...byKey.values()].sort((a, b) => b.n - a.n)) {
    const names = [...g.names.entries()].sort((a, b) => b[1] - a[1] || nicer(a[0], b[0])).map(([name]) => name);
    const city = displayCity(names[0], st);
    const s = slug(city);
    if (!s) continue;
    const same = out.get(s);
    if (same) {
      // Two keys that make the same address: merge into the bigger one.
      same.n += g.n;
      same.names.push(...names);
      const cats = new Map(same.cats);
      for (const [k, v] of g.cats) cats.set(k, (cats.get(k) ?? 0) + v);
      same.cats = [...cats.entries()].sort((a, b) => b[1] - a[1]);
      continue;
    }
    out.set(s, { city, slug: s, n: g.n, names, cats: [...g.cats.entries()].sort((a, b) => b[1] - a[1]) });
  }
  return [...out.values()]
    .filter((g) => g.n >= min)
    .map((g) => ({ ...g, names: g.names.slice(0, 90), cats: g.cats.filter(([, n]) => n >= CATEGORY_MIN).slice(0, 300) }))
    .sort((a, b) => b.n - a.n);
}

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
  // google = leads with a Google rating (data_source google / free+google), so the pages only
  // promise them where there are some.
  return c(env, "pub-states2", HOURS6, async () => {
    const { results } = await env.DB.prepare(
      `SELECT state AS st, COUNT(*) AS n, SUM(data_source <> 'free') AS google FROM leads WHERE ${SELLABLE} AND state IS NOT NULL GROUP BY state ORDER BY n DESC`,
    ).all<{ st: string; n: number; google: number | null }>();
    return results.filter((r) => /^[A-Z]{2}$/.test(r.st)).map((r) => ({ st: r.st, name: stateName(r.st) ?? r.st, n: r.n, google: Number(r.google) || 0 }));
  });
}

/** The states with a catalog of their own (STATE_MIN businesses or more); the rest are "coming soon". */
export const listedStates = <T extends { n: number }>(states: T[]) => states.filter((s) => s.n >= STATE_MIN);
/** Whether any listed state has leads with a Google rating (else the site calls them "coming soon"). */
export const hasGoogleLeads = (states: { n: number; google?: number }[]) => listedStates(states).some((s) => Number(s.google) > 0);

/** The cities of a state (spellings grouped), biggest first, each with its trades. */
export async function catalogCities(env: StoreEnv, stIn: string): Promise<CityGroup[]> {
  const st = validSt(stIn);
  if (!st) return [];
  return c(env, `pub-st3:${st}`, HOURS6, async () => {
    const { results } = await env.DB.prepare(
      `SELECT city, gbp_category AS category, COUNT(*) AS n FROM leads WHERE ${SELLABLE} AND state = ? AND city IS NOT NULL AND city <> ''
       GROUP BY city, gbp_category`,
    ).bind(st).all<{ city: string; category: string | null; n: number }>();
    return groupCities(results, st).slice(0, 1000);
  });
}

/**
 * The city for an address. `redirect` is set when the address is another spelling of a listed
 * city ("/leads/fl/saint-petersburg" -> "st-petersburg"), so the page can send people there.
 */
export async function findCity(env: StoreEnv, stIn: string, citySlug: string): Promise<{ group: CityGroup; redirect: string | null } | null> {
  const st = validSt(stIn);
  if (!st || !citySlug) return null;
  const groups = await catalogCities(env, st);
  const exact = groups.find((g) => g.slug === citySlug);
  if (exact) return { group: exact, redirect: null };
  const key = cityKey(citySlug.replace(/-/g, " "), st);
  const other = key ? groups.find((g) => cityKey(g.city, st) === key || g.names.some((n) => cityKey(n, st) === key)) : undefined;
  return other ? { group: other, redirect: other.slug } : null;
}

export async function catalogPage(env: StoreEnv, stIn: string, group: CityGroup, catSlug: string) {
  const st = validSt(stIn);
  if (!st) return null;
  const cat = group.cats.find(([name]) => slug(name) === catSlug);
  if (!cat) return null;
  const category = cat[0];
  return c(env, `pub-page3:${st}:${group.slug}:${catSlug}`, HOURS6, async () => {
    const names = group.names.length ? group.names : [group.city];
    const where = `${SELLABLE} AND state = ? AND city IN (${names.map(() => "?").join(", ")}) AND gbp_category = ?`;
    const binds = [st, ...names, category];
    const [agg, samples] = await env.DB.batch([
      env.DB.prepare(
        `SELECT COUNT(*) AS n, SUM(gbp_phone_formatted IS NOT NULL) AS withPhone,
                SUM(EXISTS (SELECT 1 FROM lead_emails e WHERE e.lead_id = leads.id)) AS withEmail,
                SUM(website_domain IS NOT NULL) AS withWebsite, SUM(owner_name IS NOT NULL AND owner_name <> '') AS withOwner,
                ROUND(AVG(CASE WHEN presence_score > 0 THEN presence_score END)) AS avgScore FROM leads WHERE ${where}`,
      ).bind(...binds),
      // The richest records first (email, owner, website), then the score.
      env.DB.prepare(
        `SELECT business_name AS name, rating, review_count AS reviews, presence_score AS score, (website_domain IS NOT NULL) AS website FROM leads
         WHERE ${where} AND business_name IS NOT NULL
         ORDER BY (EXISTS (SELECT 1 FROM lead_emails e WHERE e.lead_id = leads.id)) + (owner_name IS NOT NULL AND owner_name <> '') + (website_domain IS NOT NULL) DESC,
                  COALESCE(presence_score, 0) DESC, business_name LIMIT 12`,
      ).bind(...binds),
    ]);
    const a = (agg.results[0] ?? {}) as Record<string, number | null>;
    const num = (k: string) => Number(a[k] ?? 0);
    return {
      st, stateName: stateName(st) ?? st, city: group.city, category, n: num("n"),
      withPhone: num("withPhone"), withEmail: num("withEmail"), withWebsite: num("withWebsite"), withOwner: num("withOwner"),
      avgScore: a.avgScore == null ? null : Number(a.avgScore),
      samples: (samples.results as { name: string; rating: number | null; reviews: number | null; score: number | null; website: number | null }[])
        .map((x) => ({ name: x.name, rating: x.rating, reviews: x.reviews, score: x.score, website: !!x.website })),
    };
  });
}

/** Prices, credit packs and the "lawyer checked the legal pages" tick, in one small read. */
export async function siteSettings(env: StoreEnv): Promise<{ prices: { free: number; google: number; freePerMonth: number }; packs: CreditPack[]; legalReviewed: boolean }> {
  const { results } = await retry(() => env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN ('store_price_free', 'store_price_google', 'store_free_per_month', 'store_credit_packs', 'store_legal_reviewed')`,
  ).all<{ key: string; value: string | null }>());
  const raw = Object.fromEntries(results.map((r) => [r.key, r.value ?? ""]));
  const int = (k: string, d: number) => (raw[k] == null || raw[k] === "" ? d : Math.max(0, Math.floor(Number(raw[k]) || 0)));
  return {
    prices: { free: int("store_price_free", 1), google: int("store_price_google", 3), freePerMonth: int("store_free_per_month", 50) },
    packs: parsePacks(raw.store_credit_packs),
    legalReviewed: raw.store_legal_reviewed === "1",
  };
}

export async function publicPrices(env: StoreEnv) {
  return (await siteSettings(env)).prices;
}

/** An error about one form field (the page focuses that field). */
export class FieldError extends StoreError {
  constructor(message: string, readonly field: string, status: 400 | 429 = 400) {
    super(message, status);
  }
}

async function ipHashOf(prefix: string, ip: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${prefix}:${ip}`));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const text = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** "Remove my business": saved for the owner to review (Admin page). At most 5 per network per day. */
export async function saveRemovalRequest(
  env: StoreEnv,
  input: { business?: unknown; phone?: unknown; website?: unknown; email?: unknown; name?: unknown; contactEmail?: unknown; message?: unknown },
  ip: string,
) {
  const business = text(input.business, 160);
  const phone = text(input.phone, 40), website = text(input.website, 300), email = text(input.email, 160);
  if (!business) throw new FieldError("Enter the business name.", "business");
  if (!phone && !website && !email) throw new FieldError("Add the business's phone number, website or email, so we can find it.", "phone");
  const ipHash = await ipHashOf("removal", ip);
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM store_removal_requests WHERE ip_hash = ? AND created_at > datetime('now', '-1 day')`)
    .bind(ipHash).first<number>("n");
  if ((recent ?? 0) >= 5) throw new StoreError("We've received several requests from you today. We'll handle them shortly.", 429);
  await env.DB.prepare(
    `INSERT INTO store_removal_requests (business, phone, website, email, name, contact_email, message, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(business, phone || null, website || null, email || null, text(input.name, 120) || null, text(input.contactEmail, 160) || null, text(input.message, 1000) || null, ipHash).run();
  return { ok: true as const };
}

/** The subjects the contact form offers ("access" is what "Request access" links to). */
export const CONTACT_SUBJECTS: Record<string, string> = {
  question: "A question",
  access: "Request access",
  credits: "Buying credits",
  data: "Wrong data on a lead",
  other: "Something else",
};

/** The shortest contact message (the page checks the same before sending). */
export const CONTACT_MIN = 5;

export const EMAIL_RE =/^[^\s@<>"'()]+@[^\s@<>"'()]+\.[a-z]{2,}$/i;

/**
 * The contact form: saved in store_messages (migration 0029) and announced on the owner's bell in
 * the internal app. `website` is a hidden field people never see: when it's filled, a bot sent it
 * and nothing is saved (the answer still says "sent"). At most 5 messages per network per day.
 */
export async function saveContactMessage(
  env: StoreEnv,
  input: { name?: unknown; email?: unknown; subject?: unknown; message?: unknown; website?: unknown },
  ip: string,
) {
  if (text(input.website, 300)) return { ok: true as const };
  const name = text(input.name, 120), email = text(input.email, 160), message = text(input.message, 4000);
  const subjectKey = text(input.subject, 40);
  const subject = CONTACT_SUBJECTS[subjectKey] ?? (Object.values(CONTACT_SUBJECTS).includes(subjectKey) ? subjectKey : CONTACT_SUBJECTS.question);
  if (!name) throw new FieldError("Enter your name.", "name");
  if (!EMAIL_RE.test(email)) throw new FieldError("Enter your email address, so we can reply.", "email");
  if (message.length < CONTACT_MIN) throw new FieldError(message ? "Write a little more, so we know how to help." : "Write your message.", "message");
  const ipHash = await ipHashOf("contact", ip);
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM store_messages WHERE ip_hash = ? AND created_at > datetime('now', '-1 day')`)
    .bind(ipHash).first<number>("n");
  if ((recent ?? 0) >= 5) throw new StoreError("We've received several messages from you today. We'll reply shortly.", 429);
  await env.DB.prepare(`INSERT INTO store_messages (name, email, subject, message, ip_hash) VALUES (?, ?, ?, ?, ?)`)
    .bind(name, email, subject, message, ipHash).run();
  const short = message.length > 300 ? message.slice(0, 300) + "…" : message;
  await notifyOwner(env, "info", `Website message from ${name} (${email}), ${subject}: ${short}`, null).catch((err) => console.error("contact notify failed", err));
  return { ok: true as const };
}
