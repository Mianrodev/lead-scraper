import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import {
  allowSignInAttempt,
  recordFailedSignIn,
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
import { assertWithinBudget, audit, BudgetError, dailyChecks, dismissNotification, listAudit, listNotifications, monthSpend, notify, setBudget } from "./ops";
import { exportCsv, exportFormat } from "./export";
import { findLeads, resolveRequest, type FindRequest } from "./find";
import { listCities, listCountries, listRegions } from "./geo";
import { US_STATES } from "./format";
import { buildLeadQuery, categoryTree, leadFacets, listLeads, listSearches, resolveFilters, sqlString } from "./leads";
import { backfillDerivedColumns, trimRawStep } from "./maintenance";
import { backupAsSql, backupStep, listBackups } from "./backup";
import { claimNextImport, requeueImport, collectorAuthorized, collectorChunk, collectorDone, collectorFailed, collectorSpec, collectorStarted, dispatchCollector, freeSaveStep, freeSavingStatus, freeWaiting, freeWatchdog } from "./free";
import { previewGoogleDetails, startGoogleDetails } from "./google-details";
import { addToHarvest, harvestTick, listHarvest, removeFromHarvest, setHarvestSettings } from "./harvest";
import { claimWebsites, nudgeChecker, queueNewWebsites, queueWebsiteChecks, saveWebsiteResults, setWebsiteCheckSettings, websiteCheckStatus, websitesWaiting, websiteWatchdog } from "./website-audit";
import { scoreStep } from "./scoring";
import { pageSpeedStep } from "./pagespeed";
import { deleteSavedSearch, listSavedSearches, savedSearchAlerts, saveSearch, updateSavedSearch } from "./saved-searches";
import { checkPendingPhones, MAX_PHONE_REQUEST, phoneStatus, requestPhoneChecks } from "./phone";
import {
  checkSearch,
  createSearch,
  getSearch,
  RepeatPullError,
  REPEAT_WINDOW_DAYS,
  syncActiveSearches,
  resumeSearch,
  cancelSearch,
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
  // Cloudflare's free plan has a daily database allowance; say so plainly when it runs out.
  if (/exceeded.*(daily|free tier).*(limit|read|write)|daily .*limit/i.test(String((err as Error)?.message ?? err))) {
    const message = "The free daily database allowance is used up. Lead Finder works again after midnight UTC (8 pm New York). Nothing is lost.";
    if (!new URL(c.req.url).pathname.startsWith("/api/")) return c.html(`<!doctype html><meta charset="utf-8"><title>Lead Finder</title><p style="font:16px system-ui;margin:40px">${message}</p>`, 503);
    return c.json({ error: message, limit: true }, 503);
  }
  return c.json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
});

app.use(
  "*",
  secureHeaders({
    xFrameOptions: "DENY",
    referrerPolicy: "same-origin",
    // The pages are self-contained (inline script/style); nothing is loaded from elsewhere
    // except logo images, and the app can't be embedded in another site.
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      objectSrc: ["'none'"],
    },
  }),
);

// --- Sign-in (public) ---------------------------------------------------------

// The free collector (GitHub Actions / a computer) has its own secret instead of a sign-in.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/setup", "/api/auth/status", "/api/free/collector/*"];

const body = async <T>(c: { req: { json: <U>() => Promise<U> } }) =>
  c.req.json<T>().catch(() => {
    throw new ValidationError("Body must be JSON");
  });

app.get("/login", (c) => c.html(loginHtml));

const clientIp = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? "local";

