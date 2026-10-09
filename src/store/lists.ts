// Lists: every "Get leads" in the customer app saves the leads of that request (including ones
// the account already had) as a named list, e.g. "Plumbers · Tampa, FL". A list only groups leads
// the account owns: deleting it never takes leads away. Everyone on the account's team shares its
// lists. Tables: migrations/0028_store_lists.sql. API: docs/store-api.md ("Lists").

import { stateName } from "../format";
import { sqlString } from "../leads";
import type { StoreAccount } from "./auth";
import { StoreError, type StoreEnv } from "./types";

export const MAX_LISTS_SHOWN = 500;
const NAME_MAX = 80;

/** "Plumber" -> "Plumbers", "Real estate agency" -> "Real estate agencies", "Glass & mirrors" stays. */
export function pluralWord(word: string): string {
  const w = String(word ?? "").trim();
  if (!w || /s$/i.test(w)) return w;
  if (/man$/i.test(w)) return w.slice(0, -3) + "men"; // "Handyman" -> "Handymen"
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + "ies";
  if (/(x|z|ch|sh)$/i.test(w)) return w + "es";
  return w + "s";
}

const more = (n: number) => (n > 0 ? ` + ${n} more` : "");

/**
 * The automatic name of a list from the search that made it: "Plumbers · Tampa, FL",
 * "Dentists + 1 more · Florida", "Businesses · within 25 mi of Tampa, FL". Picked leads say so after
 * the search they came from: "Chimney sweeps · Orlando, FL (2 picked)" (or "12 picked leads" when
 * the search had no what or where).
 */
export function listName(input: URLSearchParams, picked = 0): string {
  const base = searchName(input);
  if (picked <= 0) return base.slice(0, NAME_MAX);
  const n = picked.toLocaleString("en-US");
  if (base === "Businesses") return `${n} picked lead${picked === 1 ? "" : "s"}`;
  const tail = ` (${n} picked)`;
  return base.slice(0, NAME_MAX - tail.length) + tail;
}

function searchName(input: URLSearchParams): string {
  const all = (k: string) => input.getAll(k).map((v) => v.trim()).filter(Boolean);
  const cats = all("category"), inds = all("industry");
  // Google's long names read by their first part: "Handyman/Handywoman/Handyperson" -> "Handymen".
  const what = cats.length ? pluralWord(cats[0].split("/")[0].trim() || cats[0]) + more(cats.length - 1)
    : inds.length ? `${inds[0]}${more(inds.length - 1)}`
    : "Businesses";
  const place = (v: string) => v.split("|").map((s) => s.trim()).filter(Boolean).join(", ");
  const cities = all("city"), states = all("state"), zips = all("postal_code");
  const near = input.get("near")?.trim(), radius = input.get("radius_miles")?.trim();
  let where = "";
  if (near && radius) where = `within ${radius} mi of ${near.startsWith("zip:") ? "ZIP " + near.slice(4) : place(near)}`;
  else if (cities.length) where = place(cities[0]) + more(cities.length - 1);
  else if (states.length) where = (stateName(states[0]) ?? states[0]) + more(states.length - 1);
  else if (zips.length) where = `ZIP ${zips[0]}${more(zips.length - 1)}`;
  else if (input.get("area")) where = "Map area";
  return [what, where].filter(Boolean).join(" · ");
}

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * Saves a list of leads the account owns. Called after the purchase is recorded, so a failure here
 * never loses what was bought. Each step is safe to repeat (INSERT OR IGNORE with the same id, then
 * the count is recomputed), so it is simply tried twice. Only leads in store_purchases go in.
 */
