import { describe, expect, it } from "vitest";
import { countKey, countTask, dfsCategoryId } from "../src/count";
import { CSV_COLUMNS, csvCell, leadToCsvRow, sheetPhone } from "../src/export";
import { findLeads, MAX_COMBINATIONS } from "../src/find";
import { stateName, US_STATES } from "../src/format";
import { resolveMaxResults, searchKey } from "../src/pipeline";

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
    await expect(findLeads(env, { categories: [], locations: [{ country: "US", region: "FL" }] })).rejects.toThrow("type of business");
    await expect(findLeads(env, { categories: ["Plumber"], locations: [] })).rejects.toThrow("country, state or city");
  });

  it("caps the number of combinations", async () => {
    const categories = Array.from({ length: 11 }, (_, i) => `Cat ${i}`);
    const locations = Array.from({ length: 10 }, (_, i) => ({ country: "US", region: "FL", city: `City ${i}` }));
    expect(categories.length * locations.length).toBeGreaterThan(MAX_COMBINATIONS);
    await expect(findLeads(env, { categories, locations })).rejects.toThrow(`limit is ${MAX_COMBINATIONS}`);
  });
});

describe("resolveMaxResults", () => {
  it("allows no limit (0) and big numbers only with allowLarge", () => {
    expect(resolveMaxResults(env, 0, true)).toBe(0);
    expect(resolveMaxResults(env, 40000, true)).toBe(40000);
    expect(() => resolveMaxResults(env, 0, false)).toThrow("allowLarge");
    expect(() => resolveMaxResults(env, 501, false)).toThrow("allowLarge");
    expect(resolveMaxResults(env, 10, false)).toBe(10);
    expect(() => resolveMaxResults(env, -1, true)).toThrow();
  });
});

describe("DataForSEO counts", () => {
  it.each([
    ["Plumber", "plumber"],
    ["Insurance broker", "insurance_broker"],
    ["Handyman/Handywoman/Handyperson", "handyman_handywoman_handyperson"],
    ["Bed & breakfast", "bed_and_breakfast"],
  ])("category id %s -> %s", (name, id) => {
    expect(dfsCategoryId(name)).toBe(id);
  });

  it("builds a count task with country, region, city, website and verified filters", () => {
    expect(countTask({ category: "Plumber", country: "us", region: "Florida", city: "Orlando", website: "no", verifiedOnly: true })).toEqual([
      {
        categories: ["plumber"],
        filters: [
          ["address_info.country_code", "=", "US"], "and",
          ["address_info.region", "=", "Florida"], "and",
          ["address_info.city", "=", "Orlando"], "and",
          ["url", "=", null],
        ],
        is_claimed: true,
        limit: 1,
      },
    ]);
  });

  it("caches the same question under the same key", () => {
    expect(countKey({ category: "Plumbers ", country: "US" })).not.toBe(countKey({ category: "Plumber", country: "IN" }));
    expect(countKey({ category: "Insurance broker", country: "US", website: "no" })).toBe(
      countKey({ category: "insurance BROKER", country: "us", website: "no" }),
    );
  });
});

describe("CSV export", () => {
  it("has the 42 GHL columns in order", () => {
    expect(CSV_COLUMNS).toHaveLength(42);
    expect(CSV_COLUMNS[0]).toBe("Business Name");
    expect(CSV_COLUMNS[41]).toBe("Lead Date & Time");
  });

  it("formats phones like the sheet (1407-605-3803)", () => {
    expect(sheetPhone("+14076053803", null)).toBe("1407-605-3803");
    expect(sheetPhone(null, "(407) 605-3803")).toBe("407605380" + "3");
    expect(sheetPhone("+919820012345", null)).toBe("919820012345");
    expect(sheetPhone(null, null)).toBe("");
  });

  it("quotes cells with commas, quotes and newlines", () => {
    expect(csvCell("Smith, Jones & Co")).toBe('"Smith, Jones & Co"');
    expect(csvCell('The "Best"')).toBe('"The ""Best"""');
    expect(csvCell(null)).toBe("");
  });

  it("maps a lead onto the row, duplicating name/phone/email as the sheet does and leaving Owner blank", () => {
    const row = leadToCsvRow(
      {
        id: "1", business_name: "Acme Plumbing – Orlando", gbp_category: "Plumber", lead_category: null, sub_category: "Drainage service",
        gbp_phone_raw: "(407) 605-3803", gbp_phone_formatted: "+14076053803", phone_type: "mobile", website: "https://acme.test",
        owner_name: null, gbp_url: "https://maps.google.com/?cid=1", gbp_rank: 3, rating: 4.8, review_count: 120,
        address: "1 Main St, Orlando, FL 32801", city: "Orlando", state: "FL", country: "USA", socials: null, logo_url: null,
        lead_source: null, source_code: "ILS", lead_status: null, lead_date: "9/25/2026", lead_datetime: "9/25/2026 3:30 PM",
      },
      ["info@acme.test", "sales@acme.test"],
      [],
    );
    expect(row).toHaveLength(42);
    const col = (name: (typeof CSV_COLUMNS)[number]) => row[CSV_COLUMNS.indexOf(name)];
    expect(col("Business Name")).toBe("Acme Plumbing – Orlando");
    expect(col("Business Name (Lead Name)")).toBe("Acme Plumbing – Orlando");
    expect(col("GBP Phone")).toBe("1407-605-3803");
    expect(col("GBP Phone (Phone)")).toBe("1407-605-3803");
    expect(col("Phone Type")).toBe("mobile");
    expect(col("Mobile 1")).toBe("1407-605-3803");
    expect(col("Owner")).toBe("");
    expect(col("Email")).toBe("info@acme.test");
    expect(col("Email 1")).toBe("info@acme.test");
    expect(col("Email 2")).toBe("sales@acme.test");
    expect(col("Lead Category")).toBe("Plumber");
    expect(col("Lead Source")).toBe("Google");
    expect(col("Lead Status")).toBe("Untouched");
  });
});
