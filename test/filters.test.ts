import { describe, expect, it } from "vitest";
import { buildLeadQuery, buildWhere, parseFilters } from "../src/leads";
import { businessStatus, hasStreetAddress, normalizePlace, priceLevel, profileAttributes, websiteDomain } from "../src/normalize";
import { categoriesOf, INDUSTRIES, industryOf, SECTOR_GROUPS, TOP_100 } from "../src/taxonomy";

describe("taxonomy", () => {
  it("has unique categories and a Top 100 drawn from them", () => {
    const all = INDUSTRIES.flatMap((i) => i.categories.map((c) => c.toLowerCase()));
    expect(new Set(all).size).toBe(all.length);
    expect(TOP_100).toHaveLength(100);
    for (const c of TOP_100) expect(industryOf(c)).not.toBeNull();
  });
  it("puts every sector in exactly one picker group", () => {
    const grouped = SECTOR_GROUPS.flatMap((g) => g.sectors);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(INDUSTRIES.map((i) => i.industry).sort());
  });

  it("maps categories to industries case-insensitively", () => {
    expect(industryOf("Plumber")).toBe("Home Services");
    expect(industryOf("plumber")).toBe("Home Services");
    expect(industryOf("Dentist")).toBe("Dental");
    expect(industryOf("Made-up category")).toBeNull();
    expect(categoriesOf(["Dental"])).toContain("Orthodontist");
  });
});

describe("business signals", () => {
  it.each([
    ["$$", "$$"],
    [" $ ", "$"],
    ["$10–20", null],
    ["Inexpensive", null],
    [null, null],
  ])("priceLevel(%s) -> %s", (input, expected) => {
    expect(priceLevel(input)).toBe(expected);
  });

  it("keeps only switched-on profile attributes, once each", () => {
    expect(
      profileAttributes({
        "Service options": [{ "Onsite services": true }, { "Online estimates": false }],
        Accessibility: [{ "Wheelchair accessible entrance": true }],
        Offerings: [{ "Onsite services": true }],
        Junk: "not a list",
      }),
    ).toEqual([
      { section: "Service options", name: "Onsite services" },
      { section: "Accessibility", name: "Wheelchair accessible entrance" },
    ]);
    expect(profileAttributes(null)).toEqual([]);
  });
});

describe("websiteDomain", () => {
  it.each([
    ["https://www.Example.com/about?x=1", "example.com"],
    ["http://shop.example.co.uk/", "shop.example.co.uk"],
    ["example.com", "example.com"],
    ["https://www.protechac.com/?utm_source=google", "protechac.com"],
    ["https://www.facebook.com/SomePlumber", null],
    ["https://sites.google.com/view/plumber", null],
    ["not a url", null],
    ["", null],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(websiteDomain(input)).toBe(expected);
  });
});

describe("businessStatus", () => {
  it("prefers permanently closed over temporarily closed", () => {
    expect(businessStatus(true, true)).toBe("permanently_closed");
    expect(businessStatus(false, true)).toBe("temporarily_closed");
    expect(businessStatus(false, false)).toBe("operational");
  });
});

describe("hasStreetAddress", () => {
  it("uses Apify's street field when present", () => {
    expect(hasStreetAddress({ street: "100 Main St" }, "100 Main St, Orlando, FL")).toBe(1);
    expect(hasStreetAddress({ street: null }, "Orlando, FL")).toBe(0);
  });
  it("falls back to a numbered street in the address", () => {
    expect(hasStreetAddress({}, "9161 Narcoossee Rd #210, Orlando, FL 32827")).toBe(1);
    expect(hasStreetAddress({}, "Orlando, FL")).toBe(0);
    expect(hasStreetAddress({}, null)).toBe(0);
  });
});

describe("normalizePlace derived columns", () => {
  it("keeps unverified and closed businesses, tagged", () => {
    const p = normalizePlace({
      placeId: "x",
      claimThisBusiness: true,
      permanentlyClosed: true,
      website: "https://www.acme.test/contact",
      street: null,
    })!;
    expect(p.is_claimed).toBe(0);
    expect(p.business_status).toBe("permanently_closed");
    expect(p.website_domain).toBe("acme.test");
    expect(p.has_street_address).toBe(0);
  });
});

