// Lead platform: the public website (/, pricing, catalog of businesses) and the customer app
// (/app). Separate Worker; shares the business database. See docs/store-api.md and
// docs/platform-plan.md. The owner manages it from the internal app's Admin page.

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { changePassword, login, logout, sessionFor, signup, SESSION_DAYS, STORE_COOKIE, type StoreAccount, type StoreUser } from "./auth";
import { buy, type BuyBody, categories, creditHistory, downloadCsv, examples, freeAllowance, mapPoints, myLeads, places, searchLeads, storePrices } from "./catalog";
import { deleteList, getList, listLists, renameList } from "./lists";
import { storeBrand } from "./brand";
import { storeHtml } from "./page";
import { mountSite } from "./site-routes";
import { notFoundPage } from "./site";
import { addTeamMember, deleteSaved, listSaved, listTeam, removeTeamMember, saveSearch } from "./team";
import { StoreError, type StoreEnv } from "./types";
import { creditPacks, noteFeatures } from "./launch";
import { emailFrom, confirmEmail, needsEmailConfirmation, requestPasswordReset, resetPassword, sendVerification } from "./mail";
import { handleStripeWebhook, listPayments, notifyOwner, paymentsReady, paymentStatus, startCheckout } from "./payments";
import { checkTurnstile, turnstileOn } from "./turnstile";

type Vars = { Variables: { user: StoreUser; account: StoreAccount; token: string } };
const app = new Hono<{ Bindings: StoreEnv } & Vars>();

