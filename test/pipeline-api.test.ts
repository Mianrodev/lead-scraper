import { describe, expect, it } from "vitest";
import { parseCsv, rowsFromCsv } from "../src/upload";
import { apiAllowed, checkWebhookUrl, signBody } from "../src/api-keys";
import { sanitizeRegistry } from "../src/registry";
import { sanitizeFindings } from "../src/website-audit";
import { suggestions, websiteScore, type ScoreInput } from "../src/scoring";
import { buildWhere, parseFilters } from "../src/leads";

describe("upload a list", () => {
  it("reads CSV with quotes, commas and new lines inside cells", () => {
    expect(parseCsv('Name,City\n"Joe\'s Plumbing, LLC","Orlando"\r\n"Multi\nline",Tampa\n')).toEqual([["Name", "City"], ["Joe's Plumbing, LLC", "Orlando"], ["Multi\nline", "Tampa"]]);
  });
  it("finds the columns by their usual names", () => {
    const r = rowsFromCsv("Company,Website URL,Phone Number,E-mail,City,State,Zip Code\nJoe's Plumbing,joes.com,407-555-1234,Info@Joes.com,Orlando,FL,32801\n,x.com,,,,,\n");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: "Joe's Plumbing", website: "joes.com", phone: "407-555-1234", email: "info@joes.com", city: "Orlando", state: "FL", zip: "32801" });
    expect(r.skipped).toBe(1);
    expect(r.columns.name).toBe("Company");
  });
  it("needs a business name column", () => {
    expect(() => rowsFromCsv("Website,City\njoes.com,Orlando\n")).toThrow(/business name/);
  });
});

describe("API keys", () => {
  it("only opens the listed routes, and collecting only with permission", () => {
    expect(apiAllowed("GET", "/api/leads", false)).toBe(true);
    expect(apiAllowed("GET", "/api/export", false)).toBe(true);
    expect(apiAllowed("GET", "/api/searches/abc-123", false)).toBe(true);
    expect(apiAllowed("POST", "/api/find", false)).toBe(false);
    expect(apiAllowed("POST", "/api/find", true)).toBe(true);
    expect(apiAllowed("GET", "/api/admin/users", true)).toBe(false);
    expect(apiAllowed("DELETE", "/api/saved-searches/x", true)).toBe(false);
    expect(apiAllowed("PUT", "/api/websites/settings", true)).toBe(false);
  });
});