const params = (q: string) => parseFilters(new URLSearchParams(q));

describe("parseFilters / buildWhere", () => {
  it("ignores unknown enum values", () => {
    const f = params("verified=maybe&status=open&status=operational&location=moon&phone_type=fax,mobile");
    expect(f.verified).toBeUndefined();
    expect(f.statuses).toEqual(["operational"]);
    expect(f.location).toBeUndefined();
    expect(f.phoneTypes).toEqual(["mobile"]);
  });

  it("builds clauses for every filter", () => {
    const f = params(
      "search_id=s1,s2&state=FL&city=Orlando&category=Plumber&status=operational&verified=verified&website=no" +
        "&phone=yes&location=service_area&min_rating=4&max_rating=4.8&min_reviews=10&max_reviews=500&max_rank=10" +
        "&added_from=2026-09-01&added_to=2026-09-30&lead_status=Untouched&source_code=ILS&q=50%25_off",
    );
    const { sql, binds } = buildWhere(f);
    for (const fragment of [
      "search_leads WHERE search_id IN ('s1', 's2')",
      "l.state IN ('FL')",
      "l.business_status IN ('operational')",
      "COALESCE(l.is_claimed, 1) = 1",
      "(l.website IS NULL OR l.website = '')",
      "l.gbp_phone_formatted IS NOT NULL",
      "l.has_street_address = 0",
      "l.rating >= ?",
      "l.rating <= ?",
      "sl.rank <= ? AND sl.search_id IN ('s1', 's2')",
      "l.created_at < ?",
      "l.source_code IN ('ILS')",
    ]) {
      expect(sql).toContain(fragment);
    }
    expect(binds).toContain("%50\\%\\_off%");
    // Placeholders and bindings line up.
    expect(sql.split("?").length - 1).toBe(binds.length);
  });

  it("builds round-2 clauses: industry, top 100, exclude, postal, percent, price, photos, attributes", () => {
    const f = params(
      "industry=Home Services&industry=Other&top100=1&exclude_category=Plumbing supply store&postal_code=32801" +
        "&top_pct=5&price=$$&price=bogus&min_photos=10&attribute=Onsite services&attribute=Wheelchair accessible entrance" +
        "&updated_from=2026-09-01",
    );
    expect(f.priceLevels).toEqual(["$$"]);
    const { sql, binds } = buildWhere(f);
    expect(sql).toContain("(l.industry IN ('Home Services') OR l.industry IS NULL)");
    expect(sql).toContain("l.gbp_category IN ('");
    expect(sql).toContain("COALESCE(l.gbp_category, '') NOT IN ('Plumbing supply store')");
    expect(sql).toContain("l.postal_code IN ('32801')");
    expect(sql).toContain("sl.rank <= MAX(1, (COALESCE(s.results_count, 0) * ? + 99) / 100)");
    expect(sql).toContain("HAVING COUNT(DISTINCT name) = ?");
    expect(binds.slice(-1)[0]).toBe(2);
  });

  it("ignores unsupported top percent and radius values", () => {
    const f = params("top_pct=7&near=Orlando|FL&radius_miles=9000");
    expect(f.topPercent).toBeUndefined();
    expect(f.radiusMiles).toBeUndefined();
  });

  it("filters by distance once a center is resolved, and matches nothing if it can't be", () => {
    const f = params("near=Orlando|FL&radius_miles=10");
    f.nearCenter = { lat: 28.5, lng: -81.4, radiusMiles: 10 };
    const { sql, binds } = buildWhere(f);
    expect(sql).toContain("<= ? * ?");
    expect(binds).toHaveLength(8);
    f.nearCenter = null;
    expect(buildWhere(f).sql).toContain("0 = 1");
  });

  it("inlines long lists as escaped literals to stay under D1's parameter limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Cat ${i}'s`);
    const f = params(many.map((c) => `category=${encodeURIComponent(c)}`).join("&"));
    const { sql, binds } = buildWhere(f);
    expect(binds).toHaveLength(0);
    expect(sql).toContain("'Cat 0''s'");
  });

  it("returns no WHERE when nothing is set", () => {
    expect(buildWhere(params("")).sql).toBe("");
  });

  it("rejects malformed dates", () => {
    expect(params("added_from=09/01/2026").addedFrom).toBeUndefined();
  });
});

