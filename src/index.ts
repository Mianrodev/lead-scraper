import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { dashboardHtml } from "./dashboard";
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

// Auth: the whole hostname sits behind Cloudflare Access; the Worker has no login of its own.

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof RepeatPullError) {
    return c.json({ error: err.message, repeat: true, windowDays: REPEAT_WINDOW_DAYS, previous: err.previous }, 409);
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.get("/", (c) => c.html(dashboardHtml));

// Before running a search: has this category + city + state been pulled recently?
app.get("/api/search/check", async (c) =>
  c.json(await checkSearch(c.env, c.req.query("category") ?? "", c.req.query("city") ?? "")),
);

// Refuses (409) to repeat a recent pull unless the body has "force": true.
app.post("/api/search", async (c) => {
  const body = await c.req.json<SearchInput>().catch(() => {
    throw new ValidationError("Body must be JSON");
  });
  const search = await createSearch(c.env, body);
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

app.get("/api/leads/facets", async (c) => c.json(await leadFacets(c.env)));

// Industry -> category list (for the picker and the search box), with stored counts.
app.get("/api/categories", async (c) => c.json(await categoryTree(c.env)));

// Runs the phone check on demand (the cron does this every minute anyway).
app.post("/api/phones/check", async (c) => c.json(await checkPendingPhones(c.env)));

// Recompute derived columns (website domain, street address, status) for stored leads.
app.post("/api/admin/backfill", async (c) => c.json(await backfillDerivedColumns(c.env)));

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(syncActiveSearches(env).then(() => checkPendingPhones(env)));
  },
} satisfies ExportedHandler<Env>;
