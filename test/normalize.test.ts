import { describe, expect, it } from "vitest";
import { cityStateFromAddress, formatLeadDate, formatLeadDateTime, parseCityState, stateCode } from "../src/format";
import { claimedFlag, normalizePlace, toE164 } from "../src/normalize";
import { isTollFree, telnyxResultToLineType } from "../src/phone";

describe("toE164", () => {
  it.each([
    ["(407) 605-3803", "+14076053803"],
    ["1407-605-3803", "+14076053803"],
    ["+1 407 605 3803", "+14076053803"],
    ["605-3803", null],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });
});

describe("isTollFree", () => {
  it.each([
    ["+18774164727", true],
    ["+18005551234", true],
    ["+14075550101", false],
    [null, false],
  ])("%s -> %s", (input, expected) => {
    expect(isTollFree(input)).toBe(expected);
  });
  it("tags toll-free numbers during normalisation", () => {
    expect(normalizePlace({ placeId: "a", phone: "(877) 416-4727" })!.phone_type).toBe("toll_free");
    expect(normalizePlace({ placeId: "b", phone: "(407) 555-0101" })!.phone_type).toBeNull();
  });
});

describe("telnyxResultToLineType", () => {
  it("prefers portability (current carrier) over the original number block", () => {
    const r = telnyxResultToLineType({
      data: { carrier: { type: "fixed line", name: "Old Telco" }, portability: { line_type: "Wireless", spid_carrier_name: "T-Mobile" } },
    });
    expect(r).toEqual({ type: "mobile", carrier: "T-Mobile" });
  });
  it.each([
    ["voip", "voip"],
    ["fixed line", "landline"],
    ["mobile", "mobile"],
    ["toll free", "toll_free"],
    ["fixed line or mobile", "unknown"],
  ])("carrier.type %s -> %s", (carrierType, expected) => {
    expect(telnyxResultToLineType({ data: { carrier: { type: carrierType } } }).type).toBe(expected);
  });
  it("uses the normalized carrier name when present", () => {
    expect(
      telnyxResultToLineType({ data: { carrier: { type: "mobile", name: "SPID 123", normalized_carrier: "AT&T" } } }).carrier,
    ).toBe("AT&T");
  });
});

describe("claimedFlag", () => {
  it("reads compass-style claimThisBusiness (true means unclaimed)", () => {
    expect(claimedFlag({ claimThisBusiness: false })).toBe(1);
    expect(claimedFlag({ claimThisBusiness: true })).toBe(0);
  });
  it("reads positive claimed flags", () => {
    expect(claimedFlag({ isClaimed: true })).toBe(1);
    expect(claimedFlag({ verified: false })).toBe(0);
  });
  it("is null when unknown", () => {
    expect(claimedFlag({})).toBeNull();
  });
});

describe("normalizePlace", () => {
  it("returns null without a place id", () => {
    expect(normalizePlace({ title: "x" })).toBeNull();
  });
  it("maps the core fields", () => {
    const p = normalizePlace({
      title: "Acme",
      placeId: "abc",
      categoryName: "Plumber",
      categories: ["Plumber", "Drainage service"],
      phoneUnformatted: "+14075550101",
      totalScore: 4.5,
      reviewsCount: "12",
      countryCode: "US",
      location: { lat: 1, lng: 2 },
    })!;
    expect(p.google_place_id).toBe("abc");
    expect(p.business_name).toBe("Acme");
    expect(p.sub_category).toBe("Drainage service");
    expect(p.gbp_phone_formatted).toBe("+14075550101");
    expect(p.review_count).toBe(12);
    expect(p.country).toBe("USA");
    expect(p.latitude).toBe(1);
    expect(p.is_claimed).toBeNull();
  });
});

describe("date formats", () => {
  const date = new Date("2026-08-25T19:30:00Z"); // 3:30 PM EDT
  it("formats Lead Date as M/D/YYYY", () => {
    expect(formatLeadDate(date, "America/New_York")).toBe("8/25/2026");
  });
  it("formats Lead Date & Time as M/D/YYYY H:MM AM/PM", () => {
    expect(formatLeadDateTime(date, "America/New_York")).toBe("8/25/2026 3:30 PM");
  });
});

describe("stateCode", () => {
  it.each([
    ["Florida", "FL"],
    ["fl", "FL"],
    ["New York", "NY"],
    ["Ontario", "Ontario"],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(stateCode(input)).toBe(expected);
  });
});

describe("cityStateFromAddress", () => {
  it.each([
    ["1026 28th Street Ste 100, Orlando, Florida 32805", "Orlando", "FL"],
    ["2311 Henderson Dr Unit A, Orlando, FL 32806, United States", "Orlando", "FL"],
    ["9161 Narcoossee Rd #210, Orlando, FL 32827-1234", "Orlando", "FL"],
    ["Orlando", null, null],
  ])("%s", (address, city, state) => {
    expect(cityStateFromAddress(address)).toEqual({ city, state });
  });
});

describe("parseCityState", () => {
  it.each([
    ["Orlando, FL", "Orlando", "FL"],
    ["Orlando FL", "Orlando", "FL"],
    ["Winter Park, Florida", "Winter Park", "FL"],
    ["orlando, fl", "orlando", "FL"],
    ["Orlando", "Orlando", null],
  ])("%s", (input, city, state) => {
    expect(parseCityState(input)).toEqual({ city, state });
  });
});

import { safeWebsite } from "../src/normalize";

describe("safeWebsite", () => {
  it("keeps normal sites, adds https, drops other schemes", () => {
    expect(safeWebsite("https://joes.com/about")).toBe("https://joes.com/about");
    expect(safeWebsite("joes.com")).toBe("https://joes.com");
    expect(safeWebsite("javascript:alert(1)")).toBeNull();
    expect(safeWebsite("data:text/html,x")).toBeNull();
    expect(safeWebsite("not a site")).toBeNull();
    expect(safeWebsite("  ")).toBeNull();
  });
});

import { compactRaw } from "../src/normalize";

describe("compactRaw", () => {
  it("keeps the fields the app reads and drops the heavy extras", () => {
    const item = {
      placeId: "p1", title: "Joe's", phone: "(305) 555-0100", claimThisBusiness: false, additionalInfo: { a: [{ b: true }] },
      reviews: Array(50).fill({ text: "great".repeat(40) }), imageUrls: ["x", "y"], peopleAlsoSearch: [{ title: "z" }], website: "",
    };
    const kept = JSON.parse(compactRaw(item));
    expect(Object.keys(kept).sort()).toEqual(["additionalInfo", "claimThisBusiness", "phone", "placeId", "title"]);
    expect(normalizePlace(kept)?.is_claimed).toBe(normalizePlace(item)?.is_claimed);
  });
});
