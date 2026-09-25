import { describe, expect, it } from "vitest";
import { countKey, countTask, dfsCategoryId } from "../src/count";
import { CSV_COLUMNS, csvCell, leadToCsvRow, nationalPhone, sheetPhone } from "../src/export";
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

  it("counts only businesses with a phone number when asked", () => {
    const [task] = countTask({ category: "Plumber", country: "US", city: "Orlando", withPhone: true });
    expect(task.filters).toContainEqual(["phone", "<>", null]);
    expect(countKey({ category: "Plumber", country: "US", withPhone: true })).not.toBe(countKey({ category: "Plumber", country: "US" }));
  });

  it("caches the same question under the same key", () => {
    expect(countKey({ category: "Plumbers ", country: "US" })).not.toBe(countKey({ category: "Plumber", country: "IN" }));
    expect(countKey({ category: "Insurance broker", country: "US", website: "no" })).toBe(
      countKey({ category: "insurance BROKER", country: "us", website: "no" }),
    );
  });
});

describe("CSV export", () => {
  it("matches the 49 columns of the team's sales-ready sheet, in order", () => {
    // Header row of Miami_10k_Online_Presence_Audited_Sales_Ready.xlsx
    expect([...CSV_COLUMNS]).toEqual([
      "Business Name", "Business Name (Lead Name)", "GBP Category", "Lead Category", "Sub-Category", "GBP Phone",
      "GBP Phone (Phone)", "Phone Type", "Website", "Website Ranking", "Website Comment", "Website Score", "GBP Score",
      "GBP Comment", "Overall Online Presence Score", "Suggestions", "Owner", "Email", "Mobile 1", "GBP URL", "GBP Rank",
      "Rating on GBP", "Reviews on GBP", "Address", "City", "State", "Country", "Socials", "Logo URL", "Email 1", "Email 2",
      "Email 3", "Email 4", "Email 5", "Phone 1", "Phone 1 Type", "Phone 2", "Phone 2 Type", "Phone 3", "Phone 3 Type",
      "Phone 4", "Phone 4 Type", "Phone 5", "Phone 5 Type", "Lead Source", "Source Code", "Lead Status", "Lead Date",
      "Lead Date & Time",
    ]);
  });

  it("formats Phone 1-5 / Mobile 1 like the sheet: (305) 856-2923", () => {
    expect(nationalPhone("+13058562923", null)).toBe("(305) 856-2923");
    expect(nationalPhone(null, "305-856-2923")).toBe("(305) 856-2923");
    expect(nationalPhone("+919820012345", null)).toBe("+919820012345");
    expect(nationalPhone(null, null)).toBe("");
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

  it("maps a lead onto the row the way the sheet does", () => {
    const row = leadToCsvRow(
      {
        id: "1", business_name: "Acme Plumbing – Orlando", industry: "Home Services", cid: "17640875225651890807",
        gbp_category: "Plumber", lead_category: null, sub_category: "Drainage service",
        gbp_phone_raw: "(407) 605-3803", gbp_phone_formatted: "+14076053803", phone_type: "mobile", website: "https://acme.test",
        owner_name: null, gbp_url: "https://maps.google.com/?cid=1", gbp_rank: 3, rating: 4.8, review_count: 120,
        address: "1 Main St, Orlando, FL 32801", city: "Orlando", state: "FL", country: "USA", socials: null, logo_url: null,
        lead_source: null, source_code: "ILS", lead_status: null, lead_date: "9/25/2026", lead_datetime: "9/25/2026 3:30 PM",
      },
      ["info@acme.test", "sales@acme.test"],
      [],
    );
    expect(row).toHaveLength(49);
    const col = (name: (typeof CSV_COLUMNS)[number]) => row[CSV_COLUMNS.indexOf(name)];
    expect(col("Business Name")).toBe("Acme Plumbing – Orlando");
    expect(col("Business Name (Lead Name)")).toBe("Acme Plumbing – Orlando");
    expect(col("GBP Category")).toBe("Home Services");
    expect(col("Lead Category")).toBe("Home Services");
    expect(col("Sub-Category")).toBe("Plumber");
    expect(col("GBP Phone")).toBe("1407-605-3803");
    expect(col("GBP Phone (Phone)")).toBe("1407-605-3803");
    expect(col("Phone Type")).toBe("mobile");
    expect(col("Website Ranking")).toBe(""); // AI audit: Phase 2
    expect(col("Mobile 1")).toBe("(407) 605-3803");
    expect(col("Phone 1")).toBe("(407) 605-3803");
    expect(col("Phone 1 Type")).toBe("mobile");
    expect(col("Phone 2")).toBe("");
    expect(col("GBP URL")).toBe("https://www.google.com/maps?cid=17640875225651890807");
    expect(col("State")).toBe("Florida");
    expect(col("Owner")).toBe("");
    expect(col("Email")).toBe("info@acme.test");
    expect(col("Email 1")).toBe("info@acme.test");
    expect(col("Email 2")).toBe("sales@acme.test");
    expect(col("Lead Source")).toBe("Google");
    expect(col("Lead Status")).toBe("Untouched");
  });

  it("marks businesses without a website as 'No Website', score 0, and leaves unchecked phone types blank", () => {
    const row = leadToCsvRow(
      {
        id: "2", business_name: "No Site Co", industry: null, cid: null, gbp_category: "Plumber", lead_category: null, sub_category: null,
        gbp_phone_raw: "(305) 555-0100", gbp_phone_formatted: "+13055550100", phone_type: null, website: null, owner_name: null,
        gbp_url: "https://maps.example/x", gbp_rank: 7, rating: null, review_count: null, address: null, city: "Miami", state: "FL",
        country: "USA", socials: null, logo_url: null, lead_source: "Google", source_code: "ILS", lead_status: "Untouched",
        lead_date: "9/25/2026", lead_datetime: "9/25/2026 9:00 AM",
      },
      [],
      [],
    );
    const col = (name: (typeof CSV_COLUMNS)[number]) => row[CSV_COLUMNS.indexOf(name)];
    expect(col("Website Ranking")).toBe("No Website");
    expect(col("Website Score")).toBe("0");
    expect(col("Phone Type")).toBe("");
    expect(col("Mobile 1")).toBe("");
    expect(col("GBP Category")).toBe("Plumber"); // no sector known: fall back to Google's category
    expect(col("GBP URL")).toBe("https://maps.example/x");
  });
});

describe("passwords", () => {
  it("hashes with a random salt and verifies only the right password", async () => {
    const { hashPassword, verifyPassword } = await import("../src/auth");
    const a = await hashPassword("correct-horse-1");
    const b = await hashPassword("correct-horse-1");
    expect(a.hash).not.toBe(b.hash); // different salts
    expect(await verifyPassword("correct-horse-1", a.hash, a.salt, a.iterations)).toBe(true);
    expect(await verifyPassword("wrong-horse-1", a.hash, a.salt, a.iterations)).toBe(false);
  });
});
