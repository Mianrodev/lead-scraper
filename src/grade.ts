// Report grades: one place that turns what we know about a business into the report's sections
// (Google profile, Reviews, Website, Ads & tracking, Social pages), each with a 0-100 score and
// a letter A-F, an overall grade, and the top 3 quick wins. The public report (src/report.ts) and
// the GoHighLevel download columns (src/ghl-columns.ts) both use gradeReport, so they always match.
//
// Data we never collected (free / uploaded lists have no Google details; a website not visited
// yet) is shown as "Not checked yet" and left out of the overall grade, never counted as a fail.

import { cachedMany } from "./cache";
import type { LocalAverage } from "./company-facts";
import { builderName, hasGoogleProfile } from "./scoring";

export type Grade = "A" | "B" | "C" | "D" | "F";
export type SectionKey = "google" | "reviews" | "website" | "ads" | "social";

/** 85+ A, 70-84 B, 55-69 C, 40-54 D, below 40 F. */
export function gradeFor(score: number): Grade {
  return score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
}

/** Everything the grades read. Fields left undefined are simply not checked (older callers pass fewer). */
export interface GradeInput {
  id?: string;
  business_name: string | null; gbp_category: string | null; city: string | null; state: string | null;
  website: string | null; website_domain?: string | null; data_source: string | null;
  // Google profile
  is_claimed?: number | null; phone?: string | null; has_hours?: number | null; has_description?: number | null; photos_count?: number | null;
  rating: number | null; review_count: number | null;
  // Website check (website_audits)
  reachable: number | null; https: number | null; mobile_viewport: number | null; has_contact_form: number | null; has_booking: number | null;
  has_meta_pixel: number | null; has_google_tag: number | null; has_chat_widget: number | null; copyright_year: number | null;
  psi_score: number | null; audit_error: string | null; social_only: number | null; email_provider: string | null; checked_at: string | null;
  has_google_ads?: number | null; has_bing_ads?: number | null; call_tracking?: string | null; has_tiktok_pixel?: number | null; builder?: string | null;
  // Social pages and the AI helper's reading of the website
  socials?: string | null; ai_status?: string | null; ai_summary?: string | null; ai_services?: string | null;
}

export interface Competitor { id: string; name: string; rating: number | null; reviews: number }
/** Facts about similar businesses in the same city: the local average and the busiest few (up to 4, may include the business itself). */
export interface LocalFacts { average: LocalAverage | null; top: Competitor[] }

export interface GradedCheck { id: string; ok: boolean; text: string; minor?: boolean }
export interface Section {
  key: SectionKey; title: string;
  /** graded = has a score; not_checked = we didn't collect this (neutral); na = doesn't apply (e.g. ads without a website). */
  status: "graded" | "not_checked" | "na";
  score: number | null; grade: Grade | null; note: string; checks: GradedCheck[];
}
export interface ReportGrade {
  overall: { score: number; grade: Grade } | null;
  sections: Section[];
  /** Up to 3 one-sentence fixes, most valuable first. */
  quickWins: string[];
  /** What's wrong behind the first quick win, as the report says it ("Only 17 Google reviews…"), for an opener. */
  topProblem: string;
  /** The 3 busiest similar businesses nearby (never this business). */
  competitors: Competitor[];
  average: LocalAverage | null;
  /** This business's Google reviews (null = not checked). */
  reviews: { rating: number | null; count: number } | null;
  about: { summary: string; services: string[] };
  socialPages: { key: string; name: string; url: string }[];
}

/** How much each section counts in the overall grade (only graded sections count). */
export const SECTION_WEIGHTS: Record<SectionKey, number> = { google: 25, reviews: 25, website: 25, ads: 10, social: 15 };
const TITLES: Record<SectionKey, string> = { google: "Google profile", reviews: "Reviews", website: "Website", ads: "Ads & tracking", social: "Social pages" };

