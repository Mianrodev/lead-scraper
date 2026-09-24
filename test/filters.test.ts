import { describe, expect, it } from "vitest";
import { buildLeadQuery, buildWhere, parseFilters } from "../src/leads";
import { businessStatus, hasStreetAddress, normalizePlace, websiteDomain } from "../src/normalize";

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
      "search_leads WHERE search_id IN (?, ?)",
      "l.state IN (?)",
      "l.business_status IN (?)",
      "COALESCE(l.is_claimed, 1) = 1",
      "(l.website IS NULL OR l.website = '')",
      "l.gbp_phone_formatted IS NOT NULL",
      "l.has_street_address = 0",
      "l.rating >= ?",
      "l.rating <= ?",
      "l.gbp_rank <= ?",
      "l.created_at < date(?, '+1 day')",
      "l.source_code IN (?)",
    ]) {
      expect(sql).toContain(fragment);
    }
    expect(binds).toContain("%50\\%\\_off%");
    // Placeholders and bindings line up.
    expect(sql.split("?").length - 1).toBe(binds.length);
  });

  it("returns no WHERE when nothing is set", () => {
    expect(buildWhere(params("")).sql).toBe("");
  });

  it("rejects malformed dates", () => {
    expect(params("added_from=09/01/2026").addedFrom).toBeUndefined();
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
