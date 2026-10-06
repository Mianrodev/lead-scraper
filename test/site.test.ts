import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { mountSite } from "../src/store/site-routes";
import { appFindLink, categoryPage, homePage, removePage, robotsTxt, sitemapXml } from "../src/store/site";
import type { StoreEnv } from "../src/store/types";

const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };

function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
  const stmt = (sql: string, binds: unknown[] = []) => ({
    sql,
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(binds as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    run: async () => { const r = db.prepare(sql).run(...(binds as never[])) as { changes: number }; return { meta: { changes: r.changes } }; },
  });
  const DB = {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: ReturnType<typeof stmt>[]) => Promise.all(list.map((s) => s.all())),
  };
  return { db, env: { DB } as unknown as StoreEnv };
}

const EVIL = '<script>alert(1)</script>"x\'';

function setup(opts: { publicPages?: boolean; signupClosed?: boolean } = {}) {
  const { db, env } = d1();
  const set = (k: string, v: string) => db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, v);
  set("store_brand_name", EVIL);
  set("store_brand_color", "red;}</style><script>alert(2)</script>");
  set("store_support_email", '"><img src=x onerror=alert(3)>');
  set("store_logo_url", "javascript:alert(4)");
  set("store_public_pages", opts.publicPages ? "1" : "0");
  set("store_signup_open", opts.signupClosed ? "0" : "1");
  let i = 0;
  const add = (name: string, extra: Record<string, unknown> = {}) => {
    i++;
    const row = { id: `l${i}`, google_place_id: `p${i}`, business_name: name, gbp_category: "Plumber", city: "Fort Lauderdale", state: "FL", data_source: "free",
      business_status: "operational", gbp_phone_formatted: "+19545550100", website_domain: i % 2 ? "x.test" : null, presence_score: 40, ...extra };
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO leads (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(Object.values(row) as never[]));
  };
  add(`<img src=x onerror=alert(5)> Pipes`);
  add("Joe's Plumbing");
  add("Ann & Co");
  add("Hidden Form Lead", { data_source: "form" });
  return { db, env, app: (() => { const a = new Hono<{ Bindings: StoreEnv }>(); mountSite(a); return a; })() };
}

const get = (s: ReturnType<typeof setup>, path: string) => s.app.request(path, {}, s.env);

