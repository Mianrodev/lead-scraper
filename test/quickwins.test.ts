import { describe, expect, it } from "vitest";
import { bestFirst, emailKind, firstNameFrom } from "../src/emails";
import { gbpScore, suggestions, websiteScore, type ScoreInput } from "../src/scoring";
import { COLD_EMAIL_COLUMNS, SIMPLE_COLUMNS, exportFormat, rowFor } from "../src/export";

describe("email types", () => {
  it("tells a person's email from a shared inbox and free mail", () => {
    expect(emailKind("mike@joesplumbing.com")).toBe("personal");
    expect(emailKind("mike.smith@joesplumbing.com")).toBe("personal");
    expect(emailKind("info@joesplumbing.com")).toBe("role");
    expect(emailKind("service2@joesplumbing.com")).toBe("role");
    expect(emailKind("info.orlando@joesplumbing.com")).toBe("role");
    expect(emailKind("joesplumbing@joesplumbing.com")).toBe("role");
    expect(emailKind("joesplumbing@gmail.com")).toBe("freemail");
  });
  it("puts the best email first and finds a first name", () => {
    expect(bestFirst(["info@a.com", "joe@gmail.com", "mike@a.com"])).toEqual(["mike@a.com", "info@a.com", "joe@gmail.com"]);
    expect(firstNameFrom("mike.smith@joes.com")).toBe("Mike");
    expect(firstNameFrom("info@joes.com")).toBe("");
    expect(firstNameFrom("jd@joes.com")).toBe("");
  });
});

describe("review gap", () => {
  const base: ScoreInput = {
    dataSource: "google", isClaimed: 1, website: "https://a.com", websiteDomain: "a.com", phone: "+1", rating: 4.6, reviewCount: 14,
    photosCount: 20, hasHours: true, hasDescription: true, attributesCount: 5, audit: null, year: 2026,
  };
  it("suggests closing the gap to the local leader", () => {
    const i = { ...base, topCompetitor: { name: "Ace Plumbing", reviews: 312 } };
    expect(suggestions(i, gbpScore(i), websiteScore(i))[0]).toBe("Close the review gap: Ace Plumbing nearby has 312 reviews, this business 14");
  });
  it("stays quiet when the business is close to the leader", () => {
    const i = { ...base, reviewCount: 250, topCompetitor: { name: "Ace Plumbing", reviews: 312 } };
    expect(suggestions(i, gbpScore(i), websiteScore(i)).join(" ")).not.toContain("review gap");
  });
});

import { sanitizeFindings } from "../src/website-audit";
describe("owner and advertising signs", () => {
  it("keeps a plausible owner name and the ad signs", () => {
    const f = sanitizeFindings({ id: "a1", ownerName: "Curtis Likar", ownerTitle: "Owner", hasGoogleAds: true, callTrackingTool: "CallRail" })!;
    expect(f.ownerName).toBe("Curtis Likar");
    expect(f.hasGoogleAds).toBe(true);
    expect(f.callTrackingTool).toBe("CallRail");
    expect(sanitizeFindings({ id: "a1", ownerName: "<script>x</script>" })!.ownerName).toBeNull();
  });
  it("says so when a site pays for ads but can't take a booking", () => {
    const i: ScoreInput = { dataSource: "free", isClaimed: null, website: "https://a.com", websiteDomain: "a.com", phone: null, rating: null, reviewCount: null,
      photosCount: null, hasHours: false, hasDescription: false, attributesCount: 0, year: 2026,
      audit: { reachable: 1, https: 1, social_only: 0, builder: "wordpress", has_meta_pixel: 0, has_google_tag: 1, has_booking: 0, has_contact_form: 0,
        has_chat_widget: 0, mobile_viewport: 1, copyright_year: 2026, psi_score: null, has_google_ads: 1 } };
    expect(suggestions(i, null, websiteScore(i))[0]).toBe("They pay for ads, but visitors can't book or send a request online");
  });
  it("calls a parked domain what it is", () => {
    const i: ScoreInput = { dataSource: "free", isClaimed: null, website: "https://a.com", websiteDomain: "a.com", phone: null, rating: null, reviewCount: null,
      photosCount: null, hasHours: false, hasDescription: false, attributesCount: 0,
      audit: { reachable: 0, https: 0, social_only: 0, builder: null, has_meta_pixel: 0, has_google_tag: 0, has_booking: 0, has_contact_form: 0,
        has_chat_widget: 0, mobile_viewport: 0, copyright_year: null, psi_score: null, error: "the domain is parked or for sale (no real website)" } };
    expect(websiteScore(i).comment).toBe("Domain is parked or for sale (no real website)");
    expect(suggestions(i, null, websiteScore(i))[0]).toBe("Build a new website: their domain is parked or for sale");
  });
});

describe("download formats", () => {
  const lead = {
    id: "1", business_name: "Joe's Plumbing", industry: "Home Services", cid: null, gbp_category: "Plumber", lead_category: null, sub_category: null,
    gbp_phone_raw: null, gbp_phone_formatted: "+14075551234", phone_type: "mobile", website: "https://joes.com", website_domain: "joes.com", owner_name: null,
    gbp_url: null, gbp_rank: null, rating: 4.2, review_count: 9, address: "1 Main St", city: "Orlando", state: "FL", country: "USA", socials: null,
    logo_url: null, lead_source: null, source_code: null, lead_status: null, lead_date: null, lead_datetime: null,
    presence_score: 35, is_chain: 0, score_notes: JSON.stringify({ websiteComment: "WordPress site: no booking.", suggestions: ["Add online booking", "Add a contact form"] }),
  };
  it("defaults to the GHL sheet", () => expect(exportFormat(null)).toBe("ghl"));
  it("cold email: best email, first name, what to mention", () => {
    const row = rowFor("cold_email", lead, ["mike@joes.com", "info@joes.com"], [])!;
    expect(row.length).toBe(COLD_EMAIL_COLUMNS.length);
    expect(row.slice(0, 3)).toEqual(["mike@joes.com", "Mike", "Joe's Plumbing"]);
    expect(row[5]).toBe("yes"); // mobile: can text
    expect(row[11]).toBe("Add online booking");
    expect(row[13]).toBe("person");
    expect(rowFor("cold_email", lead, [], [])).toBeNull(); // no email, no row
  });
  it("simple: the essentials", () => {
    const row = rowFor("simple", lead, ["info@joes.com"], [])!;
    expect(row.length).toBe(SIMPLE_COLUMNS.length);
    expect(row[0]).toBe("Joe's Plumbing");
    expect(row[4]).toBe("mobile");
    expect(row[5]).toBe("yes");
    expect(row[13]).toBe("35");
  });
  it("cold email uses the owner's first name when the website gives it", () => {
    expect(rowFor("cold_email", { ...lead, owner_name: "Curtis Likar" }, ["info@joes.com"], [])![1]).toBe("Curtis");
  });
});