export async function saveList(env: StoreEnv, accountId: string, userId: string | null, name: string, query: string, leadIds: string[]) {
  const id = crypto.randomUUID();
  const ids = [...new Set(leadIds.filter((x) => typeof x === "string" && x.length <= 200))];
  for (let attempt = 0; ; attempt++) {
    try {
      await env.DB.prepare(`INSERT OR IGNORE INTO store_lists (id, account_id, name, query, lead_count, created_by) VALUES (?, ?, ?, ?, 0, ?)`)
        .bind(id, accountId, name.slice(0, NAME_MAX), query.slice(0, 3000), userId).run();
      const parts = chunks(ids, 400).map((part) => env.DB.prepare(
        `INSERT OR IGNORE INTO store_list_leads (list_id, lead_id)
         SELECT ?, p.lead_id FROM store_purchases p WHERE p.account_id = ? AND p.lead_id IN (${part.map(sqlString).join(", ")})`,
      ).bind(id, accountId));
      for (const group of chunks(parts, 20)) await env.DB.batch(group);
      const count = await env.DB.prepare(`UPDATE store_lists SET lead_count = (SELECT COUNT(*) FROM store_list_leads WHERE list_id = ?) WHERE id = ? RETURNING lead_count`)
        .bind(id, id).first<number>("lead_count");
      return { id, name: name.slice(0, NAME_MAX), count: Number(count ?? 0) };
    } catch (err) {
      if (attempt >= 1) {
        // Don't leave a half-saved list behind (best effort; the leads are still in "All my leads").
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM store_list_leads WHERE list_id = ?`).bind(id),
          env.DB.prepare(`DELETE FROM store_lists WHERE id = ? AND account_id = ?`).bind(id, accountId),
        ]).catch(() => {});
        throw err;
      }
    }
  }
}

export interface ListRow { id: string; name: string; query: string | null; count: number; createdAt: string; byName: string | null }

/** The account's lists (newest first) and how many leads it owns in all ("All my leads"). */
export async function listLists(env: StoreEnv, account: StoreAccount): Promise<{ lists: ListRow[]; allCount: number }> {
  const [lists, all] = await env.DB.batch([
    env.DB.prepare(
      `SELECT l.id, l.name, l.query, l.lead_count AS count, l.created_at AS createdAt, COALESCE(NULLIF(u.name, ''), u.email) AS byName
         FROM store_lists l LEFT JOIN store_users u ON u.id = l.created_by AND u.account_id = l.account_id
        WHERE l.account_id = ? ORDER BY l.created_at DESC, l.rowid DESC LIMIT ${MAX_LISTS_SHOWN}`,
    ).bind(account.id),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM store_purchases WHERE account_id = ?`).bind(account.id),
  ]);
  return {
    lists: (lists.results as ListRow[]).map((l) => ({ ...l, count: Number(l.count) || 0 })),
    allCount: Number((all.results[0] as { n: number } | undefined)?.n ?? 0),
  };
}

/** One list of this account, or 404 (also for another account's list: never says it exists). */
export async function getList(env: StoreEnv, account: StoreAccount, id: string) {
  const l = typeof id === "string" && id.length <= 80
    ? await env.DB.prepare(`SELECT id, name, query, lead_count AS count, created_at AS createdAt FROM store_lists WHERE id = ? AND account_id = ?`)
      .bind(id, account.id).first<{ id: string; name: string; query: string | null; count: number; createdAt: string }>()
    : null;
  if (!l) throw new StoreError("That list wasn't found.", 404);
  return { ...l, count: Number(l.count) || 0 };
}

export async function renameList(env: StoreEnv, account: StoreAccount, id: string, input: { name?: unknown }) {
  const name = typeof input?.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, NAME_MAX) : "";
  if (!name) throw new StoreError("Give the list a name.");
  const r = await env.DB.prepare(`UPDATE store_lists SET name = ? WHERE id = ? AND account_id = ?`).bind(name, id, account.id).run();
  if (!r.meta?.changes) throw new StoreError("That list wasn't found.", 404);
  return { ok: true, name };
}

/** Removes the list only: its leads stay the account's (All my leads, other lists, downloads). */
export async function deleteList(env: StoreEnv, account: StoreAccount, id: string) {
  await getList(env, account, id);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM store_list_leads WHERE list_id = ? AND list_id IN (SELECT id FROM store_lists WHERE id = ? AND account_id = ?)`).bind(id, id, account.id),
    env.DB.prepare(`DELETE FROM store_lists WHERE id = ? AND account_id = ?`).bind(id, account.id),
  ]);
  return { ok: true };
}
