import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { mountSite } from "../src/store/site-routes";
import { appFindLink, categoryInline, categoryName, categoryPage, contactPage, demoFindLink, homePage, removePage, robotsTxt, sitemapXml } from "../src/store/site";
import { cityKey, groupCities } from "../src/store/public";
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

/** Sellable Florida businesses without a city: enough for Florida to be listed (STATE_MIN = 500). */
const FILLER = 500;

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
  add("Drain Pros", { city: "Ft. Lauderdale", presence_score: 0, website_domain: null });
  add("Pipe Kings", { city: "fort lauderdale", presence_score: 72 });
  add("Leak Busters", { presence_score: null });
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${FILLER})
    INSERT INTO leads (id, google_place_id, business_name, state, data_source, business_status) SELECT 'fill' || i, 'fillp' || i, 'Filler', 'FL', 'free', 'operational' FROM n`);
  return { db, env, app: (() => { const a = new Hono<{ Bindings: StoreEnv }>(); mountSite(a); return a; })() };
}

const get = (s: ReturnType<typeof setup>, path: string) => s.app.request(path, {}, s.env);

describe("public site pages", () => {
  it("render every page with escaped brand values and noindex while not public", async () => {
    const s = setup();
    for (const p of ["/", "/pricing", "/faq", "/contact", "/contact?subject=access", "/legal/terms", "/legal/privacy", "/legal/do-not-sell", "/remove", "/leads", "/leads/fl", "/leads/fl/fort-lauderdale", "/leads/fl/fort-lauderdale/plumber"]) {
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
      expect(html, p).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
      expect(html, p).toContain('<meta property="og:type" content="website">');
      // Structured data can't close its script tag.
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) expect(() => JSON.parse(m[1])).not.toThrow();
    }
  });

  it("canonical links, favicon and structured data", async () => {
    const s = setup();
    const home = await (await s.app.request("https://leads.example.com/", {}, s.env)).text();
    expect(home).toContain('<link rel="canonical" href="https://leads.example.com/">');
    expect(home).toContain('"@type":"Organization"');
    expect(home).toContain("\\u003cscript>alert(1)"); // brand name escaped inside JSON-LD
    const faq = await (await s.app.request("https://leads.example.com/faq", {}, s.env)).text();
    expect(faq).toContain('"@type":"FAQPage"');
    const cat = await (await s.app.request("https://leads.example.com/leads/fl/fort-lauderdale/plumber", {}, s.env)).text();
    expect(cat).toContain('"@type":"BreadcrumbList"');
    expect(cat).toContain('<link rel="canonical" href="https://leads.example.com/leads/fl/fort-lauderdale/plumber">');
    const icon = await get(s, "/favicon.svg");
    expect(icon.headers.get("Content-Type")).toBe("image/svg+xml");
    const svg = await icon.text();
    expect(svg).toContain('fill="#e4572e"');
    expect(svg).toContain(">S</text>"); // first letter of the (hostile) brand name, never markup
  });

  it("one address per page: trailing slashes and /index.html redirect", async () => {
    const s = setup();
    for (const [from, to] of [["/pricing/", "/pricing"], ["/leads/fl/", "/leads/fl"], ["/index.html", "/"], ["/faq/?a=1", "/faq?a=1"]]) {
      const r = await get(s, from);
      expect(r.status, from).toBe(301);
      expect(r.headers.get("Location"), from).toBe(to);
    }
  });

  it("while sign-ups are closed: the demo first, then Request access; no sign-up or free-lead promises", async () => {
    const s = setup({ signupClosed: true });
    for (const p of ["/", "/pricing", "/faq", "/leads/fl/fort-lauderdale/plumber"]) {
      const html = await (await get(s, p)).text();
      expect(html, p).not.toContain('href="/app#signup"');
      expect(html, p).not.toContain("Start free");
      expect(html, p).toContain('href="/contact?subject=access">Request access</a>');
      expect(html, p).not.toMatch(/Your first 50 leads every month are free/);
    }
    const home = await (await get(s, "/")).text();
    expect(home).toContain('<a class="btn" href="/demo">Try the demo</a><a class="btn ghost" href="/contact?subject=access">Request access</a>');
    expect(home).toContain("When your account opens, your first 50 leads every month are free.");
    expect(home).toMatch(/<meta name="description" content="[^"]*Try the demo, no account needed\.">/);
    expect(home).toContain('<a class="btn small hdr-cta" href="/contact">Contact</a>');
    const contact = await (await get(s, "/contact")).text();
    expect(contact).toContain('<a class="btn small hdr-cta" href="/contact" aria-current="page">Contact</a>');
    const cat = await (await get(s, "/leads/fl/fort-lauderdale/plumber")).text();
    expect(cat).toContain('href="/demo#find?state=FL&amp;city=Fort%20Lauderdale%7CFL&amp;category=Plumber"');
    expect(cat).not.toContain("/app#find");
  });

  it("offers the no-login demo in the header, the hero, pricing, the footer and the closing call to action", async () => {
    for (const s of [setup(), setup({ signupClosed: true })]) {
      const home = await (await get(s, "/")).text();
      expect(home.match(/href="\/demo"/g)!.length).toBeGreaterThanOrEqual(4); // header, hero, closing band, footer
      expect(home).toMatch(/<a class="btn( ghost)?" href="\/demo">Try the demo<\/a>/);
      expect(home).toContain('<span class="wide">Try the demo</span>');
      expect(home).toContain('<li><a href="/demo">Try the demo</a></li>');
      expect(await (await get(s, "/pricing")).text()).toMatch(/<a class="btn( ghost)?" href="\/demo">Try the demo<\/a>/);
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
    expect(plain).not.toContain("(about $");
  });

  it("shows credit packs, and 'coming soon' only while card payments are off", async () => {
    const s = setup();
    s.db.prepare(`INSERT INTO app_settings (key, value) VALUES ('store_credit_packs', '[{"credits":100,"price":50},{"credits":500,"price":200}]') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    const off = await (await get(s, "/pricing")).text();
    expect(off).toContain("100 credits — $50 ($0.50 each)");
    expect(off).toContain("500 credits — $200 ($0.40 each)");
    expect(off).toContain("(about $1.50)"); // per lead, from the smallest pack
    expect(off).toContain("Card payments are coming soon");
    const on = await (await s.app.request("/pricing", {}, { ...s.env, STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "wh" } as StoreEnv)).text();
    expect(on).not.toContain("Card payments are coming soon");
    expect(on).toContain("Buy credits by card in the app");
    expect(await (await get(s, "/")).text()).toContain("Credit packs: 100 credits — $50 ($0.50 each)");
    expect(await (await get(s, "/faq")).text()).toContain("Credits come in packs from $50.");
  });

  it("promises only what downloads include", async () => {
    const s = setup();
    for (const p of ["/", "/pricing", "/faq"]) {
      const html = await (await get(s, p)).text();
      expect(html, p).not.toMatch(/Verified listing, photos, hours/i);
      expect(html, p).not.toContain("(Google)");
      expect(html, p).not.toMatch(/\bunlock/i);
      expect(html, p).not.toContain("41 reviews vs 380");
      expect(html, p).not.toContain("(UTC)");
    }
    const home = await (await get(s, "/")).text();
    for (const w of ["Phone numbers", "can get a text", "Up to three business emails", "Owner and contacts", "Employee range", "estimated revenue", "year founded"]) expect(home).toContain(w);
    expect(await (await get(s, "/faq")).text()).toContain("Weak (under 40)");
  });

  it("legal pages: draft banner until a lawyer checked them, and a real date", async () => {
    const s = setup();
    for (const p of ["/legal/terms", "/legal/privacy", "/legal/do-not-sell"]) {
      const html = await (await get(s, p)).text();
      expect(html).toContain("Draft — to be reviewed by a lawyer before launch");
      expect(html).toContain("Last updated: October 9, 2026");
      expect(html).toContain('<a href="/contact">contact form</a>');
    }
    s.db.prepare(`INSERT INTO app_settings (key, value) VALUES ('store_legal_reviewed', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    expect(await (await get(s, "/legal/terms")).text()).not.toContain("Draft —");
  });

  it("category page shows counts and escaped samples, never form leads or contact details", async () => {
    const s = setup();
    const html = await (await get(s, "/leads/fl/fort-lauderdale/plumber")).text();
    expect(html).toContain("<h1>Plumbers in Fort Lauderdale, FL</h1>");
    expect(html).toContain("6 plumbers in Fort Lauderdale, Florida");
    expect(html).toContain("&lt;img src=x onerror=alert(5)&gt; Pipes");
    expect(html).toContain("Joe&#39;s Plumbing");
    expect(html).toContain("Ann &amp; Co");
    expect(html).toContain("Drain Pros"); // "Ft. Lauderdale" is the same city
    expect(html).not.toContain("Hidden Form Lead");
    expect(html).not.toContain("9545550100");
    expect(html).toContain("See all 6 in the app");
    expect(html).toContain('href="/app#find?state=FL&amp;city=Fort%20Lauderdale%7CFL&amp;category=Plumber&amp;n=6"');
    // Scores in the app's words; no "0" for a business without a website or a score.
    expect(html).toContain('<span class="sc ok" title="Online score 72 of 100">Good 72</span>');
    expect(html).toContain('<span class="sc warn" title="Online score 40 of 100">Basic 40</span>');
    expect(html).toContain('<span class="sc none">No website</span>');
    expect(html).toContain('<span class="sc none">Not scored</span>');
    expect(html).not.toMatch(/online score 0/i);
    // Average leaves out unscored: (40 * 3 + 72) / 4 = 48.
    expect(html).toContain("<b>48</b><span>average online score");
    // The richest record (a website and a score) comes first, the no-website one last.
    expect(html.indexOf("Pipe Kings")).toBeLessThan(html.indexOf("Drain Pros"));
  });

  it("other spellings of a city redirect to the one address", async () => {
    const s = setup();
    for (const [from, to] of [["/leads/fl/ft-lauderdale", "/leads/fl/fort-lauderdale"], ["/leads/fl/ft-lauderdale/plumber", "/leads/fl/fort-lauderdale/plumber"]]) {
      const r = await get(s, from);
      expect(r.status, from).toBe(301);
      expect(r.headers.get("Location"), from).toBe(to);
    }
    const state = await (await get(s, "/leads/fl")).text();
    expect(state.match(/href="\/leads\/fl\/[^"]*"/g)).toEqual(['href="/leads/fl/fort-lauderdale"']);
    expect(state).toContain(`${6 + FILLER} businesses in Florida`);
  });

  it("state page total matches the state tile (smaller towns counted)", async () => {
    const s = setup();
    s.db.prepare(`INSERT INTO leads (id, google_place_id, business_name, gbp_category, city, state, data_source, business_status) VALUES ('t1', 't1', 'Tiny', 'Plumber', 'Smallville', 'FL', 'free', 'operational')`).run();
    const html = await (await get(s, "/leads/fl")).text();
    expect(html).toContain(`${7 + FILLER} businesses in Florida: 1 city with its own page, plus ${1 + FILLER} businesses in smaller towns.`);
  });

  it("long state pages show the top 30 and a 'Show all' list", async () => {
    const s = setup();
    for (let c = 0; c < 35; c++) for (let i = 0; i < 3; i++) {
      s.db.prepare(`INSERT INTO leads (id, google_place_id, business_name, gbp_category, city, state, data_source, business_status) VALUES (?, ?, 'B', 'Plumber', ?, 'FL', 'free', 'operational')`).run(`c${c}-${i}`, `c${c}-${i}`, `Town ${c}`);
    }
    const html = await (await get(s, "/leads/fl")).text();
    expect(html).toContain("<summary>Show all 36 cities</summary>");
    expect(html).toContain('id="cityfilter"');
    const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.includes("cityfilter"))!;
    expect(() => new Function(js)).not.toThrow();
    expect(js).not.toMatch(/[`\\]|\$\{/);
  });

  it("small states are 'coming soon' (on the catalog and on their own addresses); small trades get no page", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) s.db.prepare(`INSERT INTO leads (id, google_place_id, business_name, gbp_category, city, state, data_source, business_status) VALUES (?, ?, 'B', 'Plumber', 'Atlanta', 'GA', 'free', 'operational')`).run(`ga${i}`, `ga${i}`);
    const leads = await (await get(s, "/leads")).text();
    expect(leads).toContain("Coming soon");
    expect(leads).toContain('href="/leads/fl"');
    expect(leads).not.toContain('href="/leads/ga"');
    expect(leads).not.toContain("Browse the catalog</a>"); // no self-link on catalog pages
    for (const p of ["/leads/ga", "/leads/ga/atlanta", "/leads/ga/atlanta/plumber"]) {
      const r = await get(s, p);
      expect(r.status, p).toBe(404);
      expect(await r.text(), p).toContain("<h1>Georgia is coming soon</h1>");
    }
    s.db.prepare(`INSERT INTO leads (id, google_place_id, business_name, gbp_category, city, state, data_source, business_status) VALUES ('d1', 'd1', 'Doc', 'Dentist', 'Fort Lauderdale', 'FL', 'free', 'operational')`).run();
    expect((await get(s, "/leads/fl/fort-lauderdale/dentist")).status).toBe(404);
    expect(await (await get(s, "/leads/fl/fort-lauderdale")).text()).not.toContain("/dentist");
  });

  it("unknown slugs get a friendly 404 (catalog words only under /leads)", async () => {
    const s = setup();
    for (const p of ["/leads/zz", "/leads/florida", "/leads/fl/nowhere", "/leads/fl/fort-lauderdale/dentist"]) {
      const r = await get(s, p);
      expect(r.status, p).toBe(404);
      const html = await r.text();
      expect(html).toContain("find that page");
      expect(html).toContain("place or trade");
    }
    const legal = await (await get(s, "/legal/other")).text();
    expect(legal).toContain("find that page");
    expect(legal).not.toContain("place or trade");
  });

  it("a busy database gives a branded 503, not a 500", async () => {
    const s = setup();
    const brokenDb = {
      prepare: (sql: string) => {
        if (/FROM leads|api_cache/.test(sql)) throw new Error("D1 overloaded");
        return (s.env.DB as unknown as { prepare: (q: string) => unknown }).prepare(sql);
      },
      batch: s.env.DB.batch,
    };
    const r = await s.app.request("/leads/fl", {}, { ...s.env, DB: brokenDb } as unknown as StoreEnv);
    expect(r.status).toBe(503);
    expect(r.headers.get("Retry-After")).toBe("30");
    expect(await r.text()).toContain("We're a little busy right now");
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
    for (let i = 0; i < 500; i++) s.db.prepare(`INSERT INTO leads (id, google_place_id, business_name, gbp_category, city, state, data_source, business_status) VALUES (?, ?, 'B', 'Roofer', 'Miami', 'FL', 'free', 'operational')`).run(`m${i}`, `m${i}`);
    const r = await s.app.request("https://leads.example.com/robots.txt", {}, s.env);
    const txt = await r.text();
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Sitemap: https://leads.example.com/sitemap.xml");
    const home = await s.app.request("https://leads.example.com/", {}, s.env);
    expect(home.headers.get("X-Robots-Tag")).toBeNull();
    const map = await (await s.app.request("https://leads.example.com/sitemap.xml", {}, s.env)).text();
    expect(map).toContain("<loc>https://leads.example.com/leads/fl/fort-lauderdale</loc>");
    expect(map).toContain("<loc>https://leads.example.com/leads/fl/fort-lauderdale/plumber</loc>");
    expect(map).toContain("<loc>https://leads.example.com/leads/fl/miami/roofer</loc>");
    expect(map).toContain("<loc>https://leads.example.com/pricing</loc>");
    // The demo is fake data (noindex), so it isn't in the sitemap.
    expect(map).not.toContain("<loc>https://leads.example.com/demo</loc>");
    expect(map).not.toContain("ft-lauderdale");
    const locs = [...map.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("render helpers", () => {
    expect(robotsTxt(false, "https://a.test")).toBe("User-agent: *\nDisallow: /\n");
    expect(sitemapXml("https://a.test", ["/a?b=1&c=2", "/a?b=1&c=2"]).match(/<loc>https:\/\/a\.test\/a\?b=1&amp;c=2<\/loc>/g)).toHaveLength(1);
    expect(appFindLink("fl", "St. Mary's", "Hair & Nails")).toBe("/app#find?state=FL&city=St.%20Mary's%7CFL&category=Hair%20%26%20Nails");
    expect(appFindLink("fl", "Tampa", "Plumber", 42)).toBe("/app#find?state=FL&city=Tampa%7CFL&category=Plumber&n=42");
    expect(demoFindLink("fl", "Tampa", "Plumber")).toBe("/demo#find?state=FL&city=Tampa%7CFL&category=Plumber");
  });
});

describe("cities and categories", () => {
  it("one key per city however it is spelled", () => {
    const same = (xs: string[]) => expect(new Set(xs.map((x) => cityKey(x, "FL"))).size, xs.join(" / ")).toBe(1);
    same(["St Petersburg", "Saint Petersburg", "St. Petersburg", "ST Petersburg", "St.petersburg", "Saint-Petersburg"]);
    same(["Fort Lauderdale", "Ft Lauderdale", "Ft. Lauderdale", "fort lauderdale"]);
    same(["Port St Lucie", "Port Saint Lucie", "Port St. Lucie", "Port St.Lucie", "port saint lucie"]);
    same(["West Palm Beach", "West Palm Bch", "West-Palm-Beach"]);
    same(["Altamonte Springs", "Altamonte Spg"]);
    same(["Mount Dora", "Mt Dora"]);
    same(["North Fort Myers", "N Fort Myers", "N Ft Myers", "North-Fort-Myers"]);
    same(["Fort Myers", "Fort Myers Fl", "Ft. Myers"]);
    same(["Land O' Lakes", "Land O Lakes"]);
    expect(cityKey("Miami", "FL")).not.toBe(cityKey("Miami Beach", "FL"));
  });

  it("groups spellings, shows the most common, sums counts, and keeps every spelling", () => {
    const g = groupCities([
      { city: "St Petersburg", category: "Plumber", n: 4 }, { city: "Saint Petersburg", category: "Plumber", n: 2 }, { city: "St. Petersburg", category: "Electrician", n: 1 },
      { city: "Tinytown", category: "Plumber", n: 2 },
    ], "FL");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ city: "St. Petersburg", slug: "st-petersburg", n: 7, cats: [["Plumber", 6]] });
    expect(g[0].names).toEqual(["St Petersburg", "Saint Petersburg", "St. Petersburg"]);
  });

  it("merges Florida's two-name places and writes city names one way", () => {
    for (const [a, b2] of [["Dania", "Dania Beach"], ["Hallandale", "Hallandale Beach"], ["Lake Worth", "Lake Worth Beach"], ["Ponte Vedra", "Ponte Vedra Beach"], ["Grant", "Grant-Valkaria"], ["La Belle", "LaBelle"]]) {
      expect(cityKey(a, "FL"), a).toBe(cityKey(b2, "FL"));
    }
    expect(cityKey("Grant", "MN")).not.toBe(cityKey("Grant-Valkaria", "MN")); // only in Florida
    const shown = (rows: [string, number][]) => groupCities(rows.map(([city, n]) => ({ city, category: null, n })), "FL", 1).map((g) => g.city);
    expect(shown([["St Petersburg", 9]])).toEqual(["St. Petersburg"]);
    expect(shown([["SAINT CLOUD", 9]])).toEqual(["St. Cloud"]);
    expect(shown([["Port Saint Lucie", 9]])).toEqual(["Port St. Lucie"]);
    expect(shown([["Opa Locka", 9]])).toEqual(["Opa-locka"]);
    expect(shown([["Land O Lakes", 9]])).toEqual(["Land O' Lakes"]);
    expect(shown([["Labelle", 9]])).toEqual(["LaBelle"]);
    expect(shown([["Debary", 9]])).toEqual(["DeBary"]);
    expect(shown([["Deland", 9]])).toEqual(["DeLand"]);
    expect(shown([["Defuniak Springs", 9]])).toEqual(["DeFuniak Springs"]);
    expect(shown([["Dania", 5], ["Dania Beach", 4]])).toEqual(["Dania Beach"]);
    expect(shown([["Stuart", 3]])).toEqual(["Stuart"]);
  });

  it("category display names", () => {
    expect(categoryName("Plumber")).toBe("Plumbers");
    expect(categoryName("HVAC contractor")).toBe("HVAC contractors");
    expect(categoryInline("HVAC contractor")).toBe("HVAC contractors");
    expect(categoryInline("Pest control service")).toBe("pest control services");
    expect(categoryName("Handyman/Handywoman/Handyperson")).toBe("Handymen");
    expect(categoryName("Handyman/Handywoman/Handyperson", false)).toBe("Handyman");
    expect(categoryName("Locksmith")).toBe("Locksmiths");
    expect(categoryName("Chimney sweep")).toBe("Chimney sweeps");
  });
});

