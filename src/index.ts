import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { dashboardHtml } from "./dashboard";
import { leadFacets, listLeads } from "./leads";
import { checkPendingPhones } from "./phone";
import { createSearch, getSearch, syncActiveSearches, syncSearch, ValidationError, type SearchInput } from "./pipeline";

// Auth: the whole hostname sits behind Cloudflare Access; the Worker has no login of its own.

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.get("/", (c) => c.html(dashboardHtml));

app.post("/api/search", async (c) => {
  const body = await c.req.json<SearchInput>().catch(() => {
    throw new ValidationError("Body must be JSON");
  });
  const search = await createSearch(c.env, body);
  return c.json(search, search.status === "failed" ? 502 : 201);
});

app.get("/api/searches", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM searches ORDER BY created_at DESC LIMIT 100`).all();
  return c.json(results);
});

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

// Runs the phone check on demand (the cron does this every minute anyway).
app.post("/api/phones/check", async (c) => c.json(await checkPendingPhones(c.env)));

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(syncActiveSearches(env).then(() => checkPendingPhones(env)));
  },
} satisfies ExportedHandler<Env>;
