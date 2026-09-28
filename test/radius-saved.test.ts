import { describe, expect, it } from "vitest";
import { buildActorInput } from "../src/apify";
import { countKey, countTask } from "../src/count";
import { cleanRequest, describeRequest, matchCondition } from "../src/saved-searches";
import type { ResolvedPlace } from "../src/find";

describe("distance search", () => {
  it("asks Google Maps for a circle instead of the city name", () => {
    const input = buildActorInput("compass~crawler-google-places", {
      category: "Plumber", location: "Orlando, FL, USA", maxResults: 100, circle: { lat: 28.5383, lng: -81.3792, radiusKm: 40.2 },
    });
    expect(input.customGeolocation).toEqual({ type: "Point", coordinates: ["-81.3792", "28.5383"], radiusKm: 40.2 });
    expect(input.locationQuery).toBeUndefined();
    expect(buildActorInput("compass~crawler-google-places", { category: "Plumber", location: "Orlando, FL, USA", maxResults: 100 }).locationQuery).toBe("Orlando, FL, USA");
  });
  it("counts the circle, and keeps its count separate from the plain city", () => {
    const circle = { category: "Plumber", country: "US", lat: 28.5383, lng: -81.3792, radiusKm: 40.2 };
    const task = countTask(circle)[0] as Record<string, unknown>;
    expect(task.location_coordinate).toBe("28.53830,-81.37920,40.2");
    expect(JSON.stringify(task.filters)).not.toContain("address_info.city");
    expect(countKey(circle)).not.toBe(countKey({ category: "Plumber", country: "US", city: "Orlando", region: "Florida" }));
  });
});

describe("saved searches", () => {
  it("describes a search in plain words", () => {
    expect(describeRequest({ categories: ["Plumber", "Roofing contractor"], locations: [{ country: "US", region: "FL", city: "Orlando" }], source: "free" }))
      .toBe("Plumber, Roofing contractor in Orlando, FL (free data)");
    expect(describeRequest({ categories: ["A", "B", "C", "D"], locations: [{ region: "FL" }, { region: "GA" }, { region: "TX" }], radiusMiles: 25, source: "google" }))
      .toBe("A, B and 2 more types in FL; GA and 1 more places (within 25 mi) (Google Maps)");
  });
  it("keeps only what it needs and refuses empty searches", () => {
    expect(() => cleanRequest({ categories: [], locations: [{ region: "FL" }] })).toThrow();
    const r = cleanRequest({ categories: ["Plumber"], locations: [{ state: "FL" }], mode: "pull_missing", createdBy: "x" });
    expect(r.locations[0].region).toBe("FL");
    expect("mode" in r).toBe(false);
  });
  it("matches businesses by type and place", () => {
    const city: ResolvedPlace = { countryCode: "US", countryName: "United States", state: "FL", regionName: "Florida", city: "Orlando", label: "" };
    const sql = matchCondition(["Plumber", "O'Neil's type"], [city, { ...city, city: "" }, { ...city, city: "Tampa", radiusMiles: 10, lat: 27.95, lng: -82.46 }]);
    expect(sql).toContain("l.gbp_category IN ('Plumber', 'O''Neil''s type')");
    expect(sql).toContain("l.city = 'Orlando' COLLATE NOCASE AND COALESCE(l.state, '') = 'FL'");
    expect(sql).toContain("l.state = 'FL'");
    expect(sql).toContain("<= 100");
  });
});
