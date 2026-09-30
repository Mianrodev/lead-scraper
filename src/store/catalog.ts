// What store customers can search, buy and download. Only sellable businesses: from open data
// or Google (never the agency's own form requests or uploaded lists), open, and not on the
// do-not-contact list. Contact details (phone, email, owner, website, street address) are only
// ever read from the database for leads the customer owns, so they can't leak through a bug
// in the page. The same filter engine as the internal app (src/leads.ts) does the searching.

import { buildLeadQuery, resolveFilters, sqlString } from "../leads";
import { cached, filterKey } from "../cache";
import { canText, csvCell, sheetPhone } from "../export";
import { bestFirst, firstNameFrom } from "../emails";
import type { StoreEnv } from "./types";
import { StoreError } from "./types";
import type { StoreAccount } from "./auth";

export const SELLABLE_SOURCES = ["free", "google", "free+google"] as const;
const SELLABLE_SQL = `data_source IN ('free', 'google', 'free+google') AND business_status = 'operational' AND suppressed IS NULL`;
export const MAX_PER_PURCHASE = 5000;
const PAGE_MAX = 50;

// Customer filters -> the internal engine's parameters. Anything not listed is ignored, so a
// customer can never filter by (and so learn) the team's stages, assignments, sources, etc.
const PASS_MULTI = ["state", "city", "industry", "category", "postal_code", "score"];
const PASS_ONE: Record<string, (v: string) => boolean> = {
  phone: (v) => v === "yes", email: (v) => v === "yes", owner: (v) => v === "yes",
  website: (v) => ["yes", "no", "no_real"].includes(v),
  min_rating: (v) => /^\d(\.\d)?$/.test(v), min_reviews: (v) => /^\d{1,6}$/.test(v), max_reviews: (v) => /^\d{1,6}$/.test(v),
  q: (v) => v.length <= 80, near: (v) => v.length <= 80, radius_miles: (v) => /^\d{1,3}$/.test(v), area: (v) => v.length <= 1200,
};

export function engineParams(input: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of PASS_MULTI) for (const v of input.getAll(k).slice(0, 200)) if (v && v.length <= 120) p.append(k, v);
  for (const [k, ok] of Object.entries(PASS_ONE)) { const v = input.get(k)?.trim(); if (v && ok(v)) p.set(k, v); }
  const tier = input.get("tier");
  for (const d of tier === "free" ? ["free"] : tier === "google" ? ["google", "free+google"] : SELLABLE_SOURCES) p.append("data_source", d);
  p.set("status", "operational"); // only open businesses (the do-not-contact list is always applied by the engine)
  return p;
}