interface Check {
  id: string; ok: boolean; text: string; weight: number;
  /** 0-1 share of the weight earned (defaults to ok ? 1 : 0). */
  credit?: number;
  minor?: boolean;
  /** A one-sentence fix, and how valuable it is (higher = first). Same `key` = shown once. */
  win?: { text: string; value: number; key?: string };
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const stars = (r: number) => `${r.toFixed(1)}★`;

function section(key: SectionKey, checks: Check[], note = "", fullAt?: number): Section & { raw: Check[] } {
  const possible = fullAt ?? checks.reduce((a, c) => a + c.weight, 0);
  const earned = checks.reduce((a, c) => a + c.weight * Math.max(0, Math.min(1, c.credit ?? (c.ok ? 1 : 0))), 0);
  const score = possible > 0 ? Math.max(0, Math.min(100, Math.round((earned / possible) * 100))) : 0;
  return {
    key, title: TITLES[key], status: "graded", score, grade: gradeFor(score), note,
    checks: checks.map((c) => ({ id: c.id, ok: c.ok, text: c.text, ...(c.minor ? { minor: true } : {}) })), raw: checks,
  };
}
const neutral = (key: SectionKey, status: "not_checked" | "na", note: string): Section & { raw: Check[] } =>
  ({ key, title: TITLES[key], status, score: null, grade: null, note, checks: [], raw: [] });

// ---------------------------------------------------------------------------------------
// Social pages

const SOCIAL_SITES: { key: string; name: string; hosts: RegExp; weight: number; minor: boolean; win: string; value: number }[] = [
  { key: "facebook", name: "Facebook", hosts: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/, weight: 30, minor: false, value: 46,
    win: "Set up a Facebook page for your business: it’s where many locals look for recommendations." },
  { key: "instagram", name: "Instagram", hosts: /(^|\.)instagram\.com$/, weight: 25, minor: false, value: 44,
    win: "Start an Instagram account and post photos of your work." },
  { key: "yelp", name: "Yelp", hosts: /(^|\.)yelp\.[a-z.]+$/, weight: 10, minor: false, value: 30, win: "Claim your free Yelp page so you show up there too." },
  { key: "linkedin", name: "LinkedIn", hosts: /(^|\.)linkedin\.com$/, weight: 10, minor: true, value: 20, win: "Add a LinkedIn company page." },
  { key: "youtube", name: "YouTube", hosts: /(^|\.)(youtube\.com|youtu\.be)$/, weight: 10, minor: true, value: 20, win: "Post a short video of your work on YouTube." },
  { key: "tiktok", name: "TikTok", hosts: /(^|\.)tiktok\.com$/, weight: 5, minor: true, value: 15, win: "Try short videos on TikTok." },
  { key: "nextdoor", name: "Nextdoor", hosts: /(^|\.)nextdoor\.[a-z.]+$/, weight: 5, minor: true, value: 25, win: "Claim your free Nextdoor business page to reach neighbors." },
  { key: "x", name: "X (Twitter)", hosts: /(^|\.)(x\.com|twitter\.com)$/, weight: 5, minor: true, value: 10, win: "Add an X (Twitter) account." },
];

/** The social pages in leads.socials (comma-separated links), one per site, in a fixed order. */
export function parseSocials(socials: string | null | undefined): { key: string; name: string; url: string }[] {
  const found = new Map<string, string>();
  for (const part of (socials ?? "").split(/[,\s]+/)) {
    const s = part.trim();
    if (!s) continue;
    let host = "";
    try { host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase(); } catch { continue; }
    const site = SOCIAL_SITES.find((x) => x.hosts.test(host));
    if (site && !found.has(site.key)) found.set(site.key, /^https?:\/\//i.test(s) ? s : `https://${s}`);
  }
  return SOCIAL_SITES.filter((x) => found.has(x.key)).map((x) => ({ key: x.key, name: x.name, url: found.get(x.key)! }));
}

// ---------------------------------------------------------------------------------------
// The grades

/** Can we read the website's insides (loads, not just a social page, didn't block us)? */
function websiteState(l: GradeInput): "none" | "social" | "down" | "parked" | "blocked" | "unchecked" | "ok" {
  if (!l.website) return "none";
  if (l.social_only || (l.website_domain === null)) return "social";
  const checked = l.checked_at != null || l.reachable != null;
  if (!checked) return "unchecked";
  if (!l.reachable) return (l.audit_error ?? "").includes("parked") ? "parked" : "down";
  if ((l.audit_error ?? "").startsWith("blocked:")) return "blocked";
  return "ok";
}

function googleSection(l: GradeInput) {
  if (!hasGoogleProfile(l.data_source)) return neutral("google", "not_checked", "Not checked yet: we haven’t looked up your Google profile.");
  const c: Check[] = [];
  if (l.is_claimed === 1 || l.is_claimed === 0) {
    c.push({ id: "claimed", ok: l.is_claimed === 1, weight: 25, text: l.is_claimed === 1 ? "Claimed and verified by the owner" : "Not claimed or verified by the owner",
      win: { text: "Claim and verify your Google profile so you control what customers see.", value: 95 } });
  }
  c.push({ id: "gbp_website", ok: !!l.website, weight: 15, text: l.website ? "Website listed" : "No website listed",
    win: { text: "Get a simple website and add it to your Google profile, so people who find you can learn more and get in touch.", value: 100, key: "no_website" } });
  if (l.phone !== undefined) {
    c.push({ id: "gbp_phone", ok: !!l.phone, weight: 15, text: l.phone ? "Phone number listed" : "No phone number listed",
      win: { text: "Add your phone number to your Google profile so customers can call in one tap.", value: 78 } });
  }
  if (l.has_hours != null) {
    c.push({ id: "hours", ok: !!l.has_hours, weight: 15, text: l.has_hours ? "Opening hours listed" : "No opening hours listed",
      win: { text: "Add your opening hours to Google so people know when to call or visit.", value: 72 } });
  }
  if (l.photos_count != null) {
    const p = l.photos_count;
    c.push({ id: "photos", ok: p >= 5, weight: 15, credit: p >= 20 ? 1 : p >= 5 ? 0.7 : p >= 1 ? 0.35 : 0,
      text: p ? `${plural(p, "photo")} on the profile` : "No photos on the profile",
      win: { text: p ? `Add more photos to your Google profile (you have ${p}): profiles with photos get more calls.` : "Add photos to your Google profile: profiles with photos get more calls.", value: 62 } });
  }
  if (l.has_description != null) {
    c.push({ id: "description", ok: !!l.has_description, weight: 10, text: l.has_description ? "Business description" : "No business description",
      win: { text: "Add a short description of what you do to your Google profile.", value: 50 } });
  }
  c.push({ id: "category", ok: !!l.gbp_category, weight: 5, text: l.gbp_category ? `Category: ${l.gbp_category}` : "No business category",
    win: { text: "Pick the right main category on your Google profile so you show up in the right searches.", value: 45 } });
  return section("google", c);
}

function reviewsSection(l: GradeInput, facts: LocalFacts | null, competitors: Competitor[]) {
  if (!hasGoogleProfile(l.data_source)) return neutral("reviews", "not_checked", "Your Google rating: not checked");
  const n = l.review_count ?? 0;
  const avg = facts?.average && facts.average.businesses >= 3 ? facts.average : null;
  const avgReviews = avg?.avg_reviews != null ? Math.round(avg.avg_reviews) : null;
  const target = avgReviews != null ? Math.max(10, avgReviews) : 25;
  const area = avgReviews != null ? ` (area average: ${avgReviews.toLocaleString("en-US")})` : "";
  const c: Check[] = [{
    id: "review_count", ok: n >= target, weight: 45, credit: Math.min(1, n / target),
    text: n >= target ? `${plural(n, "Google review")}${area}` : n ? `Only ${plural(n, "Google review")}${area}` : `No Google reviews yet${area}`,
    win: { text: n ? `Ask happy customers for Google reviews: you have ${n}${avgReviews != null ? `, similar businesses nearby average ${avgReviews.toLocaleString("en-US")}` : ""}.`
      : "Ask your happy customers for Google reviews: you don’t have any yet.", value: 80, key: "more_reviews" },
  }];
  if (n > 0 && l.rating != null) {
    const r = l.rating;
    const areaR = avg?.avg_rating != null ? ` (area average: ${stars(avg.avg_rating)})` : "";
    c.push({ id: "rating", ok: r >= 4.5, weight: 30, credit: r >= 4.7 ? 1 : r >= 4.5 ? 0.9 : r >= 4.0 ? 0.65 : r >= 3.5 ? 0.35 : 0,
      text: `Rated ${stars(r)}${areaR}`,
      win: { text: `Reply to every review and ask happy customers to post: it lifts your ${stars(r)} rating.`, value: r < 4 ? 82 : 66 } });
  }
  const leader = competitors[0];
  if (leader && leader.reviews > 0) {
    const half = leader.reviews * 0.5;
    c.push({ id: "review_gap", ok: n >= half, weight: 25, credit: Math.min(1, n / half),
      text: n >= half ? `Keeping up with the busiest nearby (${leader.name}: ${plural(leader.reviews, "review")})` : `${leader.name} has ${plural(leader.reviews, "review")} to your ${n.toLocaleString("en-US")}`,
      win: { text: `Close the review gap: ${leader.name} nearby has ${leader.reviews.toLocaleString("en-US")} Google reviews to your ${n.toLocaleString("en-US")}.`, value: 85, key: "more_reviews" } });
  }
  return section("reviews", c);
}

function websiteSection(l: GradeInput, today: Date) {
  const st = websiteState(l);
  if (st === "unchecked") return neutral("website", "not_checked", "Not checked yet: we haven’t visited your website.");
  if (st === "blocked") return neutral("website", "not_checked", "We couldn’t read your website this time (it blocks automated visits).");
  if (st === "none") return section("website", [{ id: "has_website", ok: false, weight: 1, text: "No website: customers searching online can’t find out about you",
    win: { text: "Get a simple website so people who find you on Google can learn more and contact you.", value: 100, key: "no_website" } }]);
  if (st === "social") return section("website", [{ id: "has_website", ok: false, weight: 1, credit: 0.1, text: "Only a social media page, no website of your own",
    win: { text: "Build a website of your own: a social page alone loses customers who search on Google.", value: 90, key: "no_website" } }]);
  if (st === "down" || st === "parked") return section("website", [{ id: "loads", ok: false, weight: 1,
    text: st === "parked" ? "Your web address is parked or for sale" : "Your website doesn’t load",
    win: { text: st === "parked" ? "Put a real website on your web address: today it shows a parked or for-sale page." : "Fix your website: it doesn’t load, so visitors leave.", value: 98, key: "no_website" } }]);
  const c: Check[] = [{ id: "loads", ok: true, weight: 20, text: "Your website loads" }];
  c.push({ id: "https", ok: !!l.https, weight: 15, text: l.https ? "Secure (https)" : "Not secure: browsers warn visitors",
    win: { text: "Make your website secure (https) so browsers stop warning visitors away.", value: 75 } });
  c.push({ id: "mobile", ok: !!l.mobile_viewport, weight: 15, text: l.mobile_viewport ? "Works on phones" : "Hard to use on phones, where most visitors are",
    win: { text: "Make your website easy to use on phones, where most of your visitors are.", value: 74 } });
  if (l.psi_score != null) {
    const p = l.psi_score;
    c.push({ id: "speed", ok: p >= 50, weight: 15, credit: p >= 90 ? 1 : p >= 50 ? 0.6 : 0.2,
      text: p >= 50 ? `Loads quickly on phones (${p}/100)` : `Slow on phones (${p}/100)`,
      win: { text: `Speed up your website on phones (it scores ${p}/100): slow pages lose visitors.`, value: 68 } });
  }
  c.push({ id: "contact_form", ok: !!l.has_contact_form, weight: 10, text: l.has_contact_form ? "Contact form" : "No contact form, so visitors have to call",
    win: { text: "Add a contact form so visitors can reach you without calling.", value: 70 } });
  c.push({ id: "booking", ok: !!l.has_booking, weight: 10, text: l.has_booking ? "Online booking" : "No online booking",
    win: { text: "Add online booking so customers can book any time, even after hours.", value: 65 } });
  c.push({ id: "chat", ok: !!l.has_chat_widget, weight: 5, text: l.has_chat_widget ? "Chat on the website" : "No chat for quick questions",
    win: { text: "Add a chat box to your website to catch visitors with quick questions.", value: 40 } });
  if (l.copyright_year) {
    const ok = l.copyright_year > today.getUTCFullYear() - 3;
    c.push({ id: "up_to_date", ok, weight: 5, text: ok ? `Kept up to date (© ${l.copyright_year})` : `Looks out of date (© ${l.copyright_year})`,
      win: { text: `Refresh your website: it looks out of date (© ${l.copyright_year}).`, value: 55 } });
  }
  if (l.email_provider) {
    const ok = l.email_provider !== "No email on this domain";
    c.push({ id: "email", ok, weight: 5, text: ok ? "Email on your own web address" : "No email on your own web address",
      win: { text: "Set up email on your own web address (like you@yourbusiness.com) so you look established.", value: 42 } });
  }
  const builder = l.builder && l.builder !== "other" ? `Built with ${builderName(l.builder)}.` : "";
  return section("website", c, builder);
}

function adsSection(l: GradeInput) {
  const st = websiteState(l);
  if (st === "unchecked" || st === "blocked") return neutral("ads", "not_checked", "Not checked yet: we haven’t read your website.");
  if (st !== "ok") return neutral("ads", "na", "Needs a working website first: ads and tracking live on your website.");
  const tracking = { text: "Add a Meta pixel and a Google tag so you can show ads to people who already visited your website.", value: 60, key: "tracking" };
  const c: Check[] = [
    { id: "meta_pixel", ok: !!l.has_meta_pixel, weight: 30, text: l.has_meta_pixel ? "Meta (Facebook) pixel: you can show Facebook and Instagram ads to past visitors" : "No Meta pixel: you can’t show Facebook and Instagram ads to past visitors", win: tracking },
    { id: "google_tag", ok: !!l.has_google_tag, weight: 30, text: l.has_google_tag ? "Google tag: you can measure visitors and show them Google ads" : "No Google tag: you can’t measure visitors or show them Google ads", win: tracking },
  ];
  if (l.has_google_ads !== undefined) {
    c.push({ id: "google_ads", ok: !!(l.has_google_ads || l.has_bing_ads), weight: 15, text: l.has_google_ads || l.has_bing_ads ? "Ad conversion tracking (you can see which ads bring customers)" : "No ad conversion tracking found",
      win: { text: "Set up conversion tracking so you can see which ads bring in customers.", value: 30 } });
  }
  if (l.call_tracking !== undefined) {
    c.push({ id: "call_tracking", ok: !!l.call_tracking, weight: 15, text: l.call_tracking ? `Call tracking (${l.call_tracking})` : "No call tracking: you can’t tell which ads make the phone ring",
      win: { text: "Add call tracking so you know which ads and pages make the phone ring.", value: 35 } });
  }
  if (l.has_tiktok_pixel !== undefined) {
    c.push({ id: "tiktok_pixel", ok: !!l.has_tiktok_pixel, weight: 10, minor: true, text: l.has_tiktok_pixel ? "TikTok pixel" : "No TikTok pixel",
      win: { text: "Add a TikTok pixel if you want to advertise on TikTok.", value: 15 } });
  }
  return section("ads", c, "Can you show ads to people who already visited your website?");
}

function socialSection(l: GradeInput, pages: { key: string }[]) {
  const looked = websiteState(l) === "ok" || l.ai_status === "done" || l.ai_status === "nothing";
  if (!pages.length && !looked) return neutral("social", "not_checked", "Not checked yet.");
  const have = new Set(pages.map((p) => p.key));
  const c: Check[] = SOCIAL_SITES.map((s) => ({
    id: s.key, ok: have.has(s.key), weight: s.weight, minor: s.minor,
    text: have.has(s.key) ? s.name : `No ${s.name} page found`, win: { text: s.win, value: s.value },
  }));
  // Facebook + Instagram + one more is a full score: nobody needs every site.
  return section("social", c, "", 70);
}

/** The report's grades for one business. `facts` = local average and busiest nearby (null = unknown). */
export function gradeReport(l: GradeInput, facts: LocalFacts | null = null, today = new Date()): ReportGrade {
  const competitors = (facts?.top ?? []).filter((c) => c.id !== l.id && (!l.id ? c.name !== l.business_name : true)).slice(0, 3);
  const pages = parseSocials(l.socials);
  const built = [googleSection(l), reviewsSection(l, facts, competitors), websiteSection(l, today), adsSection(l), socialSection(l, pages)];
  const graded = built.filter((s) => s.status === "graded");
  const totalW = graded.reduce((a, s) => a + SECTION_WEIGHTS[s.key], 0);
  const overallScore = totalW ? Math.round(graded.reduce((a, s) => a + SECTION_WEIGHTS[s.key] * (s.score ?? 0), 0) / totalW) : null;
  // Quick wins: failed checks of graded sections, most valuable first, one per kind of fix.
  const wins: { text: string; value: number; key: string; order: number; problem: string }[] = [];
  let order = 0;
  for (const s of graded) for (const ch of s.raw) if (!ch.ok && ch.win) wins.push({ ...ch.win, key: ch.win.key ?? `${s.key}.${ch.id}`, order: order++, problem: ch.text });
  wins.sort((a, b) => b.value - a.value || a.order - b.order);
  const seen = new Set<string>();
  const quickWins: string[] = [];
  for (const w of wins) {
    if (seen.has(w.key)) continue;
    seen.add(w.key);
    quickWins.push(w.text);
    if (quickWins.length === 3) break;
  }
  const services = (l.ai_services ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  return {
    overall: overallScore == null ? null : { score: overallScore, grade: gradeFor(overallScore) },
    sections: built.map(({ raw: _raw, ...s }) => s),
    quickWins,
    topProblem: wins[0]?.problem ?? "",
    competitors,
    average: facts?.average && facts.average.businesses >= 3 ? facts.average : null,
    reviews: hasGoogleProfile(l.data_source) ? { rating: l.rating, count: l.review_count ?? 0 } : null,
    about: { summary: (l.ai_summary ?? "").trim(), services },
    socialPages: pages,
  };
}

// ---------------------------------------------------------------------------------------
// Database side: Google profile flags from the saved listing, and local facts (cached a day)

/** SQL (leads aliased `l`): 1/0 when the saved Google listing has opening hours / a description, NULL when there's no listing. */
export const HAS_HOURS_SQL = `CASE WHEN l.raw IS NULL OR NOT json_valid(l.raw) THEN NULL ELSE CASE json_type(l.raw, '$.openingHours')
    WHEN 'array' THEN json_array_length(l.raw, '$.openingHours') > 0 WHEN 'object' THEN 1 WHEN 'true' THEN 1
    WHEN 'text' THEN length(json_extract(l.raw, '$.openingHours')) > 0 ELSE 0 END END`;
export const HAS_DESCRIPTION_SQL = `CASE WHEN l.raw IS NULL OR NOT json_valid(l.raw) THEN NULL
    WHEN json_type(l.raw, '$.description') = 'text' AND length(trim(json_extract(l.raw, '$.description'))) > 0 THEN 1 ELSE 0 END`;

/** Columns (leads `l` LEFT JOIN website_audits `a`) for GradeInput, apart from the ones every caller already has. */
export const GRADE_COLUMNS = `l.id, l.business_name, l.gbp_category, l.city, l.state, l.website, l.website_domain, l.data_source, l.is_claimed,
  COALESCE(l.gbp_phone_formatted, l.gbp_phone_raw) AS phone, ${HAS_HOURS_SQL} AS has_hours, ${HAS_DESCRIPTION_SQL} AS has_description, l.photos_count,
  l.rating, l.review_count, a.reachable, a.https, a.mobile_viewport, a.has_contact_form, a.has_booking, a.has_meta_pixel, a.has_google_tag,
  a.has_chat_widget, a.copyright_year, a.psi_score, a.error AS audit_error, a.social_only, a.email_provider, a.checked_at, a.has_google_ads,
  a.has_bing_ads, a.call_tracking, a.has_tiktok_pixel, a.builder, l.socials, l.ai_status, l.ai_summary, l.ai_services`;

export interface Place { state: string | null; city: string | null; category: string | null }
export const placeKey = (p: Place): string | null => (p.state && p.city && p.category ? `local3:${p.state}|${p.city}|${p.category}` : null);

/** The busiest 4 similar businesses (same city and type, open, with Google reviews), via the partial index idx_leads_local_top. */
export const TOP_NEARBY_SQL = `SELECT id, business_name AS name, rating, review_count AS reviews FROM leads
  WHERE state = ? AND city = ? AND gbp_category = ? AND review_count IS NOT NULL AND business_status = 'operational'
  ORDER BY review_count DESC LIMIT 4`;
const AVERAGE_SQL = `SELECT avg_rating, avg_reviews, businesses FROM local_averages WHERE state = ? AND city = ? AND category = ?`;

/**
 * Local facts for many places at once (one download chunk, or one report): answers stored for a
 * day in api_cache; the missing ones are looked up together (two small indexed reads per place).
 */
export async function localFactsFor(env: Env, places: Place[], memo = new Map<string, LocalFacts>()): Promise<Map<string, LocalFacts>> {
  const byKey = new Map<string, Place>();
  for (const p of places) { const k = placeKey(p); if (k && !memo.has(k)) byKey.set(k, p); }
  if (!byKey.size) return memo;
  const got = await cachedMany<LocalFacts>(env, [...byKey.keys()], 86_400, async (missing) => {
    const out = new Map<string, LocalFacts>();
    for (let i = 0; i < missing.length; i += 40) {
      const keys = missing.slice(i, i + 40);
      const st = keys.flatMap((k) => {
        const p = byKey.get(k)!;
        return [env.DB.prepare(AVERAGE_SQL).bind(p.state, p.city, p.category), env.DB.prepare(TOP_NEARBY_SQL).bind(p.state, p.city, p.category)];
      });
      const res = await env.DB.batch<Record<string, unknown>>(st);
      keys.forEach((k, j) => {
        const avg = res[j * 2].results[0] as unknown as LocalAverage | undefined;
        const top = (res[j * 2 + 1].results as unknown as Competitor[]).map((c) => ({ id: String(c.id), name: String(c.name ?? ""), rating: c.rating ?? null, reviews: Number(c.reviews) || 0 }));
        out.set(k, { average: avg ?? null, top });
      });
    }
    return out;
  });
  for (const [k, v] of got) memo.set(k, v);
  return memo;
}
