import { describe, expect, it } from "vitest";
import { formatLeadDate, formatLeadDateTime, parseCityState } from "../src/format";
import { claimedFlag, normalizePlace, toE164 } from "../src/normalize";

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

describe("parseCityState", () => {
  it.each([
    ["Orlando, FL", "Orlando", "FL"],
    ["Orlando FL", "Orlando", "FL"],
    ["Winter Park, Florida", "Winter Park", "Florida"],
    ["orlando, fl", "orlando", "FL"],
    ["Orlando", "Orlando", null],
  ])("%s", (input, city, state) => {
    expect(parseCityState(input)).toEqual({ city, state });
  });
});
