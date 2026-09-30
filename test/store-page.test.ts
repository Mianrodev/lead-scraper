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