describe("multi-select filters", () => {
  it("treats ticking both halves of a two-way choice as 'any'", () => {
    expect(params("verified=verified&verified=unverified").verified).toBeUndefined();
    expect(params("verified=unverified").verified).toBe("unverified");
    expect(params("location=storefront,service_area").location).toBeUndefined();
    expect(params("location=service_area").location).toBe("service_area");
  });

  it("ORs review buckets and ignores unknown ones", () => {
    const f = params("reviews=none&reviews=101-1000&reviews=10001%2B&reviews=lots");
    expect(f.reviewBuckets).toEqual(["none", "101-1000", "10001+"]);
    const { sql } = buildWhere(f);
    expect(sql).toContain(
      "(COALESCE(l.review_count, 0) BETWEEN 0 AND 0 OR COALESCE(l.review_count, 0) BETWEEN 101 AND 1000 OR COALESCE(l.review_count, 0) >= 10001)",
    );
  });

  it("filters by neighborhood", () => {
    expect(buildWhere(params("neighborhood=College Park")).sql).toContain("l.neighborhood IN ('College Park')");
  });
});

describe("buildLeadQuery duplicate removal", () => {
  it("selects straight from the filtered set when no dedupe is on", () => {
    expect(buildLeadQuery(params("")).source).toBe("f");
  });

  it("chains website, phone and listing dedupe in that order", () => {
    const q = buildLeadQuery(params("dedupe_website=1&dedupe_phone=1&dedupe_listing=1"));
    expect(q.source).toBe("d_cid");
    const site = q.with.indexOf("d_site AS");
    const phone = q.with.indexOf("d_phone AS");
    const cid = q.with.indexOf("d_cid AS");
    expect(site).toBeGreaterThan(0);
    expect(phone).toBeGreaterThan(site);
    expect(cid).toBeGreaterThan(phone);
    expect(q.with).toContain("PARTITION BY COALESCE(website_domain, id)");
    expect(q.with).toContain("FROM d_site");
  });
});

import { attributesHash } from "../src/pipeline";
import { monthStartUtc } from "../src/ops";
import { zonedDayStartUtc } from "../src/format";
import { toE164 } from "../src/normalize";

describe("QA round fixes", () => {
  it("dates use the team's day (New York), across daylight saving", () => {
    expect(zonedDayStartUtc("2026-09-25", "America/New_York")).toBe("2026-09-25 04:00:00");
    expect(zonedDayStartUtc("2026-01-31", "America/New_York", 1)).toBe("2026-02-01 05:00:00");
    expect(monthStartUtc("America/New_York", new Date("2026-09-25T20:00:00Z"))).toBe("2026-09-01 04:00:00");
    expect(monthStartUtc("America/New_York", new Date("2026-10-01T02:00:00Z"))).toBe("2026-09-01 04:00:00"); // still Sep 30 in NY
  });

  it("only treats numbers without + as North American in the US / Canada", () => {
    expect(toE164("(407) 555-0101", "US")).toBe("+14075550101");
    expect(toE164("098200 12345", "IN")).toBeNull();
    expect(toE164("+91 98200 12345", "IN")).toBe("+919820012345");
    expect(toE164("4075550101")).toBe("+14075550101");
  });

  it("fingerprints profile features regardless of order and case", () => {
    const a = attributesHash([{ section: "s", name: "Wheelchair accessible" }, { section: "s", name: "Onsite services" }]);
    const b = attributesHash([{ section: "x", name: "onsite services" }, { section: "x", name: "wheelchair accessible" }]);
    expect(a).toBe(b);
    expect(attributesHash([])).not.toBe(a);
  });

  it("builds website, city-in-state and date clauses", () => {
    const where = (qs: string) => buildWhere(parseFilters(new URLSearchParams(qs))).sql;
    expect(where("website=social")).toContain("l.website_domain IS NULL");
    expect(where("website=yes")).toContain("l.website_domain IS NOT NULL");
    expect(where("website=no_real")).toContain("l.website_domain IS NULL");
    expect(where("city=Springfield|IL")).toContain("(l.city = 'Springfield' AND COALESCE(l.state, '') = 'IL')");
    expect(where("city=O'Fallon")).toContain("l.city = 'O''Fallon'");
  });
});
