// Lead scores (rules, no AI), 0-100, plus plain-English notes a sales rep can read out.
// - Google profile score: how complete and trusted the Google listing is. Only for businesses
//   we have Google details for (free open data doesn't include ratings, photos or verification).
// - Website score: from the website check (src/website-audit.ts). 0 when there's no website.
// - Overall: the average of the two (or whichever one we have).
// Low scores = more for an agency to fix = better prospects.

import { looksLikeChain } from "./chains";

export interface AuditFacts {
  reachable: number;
  https: number | null;
  social_only: number;
  builder: string | null;
  has_meta_pixel: number;
  has_google_tag: number;
  has_booking: number;
  has_contact_form: number;
  has_chat_widget: number;
  mobile_viewport: number;
  copyright_year: number | null;
  psi_score: number | null;
  /** "blocked: ..." = the site exists but we couldn't read the page. */
  error?: string | null;
  /** Advertising signs: a Google Ads tag, or call tracking (CallRail etc.), which usually means paid ads. */
  has_google_ads?: number | null;
  call_tracking?: string | null;
  /** Who hosts their email ("No email on this domain" = none), and when the site's certificate ends. */
  email_provider?: string | null;
  ssl_expires?: string | null;
}

export interface ScoreInput {
  /** 'free' = open map data only (no Google profile facts). */
  dataSource: string | null;
  isClaimed: number | null;
  website: string | null;
  websiteDomain: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  photosCount: number | null;
  hasHours: boolean;
  hasDescription: boolean;
  attributesCount: number;
  audit?: AuditFacts | null;
  /** For "looks outdated" (defaults to this year). */
  year?: number;
  /** The most-reviewed business of the same type in the same city (from our database). */
  topCompetitor?: { name: string; reviews: number } | null;
  /** How much each thing counts (defaults when missing). */
  weights?: ScoreWeights;
}

/** Points earned out of the points possible, as 0-100. */
const outOf100 = (earned: number, possible: number) => (possible > 0 ? Math.min(100, Math.round((earned / possible) * 100)) : 0);

/**
 * How much each thing counts (the Admin page can change these; scores are always shown out of 100).
 * The defaults are the original fixed points.
 */
export interface ScoreWeights {
  website: { loads: number; https: number; mobile: number; form: number; booking: number; pixel: number; gtag: number; speed: number };
  gbp: { verified: number; phone: number; website: number; hours: number; description: number; photos: number; reviews: number; rating: number; features: number };
  /** Share of the overall score that comes from the website (the rest from the Google profile), 0-100. */
  websiteShare: number;
}
export const DEFAULT_WEIGHTS: ScoreWeights = {
  website: { loads: 30, https: 10, mobile: 10, form: 10, booking: 10, pixel: 10, gtag: 10, speed: 10 },
  gbp: { verified: 20, phone: 10, website: 10, hours: 10, description: 10, photos: 15, reviews: 15, rating: 10, features: 5 },
  websiteShare: 50,
};

/** Keeps only valid numbers (0-50 per item, 0-100 share); anything missing takes the default. */
export function cleanWeights(v: unknown): ScoreWeights {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, Record<string, unknown> | unknown>;
  const num = (x: unknown, d: number, max: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x) : d);
  const part = <T extends Record<string, number>>(key: string, d: T): T => {
    const src = (o[key] && typeof o[key] === "object" ? o[key] : {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(d).map(([k, dv]) => [k, num(src[k], dv, 50)])) as T;
  };
  return { website: part("website", DEFAULT_WEIGHTS.website), gbp: part("gbp", DEFAULT_WEIGHTS.gbp), websiteShare: num(o.websiteShare, DEFAULT_WEIGHTS.websiteShare, 100) };
}

