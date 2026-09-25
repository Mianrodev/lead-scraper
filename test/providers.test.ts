import { describe, expect, it } from "vitest";
import type { NormalizedPlace } from "../src/normalize";
import { abstractLineType, abstractPhoneRequest } from "../src/providers/abstract-phone";
import { compareSources, mapsKey } from "../src/providers/compare";
import { dataforseoItemToPlace, dataforseoMaxCost, dataforseoTaskBody } from "../src/providers/dataforseo-listings";

describe("abstractLineType", () => {
  it.each([
    [{ phone_carrier: { line_type: "mobile" }, phone_validation: { is_valid: true } }, "mobile"],
    [{ phone_carrier: { line_type: "landline" }, phone_validation: { is_valid: true } }, "landline"],
    [{ phone_carrier: { line_type: "voip" } }, "voip"],
    [{ phone_carrier: { line_type: "unknown" }, phone_validation: { is_voip: true } }, "voip"],
    [{ phone_carrier: { line_type: "toll_free" } }, "unknown"],
    [{ phone_carrier: { line_type: "mobile" }, phone_validation: { is_valid: false } }, "unknown"],
    [{}, "unknown"],
  ])("%j -> %s", (body, expected) => {
    expect(abstractLineType(body)).toBe(expected);
  });

  it("never guesses mobile from the number when the provider gives no carrier data", () => {
    expect(abstractLineType({ phone_carrier: null, phone_validation: { is_valid: true } })).toBe("unknown");
  });

  it("keeps the API key out of the URL", () => {
    const { url, init } = abstractPhoneRequest("+14075550101", "secret-key");
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
  });
});

describe("DataForSEO adapter", () => {
  it("builds a claimed-only task body", () => {
    const body = dataforseoTaskBody({
      category: "plumber",
      city: "Orlando",
      state: "FL",
      latitude: 28.5383355,
      longitude: -81.3792365,
      radiusKm: 15,
      limit: 50,
      claimedOnly: true,
    });
    expect(body).toEqual([
      {
        categories: ["plumber"],
        location_coordinate: "28.5383355,-81.3792365,15",
        is_claimed: true,
        order_by: ["rating.votes_count,desc"],
        limit: 50,
      },
    ]);
  });

  it("estimates the max cost of one task", () => {
    expect(dataforseoMaxCost(50)).toBeCloseTo(0.03, 5);
  });

  it("maps an item onto the Apify record shape", () => {
    const place = dataforseoItemToPlace(
      {
        title: "Example Plumbing",
        place_id: "ChIJabc",
        cid: "123",
        phone: "+1 407-555-0101",
        domain: "example.test",
        category: "Plumber",
        additional_categories: ["Drainage service"],
        address_info: { city: "Orlando", region: "Florida", zip: "32801", country_code: "US" },
        rating: { value: 4.7, votes_count: 88 },
        is_claimed: true,
      },
      3,
    )!;
    expect(place).toMatchObject({
      google_place_id: "ChIJabc",
      cid: "123",
      gbp_phone_formatted: "+14075550101",
      website: "https://example.test",
      gbp_url: "https://maps.google.com/?cid=123",
      sub_category: "Drainage service",
      rating: 4.7,
      review_count: 88,
      state: "FL",
      country: "USA",
      is_claimed: 1,
      gbp_rank: 3,
    });
  });

  it("skips items without a place id", () => {
    expect(dataforseoItemToPlace({ title: "x" }, 1)).toBeNull();
  });
});

function place(overrides: Partial<NormalizedPlace>): NormalizedPlace {
  return {
    google_place_id: "p",
    cid: null,
    business_name: null,
    gbp_category: null,
    sub_category: null,
    gbp_phone_raw: null,
    gbp_phone_formatted: null,
    phone_type: null,
    website: null,
    gbp_url: null,
    gbp_rank: null,
    rating: null,
    review_count: null,
    address: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    latitude: null,
    longitude: null,
    is_claimed: null,
    permanently_closed: 0,
    temporarily_closed: 0,
    business_status: "operational",
    website_domain: null,
    has_street_address: 1,
    industry: null,
    price_level: null,
    photos_count: null,
    attributes: [],
    logo_url: null,
    ...overrides,
  };
}

describe("compareSources", () => {
  it("matches on place id, then on Maps URL / CID", () => {
    const a = [
      place({ google_place_id: "A1", is_claimed: 1, gbp_phone_formatted: "+1" }),
      place({ google_place_id: "A2", cid: "999", is_claimed: 1 }),
      place({ google_place_id: "A3", is_claimed: 0 }),
      place({ google_place_id: "A1" }), // duplicate
    ];
    const b = [
      place({ google_place_id: "A1", is_claimed: 1 }),
      place({ google_place_id: "B2", gbp_url: "https://maps.google.com/?cid=999", is_claimed: 1 }),
      place({ google_place_id: "B3", is_claimed: 1, gbp_phone_formatted: "+2" }),
    ];
    const c = compareSources("A", a, "B", b);
    expect(c.a.total).toBe(3);
    expect(c.matchedByPlaceId).toBe(1);
    expect(c.matchedByMapsUrl).toBe(1);
    expect(c.overlap).toBe(2);
    expect(c.onlyInA.map((p) => p.google_place_id)).toEqual(["A3"]);
    expect(c.onlyInB.map((p) => p.google_place_id)).toEqual(["B3"]);
    expect(c.a).toMatchObject({ claimed: 2, unclaimed: 1, withPhone: 1 });
    expect(c.b).toMatchObject({ claimed: 3, withPhone: 1 });
    expect(c.samePhoneDifferentId).toEqual([]);
  });

  it("flags unmatched records that share a phone number", () => {
    const c = compareSources(
      "A",
      [place({ google_place_id: "OLD", gbp_phone_formatted: "+18774164727" })],
      "B",
      [place({ google_place_id: "NEW", gbp_phone_formatted: "+18774164727" })],
    );
    expect(c.overlap).toBe(0);
    expect(c.samePhoneDifferentId.map((x) => [x.a.google_place_id, x.b.google_place_id])).toEqual([["OLD", "NEW"]]);
  });

  it("reads a key from an Apify-style Maps URL", () => {
    expect(mapsKey(place({ gbp_url: "https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJxyz" }))).toBe(
      "pid:ChIJxyz",
    );
  });
});
