import { describe, expect, it } from "vitest";
import { cleanWeights, gbpScore, presenceScore, scoreLead, suggestions, websiteScore, type AuditFacts, type ScoreInput } from "../src/scoring";
import { looksLikeChain } from "../src/chains";
import { mergeSocials, sanitizeFindings } from "../src/website-audit";
import { pageSpeedUrl, parsePageSpeed } from "../src/pagespeed";
import { buildWhere, parseFilters } from "../src/leads";
import { leadToCsvRow } from "../src/export";

const audit = (over: Partial<AuditFacts> = {}): AuditFacts => ({
  reachable: 1, https: 1, social_only: 0, builder: "wordpress", has_meta_pixel: 1, has_google_tag: 1, has_booking: 1,
  has_contact_form: 1, has_chat_widget: 1, mobile_viewport: 1, copyright_year: 2026, psi_score: null, error: null, ...over,
});
const lead = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  dataSource: "google", isClaimed: 1, website: "https://joesplumbing.com", websiteDomain: "joesplumbing.com", phone: "+14075551234",
  rating: 4.8, reviewCount: 120, photosCount: 30, hasHours: true, hasDescription: true, attributesCount: 6, audit: audit(), year: 2026, ...over,
});

describe("scores", () => {
  it("gives a complete, well-reviewed Google profile full marks", () => {
    expect(gbpScore(lead())!.score).toBe(100);
    expect(gbpScore(lead())!.comment).toBe("Verified, 4.8★ from 120 reviews, 30 photos.");
  });
  it("has no Google score for free data (it doesn't include ratings or photos)", () => {
    expect(gbpScore(lead({ dataSource: "free" }))).toBeNull();
    expect(scoreLead(lead({ dataSource: "free" })).presence).toBe(websiteScore(lead()).score);
  });
  it("scores the website from the check", () => {
    expect(websiteScore(lead({ website: null }))).toEqual({ score: 0, ranking: "No Website", comment: "No website" });
    expect(websiteScore(lead({ websiteDomain: null })).comment).toMatch(/Social page only/);
    expect(websiteScore(lead({ audit: null })).score).toBeNull(); // not checked yet
    expect(websiteScore(lead({ audit: audit({ reachable: 0 }) })).comment).toBe("Website doesn't load");
    expect(websiteScore(lead({ audit: audit({ reachable: 1, error: "blocked: the site blocks automated visits" }) })).score).toBeNull();
    expect(websiteScore(lead()).score).toBe(95); // speed unknown = 5 of 10
    expect(websiteScore(lead({ audit: audit({ psi_score: 95 }) })).score).toBe(100);
    const bare = websiteScore(lead({ audit: audit({ https: 0, has_booking: 0, has_contact_form: 0, has_meta_pixel: 0, has_google_tag: 0, mobile_viewport: 0, psi_score: 20 }) }));
    expect(bare.score).toBe(30);
    expect(bare.ranking).toBe("Weak");
  });
  it("follows the team's weights (always out of 100)", () => {
    const w = cleanWeights({ website: { booking: 50, pixel: 0, gtag: 0 }, websiteShare: 80 });
    expect(w.website.loads).toBe(30); // unchanged items keep their default
    const noBooking = websiteScore(lead({ weights: w, audit: audit({ has_booking: 0 }) })).score!;
    const noPixel = websiteScore(lead({ weights: w, audit: audit({ has_meta_pixel: 0 }) })).score!;
    expect(noBooking).toBeLessThan(noPixel); // booking now matters much more than the pixel
    expect(noPixel).toBe(websiteScore(lead({ weights: w })).score); // the pixel counts for nothing
    expect(presenceScore(100, 0, 80)).toBe(20);
    expect(cleanWeights({ website: { loads: 999, https: -3 } }).website).toMatchObject({ loads: 30, https: 10 });
  });
  it("averages the two, or uses whichever we have", () => {
    expect(presenceScore(80, 40)).toBe(60);
    expect(presenceScore(null, 40)).toBe(40);
    expect(presenceScore(70, null)).toBe(70);
    expect(presenceScore(null, null)).toBeNull();
  });
  it("suggests the most valuable fixes first, in plain words", () => {
    const i = lead({ isClaimed: 0, reviewCount: 3, audit: audit({ has_booking: 0, copyright_year: 2019, mobile_viewport: 0 }) });
    const s = suggestions(i, gbpScore(i), websiteScore(i));
    expect(s[0]).toBe("Claim and verify the Google profile");
    expect(s).toContain("Refresh the website: it looks outdated (© 2019)");
    expect(s).toContain("Add online booking");
    expect(s.length).toBeLessThanOrEqual(5);
    expect(suggestions(lead({ website: null, audit: null }), null, websiteScore(lead({ website: null })))).toContain("Add a website (none today)");
  });
});

import { websiteDomain } from "../src/normalize";
describe("not real websites", () => {
  it("treats licence look-ups, directories and government pages as no website", () => {
    expect(websiteDomain("https://www.myfloridalicense.com/LicenseDetail.asp?id=1")).toBeNull();
    expect(websiteDomain("https://plumbersnearyou.com/fl/ace")).toBeNull();
    expect(websiteDomain("https://www.orangecountyfl.gov/x")).toBeNull();
    expect(websiteDomain("https://www.joesplumbing.com")).toBe("joesplumbing.com");
  });
});

