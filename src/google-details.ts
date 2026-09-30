// Paid tier: "Get Google details" for businesses from the free tier.
//
// Each chosen free business is looked up on Google Maps by name and address (Apify compass,
// one search string per business, 1 result each, about $0.005 per business). The result is
// checked (same phone, or a similar name) and merged into the same lead: rating, reviews,
// verified/claimed, Google listing link, photos, price level, profile features. When Google's
// listing is one we already have (from an earlier Google search), the free copy is folded into it.

import { startRunWithInput } from "./apify";
import { COST_PER_PLACE_USD } from "./find";
import { normalizePlace, compactRaw, type NormalizedPlace } from "./normalize";
import { assertWithinBudget } from "./ops";
import { attributesHash, getSearch, ValidationError, writeAttributes, type SearchRow } from "./pipeline";
import { rescoreLeads } from "./scoring";
import { applyToLeads } from "./suppress";

/** Most businesses one "Get Google details" request looks up. */
export const MAX_DETAILS = 500;

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`;

interface FreeLeadRow {
  id: string;
  business_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  data_source: string;
  google_match: string | null;
}

/** "Emerald Plumbing, 2311 Henderson Dr, Orlando, FL 32806" (what Google Maps is asked). */
export function detailsQuery(l: Pick<FreeLeadRow, "business_name" | "address" | "city" | "state">): string {
  const where = l.address || [l.city, l.state].filter(Boolean).join(", ");
  return [l.business_name, where].filter(Boolean).join(", ").replace(/\s+/g, " ").trim();
}

export interface DetailsPreview {
  total: number;
  /** Free businesses not looked up yet: these would be looked up. */
  eligible: number;
  /** Already have Google details (from a Google search, or looked up before). */
  alreadyGoogle: number;
  /** Looked up before but Google had no match. */
  notFoundBefore: number;
  /** Waiting in a lookup that's running now. */
  running: number;
  capped: boolean;
  costUsd: number;
}

async function loadCandidates(env: Env, leadIds: string[]): Promise<FreeLeadRow[]> {
  if (!leadIds.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT id, business_name, address, city, state, country, data_source, google_match FROM leads WHERE id IN (${leadIds.map(sql).join(", ")})`,
  ).all<FreeLeadRow>();
  return results;
}

/** Counts (and prices) what "Get Google details" would do for these businesses. */
export async function previewGoogleDetails(env: Env, leadIds: string[], opts: { retryNotFound?: boolean } = {}): Promise<DetailsPreview & { ids: string[] }> {
  const ids = [...new Set(leadIds)];
  const rows = await loadCandidates(env, ids.slice(0, 5000));
  const eligibleRows = rows.filter((r) => (r.data_source === "free" || r.data_source === "upload") && (r.google_match == null || (opts.retryNotFound && r.google_match === "not_found")) && r.business_name);
  const picked = eligibleRows.slice(0, MAX_DETAILS);
  return {
    total: rows.length,
    eligible: picked.length,
    alreadyGoogle: rows.filter((r) => r.data_source !== "free" && r.data_source !== "upload").length,
    notFoundBefore: opts.retryNotFound ? 0 : rows.filter((r) => (r.data_source === "free" || r.data_source === "upload") && r.google_match === "not_found").length,
    running: rows.filter((r) => r.google_match === "queued").length,
    capped: eligibleRows.length > MAX_DETAILS,
    costUsd: picked.length * COST_PER_PLACE_USD,
    ids: picked.map((r) => r.id),
  };
}