export interface Scores {
  gbp: number | null;
  website: number | null;
  presence: number | null;
  notes: { gbpComment: string; websiteComment: string; websiteRanking: string; suggestions: string[] };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Sources without Google profile facts (ratings, photos, verification). */
const NO_GOOGLE_SOURCES = ["free", "upload", "form"];
export const hasGoogleProfile = (dataSource: string | null) => !NO_GOOGLE_SOURCES.includes(dataSource ?? "");

/** Google profile score, or null when we don't have the business's Google details. */
export function gbpScore(i: ScoreInput): { score: number; comment: string; missing: string[] } | null {
  // Free open data, uploaded lists and website-form requests have no Google profile facts.
  if (!hasGoogleProfile(i.dataSource)) return null;
  const w = (i.weights ?? DEFAULT_WEIGHTS).gbp;
  const missing: string[] = [];
  let s = 0;
  if (i.isClaimed !== 0) s += w.verified; else missing.push("verification");
  if (i.phone) s += w.phone; else missing.push("a phone number");
  if (i.website) s += w.website; else missing.push("a website");
  if (i.hasHours) s += w.hours; else missing.push("opening hours");
  if (i.hasDescription) s += w.description; else missing.push("a description");
  const photos = i.photosCount ?? 0;
  s += w.photos * (photos >= 20 ? 1 : photos >= 5 ? 2 / 3 : photos >= 1 ? 1 / 3 : 0);
  if (photos < 5) missing.push(photos ? "more photos" : "photos");
  const reviews = i.reviewCount ?? 0;
  s += w.reviews * (reviews >= 50 ? 1 : reviews >= 10 ? 2 / 3 : reviews >= 1 ? 1 / 3 : 0);
  if (reviews < 10) missing.push(reviews ? "more reviews" : "reviews");
  const r = i.rating ?? 0;
  s += w.rating * (r >= 4.5 ? 1 : r >= 4.0 ? 0.7 : r >= 3.5 ? 0.4 : 0);
  if (i.attributesCount >= 5) s += w.features;
  const possible = Object.values(w).reduce((a, b) => a + b, 0);
  const good = [
    i.isClaimed !== 0 ? "Verified" : "Not verified",
    reviews ? `${r.toFixed(1)}★ from ${plural(reviews, "review")}` : "no reviews",
    photos ? plural(photos, "photo") : "no photos",
  ];
  const lack = missing.filter((m) => !["verification", "reviews", "more reviews", "photos", "more photos"].includes(m));
  const comment = good.join(", ") + (lack.length ? `; missing ${joinWords(lack)}.` : ".");
  return { score: outOf100(s, possible), comment, missing };
}

/** Website score: 0 = none, null = not checked yet. */
export function websiteScore(i: ScoreInput): { score: number | null; ranking: string; comment: string } {
  if (!i.website) return { score: 0, ranking: "No Website", comment: "No website" };
  const a = i.audit;
  if (!i.websiteDomain || a?.social_only) return { score: 10, ranking: "Weak", comment: "Social page only (no real website)" };
  if (!a) return { score: null, ranking: "", comment: "" };
  if (!a.reachable) return { score: 0, ranking: "No Website", comment: a.error?.includes("parked") ? "Domain is parked or for sale (no real website)" : "Website doesn't load" };
  if (a.error?.startsWith("blocked:")) return { score: null, ranking: "", comment: "Couldn't read the website (it blocks automated visits)" };
  const w = (i.weights ?? DEFAULT_WEIGHTS).website;
  let s = w.loads;
  const have: string[] = [], lack: string[] = [];
  const check = (ok: boolean | number | null, pts: number, yes: string, no: string) => {
    if (ok) { s += pts; have.push(yes); } else lack.push(no);
  };
  check(a.https, w.https, "secure (https)", "not secure (no https)");
  check(a.mobile_viewport, w.mobile, "mobile friendly", "not mobile friendly");
  check(a.has_contact_form, w.form, "contact form", "no contact form");
  check(a.has_booking, w.booking, "online booking", "no online booking");
  check(a.has_meta_pixel, w.pixel, "Meta pixel", "no Meta pixel");
  check(a.has_google_tag, w.gtag, "Google tag", "no Google tag");
  if (a.psi_score == null) s += w.speed / 2;
  else if (a.psi_score >= 90) { s += w.speed; have.push(`fast (${a.psi_score}/100)`); }
  else if (a.psi_score >= 50) { s += w.speed / 2; lack.push(`average speed (${a.psi_score}/100)`); }
  else lack.push(`slow (${a.psi_score}/100)`);
  const score = outOf100(s, Object.values(w).reduce((x, y) => x + y, 0));
  const ranking = score >= 80 ? "Strong" : score >= 60 ? "Good" : score >= 40 ? "Basic" : score >= 1 ? "Weak" : "No Website";
  const built = a.builder && a.builder !== "other" ? `${builderName(a.builder)} site` : "Website";
  const comment = `${built}: ${[...have, ...lack].join(", ")}.`;
  return { score, ranking, comment };
}

export function presenceScore(gbp: number | null, website: number | null, websiteShare = DEFAULT_WEIGHTS.websiteShare): number | null {
  if (gbp == null) return website;
  if (website == null) return gbp;
  const share = Math.min(100, Math.max(0, websiteShare)) / 100;
  return Math.round((1 - share) * gbp + share * website);
}

/** Up to 5 things to fix, most valuable first, in words a sales rep can say. */
export function suggestions(i: ScoreInput, gbp: ReturnType<typeof gbpScore>, web: ReturnType<typeof websiteScore>): string[] {
  const out: string[] = [];
  const a = i.audit;
  const year = i.year ?? new Date().getUTCFullYear();
  if (gbp && i.isClaimed === 0) out.push("Claim and verify the Google profile");
  if (!i.website) out.push("Add a website (none today)");
  else if (!i.websiteDomain || a?.social_only) out.push("Build a real website (only a social page today)");
  else if (a && !a.reachable) out.push(a.error?.includes("parked") ? "Build a new website: their domain is parked or for sale" : "Fix the website: it doesn't load");
  if (a?.reachable && !a.social_only && !a.error?.startsWith("blocked:")) {
    // Paying for ads with nowhere to book or ask: the ad money leaks (a strong opener).
    if ((a.has_google_ads || a.call_tracking) && !a.has_booking && !a.has_contact_form) out.push("They pay for ads, but visitors can't book or send a request online");
    if (a.copyright_year && a.copyright_year <= year - 3) out.push(`Refresh the website: it looks outdated (© ${a.copyright_year})`);
    if (!a.mobile_viewport) out.push("Make the website work on phones");
    if (a.ssl_expires && a.ssl_expires <= new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)) {
      out.push(`Renew the security certificate (runs out ${a.ssl_expires}; browsers will then warn visitors)`);
    }
    if (a.email_provider === "No email on this domain") out.push("Set up email on their own domain (they have none)");
    if (!a.has_booking) out.push("Add online booking");
    if (!a.has_contact_form) out.push("Add a contact form");
    if (!a.https) out.push("Move the website to https (browsers call it not secure)");
    if (!a.has_meta_pixel && !a.has_google_tag) out.push("Add a Meta pixel / Google tag to track visitors");
    if (a.psi_score != null && a.psi_score < 50) out.push(`Speed up the website (mobile score ${a.psi_score}/100)`);
    if (!a.has_chat_widget) out.push("Add a chat widget to catch visitors");
  }
  if (gbp) {
    const reviews = i.reviewCount ?? 0;
    const top = i.topCompetitor;
    // "Review gap": far behind the local leader is a strong opener for a sales call.
    if (top && top.reviews >= 20 && reviews < top.reviews * 0.5) {
      out.splice(i.isClaimed === 0 ? 1 : 0, 0, `Close the review gap: ${top.name} nearby has ${top.reviews.toLocaleString("en-US")} reviews, this business ${reviews}`);
    } else if (reviews < 10) out.push(reviews ? `Ask happy customers for reviews (only ${reviews} today)` : "Get the first Google reviews");
    if (!i.hasHours) out.push("Add opening hours to Google");
    if ((i.photosCount ?? 0) < 5) out.push(i.photosCount ? `Add photos to Google (only ${i.photosCount} today)` : "Add photos to Google");
    if (i.rating != null && reviews > 0 && i.rating < 4) out.push(`Reply to reviews and lift the rating (${i.rating.toFixed(1)}★)`);
    if (!i.hasDescription) out.push("Add a business description to Google");
  }
  void web;
  return out.slice(0, 5);
}

