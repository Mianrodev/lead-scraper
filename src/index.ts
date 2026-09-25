import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import {
  AuthError,
  changeOwnPassword,
  clearSessionCookie,
  countUsers,
  createUser,
  HIDDEN_EMAIL,
  listUsers,
  requireAdmin,
  requireSuperAdmin,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
  signIn,
  signOut,
  updateUser,
  userForToken,
  type User,
} from "./auth";
import { dashboardHtml } from "./dashboard";
import { loginHtml } from "./login-page";
import { assertWithinBudget, audit, BudgetError, dailyChecks, dismissNotification, getBudget, listAudit, listNotifications, monthSpend, setBudget } from "./ops";
import { exportCsv } from "./export";
import { findLeads, type FindRequest } from "./find";
import { listCities, listCountries, listRegions } from "./geo";
import { US_STATES } from "./format";
import { categoryTree, leadFacets, listLeads, listSearches } from "./leads";
import { backfillDerivedColumns } from "./maintenance";
import { checkPendingPhones } from "./phone";
import {
  checkSearch,
  createSearch,
  getSearch,
  RepeatPullError,
  REPEAT_WINDOW_DAYS,
  syncActiveSearches,
  syncSearch,
  ValidationError,
  type SearchInput,
} from "./pipeline";

// Auth: team members sign in with email + password (src/auth.ts). Everything except the
// sign-in page and its API needs a signed-in user; user management needs an admin.

const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();

