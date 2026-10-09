// Routes of the public website (see src/store/site.ts for the pages, docs/platform-plan.md "URLs").
// While the owner hasn't switched on "public pages", every page asks search engines not to list it
// and robots.txt disallows everything.
// Also here: the public form posts (/api/contact, /api/remove-request), registered before the
// signed-in /api/* guard in src/store/index.ts.

import type { Context, Hono } from "hono";
import { stateName } from "../format";
import { storeBrand, type Brand } from "./brand";
import { paymentsReady } from "./payments";
import {
  catalogCities, catalogPage, catalogStates, FieldError, findCity, hasGoogleLeads, publicStats, saveContactMessage, saveRemovalRequest, siteSettings, slug, STATE_MIN,
} from "./public";
import {
  busyPage, categoryPage, cityPage, comingSoonPage, contactPage, faqPage, faviconSvg, homePage, legalPage, notFoundPage, pricingPage, removePage, robotsTxt, sitemapXml,
  statePage, statesPage, type LegalKind, type SiteBrand,
} from "./site";
import { checkTurnstile, turnstileOn } from "./turnstile";
import { StoreError, type StoreEnv } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type C = Context<any>;

const env = (c: C) => c.env as StoreEnv;
const ipOf = (c: C) => c.req.header("CF-Connecting-IP") ?? "local";

function robotsHeader(c: C, brand: Brand) {
  if (brand.publicPages) c.header("X-Robots-Tag", undefined);
  else c.header("X-Robots-Tag", "noindex, nofollow");
}

/** A public page: brand, robots header, short caching. */
function page(c: C, brand: Brand, html: string, status: 200 | 404 | 503 = 200) {
  robotsHeader(c, brand);
  c.header("Cache-Control", status === 200 ? "public, max-age=300" : "no-store");
  return c.html(html, status);
}

const FALLBACK_BRAND: Brand = {
  name: "Lead Store", color: "#e4572e", logoUrl: "", supportEmail: "", signupOpen: false, signupMode: "open", publicPages: false, creditPrice: null,
};

/** The brand plus what the pages show about money and the legal pages (two small reads). */
async function site(c: C) {
  const e = env(c);
  // The states (cached for hours) tell whether leads with a Google rating exist yet; if they can't
  // be read, the pages still render (offering them as usual).
  const [brand, s, states] = await Promise.all([storeBrand(e), siteSettings(e), catalogStates(e).catch(() => null)]);
  const b: SiteBrand = {
    ...brand, packs: s.packs, cardPayments: paymentsReady(e) && s.packs.length > 0, legalReviewed: s.legalReviewed,
    origin: new URL(c.req.url).origin, turnstileSiteKey: turnstileOn(e) ? e.TURNSTILE_SITE_KEY : "",
    googleLeads: states ? hasGoogleLeads(states) : true,
  };
  return { brand, b, prices: s.prices };
}

/** A state's catalog status: listed (its pages exist), soon (some businesses, not enough yet) or unknown. */
async function stateStatus(c: C, st: string) {
  const ST = st.toUpperCase();
  const s = /^[A-Z]{2}$/.test(ST) ? (await catalogStates(env(c))).find((x) => x.st === ST) : undefined;
  return { ST, row: s, listed: !!s && s.n >= STATE_MIN, name: stateName(ST) ?? ST };
}

/**
 * Catalog pages: when the database can't answer (even after one retry inside public.ts), a
 * branded "busy, try again" page with status 503 and Retry-After, never a bare 500.
 */
async function catalog(c: C, f: () => Promise<Response>): Promise<Response> {
  try {
    return await f();
  } catch (err) {
    console.error("catalog page failed", new URL(c.req.url).pathname, err);
    const brand = await storeBrand(env(c)).catch(() => FALLBACK_BRAND);
    c.header("Retry-After", "30");
    return page(c, brand, busyPage(brand), 503);
  }
}