describe("public site pages", () => {
  it("render every page with escaped brand values and noindex while not public", async () => {
    const s = setup();
    for (const p of ["/", "/pricing", "/faq", "/contact", "/legal/terms", "/legal/privacy", "/legal/do-not-sell", "/remove", "/leads", "/leads/fl", "/leads/fl/fort-lauderdale", "/leads/fl/fort-lauderdale/plumber"]) {
      const r = await get(s, p);
      expect(r.status, p).toBe(200);
      expect(r.headers.get("X-Robots-Tag"), p).toBe("noindex, nofollow");
      expect(r.headers.get("Cache-Control"), p).toBe("public, max-age=300");
      const html = await r.text();
      expect(html.startsWith("<!doctype html>"), p).toBe(true);
      expect(html, p).not.toContain("<script>alert");
      expect(html, p).not.toContain("<img src=x");
      expect(html, p).not.toContain("javascript:alert");
      expect(html, p).toMatch(/--brand: #e4572e;/i);
      expect(html, p).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;x&#39;");
      expect(html, p).toContain('href="/app#signup"');
      expect(html, p).toContain('href="/remove"');
    }
  });

  it("never offers sign-up while sign-ups are closed", async () => {
    const s = setup({ signupClosed: true });
    for (const p of ["/", "/pricing", "/faq", "/leads/fl/fort-lauderdale/plumber"]) {
      const html = await (await get(s, p)).text();
      expect(html, p).not.toContain('href="/app#signup"');
      expect(html, p).not.toContain("Start free");
      expect(html, p).toContain('href="/contact"');
    }
    expect(await (await get(s, "/")).text()).toContain("Sign-ups are currently closed — contact us");
  });

  it("offers the no-login demo in the header, the hero, pricing and the closing call to action (open or closed)", async () => {
    for (const s of [setup(), setup({ signupClosed: true })]) {
      const home = await (await get(s, "/")).text();
      expect(home.match(/href="\/demo"/g)!.length).toBeGreaterThanOrEqual(3); // header, hero, closing band
      expect(home).toContain('<a class="btn ghost" href="/demo">Try the demo</a>');
      expect(home).toContain('<span class="wide">Try the demo</span>');
      expect(await (await get(s, "/pricing")).text()).toContain('<a class="btn ghost" href="/demo">Try the demo</a>');
    }
  });

  it("shows what a credit costs in dollars when the owner set it", async () => {
    const s = setup();
    s.db.prepare(`INSERT INTO app_settings (key, value) VALUES ('store_credit_price', '0.50') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    const html = await (await get(s, "/pricing")).text();
    expect(html).toContain("1 credit = $0.50.");
    expect(html).toContain("(about $1.50)");
    const plain = await (await get(setup(), "/pricing")).text();
    expect(plain).not.toContain("1 credit = $");
  });

  it("legal pages are marked as drafts", async () => {
    const s = setup();
    for (const p of ["/legal/terms", "/legal/privacy", "/legal/do-not-sell"]) expect(await (await get(s, p)).text()).toContain("Draft — to be reviewed by a lawyer before launch");
  });

  it("category page shows counts and escaped samples, never form leads or contact details", async () => {
    const s = setup();
    const html = await (await get(s, "/leads/fl/fort-lauderdale/plumber")).text();
    expect(html).toContain("<h1>Plumber in Fort Lauderdale, FL</h1>");
    expect(html).toContain("&lt;img src=x onerror=alert(5)&gt; Pipes");
    expect(html).toContain("Joe&#39;s Plumbing");
    expect(html).toContain("Ann &amp; Co");
    expect(html).not.toContain("Hidden Form Lead");
    expect(html).not.toContain("9545550100");
    expect(html).toContain("See all 3 in the app");
    expect(html).toContain('href="/app#find?state=FL&amp;city=Fort%20Lauderdale%7CFL&amp;category=Plumber&amp;n=3"');
  });

  it("unknown slugs get a friendly 404", async () => {
    const s = setup();
    for (const p of ["/leads/zz", "/leads/florida", "/leads/fl/nowhere", "/leads/fl/fort-lauderdale/dentist", "/legal/other"]) {
      const r = await get(s, p);
      expect(r.status, p).toBe(404);
      expect(await r.text()).toContain("find that page");
    }
  });

  it("uppercase catalog paths redirect to lowercase", async () => {
    const r = await get(setup(), "/leads/FL/Fort-Lauderdale");
    expect(r.status).toBe(301);
    expect(r.headers.get("Location")).toBe("/leads/fl/fort-lauderdale");
  });
});

describe("robots and sitemap", () => {
  it("disallow everything while pages are not public", async () => {
    const s = setup();
    expect(await (await get(s, "/robots.txt")).text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("allow and link the sitemap when public, without noindex", async () => {
    const s = setup({ publicPages: true });
    const r = await s.app.request("https://leads.example.com/robots.txt", {}, s.env);
    const txt = await r.text();
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Sitemap: https://leads.example.com/sitemap.xml");
    const home = await s.app.request("https://leads.example.com/", {}, s.env);
    expect(home.headers.get("X-Robots-Tag")).toBeNull();
    const map = await (await s.app.request("https://leads.example.com/sitemap.xml", {}, s.env)).text();
    expect(map).toContain("<loc>https://leads.example.com/leads/fl/fort-lauderdale</loc>");
    expect(map).toContain("<loc>https://leads.example.com/pricing</loc>");
  });

  it("render helpers", () => {
    expect(robotsTxt(false, "https://a.test")).toBe("User-agent: *\nDisallow: /\n");
    expect(sitemapXml("https://a.test", ["/a?b=1&c=2"])).toContain("<loc>https://a.test/a?b=1&amp;c=2</loc>");
    expect(appFindLink("fl", "St. Mary's", "Hair & Nails")).toBe("/app#find?state=FL&city=St.%20Mary's%7CFL&category=Hair%20%26%20Nails");
    expect(appFindLink("fl", "Tampa", "Plumber", 42)).toBe("/app#find?state=FL&city=Tampa%7CFL&category=Plumber&n=42");
  });
});

describe("render functions", () => {
  const brand = { name: "Goes Local", color: "#123abc", logoUrl: "https://cdn.example.com/l.png", supportEmail: "help@example.com" };
  const prices = { free: 1, google: 3, freePerMonth: 50 };

  it("home shows the hero, stats, and brand logo/color", () => {
    const html = homePage(brand, { businesses: 200, withPhone: 150, withEmail: 50, withWebsite: 100, withOwner: 20, states: 2, categories: 9 }, [{ st: "FL", name: "Florida", n: 200 }], prices);
    expect(html).toContain("Find local businesses that");
    expect(html).toContain("Start free — 50 leads a month");
    expect(html).toContain("75%");
    expect(html).toContain('<img class="logoimg" src="https://cdn.example.com/l.png" alt="Goes Local">');
    expect(html).toContain("--brand: #123abc;");
    expect(html).toContain("Online score");
    expect(homePage({ ...brand, logoUrl: "" }, null, [], prices)).toContain("<span>Local leads</span>");
    expect(html).toContain('href="/leads/fl"');
  });

  it("category page handles hostile category and city names", () => {
    const html = categoryPage(brand, {
      st: "FL", stateName: "Florida", city: "<b>City</b>", category: '"><script>x</script>', n: 1, withPhone: 1, withEmail: 0, withWebsite: 0, withOwner: 0, avgScore: null,
      samples: [{ name: "<svg onload=alert(1)>", rating: 4.5, reviews: 1, score: null }],
    }, "city");
    expect(html).not.toContain("<script>x");
    expect(html).not.toContain("<svg onload");
    expect(html).not.toContain("<b>City</b>");
    expect(html).toContain("4.5 stars · 1 review");
  });

  it("remove page script parses and has no template-literal leftovers", () => {
    const html = removePage({ ...brand, supportEmail: "" });
    // Three inline scripts: the theme boot, this page's form script and the theme toggle.
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBe(3);
    const js = scripts.find((s) => s.includes("rmform"))!;
    expect(() => new Function(js)).not.toThrow();
    expect(js).not.toMatch(/[`\\]|\$\{/);
    expect(html).toContain("This form needs JavaScript. Please enable it");
    expect(html).toContain('<a href="/contact">contact us</a>');
  });
});

describe("remove request", () => {
  const post = (s: ReturnType<typeof setup>, body: unknown, raw = false) =>
    s.app.request("/api/remove-request", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" }, body: raw ? String(body) : JSON.stringify(body) }, s.env);

  it("validates and saves", async () => {
    const s = setup();
    expect((await post(s, "not json", true)).status).toBe(400);
    const noName = await post(s, { phone: "123" });
    expect(noName.status).toBe(400);
    expect((await noName.json() as { error: string }).error).toContain("business name");
    const noContact = await post(s, { business: "Joe's" });
    expect(noContact.status).toBe(400);
    const ok = await post(s, { business: "Joe's Plumbing", phone: "954-555-0100", contactEmail: "joe@x.test" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    const row = s.db.prepare("SELECT business, phone, contact_email, status FROM store_removal_requests").get() as Record<string, string>;
    expect(row).toEqual({ business: "Joe's Plumbing", phone: "954-555-0100", contact_email: "joe@x.test", status: "new" });
  });

  it("rate limits per network", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) expect((await post(s, { business: `B${i}`, phone: "1" })).status).toBe(200);
    expect((await post(s, { business: "B6", phone: "1" })).status).toBe(429);
  });
});