export function scoreLead(i: ScoreInput): Scores {
  const gbp = gbpScore(i);
  const web = websiteScore(i);
  return {
    gbp: gbp?.score ?? null,
    website: web.score,
    presence: presenceScore(gbp?.score ?? null, web.score, (i.weights ?? DEFAULT_WEIGHTS).websiteShare),
    notes: { gbpComment: gbp?.comment ?? "", websiteComment: web.comment, websiteRanking: web.ranking, suggestions: suggestions(i, gbp, web) },
  };
}

function joinWords(list: string[]): string {
  return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

const BUILDERS: Record<string, string> = {
  wordpress: "WordPress", wix: "Wix", squarespace: "Squarespace", shopify: "Shopify", godaddy: "GoDaddy",
  weebly: "Weebly", duda: "Duda", webflow: "Webflow", highlevel: "HighLevel",
};
export const builderName = (b: string) => BUILDERS[b] ?? b;

// ---------------------------------------------------------------------------------------
// Database side: score (and flag chains for) leads.

interface LeadForScore {
  id: string; rid: number; business_name: string | null; data_source: string | null; is_claimed: number | null;
  website: string | null; website_domain: string | null; gbp_phone_formatted: string | null; gbp_phone_raw: string | null;
  rating: number | null; review_count: number | null; photos_count: number | null; raw: string | null; attrs: number;
  reachable: number | null; https: number | null; social_only: number | null; builder: string | null; has_meta_pixel: number | null;
  has_google_tag: number | null; has_booking: number | null; has_contact_form: number | null; has_chat_widget: number | null;
  mobile_viewport: number | null; copyright_year: number | null; psi_score: number | null; audited: string | null; audit_error: string | null; has_google_ads: number | null; call_tracking: string | null; email_provider: string | null; ssl_expires: string | null;
  gbp_category: string | null; city: string | null;
  /** What is stored now (so unchanged businesses aren't written again). */
  cur_gbp: number | null; cur_website: number | null; cur_presence: number | null; cur_notes: string | null; cur_chain: number | null;
}

/** Does this business need writing? Only when a score, the notes or the chain flag changes. */
export function scoreChanged(
  cur: Pick<LeadForScore, "cur_gbp" | "cur_website" | "cur_presence" | "cur_notes" | "cur_chain">,
  s: Pick<Scores, "gbp" | "website" | "presence">,
  notes: string,
  chain: 0 | 1,
): boolean {
  return cur.cur_gbp !== s.gbp || cur.cur_website !== s.website || cur.cur_presence !== s.presence
    || cur.cur_notes !== notes || (chain === 1 && cur.cur_chain !== 1);
}

const SCORE_SELECT = `SELECT l.rowid AS rid, l.id, l.business_name, l.gbp_category, l.city, l.data_source, l.is_claimed, l.website, l.website_domain, l.gbp_phone_formatted,
    l.gbp_phone_raw, l.rating, l.review_count, l.photos_count, l.raw,
    l.gbp_score AS cur_gbp, l.website_score AS cur_website, l.presence_score AS cur_presence, l.score_notes AS cur_notes, l.is_chain AS cur_chain,
    (SELECT COUNT(*) FROM lead_attributes la WHERE la.lead_id = l.id) AS attrs,
    a.lead_id AS audited, a.reachable, a.https, a.social_only, a.builder, a.has_meta_pixel, a.has_google_tag, a.has_booking,
    a.has_contact_form, a.has_chat_widget, a.mobile_viewport, a.copyright_year, a.psi_score, a.error AS audit_error, a.has_google_ads, a.call_tracking, a.email_provider, a.ssl_expires
  FROM leads l LEFT JOIN website_audits a ON a.lead_id = l.id`;

export function toScoreInput(r: LeadForScore): ScoreInput {
  let raw: Record<string, unknown> = {};
  try { raw = r.raw ? JSON.parse(r.raw) : {}; } catch { /* keep empty */ }
  const hours = raw.openingHours;
  return {
    dataSource: r.data_source, isClaimed: r.is_claimed, website: r.website, websiteDomain: r.website_domain,
    phone: r.gbp_phone_formatted ?? r.gbp_phone_raw, rating: r.rating, reviewCount: r.review_count, photosCount: r.photos_count,
    hasHours: Array.isArray(hours) ? hours.length > 0 : !!hours, hasDescription: typeof raw.description === "string" && raw.description.trim().length > 0,
    attributesCount: r.attrs,
    audit: r.audited ? {
      reachable: r.reachable ?? 0, https: r.https, social_only: r.social_only ?? 0, builder: r.builder, has_meta_pixel: r.has_meta_pixel ?? 0,
      has_google_tag: r.has_google_tag ?? 0, has_booking: r.has_booking ?? 0, has_contact_form: r.has_contact_form ?? 0,
      has_chat_widget: r.has_chat_widget ?? 0, mobile_viewport: r.mobile_viewport ?? 0, copyright_year: r.copyright_year, psi_score: r.psi_score, error: r.audit_error, has_google_ads: r.has_google_ads, call_tracking: r.call_tracking, email_provider: r.email_provider, ssl_expires: r.ssl_expires,
    } : null,
  };
}

function scoreStatements(env: Env, rows: LeadForScore[], chainDomains: Set<string>, leaders: Map<string, { name: string; reviews: number }>, weights: ScoreWeights) {
  const st: D1PreparedStatement[] = [];
  for (const r of rows) {
    const top = leaders.get(leaderKey(r.gbp_category, r.city));
    const s = scoreLead({ ...toScoreInput(r), topCompetitor: top && top.name !== r.business_name ? top : null, weights });
    const chain = looksLikeChain(r.business_name ?? "") || (!!r.website_domain && chainDomains.has(r.website_domain)) ? 1 : 0;
    const notes = JSON.stringify(s.notes);
    // A re-score (new weights, a new check) mostly lands on the same result: skip those writes.
    if (!scoreChanged(r, s, notes, chain)) continue;
    st.push(env.DB.prepare(
      `UPDATE leads SET gbp_score = ?, website_score = ?, presence_score = ?, score_notes = ?, scored_at = datetime('now'),
         is_chain = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(is_chain, 0) END WHERE id = ?`,
    ).bind(s.gbp, s.website, s.presence, notes, chain, r.id));
  }
  return st;
}

const leaderKey = (category: string | null, city: string | null) => `${category ?? ""}|${(city ?? "").toLowerCase()}`;

/** The most-reviewed independent business per type + city (for "close the review gap"). */
async function localLeaders(env: Env, rows: LeadForScore[]): Promise<Map<string, { name: string; reviews: number }>> {
  const withGoogle = rows.filter((r) => hasGoogleProfile(r.data_source) && r.gbp_category && r.city);
  if (!withGoogle.length) return new Map();
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const cats = [...new Set(withGoogle.map((r) => r.gbp_category!))].map(q).join(", ");
  const cities = [...new Set(withGoogle.map((r) => r.city!.toLowerCase()))].map(q).join(", ");
  const { results } = await env.DB.prepare(
    `SELECT c, ci, n, r FROM (
       SELECT gbp_category AS c, lower(city) AS ci, business_name AS n, review_count AS r,
              ROW_NUMBER() OVER (PARTITION BY gbp_category, lower(city) ORDER BY review_count DESC) AS rn
       FROM leads WHERE gbp_category IN (${cats}) AND lower(city) IN (${cities}) AND review_count > 0 AND COALESCE(is_chain, 0) = 0)
     WHERE rn = 1`,
  ).all<{ c: string; ci: string; n: string; r: number }>();
  return new Map(results.map((x) => [`${x.c}|${x.ci}`, { name: x.n, reviews: x.r }]));
}

/** Website domains shared by businesses in at least 3 different cities (chains / franchises). */
async function sharedDomains(env: Env, domains: string[]): Promise<Set<string>> {
  const list = [...new Set(domains)].filter(Boolean);
  if (!list.length) return new Set();
  const q = list.map((d) => `'${d.replace(/'/g, "''")}'`).join(", ");
  const { results } = await env.DB.prepare(
    `SELECT website_domain AS d FROM leads WHERE website_domain IN (${q})
     GROUP BY website_domain HAVING COUNT(DISTINCT lower(COALESCE(city, ''))) >= 3`,
  ).all<{ d: string }>();
  return new Set(results.map((r) => r.d));
}

/** The team's score weights (Admin page), or the defaults. */
export async function loadWeights(env: Env): Promise<ScoreWeights> {
  const v = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'score_weights'`).first<string>("value");
  try { return cleanWeights(v ? JSON.parse(v) : null); } catch { return DEFAULT_WEIGHTS; }
}

/** Saves new weights and re-scores every business (the minute job works through them again). */
export async function saveWeights(env: Env, v: unknown): Promise<ScoreWeights> {
  const w = cleanWeights(v);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('score_weights', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(JSON.stringify(w)),
    env.DB.prepare(`UPDATE app_settings SET value = '0' WHERE key = 'score_rowid'`),
  ]);
  return w;
}

/** Re-scores these leads now (after a website check or Google lookup). */
export async function rescoreLeads(env: Env, leadIds: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < leadIds.length; i += 50) {
    const ids = leadIds.slice(i, i + 50).map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
    const { results } = await env.DB.prepare(`${SCORE_SELECT} WHERE l.id IN (${ids})`).all<LeadForScore>();
    const chains = await sharedDomains(env, results.map((r) => r.website_domain ?? ""));
    const st = scoreStatements(env, results, chains, await localLeaders(env, results), await loadWeights(env));
    if (st.length) await env.DB.batch(st);
    n += st.length;
  }
  return n;
}

const SCORE_PAGE = 200;

/**
 * Minute job: scores new businesses (in saving order, remembered in app_settings.score_rowid)
 * and flags chains. When a website appears in 3+ cities, every business on it is flagged.
 */
export async function scoreStep(env: Env): Promise<{ scored: number }> {
  const marker = Number(await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'score_rowid'`).first<string>("value")) || 0;
  const { results } = await env.DB.prepare(`${SCORE_SELECT} WHERE l.rowid > ? ORDER BY l.rowid LIMIT ?`).bind(marker, SCORE_PAGE).all<LeadForScore>();
  if (!results.length) return { scored: 0 };
  const chains = await sharedDomains(env, results.map((r) => r.website_domain ?? ""));
  const st = scoreStatements(env, results, chains, await localLeaders(env, results), await loadWeights(env));
  if (chains.size) {
    const q = [...chains].map((d) => `'${d.replace(/'/g, "''")}'`).join(", ");
    st.push(env.DB.prepare(`UPDATE leads SET is_chain = 1 WHERE website_domain IN (${q}) AND COALESCE(is_chain, 0) = 0`));
  }
  st.push(env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('score_rowid', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(String(results[results.length - 1].rid)));
  for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));
  return { scored: results.length };
}