app.onError((err, c) => {
  if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
  if (err instanceof BudgetError) return c.json({ error: err.message, budget: true }, 409);
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof RepeatPullError) {
    return c.json({ error: err.message, repeat: true, windowDays: REPEAT_WINDOW_DAYS, previous: err.previous }, 409);
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.use("*", secureHeaders({ xFrameOptions: "DENY", referrerPolicy: "same-origin" }));

// --- Sign-in (public) ---------------------------------------------------------

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/setup", "/api/auth/status"];

const body = async <T>(c: { req: { json: <U>() => Promise<U> } }) =>
  c.req.json<T>().catch(() => {
    throw new ValidationError("Body must be JSON");
  });

app.get("/login", (c) => c.html(loginHtml));

app.get("/api/auth/status", async (c) => {
  const user = await userForToken(c.env, getCookie(c, SESSION_COOKIE));
  return c.json({ needsSetup: (await countUsers(c.env)) === 0, signedIn: !!user, mustChangePassword: !!user?.must_change_password });
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await body<{ email: string; password: string }>(c);
  let result;
  try {
    result = await signIn(c.env, email, password);
  } catch (err) {
    // Failed sign-ins are recorded against the account they tried (never the super admin's).
    const target = await c.env.DB.prepare(`SELECT id, name, role FROM users WHERE email = ?`)
      .bind(String(email ?? "").trim().toLowerCase())
      .first<Pick<User, "id" | "name" | "role">>();
    if (target) await audit(c.env, target, "sign_in_failed", { reason: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  const { token, user } = result;
  setSessionCookie(c, token);
  await audit(c.env, user, "signed_in");
  return c.json({ ok: true, mustChangePassword: !!user.must_change_password });
});

// First admin: only while there are no users, and only with the SETUP_CODE secret.
app.post("/api/auth/setup", async (c) => {
  const { code, email, name, password } = await body<{ code: string; email: string; name?: string; password: string }>(c);
  if ((await countUsers(c.env)) > 0) throw new AuthError("Setup is already done. Sign in instead.", 403);
  const expected = c.env.SETUP_CODE;
  if (!expected || typeof code !== "string" || code.length !== expected.length || code !== expected) {
    throw new AuthError("That setup code isn't right.", 403);
  }
  await createUser(c.env, { email, name, password, role: "super_admin" });
  const { token } = await signIn(c.env, email, password);
  setSessionCookie(c, token);
  return c.json({ ok: true, mustChangePassword: false });
});

// --- Everything below needs a signed-in user -------------------------------------

app.use("*", requireUser(PUBLIC_PATHS));

app.post("/api/auth/logout", async (c) => {
  await audit(c.env, c.get("user"), "signed_out");
  await signOut(c.env, getCookie(c, SESSION_COOKIE));
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get("/api/me", (c) => {
  const u = c.get("user");
  return c.json({ id: u.id, email: HIDDEN_EMAIL, name: u.name, role: u.role, mustChangePassword: !!u.must_change_password });
});

app.post("/api/me/password", async (c) => {
  const { current, next } = await body<{ current: string; next: string }>(c);
  await changeOwnPassword(c.env, c.get("user"), current, next);
  await audit(c.env, c.get("user"), "password_changed");
  return c.json({ ok: true });
});

// Team management (admins only).
app.get("/api/admin/users", requireAdmin, async (c) => c.json(await listUsers(c.env)));
app.post("/api/admin/users", requireAdmin, async (c) => {
  const { email, name, password, role } = await body<{ email: string; name?: string; password: string; role?: "admin" | "member" }>(c);
  const user = await createUser(c.env, { email, name, password, role: role === "admin" ? "admin" : "member", mustChange: true });
  await audit(c.env, c.get("user"), "team_member_added", { name: user.name, role: user.role });
  return c.json({ ...user, email: HIDDEN_EMAIL }, 201);
});
app.patch("/api/admin/users/:id", requireAdmin, async (c) => {
  const changes = await body<{ active?: boolean; role?: "admin" | "member"; password?: string; name?: string }>(c);
  await updateUser(c.env, c.get("user"), c.req.param("id"), changes);
  const target = await c.env.DB.prepare(`SELECT name FROM users WHERE id = ?`).bind(c.req.param("id")).first<string>("name");
  await audit(c.env, c.get("user"), "team_member_changed", {
    name: target,
    ...(changes.active != null ? { active: changes.active } : {}),
    ...(changes.role ? { role: changes.role } : {}),
    ...(changes.password ? { passwordReset: true } : {}),
  });
  return c.json({ ok: true });
});

app.get("/", (c) => (c.get("user").must_change_password ? c.redirect("/login") : c.html(dashboardHtml)));

// Before running a search: has this category + city + state been pulled recently?
app.get("/api/search/check", async (c) =>
  c.json(await checkSearch(c.env, c.req.query("category") ?? "", c.req.query("city") ?? "")),
);

// Refuses (409) to repeat a recent pull unless the body has "force": true.
app.post("/api/search", async (c) => {
  const input = await body<SearchInput>(c);
  const max = input.maxResults ?? Number(c.env.MAX_RESULTS_DEFAULT);
  await assertWithinBudget(c.env, max > 0 ? max * 0.005 : null, "this pull");
  const search = await createSearch(c.env, { ...input, createdBy: c.get("user").id });
  await audit(c.env, c.get("user"), "pull_started", { category: search.category, city: search.city, state: search.state, maxResults: search.max_results });
  return c.json(search, search.status === "failed" ? 502 : 201);
});

// Pull history, with filters: category, city, state, status, from, to (YYYY-MM-DD).
app.get("/api/searches", async (c) => c.json(await listSearches(c.env, new URL(c.req.url).searchParams)));

app.get("/api/searches/:id", async (c) => {
  const search = await getSearch(c.env, c.req.param("id"));
  if (!search) return c.json({ error: "Not found" }, 404);
  return c.json(search);
});

// Manual poke, so you don't have to wait for the next cron tick.
app.post("/api/searches/:id/sync", async (c) => {
  const search = await syncSearch(c.env, c.req.param("id"));
  if (!search) return c.json({ error: "Not found" }, 404);
  return c.json(search);
});

app.get("/api/leads", async (c) => c.json(await listLeads(c.env, new URL(c.req.url).searchParams)));

app.get("/api/leads/facets", async (c) => c.json(await leadFacets(c.env, new URL(c.req.url).searchParams)));

// "Find leads": body { categories[], locations[{city?, state}], maxResults?, sourceCode?, mode }.
// mode "plan" only reports what we have vs what would be pulled (and the cost); it never spends.
app.post("/api/find", async (c) => {
  const input = await body<FindRequest>(c);
  const result = await findLeads(c.env, { ...input, createdBy: c.get("user").id });
  const user = c.get("user");
  const what = { types: [...new Set(result.combinations.map((x) => x.category))], places: [...new Set(result.combinations.map((x) => x.place.label))] };
  if (result.countCost > 0) await audit(c.env, user, "counts_checked", { ...what, costUsd: Math.round(result.countCost * 1000) / 1000 });
  if (result.mode === "pull_missing" || result.mode === "refresh_all") {
    const started = result.combinations.filter((x) => x.started);
    if (started.length) {
      await audit(c.env, user, "pull_started", {
        ...what, mode: result.mode, searches: started.length, maxResults: result.maxResults || "no limit",
        estimatedCostUsd: result.mode === "pull_missing" ? result.estimatedCostMissing : result.estimatedCostAll, checkPhones: result.checkPhones,
      });
    }
  }
  if (result.mode === "use_existing" && result.checkPhones) await audit(c.env, user, "phone_checks_started", { ...what, estimatedCostUsd: result.estimatedCostExisting });
  return c.json(result);
});

// Country -> state/province -> city pickers (GeoNames: cities with 15,000+ people).
app.get("/api/geo/countries", async (c) => c.json(await listCountries(c.env)));
app.get("/api/geo/regions", async (c) => c.json(await listRegions(c.env, c.req.queries("country") ?? [])));
app.get("/api/geo/cities", async (c) =>
  c.json(
    await listCities(c.env, {
      countries: c.req.queries("country") ?? [],
      regions: c.req.queries("region") ?? [],
      q: c.req.query("q"),
      limit: Number(c.req.query("limit")) || undefined,
    }),
  ),
);

// CSV in the GHL upload format, for every lead matching the given filters (same params as /api/leads).
app.get("/api/export", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const stream = await exportCsv(c.env, params);
  await audit(c.env, c.get("user"), "csv_downloaded", { filters: Object.fromEntries([...new Set(params.keys())].map((k) => [k, params.getAll(k).join(", ")])) });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${date}.csv"`,
    },
  });
});

// States for the "Where" picker, plus cities we already have businesses in.
app.get("/api/places", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT city, state, COUNT(*) AS n FROM leads WHERE city IS NOT NULL AND city <> '' AND state IS NOT NULL
     GROUP BY city, state ORDER BY city`,
  ).all<{ city: string; state: string; n: number }>();
  return c.json({ states: US_STATES, knownCities: results });
});

// Industry -> category list (for the picker and the search box), with stored counts.
app.get("/api/categories", async (c) => c.json(await categoryTree(c.env)));

// Runs the phone check on demand (the cron does this every minute anyway).
app.post("/api/phones/check", async (c) =>
  c.json(await checkPendingPhones(c.env, Number(c.req.query("limit")) || undefined)),
);

// Recompute derived columns (website domain, street address, status) for stored leads.
app.post("/api/admin/backfill", requireAdmin, async (c) => {
  await audit(c.env, c.get("user"), "maintenance_backfill");
  return c.json(await backfillDerivedColumns(c.env));
});

// Notifications: problems worth knowing about (failed pulls, paused phone checks, low credit, budget).
app.get("/api/notifications", async (c) => c.json(await listNotifications(c.env)));
app.post("/api/notifications/:id/dismiss", async (c) => {
  await dismissNotification(c.env, Number(c.req.param("id")), c.get("user").id);
  await audit(c.env, c.get("user"), "notification_dismissed", { id: Number(c.req.param("id")) });
  return c.json({ ok: true });
});

// Monthly spending limit: everyone can see it, only the super admin can change it.
app.get("/api/budget", async (c) => c.json(await monthSpend(c.env)));
app.put("/api/budget", requireSuperAdmin, async (c) => {
  const { amount } = await body<{ amount: number }>(c);
  await setBudget(c.env, Number(amount));
  return c.json(await monthSpend(c.env));
});

// Activity log (super admin only). The super admin's own actions aren't recorded.
app.get("/api/admin/audit", requireSuperAdmin, async (c) => c.json(await listAudit(c.env, new URL(c.req.url).searchParams)));

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(syncActiveSearches(env).then(() => checkPendingPhones(env)).then(() => dailyChecks(env)));
  },
} satisfies ExportedHandler<Env>;
