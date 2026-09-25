import { describe, expect, it } from "vitest";
import { dashboardHtml } from "../src/dashboard";

const script = dashboardHtml.match(/<script>([\s\S]*)<\/script>/)![1];

describe("dashboard page script", () => {
  it("parses", () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it("only uses filter dropdowns that exist", () => {
    // Every f.<name> the page reads must be created in buildFilters (multi/single or f.<name> = dropdown).
    const defined = new Set([
      ...[...script.matchAll(/\b(?:multi|single)\("(\w+)"/g)].map((m) => m[1]),
      ...[...script.matchAll(/\bf\.(\w+) = dropdown\(/g)].map((m) => m[1]),
    ]);
    const used = new Set([...script.matchAll(/\bf\.(\w+)\b(?!\s*=\s*dropdown)/g)].map((m) => m[1]));
    // (detailText has an unrelated local array also called f.)
    const missing = [...used].filter((name) => !defined.has(name) && !["length", "map"].includes(name));
    expect(missing).toEqual([]);
  });
});

describe("dashboard link check", () => {
  it("links only web addresses", () => {
    const isWebLink = new Function(script.match(/const isWebLink = [^\n]+/)![0] + "; return isWebLink;")() as (u: unknown) => boolean;
    expect(isWebLink("https://joes.com")).toBe(true);
    expect(isWebLink("http://maps.google.com/?cid=1")).toBe(true);
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink(null)).toBe(false);
  });
});