/** Starts the Google lookup for the eligible businesses. Returns the new search (progress + history). */
export async function startGoogleDetails(
  env: Env,
  leadIds: string[],
  opts: { createdBy: string | null; retryNotFound?: boolean },
): Promise<{ search: SearchRow; preview: DetailsPreview }> {
  const preview = await previewGoogleDetails(env, leadIds, opts);
  if (!preview.eligible) throw new ValidationError("None of these need Google details: they already have them, or are being looked up now.");
  await assertWithinBudget(env, preview.costUsd, "this Google lookup");
  const rows = await loadCandidates(env, preview.ids);
  const id = crypto.randomUUID();
  const actorId = env.APIFY_ACTOR_ID;
  const queries = rows.map(detailsQuery);
  await env.DB.prepare(
    `INSERT INTO searches (id, category, city, state, country, country_code, region_name, source_code, max_results,
       apify_actor_id, created_by, estimated_cost, status, source)
     VALUES (?, 'Google details', '', NULL, 'USA', 'US', NULL, ?, ?, ?, ?, ?, 'pending', 'google_details')`,
  )
    .bind(id, env.SOURCE_CODE_DEFAULT, rows.length, actorId, opts.createdBy, preview.costUsd)
    .run();
  const statements = rows.map((r, idx) =>
    env.DB.prepare(`INSERT INTO google_detail_items (search_id, idx, lead_id, query) VALUES (?, ?, ?, ?)`).bind(id, idx, r.id, queries[idx]));
  statements.push(env.DB.prepare(`UPDATE leads SET google_match = 'queued' WHERE id IN (${rows.map((r) => sql(r.id)).join(", ")})`));
  for (let i = 0; i < statements.length; i += 90) await env.DB.batch(statements.slice(i, i + 90));
  try {
    const run = await startRunWithInput(env, actorId, {
      searchStringsArray: queries,
      maxCrawledPlacesPerSearch: 1,
      language: "en",
    }, rows.length);
    await env.DB.prepare(
      `UPDATE searches SET status = 'scraping', apify_run_id = ?, apify_dataset_id = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(run.id, run.defaultDatasetId, id)
      .run();
  } catch (err) {
    const message = `Google Maps lookup couldn't start: ${err instanceof Error ? err.message : String(err)}`;
    await env.DB.batch([
      env.DB.prepare(`UPDATE searches SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`).bind(message, id),
      env.DB.prepare(`UPDATE leads SET google_match = NULL WHERE google_match = 'queued' AND id IN (SELECT lead_id FROM google_detail_items WHERE search_id = ?)`).bind(id),
    ]);
  }
  return { search: (await getSearch(env, id))!, preview };
}

const nameWords = (s: string | null) =>
  new Set((s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((w) => w.length > 1 && !["the", "and", "inc", "llc", "co", "corp", "company", "ltd", "of"].includes(w)));

/** Is Google's result the same business? Same phone, or most of the name's words in common. */
export function sameBusiness(free: { name: string | null; phone: string | null }, google: { name: string | null; phone: string | null }): boolean {
  if (free.phone && google.phone && free.phone === google.phone) return true;
  const a = nameWords(free.name), b = nameWords(google.name);
  if (!a.size || !b.size) return false;
  const common = [...a].filter((w) => b.has(w)).length;
  return common / Math.min(a.size, b.size) >= 0.6;
}

/**
 * Saves one page of lookup results into the free leads (called by syncSearch for
 * 'google_details' searches). Same shape of result as the normal saving step.
 */
export async function detailsIngestStep(env: Env, search: SearchRow, items: Record<string, unknown>[], startOffset: number, pageSize: number) {
  const stats = { read: items.length, results: items.length, newLeads: 0, skipped: 0, finished: items.length < pageSize };
  const { results: wanted } = await env.DB.prepare(
    `SELECT i.idx, i.query, i.lead_id, l.business_name, l.gbp_phone_formatted AS phone, l.raw
     FROM google_detail_items i JOIN leads l ON l.id = i.lead_id WHERE i.search_id = ?`,
  )
    .bind(search.id)
    .all<{ idx: number; query: string; lead_id: string; business_name: string | null; phone: string | null; raw: string | null }>();
  const byQuery = new Map(wanted.map((w) => [w.query, w]));

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Real runs say which search string found the place; the practice (mock) data doesn't.
    const w = typeof item.searchString === "string" ? byQuery.get(item.searchString) : wanted.find((x) => x.idx === startOffset + i);
    const place = normalizePlace(item, search.country_code);
    if (!w || !place) { stats.skipped++; continue; }
    if (!sameBusiness({ name: w.business_name, phone: w.phone }, { name: place.business_name, phone: place.gbp_phone_formatted })) {
      await env.DB.prepare(`UPDATE leads SET google_match = 'not_found', google_checked_at = datetime('now') WHERE id = ?`).bind(w.lead_id).run();
      stats.skipped++;
      continue;
    }
    await mergeGoogleIntoFree(env, search.id, w.lead_id, place, item, w.raw);
  }
  if (stats.finished) {
    // Anything Google returned nothing for.
    await env.DB.prepare(
      `UPDATE leads SET google_match = 'not_found', google_checked_at = datetime('now')
       WHERE google_match = 'queued' AND id IN (SELECT lead_id FROM google_detail_items WHERE search_id = ?)`,
    )
      .bind(search.id)
      .run();
  }
  return stats;
}

/** What the team added to a free business, carried over when it is folded into Google's copy. */
export const FOLD_COLUMNS = [
  "lead_status", "status_changed_at", "assigned_to", "owner_name", "owner_title", "owner_source",
  "registry_name", "registry_id", "registry_checked_at", "suppressed", "report_token", "demo_token", "report_views", "report_viewed_at",
] as const;
export type FoldFields = Record<(typeof FOLD_COLUMNS)[number], string | number | null>;
export const foldBinds = (f: FoldFields) => FOLD_COLUMNS.map((c) => f[c] ?? null);

/**
 * Onto the kept (Google) business, only where it has nothing of its own: the stage when it is
 * still Untouched, the owner, the registry match, do-not-contact, report / demo links. Report
 * opens are added up. ?1-?14 are FOLD_COLUMNS in order, ?15 the kept business.
 */
export const FOLD_CRM_SQL = `UPDATE leads SET
  lead_status = CASE WHEN COALESCE(lead_status, 'Untouched') = 'Untouched' AND COALESCE(?1, 'Untouched') <> 'Untouched' THEN ?1 ELSE lead_status END,
  status_changed_at = CASE WHEN COALESCE(lead_status, 'Untouched') = 'Untouched' AND COALESCE(?1, 'Untouched') <> 'Untouched' THEN ?2 ELSE status_changed_at END,
  assigned_to = COALESCE(assigned_to, ?3),
  owner_name = CASE WHEN COALESCE(owner_name, '') = '' AND ?4 IS NOT NULL THEN ?4 ELSE owner_name END,
  owner_title = CASE WHEN COALESCE(owner_name, '') = '' AND ?4 IS NOT NULL THEN ?5 ELSE owner_title END,
  owner_source = CASE WHEN COALESCE(owner_name, '') = '' AND ?4 IS NOT NULL THEN ?6 ELSE owner_source END,
  registry_name = CASE WHEN registry_checked_at IS NULL AND ?9 IS NOT NULL THEN ?7 ELSE registry_name END,
  registry_id = CASE WHEN registry_checked_at IS NULL AND ?9 IS NOT NULL THEN ?8 ELSE registry_id END,
  registry_checked_at = COALESCE(registry_checked_at, ?9),
  suppressed = COALESCE(suppressed, ?10),
  report_token = COALESCE(report_token, ?11),
  demo_token = COALESCE(demo_token, ?12),
  report_views = COALESCE(report_views, 0) + COALESCE(?13, 0),
  report_viewed_at = CASE WHEN report_viewed_at IS NULL OR ?14 > report_viewed_at THEN COALESCE(?14, report_viewed_at) ELSE report_viewed_at END
  WHERE id = ?15`;

async function mergeGoogleIntoFree(env: Env, searchId: string, freeId: string, p: NormalizedPlace, item: Record<string, unknown>, freeRaw: string | null) {
  // Is Google's listing already stored (from an earlier Google search)? Then fold the free copy into it.
  const existing = await env.DB.prepare(
    `SELECT id FROM leads WHERE (google_place_id = ? ${p.cid ? "OR cid = ?" : ""}) AND id <> ? LIMIT 1`,
  )
    .bind(...[p.google_place_id, ...(p.cid ? [p.cid] : []), freeId])
    .first<string>("id");
  if (existing) {
    // The team's work on the free copy (stage, owner, notes, report links, do-not-contact...) moves over.
    const crm = await env.DB.prepare(`SELECT ${FOLD_COLUMNS.join(", ")} FROM leads WHERE id = ?`).bind(freeId).first<FoldFields>();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO search_leads (search_id, lead_id, rank) SELECT search_id, ?, rank FROM search_leads WHERE lead_id = ?`).bind(existing, freeId),
      env.DB.prepare(`INSERT OR IGNORE INTO search_leads (search_id, lead_id, rank) VALUES (?, ?, NULL)`).bind(searchId, existing),
      env.DB.prepare(`INSERT OR IGNORE INTO lead_emails (lead_id, email, position) SELECT ?, email, position + 10 FROM lead_emails
                      WHERE lead_id = ? AND email NOT IN (SELECT email FROM lead_emails WHERE lead_id = ?)`).bind(existing, freeId, existing),
      env.DB.prepare(`INSERT OR IGNORE INTO lead_phones (lead_id, phone, phone_type, position) SELECT ?, phone, phone_type, position + 10 FROM lead_phones
                      WHERE lead_id = ? AND phone NOT IN (SELECT phone FROM lead_phones WHERE lead_id = ?)`).bind(existing, freeId, existing),
      env.DB.prepare(`UPDATE lead_notes SET lead_id = ? WHERE lead_id = ?`).bind(existing, freeId),
      env.DB.prepare(`UPDATE lead_events SET lead_id = ? WHERE lead_id = ?`).bind(existing, freeId),
      // Links are unique: taken off the free copy first, then kept on Google's copy if it has none.
      env.DB.prepare(`UPDATE leads SET report_token = NULL, demo_token = NULL WHERE id = ?`).bind(freeId),
      ...(crm ? [env.DB.prepare(FOLD_CRM_SQL).bind(...foldBinds(crm), existing)] : []),
      env.DB.prepare(`UPDATE leads SET socials = COALESCE(socials, (SELECT socials FROM leads WHERE id = ?)), data_source = CASE WHEN data_source = 'google' THEN 'google' ELSE 'free+google' END,
                        google_checked_at = datetime('now'), google_match = 'matched' WHERE id = ?`).bind(freeId, existing),
      env.DB.prepare(`UPDATE google_detail_items SET lead_id = ? WHERE lead_id = ?`).bind(existing, freeId),
      env.DB.prepare(`DELETE FROM search_leads WHERE lead_id = ?`).bind(freeId),
      env.DB.prepare(`DELETE FROM lead_emails WHERE lead_id = ?`).bind(freeId),
      env.DB.prepare(`DELETE FROM lead_phones WHERE lead_id = ?`).bind(freeId),
      env.DB.prepare(`DELETE FROM lead_attributes WHERE lead_id = ?`).bind(freeId),
      // Keep the free copy's website check when Google's copy has none.
      env.DB.prepare(`UPDATE website_audits SET lead_id = ? WHERE lead_id = ? AND NOT EXISTS (SELECT 1 FROM website_audits WHERE lead_id = ?)`)
        .bind(existing, freeId, existing),
      env.DB.prepare(`UPDATE leads SET website_audit_status = COALESCE(website_audit_status, (SELECT website_audit_status FROM leads WHERE id = ?)) WHERE id = ?`)
        .bind(freeId, existing),
      env.DB.prepare(`DELETE FROM website_audits WHERE lead_id = ?`).bind(freeId),
      env.DB.prepare(`DELETE FROM leads WHERE id = ?`).bind(freeId),
    ]);
    await applyToLeads(env, [existing]); // the free copy's emails may be on the do-not-contact list
    await rescoreLeads(env, [existing]);
    return;
  }
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(freeRaw ?? "{}"); } catch { /* keep {} */ }
  const merged = JSON.stringify({ ...JSON.parse(compactRaw(item)), overture: raw });
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE leads SET google_place_id = ?, cid = ?, gbp_url = ?, rating = ?, review_count = ?, is_claimed = ?,
         business_name = COALESCE(?, business_name), sub_category = COALESCE(?, sub_category),
         website = COALESCE(website, ?), website_domain = COALESCE(website_domain, ?),
         gbp_phone_raw = COALESCE(gbp_phone_raw, ?), gbp_phone_formatted = COALESCE(gbp_phone_formatted, ?),
         permanently_closed = ?, temporarily_closed = ?, business_status = ?, has_street_address = ?,
         price_level = ?, photos_count = ?, neighborhood = COALESCE(?, neighborhood), logo_url = COALESCE(?, logo_url),
         raw = ?, attributes_hash = ?, data_source = 'free+google', google_checked_at = datetime('now'), google_match = 'matched',
         updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(
      p.google_place_id, p.cid, p.gbp_url, p.rating, p.review_count, p.is_claimed,
      p.business_name, p.gbp_category, p.website, p.website_domain, p.gbp_phone_raw, p.gbp_phone_formatted,
      p.permanently_closed, p.temporarily_closed, p.business_status, p.has_street_address,
      p.price_level, p.photos_count, p.neighborhood, p.logo_url, merged, attributesHash(p.attributes), freeId,
    ),
    env.DB.prepare(`INSERT OR IGNORE INTO search_leads (search_id, lead_id, rank) VALUES (?, ?, NULL)`).bind(searchId, freeId),
  ]);
  await writeAttributes(env, [{ leadId: freeId, attributes: p.attributes }]);
  // Google may have added a phone number or website that is on the do-not-contact list.
  await applyToLeads(env, [freeId]);
  await rescoreLeads(env, [freeId]);
}
