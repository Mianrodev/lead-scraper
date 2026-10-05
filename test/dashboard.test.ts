import { describe, expect, it } from "vitest";
import { dashboardHtml } from "../src/dashboard";

// The page script is the biggest <script> block (the theme ones are small).
const script = [...dashboardHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];

describe("dashboard page script", () => {
  it("parses", () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it("uses in-page dialogs, never the browser's alert / confirm / prompt boxes", () => {
    expect(script.match(/\b(?:alert|confirm|prompt)\(/g) ?? []).toEqual([]);
  });

  it("has the light / dark switch and the shared look", () => {
    expect(dashboardHtml).toContain("data-theme-toggle");
    expect(dashboardHtml).toContain('localStorage.getItem("theme")');
    expect(dashboardHtml).toMatch(/prefers-color-scheme: dark/);
    expect(dashboardHtml).toContain("Fraunces");
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