/** Catalog paths are lowercase; send "/leads/FL" to "/leads/fl". */
function lowercaseRedirect(c: C) {
  const u = new URL(c.req.url);
  if (u.pathname !== u.pathname.toLowerCase()) return c.redirect(u.pathname.toLowerCase() + u.search, 301);
  return null;
}

const LEGAL: Record<string, LegalKind> = { terms: "terms", privacy: "privacy", "do-not-sell": "do-not-sell" };

async function jsonBody(c: C): Promise<Record<string, unknown> | null> {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function formError(c: C, err: unknown) {
  if (err instanceof FieldError) return c.json({ error: err.message, field: err.field }, err.status);
  if (err instanceof StoreError) return c.json({ error: err.message }, err.status);
  throw err;
}

export function mountSite(app: Hono<any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  // One address per page: "/pricing/" -> "/pricing", "/index.html" -> "/".
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") {
      const u = new URL(c.req.url);
      if (u.pathname === "/index.html") return c.redirect("/" + u.search, 301);
      if (u.pathname.length > 1 && u.pathname.endsWith("/") && !u.pathname.startsWith("/api/")) {
        return c.redirect((u.pathname.replace(/\/+$/, "") || "/") + u.search, 301);
      }
    }
    return next();
  });

  app.get("/", async (c) => {
    const e = env(c);
    const [{ brand, b, prices }, stats, states] = await Promise.all([site(c), publicStats(e).catch(() => null), catalogStates(e).catch(() => [])]);
    return page(c, brand, homePage(b, stats, states, prices));
  });
  app.get("/pricing", async (c) => {
    const { brand, b, prices } = await site(c);
    return page(c, brand, pricingPage(b, prices));
  });
  app.get("/faq", async (c) => {
    const { brand, b, prices } = await site(c);
    return page(c, brand, faqPage(b, prices));
  });
  app.get("/contact", async (c) => {
    const { brand, b } = await site(c);
    return page(c, brand, contactPage(b, { subject: c.req.query("subject") }));
  });
  app.get("/legal/:kind", async (c) => {
    const { brand, b } = await site(c);
    const kind = LEGAL[c.req.param("kind")];
    return kind ? page(c, brand, legalPage(b, kind)) : page(c, brand, notFoundPage(b), 404);
  });
  app.get("/remove", async (c) => {
    const { brand, b } = await site(c);
    return page(c, brand, removePage(b));
  });
  app.get("/favicon.svg", async (c) => {
    const brand = await storeBrand(env(c)).catch(() => FALLBACK_BRAND);
    return c.body(faviconSvg(brand), 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
  });
  app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 301));

  // Catalog
  app.get("/leads", (c) => catalog(c, async () => {
    const [{ brand, b }, states] = await Promise.all([site(c), catalogStates(env(c))]);
    return page(c, brand, statesPage(b, states));
  }));
  // States under STATE_MIN businesses are "coming soon" on the catalog: their own addresses (and
  // their cities' and trades') say so too, as a 404 so search engines don't list them.
  app.get("/leads/:st", (c) => catalog(c, async () => {
    const r = lowercaseRedirect(c); if (r) return r;
    const st = c.req.param("st");
    const [{ brand, b }, s] = await Promise.all([site(c), stateStatus(c, st)]);
    if (s.row && !s.listed) return page(c, brand, comingSoonPage(b, s.name), 404);
    const cities = s.listed ? await catalogCities(env(c), st) : [];
    if (!cities.length) return page(c, brand, notFoundPage(b, { catalog: true }), 404);
    return page(c, brand, statePage(b, st, s.name, cities, s.row?.n));
  }));
  app.get("/leads/:st/:city", (c) => catalog(c, async () => {
    const r = lowercaseRedirect(c); if (r) return r;
    const st = c.req.param("st"), city = c.req.param("city");
    const [{ brand, b }, s] = await Promise.all([site(c), stateStatus(c, st)]);
    if (s.row && !s.listed) return page(c, brand, comingSoonPage(b, s.name), 404);
    const found = s.listed ? await findCity(env(c), st, city) : null;
    if (!found) return page(c, brand, notFoundPage(b, { catalog: true }), 404);
    if (found.redirect) return c.redirect(`/leads/${st}/${found.redirect}`, 301);
    const g = found.group;
    const cats = g.cats.map(([category, n]) => ({ category, slug: slug(category), n })).filter((x) => x.slug);
    return page(c, brand, cityPage(b, st, stateName(st.toUpperCase()) ?? st.toUpperCase(), g.city, g.slug, cats, g.n));
  }));
  app.get("/leads/:st/:city/:cat", (c) => catalog(c, async () => {
    const r = lowercaseRedirect(c); if (r) return r;
    const st = c.req.param("st"), city = c.req.param("city"), cat = c.req.param("cat");
    const [{ brand, b }, s] = await Promise.all([site(c), stateStatus(c, st)]);
    if (s.row && !s.listed) return page(c, brand, comingSoonPage(b, s.name), 404);
    const found = s.listed ? await findCity(env(c), st, city) : null;
    if (!found) return page(c, brand, notFoundPage(b, { catalog: true }), 404);
    if (found.redirect) return c.redirect(`/leads/${st}/${found.redirect}/${cat}`, 301);
    const p = await catalogPage(env(c), st, found.group, cat);
    if (!p || !p.n) return page(c, brand, notFoundPage(b, { catalog: true }), 404);
    return page(c, brand, categoryPage(b, p, found.group.slug));
  }));

  // Search engines
  app.get("/robots.txt", async (c) => {
    const brand = await storeBrand(env(c));
    robotsHeader(c, brand);
    c.header("Cache-Control", "public, max-age=300");
    return c.text(robotsTxt(brand.publicPages, new URL(c.req.url).origin));
  });
  app.get("/sitemap.xml", async (c) => {
    const e = env(c);
    try {
      const [brand, states] = await Promise.all([storeBrand(e), catalogStates(e)]);
      const paths = ["/", "/pricing", "/faq", "/contact", "/remove", "/legal/terms", "/legal/privacy", "/legal/do-not-sell", "/leads"];
      const listed = states.filter((s) => s.n >= STATE_MIN);
      const all = await Promise.all(listed.map(async (s) => ({ st: s.st.toLowerCase(), cities: await catalogCities(e, s.st) })));
      for (const s of all) {
        paths.push(`/leads/${s.st}`);
        for (const g of s.cities) {
          paths.push(`/leads/${s.st}/${g.slug}`);
          for (const [category] of g.cats) { const k = slug(category); if (k) paths.push(`/leads/${s.st}/${g.slug}/${k}`); }
        }
      }
      robotsHeader(c, brand);
      c.header("Cache-Control", "public, max-age=300");
      return c.body(sitemapXml(new URL(c.req.url).origin, [...new Set(paths)].slice(0, 50_000)), 200, { "Content-Type": "application/xml; charset=utf-8" });
    } catch (err) {
      console.error("sitemap failed", err);
      return c.text("Busy, try again shortly.", 503, { "Retry-After": "60", "Cache-Control": "no-store" });
    }
  });

  // The contact form (public; Turnstile when it's on; rate limited in saveContactMessage).
  app.post("/api/contact", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Body must be JSON" }, 400);
    try {
      if (!(typeof body.website === "string" && body.website.trim())) await checkTurnstile(env(c), body.turnstile, ipOf(c));
      return c.json(await saveContactMessage(env(c), body, ipOf(c)));
    } catch (err) {
      return formError(c, err);
    }
  });

  // "Remove my business" (public, rate limited in saveRemovalRequest)
  app.post("/api/remove-request", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Body must be JSON" }, 400);
    try {
      return c.json(await saveRemovalRequest(env(c), body, ipOf(c)));
    } catch (err) {
      return formError(c, err);
    }
  });
}
