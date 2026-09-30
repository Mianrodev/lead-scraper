// Lead Store: the customer-facing app (separate Worker, shares the business database).
// See docs/store-api.md for the design. Customers search with contact details hidden, spend
// credits to unlock leads and download them. The owner manages accounts, credits and prices
// from the internal app's Admin page (src/store/admin.ts).

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { changePassword, login, logout, sessionFor, signup, SESSION_DAYS, STORE_COOKIE, type StoreAccount, type StoreUser } from "./auth";
import { buy, categories, creditHistory, downloadCsv, myLeads, places, searchLeads, storePrices } from "./catalog";
import { storeHtml } from "./page";
import { StoreError, type StoreEnv } from "./types";

type Vars = { Variables: { user: StoreUser; account: StoreAccount; token: string } };
const app = new Hono<{ Bindings: StoreEnv } & Vars>();

app.use("*", secureHeaders({
  xFrameOptions: "DENY",
  referrerPolicy: "same-origin",
  contentSecurityPolicy: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], fontSrc: ["https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "https:"], connectSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"], objectSrc: ["'none'"],
  },
}));
app.use("*", async (c, next) => {
  c.header("X-Robots-Tag", "noindex, nofollow"); // not public yet: keep it out of search engines
  // State changes must come from the store's own page.
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

async function brand(env: StoreEnv) {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN ('store_brand_name', 'store_brand_color', 'store_support_email', 'store_signup_open', 'store_logo_url')`,
  ).all<{ key: string; value: string }>();
  const v = Object.fromEntries(results.map((r) => [r.key, r.value ?? ""]));
  return {
    name: v.store_brand_name || "Lead Store",
    color: /^#[0-9a-f]{6}$/i.test(v.store_brand_color ?? "") ? v.store_brand_color : "#e4572e",
    logoUrl: v.store_logo_url ?? "",
    supportEmail: v.store_support_email ?? "",
    signupOpen: v.store_signup_open === "1",
  };
}

// --- Public ----------------------------------------------------------------------------
app.get("/", async (c) => c.html(storeHtml(await brand(c.env))));
app.get("/api/brand", async (c) => c.json({ ...(await brand(c.env)), prices: await storePrices(c.env) }));
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

// --- Signed in -------------------------------------------------------------------------
app.use("/api/*", async (c, next) => {
  const token = getCookie(c, STORE_COOKIE);
  const s = await sessionFor(c.env, token);
  if (!s) return c.json({ error: "Please sign in.", signIn: true }, 401);
  c.set("user", s.user); c.set("account", s.account); c.set("token", token!);
  return next();
});

app.get("/api/me", async (c) => {
  const u = c.get("user"), a = c.get("account");
  return c.json({ user: { name: u.name, email: u.email, mustChangePassword: !!u.must_change_password }, account: a, prices: await storePrices(c.env) });
});
app.post("/api/password", async (c) => {
  const b = await body<{ current?: string; next?: string }>(c);
  await changePassword(c.env, c.get("user").id, b.current ?? "", b.next ?? "", c.get("token"));
  return c.json({ ok: true });
});
app.get("/api/places", async (c) => c.json(await places(c.env, c.req.query("state") ?? null)));
app.get("/api/categories", async (c) => c.json(await categories(c.env)));
app.get("/api/leads", async (c) => c.json(await searchLeads(c.env, c.get("account"), new URL(c.req.url).searchParams)));
app.post("/api/buy", async (c) => {
  const b = await body<{ ids?: unknown; all?: unknown; dryRun?: unknown }>(c);
  return c.json(await buy(c.env, c.get("account"), b, new URL(c.req.url).searchParams, c.get("user").id));
});
app.get("/api/my-leads", async (c) => c.json(await myLeads(c.env, c.get("account"), new URL(c.req.url).searchParams)));
app.get("/api/credits", async (c) => c.json(await creditHistory(c.env, c.get("account"))));
app.get("/api/download", async (c) => {
  const format = c.req.query("format") === "cold_email" ? "cold_email" : "simple";
  const ids = (c.req.query("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const stream = await downloadCsv(c.env, c.get("account"), format, ids);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="leads-${format === "cold_email" ? "cold-email-" : ""}${date}.csv"` },
  });
});

app.notFound((c) => (new URL(c.req.url).pathname.startsWith("/api/") ? c.json({ error: "Not found" }, 404) : c.redirect("/")));

export default { fetch: app.fetch } satisfies ExportedHandler<StoreEnv>;
