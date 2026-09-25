import { describe, expect, it } from "vitest";
import { findLeads, MAX_COMBINATIONS } from "../src/find";
import { stateName, US_STATES } from "../src/format";
import { searchKey } from "../src/pipeline";

describe("searchKey", () => {
  it.each([
    ["Plumbers", "plumber"],
    [" plumber ", "plumber"],
    ["HVAC  contractors", "hvac contractor"],
    ["Dentist", "dentist"],
    ["Auto glass", "auto glass"],
    ["Bus", "bus"],
  ])("%s -> %s", (input, expected) => {
    expect(searchKey(input)).toBe(expected);
  });
});

describe("US states", () => {
  it("lists 50 states plus DC and Puerto Rico, with names", () => {
    expect(US_STATES).toHaveLength(52);
    expect(stateName("fl")).toBe("Florida");
    expect(stateName("DC")).toBe("District of Columbia");
  });
});

// Validation runs before any database access, so a stub env is enough here.
const env = { MAX_RESULTS_DEFAULT: "500" } as unknown as Env;

describe("findLeads validation", () => {
  it("needs categories and places", async () => {
    await expect(findLeads(env, { categories: [], locations: [{ state: "FL" }] })).rejects.toThrow("type of business");
    await expect(findLeads(env, { categories: ["Plumber"], locations: [] })).rejects.toThrow("state or city");
    await expect(findLeads(env, { categories: ["Plumber"], locations: [{ state: "Narnia" }] })).rejects.toThrow("state or city");
  });

  it("caps the number of combinations", async () => {
    const categories = Array.from({ length: 6 }, (_, i) => `Cat ${i}`);
    const locations = Array.from({ length: 5 }, (_, i) => ({ city: `City ${i}`, state: "FL" }));
    expect(categories.length * locations.length).toBeGreaterThan(MAX_COMBINATIONS);
    await expect(findLeads(env, { categories, locations })).rejects.toThrow("limit is 25");
  });
});