app.get("/api/auth/status", async (c) => {
  const user = await userForToken(c.env, getCookie(c, SESSION_COOKIE));
  return c.json({ needsSetup: (await countUsers(c.env)) === 0, signedIn: !!user, mustChangePassword: !!user?.must_change_password });
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await body<{ email: string; password: string }>(c);
  await allowSignInAttempt(c.env, clientIp(c));
  let result;
  try {
    result = await signIn(c.env, email, password);
  } catch (err) {
    await recordFailedSignIn(c.env, clientIp(c));
    // Failed sign-ins are recorded against the account they tried. The super admin isn't in
    // the activity log, so attempts on their account go to the notification bell instead.
    const target = await c.env.DB.prepare(`SELECT id, name, role FROM users WHERE email = ?`)
      .bind(String(email ?? "").trim().toLowerCase())
      .first<Pick<User, "id" | "name" | "role">>();
    if (target?.role === "super_admin") {
      await notify(c.env, {
        kind: "security", level: "warn",
        message: "Someone tried to sign in to the super admin account with a wrong password today. If it wasn't you, consider changing your password.",
        dedupeKey: `sa-signin-failed-${new Date().toISOString().slice(0, 10)}`,
      });
    } else if (target) await audit(c.env, target, "sign_in_failed", { reason: "wrong password" });
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
  await allowSignInAttempt(c.env, clientIp(c));
  if ((await countUsers(c.env)) > 0) throw new AuthError("Setup is already done. Sign in instead.", 403);
  const expected = c.env.SETUP_CODE;
  if (!expected || typeof code !== "string" || code.length !== expected.length || code !== expected) {
    await recordFailedSignIn(c.env, clientIp(c));
    throw new AuthError("That setup code isn't right.", 403);
  }
  await createUser(c.env, { email, name, password, role: "super_admin" });
  const { token } = await signIn(c.env, email, password);
  setSessionCookie(c, token);
  return c.json({ ok: true, mustChangePassword: false });
});

// --- Free collector (scripts/overture_collect.py), authorised by FREE_COLLECTOR_SECRET ------------
app.use("/api/free/collector/*", async (c, next) => {
  if (!(await collectorAuthorized(c.env, c.req.header("Authorization")))) return c.json({ error: "Not allowed" }, 401);
  return next();
});
// Website check (scripts/website_check.py): is anything waiting, take a batch, send findings.
app.post("/api/free/collector/websites/waiting", async (c) => c.json({ waiting: await websitesWaiting(c.env) }));
app.post("/api/free/collector/websites/claim", async (c) => c.json({ items: await claimWebsites(c.env) }));
app.post("/api/free/collector/websites/results", async (c) => {
  const b = await body<{ results?: unknown[] }>(c);
  return c.json(await saveWebsiteResults(c.env, Array.isArray(b.results) ? b.results : []));
});
// The scheduled collector asks for the next waiting collection (or nothing).
app.post("/api/free/collector/next", async (c) => c.json({ importId: await claimNextImport(c.env) }));
app.get("/api/free/collector/:id/spec", async (c) => {
  const spec = await collectorSpec(c.env, c.req.param("id"));
  return spec ? c.json(spec) : c.json({ error: "Unknown collection" }, 404);
});
app.post("/api/free/collector/:id/started", async (c) => {
  const b = await c.req.json<{ release?: string; runner?: string }>().catch(() => ({}) as { release?: string; runner?: string });
  await collectorStarted(c.env, c.req.param("id"), b.release ?? null, b.runner ?? null);
  return c.json({ ok: true });
});
app.post("/api/free/collector/:id/chunk", async (c) => {
  const n = Number(c.req.query("n")), rows = Number(c.req.query("rows")), searchId = c.req.query("search_id") ?? "";
  if (!Number.isInteger(n) || !Number.isInteger(rows) || rows < 0 || !searchId) throw new ValidationError("Bad chunk");
  const body = await c.req.arrayBuffer();
  if (body.byteLength > 20_000_000) throw new ValidationError("Chunk too big");
  await collectorChunk(c.env, c.req.param("id"), searchId, n, rows, body);
  return c.json({ ok: true });
});
app.post("/api/free/collector/:id/done", async (c) => {
  const b = await body<{ perSearch?: Record<string, number>; release?: string | null }>(c);
  await collectorDone(c.env, c.req.param("id"), b.perSearch ?? {}, b.release ?? null);
  return c.json({ ok: true });
});
app.post("/api/free/collector/:id/failed", async (c) => {
  const b = await body<{ error?: string }>(c);
  await collectorFailed(c.env, c.req.param("id"), String(b.error ?? "unknown error"));
  return c.json({ ok: true });
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
  await changeOwnPassword(c.env, c.get("user"), current, next, getCookie(c, SESSION_COOKIE));
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

// Older single-search route. Refuses (409) to repeat a recent pull unless the body has "force": true.
// Only the basic fields are accepted: the cost the budget relies on is worked out here, not sent in.
app.post("/api/search", async (c) => {
  const raw = await body<SearchInput>(c);
  const input: SearchInput = {
    category: String(raw.category ?? ""), city: String(raw.city ?? ""), state: raw.state ?? null,
    countryCode: raw.countryCode ?? null, maxResults: raw.maxResults ?? null, force: raw.force === true,
  };
  const max = input.maxResults ?? Number(c.env.MAX_RESULTS_DEFAULT);
  if (max <= 0 || max > Number(c.env.MAX_RESULTS_DEFAULT)) throw new ValidationError(`Up to ${c.env.MAX_RESULTS_DEFAULT} businesses here; use "Find leads" for bigger searches.`);
  await assertWithinBudget(c.env, max * 0.005, "this search");
  const search = await createSearch(c.env, { ...input, estimatedCost: max * 0.005, createdBy: c.get("user").id });
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

// Resume a failed pull without paying again (continues saving what the scraper collected).
app.post("/api/searches/:id/resume", async (c) => {
  const search = await resumeSearch(c.env, c.req.param("id"));
  if (!search) return c.json({ error: "Not found" }, 404);
  await audit(c.env, c.get("user"), "pull_resumed", { category: search.category, city: search.city, state: search.state });
  return c.json(search);
});

// Stop a pull that is still collecting; what it already collected is saved.
app.post("/api/searches/:id/cancel", async (c) => {
  const search = await cancelSearch(c.env, c.req.param("id"), c.get("user").id);
  if (!search) return c.json({ error: "Not found" }, 404);
  await audit(c.env, c.get("user"), "pull_cancelled", { category: search.category, city: search.city, state: search.state });
  return c.json(search);
});

// Manual poke, so you don't have to wait for the next cron tick.
app.post("/api/searches/:id/sync", async (c) => {
  const search = await syncSearch(c.env, c.req.param("id"));
  if (!search) return c.json({ error: "Not found" }, 404);
  return c.json(search);
});

app.get("/api/leads", async (c) => c.json(await listLeads(c.env, new URL(c.req.url).searchParams)));

// How phone checks are going: waiting count and a plain-language line (cheap; no checks run).
app.get("/api/phones/status", async (c) => c.json(await phoneStatus(c.env)));

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
      "Content-Disposition": `attachment; filename="leads-${{ ghl: "", cold_email: "cold-email-", simple: "simple-" }[exportFormat(params.get("format"))]}${date}.csv"`,
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
  c.json(await checkPendingPhones(c.env, Number(c.req.query("limit")) || undefined, { force: true })),
);

// Check (or re-check) phone types for chosen businesses, verified or not: body { ids } for
// specific ones, or no ids to use every business matching the filters in the query string.
// dryRun: true only counts and prices it. The minute timer / open page then does the checks.
app.post("/api/phones/request", async (c) => {
  const { ids, recheck, dryRun } = await body<{ ids?: string[]; recheck?: boolean; dryRun?: boolean }>(c);
  let leadIds = Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  let capped = false;
  if (!leadIds.length && !Array.isArray(ids)) {
    // Every business in the list (with or without a phone), so the answer can say exactly why
    // nothing needs checking: no phone, already checked, or already waiting.
    const q = buildLeadQuery(await resolveFilters(c.env, new URL(c.req.url).searchParams));
    const { results } = await c.env.DB.prepare(
      `${q.with} SELECT id FROM ${q.source} ORDER BY (gbp_phone_formatted IS NULL), (phone_type IS NOT NULL) LIMIT ${MAX_PHONE_REQUEST + 1}`,
    )
      .bind(...q.binds)
      .all<{ id: string }>();
    capped = results.length > MAX_PHONE_REQUEST;
    leadIds = results.map((r) => r.id);
  }
  const preview = await requestPhoneChecks(c.env, leadIds, { recheck: !!recheck, dryRun: true });
  const budget = await monthSpend(c.env);
  // Paid checks must fit the budget, unless a free service is set up to do them.
  const paidOnly = preview.maxPerCheck > 0 && !preview.hasFreeService;
  if (dryRun || !preview.queued) return c.json({ ...preview, capped, limit: MAX_PHONE_REQUEST, budgetLeft: budget.left, fits: !paidOnly || preview.maxCostUsd <= budget.left });
  if (paidOnly) await assertWithinBudget(c.env, preview.maxCostUsd, "these phone checks");
  const result = await requestPhoneChecks(c.env, leadIds, { recheck: !!recheck });
  await audit(c.env, c.get("user"), "phone_checks_requested", { count: result.queued, recheck: !!recheck, maxCostUsd: result.maxCostUsd });
  await c.env.INGEST_QUEUE?.send({ phones: true, force: true }).catch(() => undefined);
  return c.json({ ...result, capped, limit: MAX_PHONE_REQUEST, budgetLeft: budget.left, fits: true });
});

// Free tier: saving progress and the daily limit; recent collections; start a collector again.
app.get("/api/free/status", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, created_at, status, runner, release, rows_received, error, finished_at FROM free_imports ORDER BY created_at DESC LIMIT 10`,
  ).all();
  const seen = await c.env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'collector_seen_at'`).first<string>("value");
  return c.json({ ...(await freeSavingStatus(c.env)), collectorSeenAt: seen, imports: results });
});
app.put("/api/free/settings", requireSuperAdmin, async (c) => {
  const { dailyLimit } = await body<{ dailyLimit: number }>(c);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1_000_000) throw new ValidationError("Daily limit must be 0 (no limit) or a whole number.");
  await c.env.DB.prepare(`UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = 'free_daily_limit'`).bind(String(dailyLimit)).run();
  return c.json(await freeSavingStatus(c.env));
});
// Put a waiting or failed collection back in line (and nudge GitHub straight away when a token is set).
app.post("/api/free/imports/:id/dispatch", requireAdmin, async (c) => {
  const ok = await requeueImport(c.env, c.req.param("id"));
  if (!ok) return c.json({ ok: false, error: "That collection is already running or finished." });
  const d = await dispatchCollector(c.env, c.req.param("id"));
  return c.json({ ok: true, error: d.error, note: d.ok ? "Started." : "Queued: the free collector picks it up within about 10 minutes." });
});

// Daily free collection: the list (admins), switching it on and the pace (super admin).
app.get("/api/harvest", requireAdmin, async (c) => c.json(await listHarvest(c.env)));
app.post("/api/harvest", requireAdmin, async (c) => {
  const b = await body<Pick<FindRequest, "categories" | "locations" | "radiusMiles">>(c);
  const { categories, places } = await resolveRequest(c.env, b);
  const r = await addToHarvest(c.env, categories.flatMap((category) => places.map((place) => ({ category, place }))), c.get("user").id);
  await audit(c.env, c.get("user"), "harvest_added", { added: r.added });
  return c.json(r);
});
app.delete("/api/harvest/:id", requireAdmin, async (c) => { await removeFromHarvest(c.env, c.req.param("id")); return c.json({ ok: true }); });
app.put("/api/harvest/settings", requireSuperAdmin, async (c) => {
  const b = await body<{ enabled: boolean; target: number }>(c);
  try { await setHarvestSettings(c.env, { enabled: b.enabled === true, target: Number(b.target) }); } catch (err) { throw new ValidationError((err as Error).message); }
  return c.json(await listHarvest(c.env));
});

// Paid tier: "Get Google details" for free businesses (ids, or every business matching the filters).
app.post("/api/google-details", async (c) => {
  const { ids, dryRun, retryNotFound } = await body<{ ids?: string[]; dryRun?: boolean; retryNotFound?: boolean }>(c);
  let leadIds = Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  if (!Array.isArray(ids)) {
    const q = buildLeadQuery(await resolveFilters(c.env, new URL(c.req.url).searchParams));
    const { results } = await c.env.DB.prepare(`${q.with} SELECT id FROM ${q.source} WHERE data_source = 'free' LIMIT 5000`).bind(...q.binds).all<{ id: string }>();
    leadIds = results.map((r) => r.id);
  }
  if (dryRun) {
    const { ids: _ids, ...preview } = await previewGoogleDetails(c.env, leadIds, { retryNotFound: !!retryNotFound });
    return c.json({ ...preview, budget: await monthSpend(c.env) });
  }
  const { search, preview } = await startGoogleDetails(c.env, leadIds, { createdBy: c.get("user").id, retryNotFound: !!retryNotFound });
  await audit(c.env, c.get("user"), "google_details_started", { count: preview.eligible, estimatedCostUsd: preview.costUsd });
  return c.json({ search, preview });
});

// Saved searches (shared by the team) with free "new businesses" alerts.
app.get("/api/saved-searches", async (c) => c.json(await listSavedSearches(c.env)));
app.post("/api/saved-searches", async (c) => {
  const b = await body<{ name: string; request: FindRequest }>(c);
  const r = await saveSearch(c.env, b.name, b.request, c.get("user").id);
  await audit(c.env, c.get("user"), "saved_search_added", { name: b.name });
  return c.json(r);
});
app.patch("/api/saved-searches/:id", async (c) => {
  await updateSavedSearch(c.env, c.req.param("id"), await body<{ name?: string; alert?: boolean; seen?: boolean; ran?: boolean }>(c));
  return c.json({ ok: true });
});
app.delete("/api/saved-searches/:id", async (c) => {
  await deleteSavedSearch(c.env, c.req.param("id"));
  await audit(c.env, c.get("user"), "saved_search_deleted", {});
  return c.json({ ok: true });
});

// Website check: status, settings, and "Check websites" for chosen businesses (ids or filters).
app.get("/api/websites/status", async (c) => c.json({ ...(await websiteCheckStatus(c.env)), speedKey: !!c.env.PAGESPEED_API_KEY }));
app.put("/api/websites/settings", requireSuperAdmin, async (c) => {
  const b = await body<{ enabled: boolean; limit: number }>(c);
  try { await setWebsiteCheckSettings(c.env, { enabled: b.enabled === true, limit: Number(b.limit) }); } catch (err) { throw new ValidationError((err as Error).message); }
  await audit(c.env, c.get("user"), "website_check_settings", { enabled: b.enabled === true, limit: Number(b.limit) });
  return c.json({ ok: true });
});
app.post("/api/websites/check", async (c) => {
  const { ids, dryRun, recheck } = await body<{ ids?: string[]; dryRun?: boolean; recheck?: boolean }>(c);
  let leadIds = Array.isArray(ids) ? ids.filter((x) => typeof x === "string").slice(0, 5000) : [];
  if (!Array.isArray(ids)) {
    const q = buildLeadQuery(await resolveFilters(c.env, new URL(c.req.url).searchParams));
    const { results } = await c.env.DB.prepare(`${q.with} SELECT id FROM ${q.source} WHERE website_domain IS NOT NULL LIMIT 5000`).bind(...q.binds).all<{ id: string }>();
    leadIds = results.map((r) => r.id);
  }
  if (dryRun) {
    let done = 0, waiting = 0;
    for (let i = 0; i < leadIds.length; i += 90) {
      const list = leadIds.slice(i, i + 90).map(sqlString).join(", ");
      const r = await c.env.DB.prepare(
        `SELECT SUM(website_audit_status IN ('done', 'failed')) AS done, SUM(website_audit_status IN ('queued', 'checking')) AS waiting
         FROM leads WHERE id IN (${list}) AND website_domain IS NOT NULL`,
      ).first<{ done: number | null; waiting: number | null }>();
      done += r?.done ?? 0; waiting += r?.waiting ?? 0;
    }
    return c.json({ withWebsite: leadIds.length, done, waiting, notChecked: leadIds.length - done - waiting, status: await websiteCheckStatus(c.env) });
  }
  const r = await queueWebsiteChecks(c.env, leadIds, { recheck: recheck === true });
  await audit(c.env, c.get("user"), "website_check_started", { count: r.queued, recheck: recheck === true });
  return c.json(r);
});

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

// Backups (super admin only): list, start one now, download one as a restore file.
app.get("/api/admin/backups", requireSuperAdmin, async (c) => c.json(await listBackups(c.env)));
app.post("/api/admin/backups/run", requireSuperAdmin, async (c) => {
  const backup = await backupStep(c.env, new Date(), true);
  if (!backup) return c.json({ error: "Backups are paused until production." }, 400);
  return c.json(backup);
});
app.get("/api/admin/backups/:id/sql", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  if (!/^[\w-]+$/.test(id)) return c.json({ error: "Not found" }, 404);
  const stream = await backupAsSql(c.env, id);
  if (!stream) return c.json({ error: "That backup isn't finished or no longer exists." }, 404);
  return new Response(stream, {
    headers: { "Content-Type": "application/sql; charset=utf-8", "Content-Disposition": `attachment; filename="lead-finder-backup-${id}.sql"` },
  });
});

