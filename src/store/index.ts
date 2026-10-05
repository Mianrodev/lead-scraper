// Lead platform: the public website (/, pricing, catalog of businesses) and the customer app
// (/app). Separate Worker; shares the business database. See docs/store-api.md and
// docs/platform-plan.md. The owner manages it from the internal app's Admin page.

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { changePassword, login, logout, sessionFor, signup, SESSION_DAYS, STORE_COOKIE, type StoreAccount, type StoreUser } from "./auth";
import { buy, type BuyBody, categories, creditHistory, downloadCsv, freeAllowance, mapPoints, myLeads, places, searchLeads, storePrices } from "./catalog";
import { storeBrand } from "./brand";
import { storeHtml } from "./page";
import { mountSite } from "./site-routes";
import { notFoundPage } from "./site";
import { addTeamMember, deleteSaved, listSaved, listTeam, removeTeamMember, saveSearch } from "./team";
import { StoreError, type StoreEnv } from "./types";

type Vars = { Variables: { user: StoreUser; account: StoreAccount; token: string } };
const app = new Hono<{ Bindings: StoreEnv } & Vars>();

app.use("*", secureHeaders({
  xFrameOptions: "DENY",
  referrerPolicy: "strict-origin-when-cross-origin",
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    // The map library (Leaflet) comes from Cloudflare's CDN; fonts from Google Fonts.
    scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
    fontSrc: ["https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "https:"], // logo and map tiles
    connectSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"], objectSrc: ["'none'"],
  },
}));
app.use("*", async (c, next) => {
  // State changes must come from the site's own pages.
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Cross-site request refused" }, 403);
  }
  return next();
});

app.onError((err, c) => {
  if (err instanceof StoreError) return c.json({ error: err.message }, err.status);
  console.error("store error", err);
  return c.json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
});

const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? "local";
const body = async <T,>(c: { req: { json: <U>() => Promise<U> } }) => c.req.json<T>().catch(() => { throw new StoreError("Body must be JSON"); });

// --- Public website + catalog (src/store/site-routes.ts) -------------------------------
mountSite(app);

// --- The customer app -----------------------------------------------------------------
app.get("/app", async (c) => {
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.html(storeHtml(await storeBrand(c.env)));
});
app.use("/api/*", async (c, next) => { await next(); c.header("X-Robots-Tag", "noindex, nofollow"); });
app.get("/api/brand", async (c) => {
  const b = await storeBrand(c.env);
  return c.json({
    name: b.name, color: b.color, logoUrl: b.logoUrl, supportEmail: b.supportEmail, signupOpen: b.signupOpen, signupMode: b.signupMode,
    creditPrice: b.creditPrice, prices: await storePrices(c.env),
  });
});
app.post("/api/signup", async (c) => c.json(await signup(c.env, await body(c), ip(c))));
app.post("/api/login", async (c) => {
  const b = await body<{ email?: string; password?: string }>(c);
  const token = await login(c.env, b.email ?? "", b.password ?? "", ip(c));
  setCookie(c, STORE_COOKIE, token, { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86400 });
  return c.json({ ok: true });
});
app.post("/api/logout", async (c) => {
  await logout(c.env, getCookie(c, STORE_COOKIE));
  deleteCookie(c, STORE_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// Signed in (the public removal form lives in site-routes and is registered before this).
app.use("/api/*", async (c, next) => {
  const token = getCookie(c, STORE_COOKIE);
  const s = await sessionFor(c.env, token);
  if (!s) return c.json({ error: "Please sign in.", signIn: true }, 401);
  c.set("user", s.user); c.set("account", s.account); c.set("token", token!);
  return next();
});

app.get("/api/me", async (c) => {
  const u = c.get("user"), a = c.get("account");
  return c.json({
    user: { name: u.name, email: u.email, role: u.role, mustChangePassword: !!u.must_change_password },
    account: a, prices: await storePrices(c.env), free: await freeAllowance(c.env, a.id),
  });
});
app.post("/api/password", async (c) => {
  const b = await body<{ current?: string; next?: string }>(c);
  await changePassword(c.env, c.get("user").id, b.current ?? "", b.next ?? "", c.get("token"));
  return c.json({ ok: true });
});
app.get("/api/places", async (c) => c.json(await places(c.env, c.req.query("state") ?? null)));
app.get("/api/categories", async (c) => c.json(await categories(c.env)));
app.get("/api/leads", async (c) => c.json(await searchLeads(c.env, c.get("account"), new URL(c.req.url).searchParams)));
app.get("/api/map", async (c) => c.json(await mapPoints(c.env, c.get("account"), new URL(c.req.url).searchParams)));
app.post("/api/buy", async (c) => {
  const b = await body<BuyBody>(c);
  return c.json(await buy(c.env, c.get("account"), b, new URL(c.req.url).searchParams, c.get("user").id));
});
app.get("/api/my-leads", async (c) => c.json(await myLeads(c.env, c.get("account"), new URL(c.req.url).searchParams)));
app.get("/api/credits", async (c) => c.json({ ...(await creditHistory(c.env, c.get("account"))), free: await freeAllowance(c.env, c.get("account").id) }));
app.get("/api/download", async (c) => {
  const f = c.req.query("format");
  const format = f === "cold_email" || f === "json" ? f : "simple";
  const ids = (c.req.query("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const stream = await downloadCsv(c.env, c.get("account"), format, ids, new URL(c.req.url).searchParams);
  const date = new Date().toISOString().slice(0, 10);
  const name = `leads-${format === "cold_email" ? "cold-email-" : ""}${date}.${format === "json" ? "json" : "csv"}`;
  return new Response(stream, {
    headers: { "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
});
app.get("/api/saved", async (c) => c.json(await listSaved(c.env, c.get("account"))));
app.post("/api/saved", async (c) => c.json(await saveSearch(c.env, c.get("account"), await body(c))));
app.delete("/api/saved/:id", async (c) => c.json(await deleteSaved(c.env, c.get("account"), c.req.param("id"))));
app.get("/api/team", async (c) => c.json(await listTeam(c.env, c.get("account"), c.get("user"))));
app.post("/api/team", async (c) => c.json(await addTeamMember(c.env, c.get("account"), c.get("user"), await body(c))));
app.delete("/api/team/:id", async (c) => c.json(await removeTeamMember(c.env, c.get("account"), c.get("user"), c.req.param("id"))));

app.notFound(async (c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
  c.header("X-Robots-Tag", "noindex");
  return c.html(notFoundPage(await storeBrand(c.env)), 404);
});

export default { fetch: app.fetch } satisfies ExportedHandler<StoreEnv>;
