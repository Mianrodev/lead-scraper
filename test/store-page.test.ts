import { describe, expect, it } from "vitest";
import { safeColor, safeLogo, storeHtml } from "../src/store/page";

const html = storeHtml({ name: "Lead Store", color: "#4f46e5", supportEmail: "help@example.com" });
const script = html.match(/<script>([\s\S]*)<\/script>/)![1];

describe("store page script", () => {
  it("parses", () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it("has exactly one inline script and no external scripts", () => {
    expect(html.match(/<script/g)!.length).toBe(1);
  });

  it("links only web addresses", () => {
    const isWebLink = new Function(script.match(/const isWebLink = [^\n]+/)![0] + "; return isWebLink;")() as (u: unknown) => boolean;
    expect(isWebLink("https://joes.com")).toBe(true);
    expect(isWebLink("http://joes.com/a")).toBe(true);
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink(null)).toBe(false);
  });

  it("loads Leaflet only at runtime from cdnjs (no <script src> in the page)", () => {
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(script).toContain("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js");
    expect(script).toContain("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css");
    expect(script).toContain("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(script).toContain("OpenStreetMap contributors");
  });

  it("keeps only valid map areas (3 to 40 points)", () => {
    const src = script.match(/function cleanArea[\s\S]*?\r?\n}\r?\n/)![0];
    const cleanArea = new Function(src + "; return cleanArea;")() as (v: unknown) => string;
    expect(cleanArea("25.1,-80.2;25.2,-80.3;25.3,-80.1")).toBe("25.10000,-80.20000;25.20000,-80.30000;25.30000,-80.10000");
    expect(cleanArea("25.1,-80.2;25.2,-80.3")).toBe("");
    expect(cleanArea("a,b;c,d;e,f")).toBe("");
    expect(cleanArea("95,0;1,1;2,2")).toBe("");
    expect(cleanArea(Array.from({ length: 60 }, (_, i) => i / 10 + ",1").join(";")).split(";").length).toBe(40);
    expect(cleanArea(null)).toBe("");
  });

  it("reads deep links from the hash", () => {
    const src = script.match(/function parseHash[\s\S]*?\r?\n}\r?\n/)![0];
    const parse = (hash: string) => new Function("location", src + "; return parseHash();")({ hash });
    expect(parse("#find?state=FL&city=Miami%7CFL&category=Plumber")).toEqual({ tab: "find", query: "state=FL&city=Miami%7CFL&category=Plumber" });
    expect(parse("#signup")).toEqual({ tab: "signup", query: "" });
    expect(parse("")).toEqual({ tab: "", query: "" });
  });
});

describe("store page sections", () => {
  it("links the logo to the website and signs out to it", () => {
    expect(html).toContain('<a class="homelink" href="/"');
    expect(script).toContain('location.href = "/"');
  });

  it("shows the free allowance", () => {
    expect(html).toContain('id="hdrFree"');
    expect(html).toContain('id="crFree"');
    expect(script).toContain("free leads left");
    expect(script).toContain("this month's allowance");
    expect(script).toContain("free leads every month, ");
    expect(script).toContain("Welcome! You have ");
  });

  it("has the map, isolated under dialogs", () => {
    for (const id of ["mapBtn", "mapCard", "leadMap", "mapDraw", "mapUse", "mapClear", "areaNote"]) expect(html).toContain('id="' + id + '"');
    expect(html).toMatch(/#leadMap \{[^}]*isolation: isolate/);
    expect(script).toContain('"/api/map"');
    expect(script).toContain('p.set("area", find.area)');
  });

  it("has saved searches", () => {
    for (const id of ["savedSel", "savedUse", "savedDel", "saveSearch"]) expect(html).toContain('id="' + id + '"');
    expect(script).toContain('"/api/saved"');
    expect(script).toContain('"/api/saved/" + encodeURIComponent(id)');
  });

  it("has the team tab", () => {
    expect(html).toContain('data-tab="team"');
    for (const id of ["view-team", "teamBody", "teamAddCard", "teamForm", "teamPw", "teamPwCopy"]) expect(html).toContain('id="' + id + '"');
    expect(html).toContain("Give them this password; they'll choose their own after signing in");
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
    expect(evil.match(/<script>/g)!.length).toBe(1);
  });

  it("only accepts hex brand colors", () => {
    expect(evil).not.toContain("alert(2)");
    expect(evil).toContain("--accent: #E4572E;");
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
    expect(storeHtml({ name: "X", color: "#0f766e", supportEmail: "" })).toContain("--accent: #0f766e;");
  });

  it("falls back to a default name", () => {
    expect(storeHtml({ name: "  ", color: "", supportEmail: "" })).toContain("<title>Lead Store</title>");
  });
});