// Activity log (super admin only). The super admin's own actions aren't recorded.
app.get("/api/admin/audit", requireSuperAdmin, async (c) => c.json(await listAudit(c.env, new URL(c.req.url).searchParams)));

/** Free tier housekeeping each minute: fail stuck collections, keep saving going. */
async function freeTick(env: Env) {
  await freeWatchdog(env);
  await harvestTick(env);
  if (await freeWaiting(env)) await env.INGEST_QUEUE.send({ free: true });
}

/** Website checks, scores and speed each minute (each step does a small slice). */
async function websiteTick(env: Env) {
  await queueNewWebsites(env);
  await scoreStep(env);
  if (new Date().getUTCMinutes() % 10 === 0) await websiteWatchdog(env);
  if (new Date().getUTCMinutes() % 5 === 0) await nudgeChecker(env);
  await pageSpeedStep(env);
  await savedSearchAlerts(env);
}

/** Starts a phone-check run when numbers are waiting (queue message; runs inline if there's no queue). */
async function startPhoneRun(env: Env) {
  const waiting = await env.DB.prepare(`SELECT 1 AS x FROM leads WHERE phone_check_requested > 0 AND gbp_phone_formatted IS NOT NULL LIMIT 1`).first();
  if (!waiting) return;
  if (env.INGEST_QUEUE) await env.INGEST_QUEUE.send({ phones: true });
  else await checkPendingPhones(env);
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    // Independent jobs: one failing doesn't skip the others.
    // Phone checks run in their own invocation (a queue message), so they never share this
    // run's allowance of outside requests with pull syncing.
    ctx.waitUntil(
      Promise.allSettled([syncActiveSearches(env), startPhoneRun(env), dailyChecks(env), backupStep(env), trimRawStep(env), freeTick(env), websiteTick(env)]),
    );
  },
  // Queue messages: { searchId } = one saving step of a pull (each step queues the next);
  // { phones: true } = one run of phone checks.
  async queue(batch, env) {
    for (const message of batch.messages) {
      const body = message.body as { searchId?: string; phones?: boolean; force?: boolean; free?: boolean };
      try {
        if (body.free) {
          // One slice of free businesses; queue the next straight away while there's more.
          const r = await freeSaveStep(env);
          if (r.more && !r.paused) await env.INGEST_QUEUE.send({ free: true });
        }
        if (body.searchId) await syncSearch(env, body.searchId); // errors are counted on the pull
        if (body.phones) await checkPendingPhones(env, undefined, { force: body.force === true });
      } catch (err) {
        console.error("queue message failed", err);
      }
      message.ack();
    }
  },
} satisfies ExportedHandler<Env>;
