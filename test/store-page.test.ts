import { describe, expect, it } from "vitest";
import { safeColor, safeLogo, storeHtml } from "../src/store/page";

const html = storeHtml({ name: "Lead Store", color: "#4f46e5", supportEmail: "help@example.com", creditPrice: 0.5 });
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
// The app's own script (the other two are the shared theme boot + toggle from src/theme.ts).
const script = scripts.find((s) => s.includes("const $ = "))!;
const fn = (name: string) => script.match(new RegExp(`function ${name}[\\s\\S]*?\\r?\\n}\\r?\\n`))![0];

describe("store page script", () => {
  it("parses", () => {
    for (const s of scripts) expect(() => new Function(s)).not.toThrow();
  });

  it("has only inline scripts: the app's plus the theme boot and toggle", () => {
    expect(scripts.length).toBe(3);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("has no template-literal leftovers (no backslashes, backticks or dollar-braces)", () => {
    expect(script).not.toMatch(/[`\\]|\$\{/);
  });

  it("never uses the browser's prompt, confirm or alert", () => {
    expect(script).not.toMatch(/window\.(prompt|confirm|alert)\(|[^.\w](prompt|confirm|alert)\(/);
  });

  it("links only web addresses", () => {
    const isWebLink = new Function(script.match(/const isWebLink = [^\n]+/)![0] + "; return isWebLink;")() as (u: unknown) => boolean;
    expect(isWebLink("https://joes.com")).toBe(true);
    expect(isWebLink("http://joes.com/a")).toBe(true);
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink(null)).toBe(false);
  });

  it("loads Leaflet only at runtime from cdnjs (no <script src> in the page)", () => {
    expect(script).toContain("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js");
    expect(script).toContain("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css");
    expect(script).toContain("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(script).toContain("OpenStreetMap contributors");
  });

  it("keeps only valid map areas (3 to 40 points)", () => {
    const cleanArea = new Function(fn("cleanArea") + "; return cleanArea;")() as (v: unknown) => string;
    expect(cleanArea("25.1,-80.2;25.2,-80.3;25.3,-80.1")).toBe("25.10000,-80.20000;25.20000,-80.30000;25.30000,-80.10000");
    expect(cleanArea("25.1,-80.2;25.2,-80.3")).toBe("");
    expect(cleanArea("a,b;c,d;e,f")).toBe("");
    expect(cleanArea("95,0;1,1;2,2")).toBe("");
    expect(cleanArea(Array.from({ length: 60 }, (_, i) => i / 10 + ",1").join(";")).split(";").length).toBe(40);
    expect(cleanArea(null)).toBe("");
  });

  it("reads deep links from the hash", () => {
    const parse = (hash: string) => new Function("location", fn("parseHash") + "; return parseHash();")({ hash });
    expect(parse("#find?state=FL&city=Miami%7CFL&category=Plumber")).toEqual({ tab: "find", query: "state=FL&city=Miami%7CFL&category=Plumber" });
    expect(parse("#signup")).toEqual({ tab: "signup", query: "" });
    expect(parse("")).toEqual({ tab: "", query: "" });
  });

  it("colours scores the same way everywhere (under 40 red, 40-59 amber, 60+ green)", () => {
    const scoreClass = new Function(fn("scoreClass") + "; return scoreClass;")() as (s: unknown) => string;
    expect([scoreClass(10), scoreClass(39), scoreClass(40), scoreClass(59), scoreClass(60), scoreClass(95), scoreClass(null)]).toEqual(["bad", "bad", "warn", "warn", "ok", "ok", "none"]);
  });

  it("explains the unlock price in one sentence from the dry run (free leads cover the priciest)", () => {
    const paidSplit = new Function("prices", fn("paidSplit") + "; return paidSplit;")(() => ({ free: 1, google: 3 })) as (d: unknown) => { ok: boolean; paidStd: number; paidPrem: number };
    expect(paidSplit({ free: 20, google: 10, freeLeads: 12, credits: 18 })).toMatchObject({ ok: true, paidStd: 18, paidPrem: 0 });
    expect(paidSplit({ free: 5, google: 5, freeLeads: 2, credits: 14 })).toMatchObject({ ok: true, paidStd: 5, paidPrem: 3 });
    expect(paidSplit({ free: 5, google: 5, freeLeads: 2, credits: 99 }).ok).toBe(false);
  });
});

describe("store page sections", () => {
  it("links the logo to the website and signs out to it", () => {
    expect(html).toContain('<a class="homelink" href="/"');
    expect(script).toContain('location.href = "/"');
    expect(html).toContain("<span>Local leads</span>");
  });

  it("uses the shared theme: tokens, fonts, dark mode switch always in the header", () => {
    expect(html).toContain("--brand: #4f46e5;");
    expect(html).toContain('data-theme-toggle');
    expect(html).toContain('prefers-color-scheme: dark');
    // The theme button sits outside the signed-in part of the header.
    expect(html.indexOf("data-theme-toggle")).toBeGreaterThan(html.indexOf('id="hdrAcct"'));
    expect(html).toMatch(/<div class="hdr-right">/);
    expect(script).toContain('"themechange"');
    expect(html).not.toMatch(/outline: none/);
  });

  it("shows the free allowance and the value of a credit", () => {
    expect(html).toContain('id="hdrFree"');
    expect(html).toContain('id="crFree"');
    expect(html).toContain('data-credit-price="0.5"');
    expect(script).toContain('" free lead" + (Number(fr.left) === 1 ? "" : "s") + " left"');
    expect(script).toContain("use your free leads");
    expect(script).toContain("free leads every month, ");
    expect(script).toContain("Welcome! You have ");
    expect(script).toContain("1 credit = ");
    expect(script).toContain('"Credits for " + company');
  });

  it("never leaves a buyer stuck: get more credits, forgot password, help", () => {
    for (const id of ["balMore", "crMore", "buyMore", "forgotBtn", "helpBtn", "buyPart"]) expect(html).toContain('id="' + id + '"');
    expect(html).toContain("Forgot your password?");
    expect(script).toContain('href="/contact"');
  });

  it("guards purchases: expected price, re-quote on 409, big-spend tick box, Cancel focused", () => {
    expect(script).toContain("expectedCredits: Number(job.quote.credits || 0)");
    expect(script).toContain("e.status === 409");
    expect(script).toContain("I understand this spends ");
    expect(script).toContain('$("buyCancel").focus()');
    expect(script).toContain('"Unlock the first " + num(MAX_BUY) + " (of "');
  });

  it("has the map, isolated under dialogs", () => {
    for (const id of ["mapBtn", "mapCard", "leadMap", "mapDraw", "mapUse", "mapClear", "areaNote"]) expect(html).toContain('id="' + id + '"');
    expect(html).toMatch(/#leadMap \{[^}]*isolation: isolate/);
    expect(script).toContain('"/api/map"');
    expect(script).toContain('p.set("area", find.area)');
  });

  it("has saved searches (with the sort) and remembers the last search", () => {
    for (const id of ["savedSel", "savedUse", "savedDel", "saveSearch"]) expect(html).toContain('id="' + id + '"');
    expect(script).toContain('"/api/saved"');
    expect(script).toContain('"/api/saved/" + encodeURIComponent(id)');
    expect(script).toContain("query: fullQuery()");
    expect(script).toContain('"ls.lastFind"');
    expect(script).toContain('"#find?" + q');
  });

  it("has the team tab with the temporary password in a copy dialog", () => {
    expect(html).toContain('data-tab="team"');
    for (const id of ["view-team", "teamBody", "teamAddCard", "teamForm", "askCopy"]) expect(html).toContain('id="' + id + '"');
    expect(script).toContain("they'll choose their own after signing in");
    expect(script).toContain('"/api/team"');
    expect(script).toContain('"/api/team/" + encodeURIComponent(');
  });

  it("offers JSON downloads and the forced password change", () => {
    expect(html).toContain('id="dlJson"');
    expect(html).toContain('id="dlSelJson"');
    expect(script).toContain('"json"');
    expect(html).toContain("Choose your own password to continue.");
    expect(script).toContain("mustChangePassword");
  });

  it("says Unlock, not Buy", () => {
    expect(html).not.toMatch(/>Buy /);
    expect(script).not.toMatch(/"Buy /);
  });

  it("asks new buyers to agree to the terms, and hides sign-up when closed", () => {
    expect(html).toContain('By creating an account you agree to the <a href="/legal/terms"');
    expect(html).toContain('data-signup="1"');
    expect(storeHtml({ name: "X", color: "#000000", supportEmail: "", signupOpen: false })).toContain('data-signup="0"');
    expect(script).toContain("Sign-ups are currently closed.");
  });
});

describe("store page brand values", () => {
  const evil = storeHtml({
    name: '<script>alert(1)</script>"Acme\'s',
    color: "red;}</style><script>alert(2)</script>",
    supportEmail: '"><img src=x onerror=alert(3)>',
  });

  it("escapes the brand name and support email", () => {
    expect(evil).not.toContain("<script>alert(1)");
    expect(evil).not.toContain("<img src=x");
    expect(evil).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;Acme&#39;s");
    expect(evil).toContain('data-support="&quot;&gt;&lt;img src=x onerror=alert(3)&gt;"');
    expect(evil.match(/<script>/g)!.length).toBe(3);
  });

  it("only accepts hex brand colors", () => {
    expect(evil).not.toContain("alert(2)");
    expect(evil).toContain("--brand: #E4572E;");
    expect(safeColor("#ABCDEF")).toBe("#ABCDEF");
    expect(safeColor("#abc")).toBe("#abc");
    expect(safeColor("blue")).toBe("#E4572E");
    expect(safeColor(undefined)).toBe("#E4572E");
  });

  it("shows only an https logo, escaped, else the name as a wordmark", () => {
    expect(safeLogo("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    expect(safeLogo("http://cdn.example.com/logo.png")).toBe("");
    expect(safeLogo("javascript:alert(1)")).toBe("");
    expect(safeLogo('https://x.test/a.png" onerror="alert(1)')).not.toContain('"');
    const withLogo = storeHtml({ name: "Goes Local", color: "#E4572E", supportEmail: "", logoUrl: "https://cdn.example.com/logo.png" });
    expect(withLogo).toContain('<img class="logoimg" src="https://cdn.example.com/logo.png" alt="Goes Local">');
    expect(storeHtml({ name: "Goes Local", color: "#E4572E", supportEmail: "" })).toContain('class="wordmark"');
    expect(storeHtml({ name: "X", color: "#0f766e", supportEmail: "" })).toContain("--brand: #0f766e;");
  });

  it("falls back to a default name", () => {
    expect(storeHtml({ name: "  ", color: "", supportEmail: "" })).toContain("<title>Lead Store</title>");
  });
});
