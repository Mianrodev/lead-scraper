import { describe, expect, it } from "vitest";
import { dashboardHtml } from "../src/dashboard";

// The page script is the biggest <script> block (the theme ones are small).
const script = [...dashboardHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];

describe("dashboard page script", () => {
  it("parses", () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it("only looks up elements that exist (every $(\"id\") has an id=\"id\" in the page or its templates)", () => {
    const ids = [...new Set([...script.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]))];
    // Made by code: the filter slots ("f-" + key) and the column-hiding style tag.
    const made = new Set(["f-distance", "f-dates", "colStyle", "colAuto"]);
    const missing = ids.filter((id) => !made.has(id) && !dashboardHtml.includes(`id="${id}"`));
    expect(missing).toEqual([]);
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

describe("dashboard QA fixes", () => {
  const between = (from: string, to: string) => script.slice(script.indexOf(from), script.indexOf(to, script.indexOf(from)));

  it("shows business names the way people write them", () => {
    const bizName = new Function(between("const INVISIBLE", "/** The best email") + "; return bizName;")() as (s: string) => string;
    expect(bizName("JOE'S PLUMBING LLC")).toBe("Joe's Plumbing LLC");
    expect(bizName("ABC HVAC & PLUMBING")).toBe("ABC HVAC & Plumbing");
    expect(bizName("​* Tampa Dental")).toBe("Tampa Dental");
    expect(bizName("McDonald's")).toBe("McDonald's"); // mixed case is left alone
    expect(bizName("")).toBe("Business");
  });

  it("compares searches by what they ask for, not by key order", () => {
    const reqKey = new Function(between("function reqKey(", "/** The search changed") + "; return reqKey;")() as (r: unknown) => string;
    const a = { source: "free", categories: ["Plumber", "Roofer"], locations: [{ country: "US", region: "FL", city: "Tampa" }], radiusMiles: null, checkPhones: false, maxResults: 100, withCounts: true };
    const b = { checkPhones: false, locations: [{ city: "Tampa", region: "FL", country: "US" }], categories: ["Roofer", "Plumber"], source: "free", maxResults: 500, withCounts: false };
    expect(reqKey(a)).toBe(reqKey(b)); // free data: Google-only options don't matter
    expect(reqKey({ ...a, source: "google" })).not.toBe(reqKey({ ...b, source: "google" }));
    expect(reqKey({ ...a, categories: ["Plumber"] })).not.toBe(reqKey(a));
  });

  it("drops developer file references from the launch checklist and uses US spelling", () => {
    const plainLaunch = new Function(script.match(/const plainLaunch = [^\n]+/)![0] + "; return plainLaunch;")() as (s: string) => string;
    expect(plainLaunch("Ask your developer to add the key (docs/launch-setup.md, step 2).")).toBe("Ask your developer to add the key.");
    expect(plainLaunch("Store name, colour and logo")).toBe("Store name, color and logo");
  });

  it("keeps column headings on every table except the business list on phones", () => {
    expect(dashboardHtml).not.toMatch(/\.results table thead\s*\{\s*display:\s*none/);
    expect(dashboardHtml).toMatch(/#leadTable thead\s*\{\s*display:\s*none/);
  });

  it("has no emoji on the Admin section buttons", () => {
    const nav = dashboardHtml.slice(dashboardHtml.indexOf('id="adminNav"'), dashboardHtml.indexOf("</nav>"));
    expect(nav).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("keeps typed text when Escape closes the suggestions", () => {
    const esc = between('e.key === "Escape"', 'e.key === "Backspace"');
    expect(esc).toContain("e.preventDefault()");
  });

  it("puts the tab in the address and handles Back", () => {
    expect(script).toContain("history.pushState");
    expect(script).toContain('addEventListener("popstate"');
  });

  it("doesn't poll while another view is open, and treats paused searches as not running", () => {
    expect(between("async function pollActive", "function startPolling")).toContain('$("findView").hidden && $("historyView").hidden');
    expect(script).toMatch(/const isRunning = \(s\) => [^\n]*!s\.paused/);
  });

  it("offers a sample CSV with the headings the upload understands", () => {
    expect(script).toContain('"Business Name,Website,Phone,Email,Address,City,State,Zip,Category"');
  });

  it("tries a failed read once more before showing an error", () => {
    const apiFn = between("async function api(", "const postJson");
    expect(apiFn).toMatch(/isRead && res\.status >= 500/);
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