app.use("*", secureHeaders({
  xFrameOptions: "DENY",
  referrerPolicy: "strict-origin-when-cross-origin",
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    // The map library (Leaflet) comes from Cloudflare's CDN; fonts from Google Fonts; the
    // "I'm human" check (Turnstile, when switched on) from Cloudflare's challenges site.
    scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://challenges.cloudflare.com"],
    frameSrc: ["https://challenges.cloudflare.com"],
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
  return c.html(storeHtml({ ...(await storeBrand(c.env)), turnstileSiteKey: turnstileOn(c.env) ? c.env.TURNSTILE_SITE_KEY : "" }));
});
// The no-login demo: the same app on made-up businesses generated in the page. Its script never
// calls the customer API (so no real data can show) and never signs anyone in.
app.get("/demo", async (c) => {
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.html(storeHtml({ ...(await storeBrand(c.env)), turnstileSiteKey: "", demo: true }));
});
const originOf = (c: { req: { url: string } }) => new URL(c.req.url).origin;
// Stripe calls this when a card payment is confirmed (signed; no session cookie).
app.post("/api/stripe/webhook", async (c) => {
  const r = await handleStripeWebhook(c.env, await c.req.text(), c.req.header("Stripe-Signature"));
  return c.text(r.body, r.status as 200 | 400 | 404);
});
app.use("/api/*", async (c, next) => { await next(); c.header("X-Robots-Tag", "noindex, nofollow"); });
app.get("/api/brand", async (c) => {
  const b = await storeBrand(c.env);
  const [packs, from] = await Promise.all([creditPacks(c.env.DB), emailFrom(c.env)]);
  const features = { payments: paymentsReady(c.env), email: !!from, turnstile: turnstileOn(c.env) };
  c.executionCtx.waitUntil(noteFeatures(c.env.DB, features).catch(() => {}));
  return c.json({
    name: b.name, color: b.color, logoUrl: b.logoUrl, supportEmail: b.supportEmail, signupOpen: b.signupOpen, signupMode: b.signupMode, prices: await storePrices(c.env),
    creditPrice: b.creditPrice, packs, cardPayments: features.payments && packs.length > 0, emails: features.email,
  });
});
app.post("/api/signup", async (c) => {
  const b = await body<{ company?: string; name?: string; email?: string; password?: string; turnstile?: string }>(c);
  await checkTurnstile(c.env, b.turnstile, ip(c));
  const r = await signup(c.env, b, ip(c));
  // The "confirm your email" link (when emails are on); sign-up still works if sending fails.
  const sent = await sendVerification(c.env, r.userId, r.email, originOf(c), true).catch(() => ({ sent: false }));
  await notifyOwner(c.env, "info", `New store customer: ${r.company}${r.status === "pending" ? " (waiting for your approval on the Admin page)" : ""}.`, null).catch(() => {});
  return c.json({ ok: true, status: r.status, confirmEmail: sent.sent });
});
app.post("/api/password/forgot", async (c) => {
  const b = await body<{ email?: string; turnstile?: string }>(c);
  await checkTurnstile(c.env, b.turnstile, ip(c));
  return c.json(await requestPasswordReset(c.env, b.email, originOf(c)));
});
app.post("/api/password/reset", async (c) => {
  const b = await body<{ token?: string; password?: string }>(c);
  return c.json(await resetPassword(c.env, b.token, b.password));
});
app.post("/api/email/confirm", async (c) => c.json(await confirmEmail(c.env, (await body<{ token?: string }>(c)).token)));
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
    user: { name: u.name, email: u.email, role: u.role, mustChangePassword: !!u.must_change_password, needsEmailConfirmation: await needsEmailConfirmation(c.env, u) },
    account: a, prices: await storePrices(c.env), free: await freeAllowance(c.env, a.id),
  });
});
app.post("/api/email/resend", async (c) => {
  const u = c.get("user");
  if (!(await needsEmailConfirmation(c.env, u))) return c.json({ sent: false, already: true });
  return c.json(await sendVerification(c.env, u.id, u.email, originOf(c)));
});
app.post("/api/checkout", async (c) => {
  const b = await body<{ credits?: unknown }>(c);
  return c.json(await startCheckout(c.env, c.get("account"), c.get("user"), b.credits, originOf(c)));
});
app.get("/api/payments", async (c) => c.json(await listPayments(c.env, c.get("account"))));
app.get("/api/payments/:id", async (c) => c.json(await paymentStatus(c.env, c.get("account"), c.req.param("id"))));
app.post("/api/password", async (c) => {
  const b = await body<{ current?: string; next?: string }>(c);
  await changePassword(c.env, c.get("user").id, b.current ?? "", b.next ?? "", c.get("token"));
  return c.json({ ok: true });
});
app.get("/api/places", async (c) => c.json(await places(c.env, c.req.query("state") ?? null)));
app.get("/api/categories", async (c) => c.json(await categories(c.env)));
app.get("/api/examples", async (c) => c.json(await examples(c.env)));
app.get("/api/leads", async (c) => c.json(await searchLeads(c.env, c.get("account"), new URL(c.req.url).searchParams)));
app.get("/api/map", async (c) => c.json(await mapPoints(c.env, c.get("account"), new URL(c.req.url).searchParams)));
app.post("/api/buy", async (c) => {
  const b = await body<BuyBody>(c);
  if (b.dryRun !== true && (await needsEmailConfirmation(c.env, c.get("user")))) {
    throw new StoreError("Please confirm your email first: we sent you a link when you signed up. (Use “Send it again” at the top of the page.)", 403);
  }
  return c.json(await buy(c.env, c.get("account"), b, new URL(c.req.url).searchParams, c.get("user").id));
});
app.get("/api/my-leads", async (c) => c.json(await myLeads(c.env, c.get("account"), new URL(c.req.url).searchParams)));
app.get("/api/credits", async (c) => c.json({ ...(await creditHistory(c.env, c.get("account"))), free: await freeAllowance(c.env, c.get("account").id) }));
app.get("/api/download", async (c) => {
  const f = c.req.query("format");
  const format = f === "cold_email" || f === "json" ? f : "simple";
  const ids = (c.req.query("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  // list=<id>: exactly that list's leads (404 unless it is this account's list).
  const listId = c.req.query("list");
  const list = listId && !ids.length ? await getList(c.env, c.get("account"), listId) : null;
  const stream = await downloadCsv(c.env, c.get("account"), format, ids, new URL(c.req.url).searchParams);
  const date = new Date().toISOString().slice(0, 10);
  const base = list ? list.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "list" : "leads";
  const name = `${base}-${format === "cold_email" ? "cold-email-" : ""}${date}.${format === "json" ? "json" : "csv"}`;
  return new Response(stream, {
    headers: { "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
});
// Lists (one per "Get leads"; shared by the account's team). See src/store/lists.ts.
app.get("/api/lists", async (c) => c.json(await listLists(c.env, c.get("account"))));
app.get("/api/lists/:id", async (c) => {
  const account = c.get("account");
  const list = await getList(c.env, account, c.req.param("id"));
  const input = new URL(c.req.url).searchParams, p = new URLSearchParams();
  for (const k of ["page", "page_size", "q"]) { const v = input.get(k); if (v) p.set(k, v); }
  p.set("list", list.id);
  return c.json({ list, ...(await myLeads(c.env, account, p)) });
});
app.patch("/api/lists/:id", async (c) => c.json(await renameList(c.env, c.get("account"), c.req.param("id"), await body(c))));
app.delete("/api/lists/:id", async (c) => c.json(await deleteList(c.env, c.get("account"), c.req.param("id"))));
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
