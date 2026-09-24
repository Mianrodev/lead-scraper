import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createSearch, getSearch, syncActiveSearches, syncSearch, ValidationError, type SearchInput } from "./pipeline";

// Auth: the whole hostname sits behind Cloudflare Access; the Worker has no login of its own.

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.get("/", (c) => c.text("Lead scraper API. Dashboard arrives in Phase 3."));

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

// Minimal listing for Phase 1 verification; the filterable version comes in Phase 3.
app.get("/api/leads", async (c) => {
  const searchId = c.req.query("search_id");
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
  const columns = `l.id, l.google_place_id, l.business_name, l.gbp_category, l.sub_category, l.gbp_phone_raw,
    l.gbp_phone_formatted, l.website, l.gbp_url, l.rating, l.review_count, l.address, l.city, l.state, l.country,
    l.is_claimed, l.logo_url, l.source_code, l.lead_status, l.lead_date, l.lead_datetime, l.created_at, l.updated_at`;
  const stmt = searchId
    ? c.env.DB.prepare(
        `SELECT ${columns}, sl.rank AS search_rank FROM search_leads sl JOIN leads l ON l.id = sl.lead_id
         WHERE sl.search_id = ? ORDER BY sl.rank LIMIT ?`,
      ).bind(searchId, limit)
    : c.env.DB.prepare(`SELECT ${columns} FROM leads l ORDER BY l.created_at DESC LIMIT ?`).bind(limit);
  const { results } = await stmt.all();
  const total = await (searchId
    ? c.env.DB.prepare(`SELECT COUNT(*) AS n FROM search_leads WHERE search_id = ?`).bind(searchId)
    : c.env.DB.prepare(`SELECT COUNT(*) AS n FROM leads`)
  ).first<number>("n");
  return c.json({ total, results });
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(syncActiveSearches(env));
  },
} satisfies ExportedHandler<Env>;
