import { describe, expect, it } from "vitest";
import { labelsFromJson, localLabels, money, rangeText, revenueText, sizeNote } from "../src/company-facts";

describe("company facts formatting", () => {
  it("shows ranges, never exact-looking figures", () => {
    expect(rangeText(10, 19)).toBe("10–19");
    expect(rangeText(500, null)).toBe("500+");
    expect(rangeText(null, null)).toBe("");
    expect(money(250_000)).toBe("$250k");
    expect(money(2_500_000)).toBe("$2.5M");
    expect(money(10_000_000)).toBe("$10M");
    expect(revenueText(1_000_000, 2_500_000)).toBe("$1M–$2.5M");
    expect(revenueText(0, 250_000)).toBe("under $250k");
    expect(revenueText(25_000_000, null)).toBe("$25M+");
    expect(revenueText(null, null)).toBe("");
    expect(sizeNote("ppp", 2021)).toBe("PPP loan record (2021)");
    expect(sizeNote("estimate", null)).toBe("estimated");
  });

  it("compares with similar businesses nearby", () => {
    const avg = { avg_rating: 4.4, avg_reviews: 120, businesses: 12 };
    expect(localLabels(4.9, 51, avg)).toEqual(["Above local average"]);
    expect(localLabels(3.9, 8, avg)).toEqual(["Below local average", "Low review count"]);
    expect(localLabels(4.5, 200, avg)).toEqual([]);
    expect(localLabels(4.9, 51, { ...avg, businesses: 2 })).toEqual([]); // too few to compare
    expect(labelsFromJson(4.9, 51, JSON.stringify({ r: 4.4, v: 120, n: 12 }))).toEqual(["Above local average"]);
    expect(labelsFromJson(4.9, 51, null)).toEqual([]);
  });
});