async function prices(env: StoreEnv): Promise<{ free: number; google: number }> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN ('store_price_free', 'store_price_google')`).all<{ key: string; value: string }>();
  const v = Object.fromEntries(results.map((r) => [r.key, Math.max(0, Math.floor(Number(r.value) || 0))]));
  return { free: v.store_price_free ?? 1, google: v.store_price_google ?? 3 };
}
export { prices as storePrices };

const tierOf = (source: string | null) => (source === "free" ? "free" : "google");

/** The engine's query for a customer's filters, plus the "own it / don't" filter. */
async function query(env: StoreEnv, input: URLSearchParams, accountId: string) {
  const q = buildLeadQuery(await resolveFilters(env as unknown as Env, engineParams(input)));
  const owned = input.get("owned");
  const ownedSql = owned === "yes" || owned === "no"
    ? `WHERE ${owned === "no" ? "NOT " : ""}EXISTS (SELECT 1 FROM store_purchases p WHERE p.account_id = ${sqlString(accountId)} AND p.lead_id = x.id)`
    : "";
  return { ...q, ownedSql };
}

const SORTS: Record<string, string> = { score: "presence_score", rating: "rating", reviews: "review_count", name: "business_name" };

/** Columns for a result row. Contact details only when this account owns the lead. */
function rowColumns(accountSql: string) {
  const own = `EXISTS (SELECT 1 FROM store_purchases p WHERE p.account_id = ${accountSql} AND p.lead_id = x.id)`;
  return `id, business_name AS name, gbp_category AS category, city, state, postal_code AS zip, rating, review_count AS reviews,
    presence_score AS score, data_source, gbp_phone_formatted IS NOT NULL AS hasPhone,
    EXISTS (SELECT 1 FROM lead_emails e WHERE e.lead_id = x.id) AS hasEmail,
    (owner_name IS NOT NULL AND owner_name <> '') AS hasOwner, website_domain IS NOT NULL AS hasWebsite, ${own} AS owned,
    CASE WHEN ${own} THEN gbp_phone_formatted END AS phone,
    CASE WHEN ${own} THEN (SELECT group_concat(e.email, ' ') FROM lead_emails e WHERE e.lead_id = x.id
      AND NOT EXISTS (SELECT 1 FROM email_checks c WHERE c.email = e.email AND c.result IN ('invalid', 'disposable'))) END AS emails,
    CASE WHEN ${own} THEN owner_name END AS owner, CASE WHEN ${own} THEN owner_title END AS ownerTitle,
    CASE WHEN ${own} THEN website END AS website, CASE WHEN ${own} THEN address END AS address`;
}

type RawRow = Record<string, unknown> & { data_source: string | null; emails: string | null; website: string | null };
function shapeRow(r: RawRow) {
  const { data_source, emails, ...rest } = r;
  const list = emails ? bestFirst(emails.split(" ").filter(Boolean)) : [];
  const out: Record<string, unknown> = {
    ...rest, tier: tierOf(data_source), hasPhone: !!r.hasPhone, hasEmail: !!r.hasEmail, hasOwner: !!r.hasOwner, hasWebsite: !!r.hasWebsite, owned: !!r.owned,
  };
  if (out.owned) { out.email = list[0] ?? null; out.emails = list; } else for (const k of ["phone", "owner", "ownerTitle", "website", "address"]) delete out[k];
  return out;
}

export async function searchLeads(env: StoreEnv, account: StoreAccount, input: URLSearchParams) {
  const q = await query(env, input, account.id);
  const pageSize = Math.min(Math.max(Number(input.get("page_size")) || PAGE_MAX, 1), PAGE_MAX);
  const page = Math.min(Math.max(Number(input.get("page")) || 1, 1), 200); // 10,000 rows deep at most
  const col = SORTS[input.get("sort") ?? ""] ?? "presence_score";
  const dir = input.get("dir") === "desc" ? "DESC" : input.get("dir") === "asc" ? "ASC" : col === "presence_score" || col === "business_name" ? "ASC" : "DESC";
  const rows = await env.DB.prepare(
    `${q.with} SELECT ${rowColumns(sqlString(account.id))} FROM ${q.source} AS x ${q.ownedSql}
     ORDER BY ${col} IS NULL, ${col} ${dir}, id LIMIT ? OFFSET ?`,
  ).bind(...q.binds, pageSize, (page - 1) * pageSize).all<RawRow>();
  const key = filterKey(`store-count${q.ownedSql ? `:${account.id}` : ""}`, input, ["page", "page_size", "sort", "dir"]);
  const counts = await cached(env as unknown as Env, key, 120, async () =>
    (await env.DB.prepare(`${q.with} SELECT COUNT(*) AS total, COALESCE(SUM(data_source = 'free'), 0) AS free FROM ${q.source} AS x ${q.ownedSql}`)
      .bind(...q.binds).first<{ total: number; free: number }>()) ?? { total: 0, free: 0 });
  return {
    total: counts.total, page, pageSize, counts: { free: counts.free, google: counts.total - counts.free },
    results: rows.results.map(shapeRow),
  };
}

export async function places(env: StoreEnv, state: string | null) {
  const st = state && /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : null;
  return cached(env as unknown as Env, `store-places:${st ?? ""}`, 3600, async () => {
    const [states, cities] = await env.DB.batch<{ value: string; n: number }>([
      env.DB.prepare(`SELECT state AS value, COUNT(*) AS n FROM leads WHERE ${SELLABLE_SQL} AND state IS NOT NULL GROUP BY state ORDER BY state`),
      st
        ? env.DB.prepare(`SELECT city || '|' || state AS value, COUNT(*) AS n FROM leads WHERE ${SELLABLE_SQL} AND state = ? AND city IS NOT NULL AND city <> '' GROUP BY city, state ORDER BY city`).bind(st)
        : env.DB.prepare(`SELECT city || '|' || state AS value, COUNT(*) AS n FROM leads WHERE ${SELLABLE_SQL} AND city IS NOT NULL AND city <> '' GROUP BY city, state HAVING COUNT(*) >= 5 ORDER BY n DESC LIMIT 300`),
    ]);
    return { states: states.results, cities: cities.results };
  });
}

export async function categories(env: StoreEnv) {
  return cached(env as unknown as Env, "store-categories", 3600, async () => {
    const { results } = await env.DB.prepare(
      `SELECT COALESCE(industry, 'Other') AS industry, gbp_category AS value, COUNT(*) AS n FROM leads
       WHERE ${SELLABLE_SQL} AND gbp_category IS NOT NULL GROUP BY 1, 2 ORDER BY n DESC`,
    ).all<{ industry: string; value: string; n: number }>();
    const byIndustry = new Map<string, number>();
    for (const r of results) byIndustry.set(r.industry, (byIndustry.get(r.industry) ?? 0) + r.n);
    return {
      industries: [...byIndustry].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n),
      categories: results.map((r) => ({ value: r.value, n: r.n, industry: r.industry })),
    };
  });
}

// ----------------------------------------------------------------------------------------
// Buying

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function buy(env: StoreEnv, account: StoreAccount, body: { ids?: unknown; all?: unknown; dryRun?: unknown }, input: URLSearchParams, userId: string) {
  // The candidates: picked ids (checked to be sellable), or everything matching the filters.
  let candidates: { id: string; data_source: string }[];
  let capped = false;
  if (body.all === true) {
    const q = await query(env, input, account.id);
    const { results } = await env.DB.prepare(`${q.with} SELECT id, data_source FROM ${q.source} AS x ${q.ownedSql} LIMIT ${MAX_PER_PURCHASE + 1}`)
      .bind(...q.binds).all<{ id: string; data_source: string }>();
    capped = results.length > MAX_PER_PURCHASE;
    candidates = results.slice(0, MAX_PER_PURCHASE);
  } else {
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).filter((x): x is string => typeof x === "string" && /^[\w:-]{1,80}$/.test(x)))];
    if (!ids.length) throw new StoreError("Pick at least one lead.");
    if (ids.length > MAX_PER_PURCHASE) throw new StoreError(`At most ${MAX_PER_PURCHASE.toLocaleString("en-US")} leads at a time.`);
    candidates = [];
    for (const part of chunks(ids, 90)) {
      const { results } = await env.DB.prepare(`SELECT id, data_source FROM leads WHERE id IN (${part.map(sqlString).join(", ")}) AND ${SELLABLE_SQL}`)
        .all<{ id: string; data_source: string }>();
      candidates.push(...results);
    }
  }
  const owned = new Set<string>();
  for (const part of chunks(candidates.map((c) => c.id), 90)) {
    const { results } = await env.DB.prepare(`SELECT lead_id FROM store_purchases WHERE account_id = ? AND lead_id IN (${part.map(sqlString).join(", ")})`)
      .bind(account.id).all<{ lead_id: string }>();
    for (const r of results) owned.add(r.lead_id);
  }
  const fresh = candidates.filter((c) => !owned.has(c.id));
  const price = await prices(env);
  const free = fresh.filter((c) => tierOf(c.data_source) === "free").length;
  const google = fresh.length - free;
  const credits = free * price.free + google * price.google;
  if (body.dryRun === true) {
    return { count: fresh.length, alreadyOwned: owned.size, free, google, credits, balance: account.credits, capped };
  }
  if (account.status !== "active") throw new StoreError(account.status === "pending" ? "Your account is waiting for approval." : "Your account is paused.", 403);
  if (!fresh.length) return { bought: 0, free: 0, google: 0, credits: 0, balance: account.credits };

  // Take the credits first, in one step that fails if there aren't enough.
  const after = await env.DB.prepare(`UPDATE store_accounts SET credits = credits - ? WHERE id = ? AND status = 'active' AND credits >= ? RETURNING credits`)
    .bind(credits, account.id, credits).first<number>("credits");
  if (after == null) {
    throw new StoreError(`That needs ${credits.toLocaleString("en-US")} credits and you have ${account.credits.toLocaleString("en-US")}.`, 402);
  }
  await env.DB.prepare(`INSERT INTO store_ledger (account_id, delta, balance, kind, note, created_by) VALUES (?, ?, ?, 'purchase', ?, ?)`)
    .bind(account.id, -credits, after, `${fresh.length.toLocaleString("en-US")} leads (${free} standard, ${google} premium)`, userId).run();

  // Record the leads. One that was bought at the same moment by another tab isn't charged twice.
  let notSaved = 0;
  for (const part of chunks(fresh, 90)) {
    const res = await env.DB.batch(part.map((c) => env.DB.prepare(`INSERT OR IGNORE INTO store_purchases (account_id, lead_id, tier, credits) VALUES (?, ?, ?, ?)`)
      .bind(account.id, c.id, tierOf(c.data_source), tierOf(c.data_source) === "free" ? price.free : price.google)));
    res.forEach((r, i) => { if (!r.meta?.changes) notSaved += tierOf(part[i].data_source) === "free" ? price.free : price.google; });
  }
  let balance = after;
  if (notSaved > 0) {
    balance = (await env.DB.prepare(`UPDATE store_accounts SET credits = credits + ? WHERE id = ? RETURNING credits`).bind(notSaved, account.id).first<number>("credits")) ?? after;
    await env.DB.prepare(`INSERT INTO store_ledger (account_id, delta, balance, kind, note) VALUES (?, ?, ?, 'refund', 'Already owned (bought at the same time)')`)
      .bind(account.id, notSaved, balance).run();
  }
  return { bought: fresh.length, free, google, credits: credits - notSaved, balance };
}

// ----------------------------------------------------------------------------------------
// The customer's own leads

export async function myLeads(env: StoreEnv, account: StoreAccount, input: URLSearchParams) {
  const pageSize = Math.min(Math.max(Number(input.get("page_size")) || PAGE_MAX, 1), PAGE_MAX);
  const page = Math.max(Number(input.get("page")) || 1, 1);
  const q = (input.get("q") ?? "").trim().slice(0, 80);
  const where = `p.account_id = ?${q ? " AND x.business_name LIKE ?" : ""}`;
  const binds: unknown[] = [account.id, ...(q ? [`%${q.replace(/[%_]/g, "")}%`] : [])];
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ${rowColumns(sqlString(account.id))}, p.purchased_at AS purchasedAt FROM store_purchases p JOIN leads x ON x.id = p.lead_id
       WHERE ${where} ORDER BY p.purchased_at DESC, x.business_name LIMIT ? OFFSET ?`,
    ).bind(...binds, pageSize, (page - 1) * pageSize),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM store_purchases p JOIN leads x ON x.id = p.lead_id WHERE ${where}`).bind(...binds),
  ]);
  return { total: (count.results[0] as { n: number }).n, page, pageSize, results: (rows.results as RawRow[]).map(shapeRow) };
}

export async function creditHistory(env: StoreEnv, account: StoreAccount) {
  const { results } = await env.DB.prepare(
    `SELECT created_at AS at, delta, balance, kind, note FROM store_ledger WHERE account_id = ? ORDER BY id DESC LIMIT 100`,
  ).bind(account.id).all();
  return { balance: account.credits, history: results };
}

// ----------------------------------------------------------------------------------------
// Downloads: only the customer's own leads.

export const SIMPLE_COLUMNS = ["Business Name", "Owner", "Owner Title", "Category", "Phone", "Can Text", "Email", "Email 2", "Email 3", "Website",
  "Address", "City", "State", "Zip", "Rating", "Reviews", "Score", "Website Comment", "Top Fix", "Type", "Unlocked On"] as const;
export const COLD_COLUMNS = ["Email", "First Name", "Company Name", "Website", "Phone", "Can Text", "City", "State", "Category", "Score", "Top Fix"] as const;

interface DlRow {
  id: string; business_name: string | null; owner_name: string | null; owner_title: string | null; gbp_category: string | null;
  gbp_phone_formatted: string | null; gbp_phone_raw: string | null; phone_type: string | null; website: string | null; address: string | null;
  city: string | null; state: string | null; postal_code: string | null; rating: number | null; review_count: number | null;
  presence_score: number | null; score_notes: string | null; data_source: string | null; purchased_at: string;
}

export function downloadRow(format: "simple" | "cold_email", l: DlRow, emails: string[]): string[] | null {
  let notes: { websiteComment?: string; suggestions?: string[] } = {};
  try { notes = l.score_notes ? JSON.parse(l.score_notes) : {}; } catch { notes = {}; }
  const phone = sheetPhone(l.gbp_phone_formatted, l.gbp_phone_raw);
  const num = (n: number | null) => (n == null ? "" : String(n));
  if (format === "cold_email") {
    if (!emails.length) return null;
    const first = (l.owner_name ?? "").trim().split(/\s+/)[0] || firstNameFrom(emails[0]);
    return [emails[0], first, l.business_name ?? "", l.website ?? "", phone, canText(l.phone_type, phone), l.city ?? "", l.state ?? "",
      l.gbp_category ?? "", num(l.presence_score), notes.suggestions?.[0] ?? ""];
  }
  return [l.business_name ?? "", l.owner_name ?? "", l.owner_title ?? "", l.gbp_category ?? "", phone, canText(l.phone_type, phone),
    emails[0] ?? "", emails[1] ?? "", emails[2] ?? "", l.website ?? "", l.address ?? "", l.city ?? "", l.state ?? "", l.postal_code ?? "",
    num(l.rating), num(l.review_count), num(l.presence_score), notes.websiteComment ?? "", notes.suggestions?.[0] ?? "",
    tierOf(l.data_source) === "free" ? "Standard" : "Premium (Google)", l.purchased_at.slice(0, 10)];
}

export async function downloadCsv(env: StoreEnv, account: StoreAccount, format: "simple" | "cold_email", ids: string[]): Promise<ReadableStream<Uint8Array>> {
  const pick = ids.filter((x) => /^[\w:-]{1,80}$/.test(x)).slice(0, 20000);
  const { results: order } = await env.DB.prepare(
    `SELECT lead_id FROM store_purchases WHERE account_id = ?${pick.length ? ` AND lead_id IN (${pick.map(sqlString).join(", ")})` : ""} ORDER BY purchased_at, lead_id`,
  ).bind(account.id).all<{ lead_id: string }>();
  const encoder = new TextEncoder();
  let next = 0, header = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!header) {
          header = true;
          controller.enqueue(encoder.encode("﻿" + (format === "cold_email" ? COLD_COLUMNS : SIMPLE_COLUMNS).map(csvCell).join(",") + "\r\n"));
          return;
        }
        const part = order.slice(next, next + 500).map((r) => r.lead_id);
        if (!part.length) { controller.close(); return; }
        next += part.length;
        const list = part.map(sqlString).join(", ");
        const [leads, mails] = await env.DB.batch([
          env.DB.prepare(
            `SELECT l.id, l.business_name, l.owner_name, l.owner_title, l.gbp_category, l.gbp_phone_formatted, l.gbp_phone_raw, l.phone_type, l.website,
                    l.address, l.city, l.state, l.postal_code, l.rating, l.review_count, l.presence_score, l.score_notes, l.data_source, p.purchased_at
             FROM leads l JOIN store_purchases p ON p.lead_id = l.id AND p.account_id = ? WHERE l.id IN (${list})`,
          ).bind(account.id),
          env.DB.prepare(
            `SELECT e.lead_id, e.email FROM lead_emails e WHERE e.lead_id IN (${list})
               AND NOT EXISTS (SELECT 1 FROM email_checks c WHERE c.email = e.email AND c.result IN ('invalid', 'disposable')) ORDER BY e.lead_id, e.position`,
          ),
        ]);
        const byLead = new Map<string, string[]>();
        for (const m of mails.results as { lead_id: string; email: string }[]) byLead.set(m.lead_id, [...(byLead.get(m.lead_id) ?? []), m.email]);
        const byId = new Map((leads.results as DlRow[]).map((l) => [l.id, l]));
        const text = part.map((id) => byId.get(id)).filter((l): l is DlRow => !!l)
          .map((l) => downloadRow(format, l, bestFirst(byLead.get(l.id) ?? [])))
          .filter((r): r is string[] => !!r).map((r) => r.map(csvCell).join(",")).join("\r\n");
        if (text) controller.enqueue(encoder.encode(text + "\r\n"));
      } catch (err) {
        console.error("store download failed", err);
        controller.error(err);
      }
    },
  });
}
