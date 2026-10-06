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

describe("dashboard search row", () => {
  // The filter keys buildFilters creates (same rule as the test above).
  const defined = new Set([
    ...[...script.matchAll(/\b(?:multi|single)\("(\w+)"/g)].map((m) => m[1]),
    ...[...script.matchAll(/\bf\.(\w+) = dropdown\(/g)].map((m) => m[1]),
  ]);

  it("is one What / Where row with suggestions, a data switch and one Search button (no step-by-step)", () => {
    for (const id of ["whatInput", "whereInput"]) {
      expect(dashboardHtml).toMatch(new RegExp(`id="${id}"[^>]*role="combobox"[^>]*aria-controls="${id.replace("Input", "List")}"`));
      expect(dashboardHtml).toContain(`id="${id.replace("Input", "List")}" role="listbox"`);
    }
    expect(dashboardHtml).toMatch(/name="source" value="free"/);
    expect(dashboardHtml).toMatch(/name="source" value="google"/);
    expect(dashboardHtml).toMatch(/<button id="findBtn" type="button">Search<\/button>/);
    expect(dashboardHtml).toContain('id="browseTypes"'); // the full type picker stays reachable
    expect(dashboardHtml).not.toContain('id="steps"');
    expect(dashboardHtml).not.toContain('id="builderCard"');
    expect(dashboardHtml).not.toContain('id="welcomeCard"');
  });

  it("works from the keyboard: arrows move, Enter picks or searches, Escape closes", () => {
    const ta = script.slice(script.indexOf("function typeahead("), script.indexOf("const isDb ="));
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape", "Backspace"]) expect(ta).toContain(`e.key === "${key}"`);
    expect(ta).toContain("aria-activedescendant");
    expect(ta).toMatch(/o\.onEnter\(\)/);
  });

  it("offers example searches that fill the row", () => {
    expect([...dashboardHtml.matchAll(/data-example="[^"|]+\|[^"|]*\|[A-Z]{2}"/g)].length).toBe(3);
  });

  it("answers with one button per situation, with the price on paid ones", () => {
    expect(script).toContain('"Collect them (up to " + money(cost) + ")"');
    expect(script).toContain('"Collect them (free)"');
    expect(script).toContain('"Show them"');
    expect(script).toContain('data-switch-source="free"'); // over budget -> one-click free data
    expect(script).toContain('data-switch-source="google"'); // not in the free data -> one-click Google
  });

  it("one-tap filters only switch filters that exist", () => {
    const quick = script.slice(script.indexOf("const QUICK = ["), script.indexOf("function renderQuick"));
    const keys = [...quick.matchAll(/\["(\w+)", "[^"]+", "[^"]+", "[^"]+"\]/g)].map((m) => m[1]);
    expect(keys).toEqual(["phone", "email", "website", "score", "owner", "assigned", "leadStatus"]);
    expect(keys.filter((k) => !defined.has(k))).toEqual([]);
  });

  it("says counts in plain English", () => {
    const plural = new Function(script.match(/const plural = [^\n]+/)![0] + "; return plural;")() as (w: string, n: number) => string;
    expect(plural("plumber", 248)).toBe("plumbers");
    expect(plural("plumber", 1)).toBe("plumber");
    expect(plural("pharmacy", 2)).toBe("pharmacies");
    expect(plural("glass", 2)).toBe("glasses");
    expect(plural("pizza restaurant", 3)).toBe("pizza restaurants");
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