describe("render functions", () => {
  const brand = { name: "Goes Local", color: "#123abc", logoUrl: "https://cdn.example.com/l.png", supportEmail: "help@example.com" };
  const prices = { free: 1, google: 3, freePerMonth: 50 };

  it("home shows the hero, stats, and brand logo/color", () => {
    const html = homePage(brand, { businesses: 2000, withPhone: 1500, withEmail: 500, withWebsite: 1000, withOwner: 0, states: 2, categories: 9 }, [{ st: "FL", name: "Florida", n: 2000 }, { st: "CA", name: "California", n: 100 }], prices);
    expect(html).toContain("Find local businesses that");
    expect(html).toContain("Start free — 50 leads a month");
    expect(html).toContain("75%");
    expect(html).not.toContain("<b>0%</b>"); // tiles at 0% are hidden
    expect(html).toContain('<img class="logoimg" src="https://cdn.example.com/l.png" alt="Goes Local">');
    expect(html).toContain('[data-theme="dark"] .logoimg { background: #fff;');
    expect(html).toContain("--brand: #123abc;");
    expect(html).toContain("Online score");
    expect(html).not.toMatch(/html, body \{ overflow-x: hidden/);
    expect(homePage({ ...brand, logoUrl: "" }, null, [], prices)).toContain("<span>Local leads</span>");
    expect(html).toContain('href="/leads/fl"');
    expect(html).not.toContain('href="/leads/ca"'); // under 500 businesses
  });

  it("one lead-type vocabulary; leads with a Google rating are 'coming soon' while there are none", async () => {
    const s = setup(); // only Standard (open data) leads
    for (const p of ["/", "/pricing", "/faq"]) {
      const html = await (await get(s, p)).text();
      expect(html, p).not.toMatch(/Premium/);
      expect(html, p).toMatch(/coming soon/i);
      expect(html, p).not.toContain("of either type");
    }
    expect(await (await get(s, "/pricing")).text()).toContain('With Google rating<span class="soon">Coming soon</span>');
    s.db.prepare(`UPDATE leads SET data_source = 'google' WHERE id = 'fill1'`).run();
    s.db.prepare(`DELETE FROM api_cache`).run();
    const on = await (await get(s, "/pricing")).text();
    expect(on).not.toContain('<span class="soon">');
    expect(on).toContain("a lead with a Google rating costs 3 credits");
  });

  it("score bands, 'Site down', tidy sample names and no '0%' in descriptions", () => {
    const html = categoryPage(brand, {
      st: "FL", stateName: "Florida", city: "Tampa", category: "Plumber", n: 4, withPhone: 4, withEmail: 0, withWebsite: 2, withOwner: 0, avgScore: 50,
      samples: [{ name: "ACME PLUMBING LLC", rating: null, reviews: null, score: 85, website: true }, { name: "U.s. Pipes", rating: null, reviews: null, score: 0, website: true },
        { name: "P&a Drains", rating: null, reviews: null, score: 0, website: false }],
    }, "tampa");
    expect(html).toContain('<span class="sc strong" title="Online score 85 of 100">Strong 85</span>');
    expect(html).toContain("<b>Acme Plumbing LLC</b>");
    expect(html).toContain("<b>U.S. Pipes</b>");
    expect(html).toContain("<b>P&amp;A Drains</b>");
    expect(html).toContain('<span class="sc none">Site down</span>');
    expect(html).toContain('<span class="sc none">No website</span>');
    expect(html).toMatch(/<meta name="description" content="4 plumbers in Tampa, FL: 100% with phone, 50% with a website\.">/);
    expect(html).not.toMatch(/[^0-9]0% with/);
    const home = homePage(brand, null, [], prices);
    expect(home).toContain("Weak under 40, Basic 40 to 59, Good 60 to 79, Strong 80 and up");
  });

  it("home counts only listed states and doesn't promise a page for every city", () => {
    const html = homePage(brand, { businesses: 2000, withPhone: 1500, withEmail: 500, withWebsite: 1000, withOwner: 0, states: 2, categories: 9 },
      [{ st: "FL", name: "Florida", n: 2000 }, { st: "CA", name: "California", n: 100 }], prices);
    expect(html).toContain("Across 1 state and 9 business categories");
    expect(html).not.toContain("Every city and trade has its own page");
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

  it("form scripts parse and have no template-literal leftovers", () => {
    for (const html of [removePage({ ...brand, supportEmail: "" }), contactPage(brand)]) {
      // Three inline scripts: the theme boot, the form script and the theme toggle.
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(scripts.length).toBe(3);
      const js = scripts.find((s) => s.includes("data-api"))!;
      expect(() => new Function(js)).not.toThrow();
      expect(js).not.toMatch(/[`\\]|\$\{/);
      expect(html).toContain("This form needs JavaScript. Please enable it");
      expect(html).toContain('id="fdone" class="done" tabindex="-1"');
    }
    expect(removePage({ ...brand, supportEmail: "" })).toContain('<a href="/contact">contact us</a>');
  });

  it("contact page: support email when set, request-access subject, Turnstile when on", () => {
    const html = contactPage(brand, { subject: "access" });
    expect(html).toContain("<h1>Request access</h1>");
    expect(html).toContain('<option value="access" selected>Request access</option>');
    expect(html).toContain('href="mailto:help@example.com"');
    expect(html).toContain('name="website" type="text" tabindex="-1"');
    expect(html).not.toContain('class="cf-turnstile"');
    expect(html).not.toContain("using the details above");
    const ts = contactPage({ ...brand, turnstileSiteKey: "0x4AAA" });
    expect(ts).toContain('<div class="cf-turnstile" data-sitekey="0x4AAA"></div>');
    expect(ts).toContain('src="https://challenges.cloudflare.com/turnstile/v0/api.js"');
    expect(contactPage({ ...brand, supportEmail: "" })).not.toContain("mailto:");
  });
});

describe("contact form", () => {
  const post = (s: ReturnType<typeof setup>, body: unknown, raw = false, ip = "1.2.3.4", env?: StoreEnv) =>
    s.app.request("/api/contact", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: raw ? String(body) : JSON.stringify(body) }, env ?? s.env);

  it("validates, saves and tells the owner", async () => {
    const s = setup();
    expect((await post(s, "nope", true)).status).toBe(400);
    const noName = await post(s, { email: "a@b.co", message: "hi" });
    expect(noName.status).toBe(400);
    expect(await noName.json()).toEqual({ error: "Enter your name.", field: "name" });
    expect(((await (await post(s, { name: "Al", email: "nope", message: "hi" })).json()) as { field: string }).field).toBe("email");
    expect(((await (await post(s, { name: "Al", email: "a@b.co", message: "" })).json()) as { field: string }).field).toBe("message");
    // Too short to act on (the page checks the same 5 characters).
    expect(await (await post(s, { name: "Al", email: "a@b.co", message: "hi" })).json()).toEqual({ error: "Write a little more, so we know how to help.", field: "message" });
    expect(contactPage({ name: "X", color: "#000000", supportEmail: "" })).toContain('data-min="5"');
    const ok = await post(s, { name: "Al Smith", email: "al@agency.test", subject: "access", message: "We sell websites to plumbers. " + "x".repeat(400) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    const row = s.db.prepare("SELECT name, email, subject, status FROM store_messages").get() as Record<string, string>;
    expect(row).toEqual({ name: "Al Smith", email: "al@agency.test", subject: "Request access", status: "new" });
    const note = s.db.prepare("SELECT level, kind, message FROM notifications").get() as Record<string, string>;
    expect(note.level).toBe("info");
    expect(note.kind).toBe("store");
    expect(note.message).toContain("Al Smith (al@agency.test), Request access: We sell websites to plumbers.");
    expect(note.message.length).toBeLessThan(400);
  });

  it("drops bot posts (honeypot) without saving", async () => {
    const s = setup();
    const r = await post(s, { name: "Bot", email: "b@b.co", message: "buy", website: "http://spam.test" });
    expect(r.status).toBe(200);
    expect((s.db.prepare("SELECT COUNT(*) AS n FROM store_messages").get() as { n: number }).n).toBe(0);
  });

  it("rate limits per network and checks Turnstile when it's on", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) expect((await post(s, { name: "A", email: "a@b.co", message: `message ${i}` })).status).toBe(200);
    expect((await post(s, { name: "A", email: "a@b.co", message: "message 6" })).status).toBe(429);
    expect((await post(s, { name: "A", email: "a@b.co", message: "hello" }, false, "5.6.7.8")).status).toBe(200);
    const on = { ...s.env, TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET_KEY: "s" } as StoreEnv;
    const r = await post(s, { name: "A", email: "a@b.co", message: "hello" }, false, "9.9.9.9", on);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain("I'm human");
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
    expect(await noName.json()).toEqual({ error: "Enter the business name.", field: "business" });
    const noContact = await post(s, { business: "Joe's" });
    expect(noContact.status).toBe(400);
    expect(((await noContact.json()) as { field: string }).field).toBe("phone");
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