describe("webhooks", () => {
  it("only sends to public https addresses", () => {
    expect(checkWebhookUrl("https://hooks.zapier.com/abc")).toBe("https://hooks.zapier.com/abc");
    expect(() => checkWebhookUrl("http://hooks.zapier.com/abc")).toThrow();
    expect(() => checkWebhookUrl("https://localhost/x")).toThrow();
    expect(() => checkWebhookUrl("https://192.168.1.4/x")).toThrow();
  });
  it("signs the body with the secret (HMAC SHA-256)", async () => {
    // Known answer: HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    expect(await signBody("key", "The quick brown fox jumps over the lazy dog")).toBe("sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
});

describe("state registry results", () => {
  it("keeps a plausible owner and the registry match", () => {
    expect(sanitizeRegistry({ id: "a1", ownerName: "Selma Pinto De Oliveira", ownerTitle: "Manager", registryName: "SELMA'S CLEANING SERVICES LLC", registryId: "FL:L21000012345" }))
      .toEqual({ id: "a1", ownerName: "Selma Pinto De Oliveira", ownerTitle: "Manager", registryName: "SELMA'S CLEANING SERVICES LLC", registryId: "FL:L21000012345" });
    expect(sanitizeRegistry({ id: "a1", ownerName: "<b>x</b>" })!.ownerName).toBeNull();
    expect(sanitizeRegistry({ id: "bad id" })).toBeNull();
  });
});

import { tidyOwnerTitle } from "../src/registry";
describe("owner titles", () => {
  it("turns registry codes into plain titles", () => {
    const cases: Record<string, string | null> = {
      President: "President", Pd: "President", Ptd: "President", "P, D": "President", "D/P": "President", Dpst: "President", Pceo: "CEO",
      Mana: "Manager", "Mgr,": "Manager", Mgrm: "Managing Member", Ambr: "Member", Memb: "Member", Owne: "Owner", O: "Owner", Auth: "Authorized Person",
      Ar: "Authorized Person", Dire: "Director", D: "Director", "Vp,": "Vice President", Vd: "Vice President", Secr: "Secretary", Trea: "Treasurer",
      Coo: "COO", "Cfo/": "CFO", Prin: "Principal", "Registered agent": "Registered agent", "": null,
    };
    for (const [raw, want] of Object.entries(cases)) expect([raw, tidyOwnerTitle(raw)]).toEqual([raw, want]);
  });
});

describe("email and domain setup", () => {
  it("keeps the email host and dates", () => {
    const f = sanitizeFindings({ id: "a1", emailProvider: "Google Workspace", domainCreated: "2012-03-04", sslExpires: "nope" })!;
    expect(f.emailProvider).toBe("Google Workspace");
    expect(f.domainCreated).toBe("2012-03-04");
    expect(f.sslExpires).toBeNull();
  });
  it("suggests fixing a missing business email and an expiring certificate", () => {
    const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const i: ScoreInput = { dataSource: "free", isClaimed: null, website: "https://a.com", websiteDomain: "a.com", phone: null, rating: null, reviewCount: null,
      photosCount: null, hasHours: false, hasDescription: false, attributesCount: 0, year: 2026,
      audit: { reachable: 1, https: 1, social_only: 0, builder: "wordpress", has_meta_pixel: 1, has_google_tag: 1, has_booking: 1, has_contact_form: 1,
        has_chat_widget: 1, mobile_viewport: 1, copyright_year: 2026, psi_score: null, email_provider: "No email on this domain", ssl_expires: soon } };
    const s = suggestions(i, null, websiteScore(i));
    expect(s[0]).toBe(`Renew the security certificate (runs out ${soon}; browsers will then warn visitors)`);
    expect(s).toContain("Set up email on their own domain (they have none)");
  });
});

import { filtersToParams, type AiFilters } from "../src/ai-search";
import { canText } from "../src/export";
describe("plain-English search", () => {
  const none: AiFilters = {
    categories: [], states: [], cities: [], near: null, website: "any", phone: "any", phoneTypes: [], email: "any", owner: "any", chain: "any",
    minRating: null, maxRating: null, minReviews: null, maxReviews: null, scoreBands: [], siteChecks: [], siteProblems: [], ads: [], builders: [],
    addedWithinDays: null, nameContains: null, summary: "", notUnderstood: null,
  };
  it("turns the AI's answer into the page's filters", () => {
    const { params, dropped } = filtersToParams({
      ...none, categories: ["roofing contractor", "Space Elevator Repair"], cities: [{ city: "Tampa", state: "fl" }], website: "no_real", maxReviews: 19,
      siteProblems: ["no_booking", "made_up"], addedWithinDays: 7, chain: "hide",
    }, ["Roofing contractor", "Plumber"], new Date("2026-09-29T12:00:00Z"));
    expect(params).toEqual({ category: ["Roofing contractor"], city: ["Tampa|FL"], website: "no_real", chain: "hide", max_reviews: "19", site_problem: ["no_booking"], added_from: "2026-09-22" });
    expect(dropped).toEqual(["Space Elevator Repair"]);
  });
  it("snaps a distance to the choices the page has", () => {
    expect(filtersToParams({ ...none, near: { city: "Orlando", state: "FL", miles: 30 } }, []).params).toEqual({ near: "Orlando|FL", radius_miles: "25" });
    expect(filtersToParams({ ...none, minRating: 9, minReviews: -1 }, []).params).toEqual({});
  });
});

describe("text-ready phones", () => {
  it("says which numbers can take a text", () => {
    expect(canText("mobile", "+14075551234")).toBe("yes");
    expect(canText("voip", "+14075551234")).toBe("maybe");
    expect(canText("landline", "+14075551234")).toBe("no");
    expect(canText(null, "+14075551234")).toBe("not checked");
    expect(canText("mobile", "")).toBe("");
  });
});

describe("assigned filter", () => {
  it("filters by person or nobody", () => {
    const w = buildWhere(parseFilters(new URLSearchParams("assigned=u1&assigned=none"))).sql;
    expect(w).toContain("l.assigned_to IN ('u1') OR l.assigned_to IS NULL");
  });
});
