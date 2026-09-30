// Routes of the public website (see src/store/site.ts for the pages, docs/platform-plan.md "URLs").
// While the owner hasn't switched on "public pages", every page asks search engines not to list it
// and robots.txt disallows everything.

import type { Context, Hono } from "hono";
import { stateName } from "../format";
import { storeBrand, type Brand } from "./brand";
import { catalogCategories, catalogCities, catalogPage, catalogStates, publicPrices, publicStats, saveRemovalRequest } from "./public";
import {
  categoryPage, cityPage, contactPage, faqPage, homePage, legalPage, notFoundPage, pricingPage, removePage, robotsTxt, sitemapXml,
  statePage, statesPage, type LegalKind,
} from "./site";
import { StoreError, type StoreEnv } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type C = Context<any>;

const env = (c: C) => c.env as StoreEnv;

function robotsHeader(c: C, brand: Brand) {
  if (brand.publicPages) c.header("X-Robots-Tag", undefined);
  else c.header("X-Robots-Tag", "noindex, nofollow");
}

/** A public page: brand, robots header, short caching. */
function page(c: C, brand: Brand, html: string, status: 200 | 404 = 200) {
  robotsHeader(c, brand);
  c.header("Cache-Control", status === 200 ? "public, max-age=300" : "no-store");
  return c.html(html, status);
}

/** Catalog paths are lowercase; send "/leads/FL" to "/leads/fl". */
function lowercaseRedirect(c: C) {
  const u = new URL(c.req.url);
  if (u.pathname !== u.pathname.toLowerCase()) return c.redirect(u.pathname.toLowerCase() + u.search, 301);
  return null;
}

const LEGAL: Record<string, LegalKind> = { terms: "terms", privacy: "privacy", "do-not-sell": "do-not-sell" };

export function mountSite(app: Hono<any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  app.get("/", async (c) => {
    const e = env(c);
    const [brand, stats, states, prices] = await Promise.all([storeBrand(e), publicStats(e).catch(() => null), catalogStates(e).catch(() => []), publicPrices(e)]);
    return page(c, brand, homePage(brand, stats, states, prices));
  });
  app.get("/pricing", async (c) => {
    const [brand, prices] = await Promise.all([storeBrand(env(c)), publicPrices(env(c))]);
    return page(c, brand, pricingPage(brand, prices));
  });
  app.get("/faq", async (c) => {
    const [brand, prices] = await Promise.all([storeBrand(env(c)), publicPrices(env(c))]);
    return page(c, brand, faqPage(brand, prices));
  });
  app.get("/contact", async (c) => {
    const brand = await storeBrand(env(c));
    return page(c, brand, contactPage(brand));
  });
  app.get("/legal/:kind", async (c) => {
    const brand = await storeBrand(env(c));
    const kind = LEGAL[c.req.param("kind")];
    return kind ? page(c, brand, legalPage(brand, kind)) : page(c, brand, notFoundPage(brand), 404);
  });
  app.get("/remove", async (c) => {
    const brand = await storeBrand(env(c));
    return page(c, brand, removePage(brand));
  });

  // Catalog
  app.get("/leads", async (c) => {
    const [brand, states] = await Promise.all([storeBrand(env(c)), catalogStates(env(c))]);
    return page(c, brand, statesPage(brand, states));
  });
  app.get("/leads/:st", async (c) => {
    const r = lowercaseRedirect(c); if (r) return r;
    const st = c.req.param("st");
    const [brand, cities] = await Promise.all([storeBrand(env(c)), catalogCities(env(c), st)]);
    if (!cities.length) return page(c, brand, notFoundPage(brand), 404);
    return page(c, brand, statePage(brand, st, stateName(st.toUpperCase()) ?? st.toUpperCase(), cities));
  });
  app.get("/leads/:st/:city", async (c) => {
    const r = lowercaseRedirect(c); if (r) return r;
    const st = c.req.param("st"), city = c.req.param("city");
    const [brand, cats] = await Promise.all([storeBrand(env(c)), catalogCategories(env(c), st, city)]);
    if (!cats || !cats.categories.length) return page(c, brand, notFoundPage(brand), 404);
    return page(c, brand, cityPage(brand, st, stateName(st.toUpperCase()) ?? st.toUpperCase(), cats.city, city, cats.categories));
  });
  app.get("/leads/:st/:city/:cat", async (c) => {
    const r = lowercaseRedirect(c); if (r) return r;
    const st = c.req.param("st"), city = c.req.param("city"), cat = c.req.param("cat");
    const [brand, p] = await Promise.all([storeBrand(env(c)), catalogPage(env(c), st, city, cat)]);
    if (!p || !p.n) return page(c, brand, notFoundPage(brand), 404);
    return page(c, brand, categoryPage(brand, p, city));
  });

  // Search engines
  app.get("/robots.txt", async (c) => {
    const brand = await storeBrand(env(c));
    robotsHeader(c, brand);
    c.header("Cache-Control", "public, max-age=300");
    return c.text(robotsTxt(brand.publicPages, new URL(c.req.url).origin));
  });
  app.get("/sitemap.xml", async (c) => {
    const e = env(c);
    const [brand, states] = await Promise.all([storeBrand(e), catalogStates(e)]);
    const paths = ["/", "/pricing", "/faq", "/contact", "/remove", "/legal/terms", "/legal/privacy", "/legal/do-not-sell", "/leads"];
    const cities = await Promise.all(states.map(async (s) => ({ st: s.st.toLowerCase(), cities: await catalogCities(e, s.st) })));
    for (const s of cities) {
      paths.push(`/leads/${s.st}`);
      for (const x of s.cities) paths.push(`/leads/${s.st}/${x.slug}`);
    }
    robotsHeader(c, brand);
    c.header("Cache-Control", "public, max-age=300");
    return c.body(sitemapXml(new URL(c.req.url).origin, paths.slice(0, 50_000)), 200, { "Content-Type": "application/xml; charset=utf-8" });
  });

  // "Remove my business" (public, rate limited in saveRemovalRequest)
  app.post("/api/remove-request", async (c) => {
    let body: Record<string, unknown>;
    try {
      const b = await c.req.json();
      body = b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
    } catch {
      return c.json({ error: "Body must be JSON" }, 400);
    }
    try {
      return c.json(await saveRemovalRequest(env(c), body, c.req.header("CF-Connecting-IP") ?? "local"));
    } catch (err) {
      if (err instanceof StoreError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });
}