describe("chains and franchises", () => {
  it("spots well-known brands at the start of the name", () => {
    expect(looksLikeChain("Roto-Rooter Plumbing & Water Cleanup")).toBe(true);
    expect(looksLikeChain("Mr. Rooter Plumbing of Orlando")).toBe(true);
    expect(looksLikeChain("ServPro of Winter Park")).toBe(true);
    expect(looksLikeChain("The Home Depot")).toBe(true);
  });
  it("leaves local businesses alone", () => {
    expect(looksLikeChain("Joe's Rooter Service")).toBe(false);
    expect(looksLikeChain("Orkinson Roofing")).toBe(false); // not "Orkin"
    expect(looksLikeChain("Target Pest Control")).toBe(false); // a local name, not the store
    expect(looksLikeChain("Carrier Air Conditioning Dealer")).toBe(false); // independent dealers are prospects
    expect(looksLikeChain("")).toBe(false);
  });
});

describe("website check results", () => {
  it("keeps only well-formed findings", () => {
    expect(sanitizeFindings(null)).toBeNull();
    expect(sanitizeFindings({ id: "bad id; drop table" })).toBeNull();
    const f = sanitizeFindings({
      id: "abc-123", reachable: true, https: true, builder: "WordPress", hasBooking: 1, copyrightYear: 1850,
      emails: ["Info@Joes.com", "not an email", "info@joes.com"], socials: ["https://facebook.com/joes", "javascript:alert(1)"], pagesChecked: 9,
    })!;
    expect(f.builder).toBe("wordpress");
    expect(f.hasBooking).toBe(true);
    expect(f.copyrightYear).toBeNull();
    expect(f.emails).toEqual(["info@joes.com"]);
    expect(f.socials).toEqual(["https://facebook.com/joes"]);
    expect(f.pagesChecked).toBe(1);
    expect(sanitizeFindings({ id: "x", builder: "frontpage" })!.builder).toBeNull();
  });
  it("adds social pages without repeating them", () => {
    expect(mergeSocials("https://facebook.com/joes", ["https://facebook.com/joes/", "https://instagram.com/joes"])).toBe("https://facebook.com/joes, https://instagram.com/joes");
    expect(mergeSocials(null, [])).toBeNull();
  });
});

describe("website speed", () => {
  it("reads Google's answer", () => {
    expect(parsePageSpeed({ lighthouseResult: { categories: { performance: { score: 0.43 } }, audits: { "largest-contentful-paint": { numericValue: 5321.4 } } } }))
      .toEqual({ score: 43, lcpMs: 5321, error: null });
    expect(parsePageSpeed({ lighthouseResult: { runtimeError: { message: "DNS failure" } } }).error).toBe("DNS failure");
    expect(parsePageSpeed(null).score).toBeNull();
  });
  it("asks for only the numbers it needs", () => {
    const u = new URL(pageSpeedUrl("https://joes.com", "k"));
    expect(u.searchParams.get("strategy")).toBe("mobile");
    expect(u.searchParams.get("fields")).toContain("performance/score");
  });
});

describe("filters: scores, chains, website check", () => {
  const where = (qs: string) => buildWhere(parseFilters(new URLSearchParams(qs))).sql;
  it("builds the conditions", () => {
    expect(where("score=weak&score=none")).toContain("(l.presence_score BETWEEN 0 AND 39 OR l.presence_score IS NULL)");
    expect(where("chain=hide")).toContain("COALESCE(l.is_chain, 0) = 0");
    expect(where("chain=only")).toContain("l.is_chain = 1");
    expect(where("site_check=broken")).toContain("a.reachable = 0");
    expect(where("site_check=not_checked")).toContain("NOT EXISTS (SELECT 1 FROM website_audits");
    expect(where("site_problem=no_booking&site_problem=no_tracking")).toContain("(a.has_booking = 0) AND (a.has_meta_pixel = 0 AND a.has_google_tag = 0)");
    expect(where("builder=wix&builder=hacker")).toContain("builder IN ('wix')");
    expect(where("email=yes")).toContain("EXISTS (SELECT 1 FROM lead_emails");
    expect(where("site_problem=drop_tables&score=best")).toBe("");
  });
});

describe("CSV audit columns", () => {
  const base = {
    id: "1", business_name: "Joe's", industry: "Home Services", cid: null, gbp_category: "Plumber", lead_category: null, sub_category: null,
    gbp_phone_raw: null, gbp_phone_formatted: null, phone_type: null, website: "https://joes.com", website_domain: "joes.com", owner_name: null,
    gbp_url: null, gbp_rank: null, rating: null, review_count: null, address: null, city: null, state: null, country: "USA", socials: null,
    logo_url: null, lead_source: null, source_code: null, lead_status: null, lead_date: null, lead_datetime: null,
  };
  it("fills them from the scores", () => {
    const row = leadToCsvRow({ ...base, website_score: 45, gbp_score: null, presence_score: 45,
      score_notes: JSON.stringify({ websiteRanking: "Basic", websiteComment: "WordPress site: no booking.", gbpComment: "", suggestions: ["Add online booking", "Add a contact form"] }) }, [], []);
    expect(row.slice(9, 16)).toEqual(["Basic", "WordPress site: no booking.", "45", "", "", "45", "Add online booking; Add a contact form"]);
  });
  it("still says No Website before scoring", () => {
    expect(leadToCsvRow({ ...base, website: null, website_domain: null }, [], []).slice(9, 12)).toEqual(["No Website", "", "0"]);
  });
});
