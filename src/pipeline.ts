import { getDatasetItems, getRun, startRun, TERMINAL_FAILURE_STATUSES } from "./apify";
import { formatLeadDate, formatLeadDateTime, parseCityState, stateCode, stateName } from "./format";
import { normalizePlace, type NormalizedPlace } from "./normalize";

const DATASET_PAGE_SIZE = 500;
// D1 caps statements per batch; stay well under it.
const DB_BATCH_SIZE = 50;
// A search stuck in 'ingesting' this long (e.g. the Worker was evicted mid-ingest) is retried.
const STALE_INGEST_MINUTES = 10;

export interface SearchInput {
  category: string;
  city: string;
  /** US: 2-letter state code. Elsewhere: the state/province name. */
  state?: string | null;
  /** ISO country code; default "US". */
  countryCode?: string | null;
  countryName?: string | null;
  /** 0 = no limit (collect everything), which needs allowLarge. */
  maxResults?: number | null;
  allowLarge?: boolean;
  sourceCode?: string | null;
  skipPhoneLookup?: boolean;
  /** Run even though the same search was pulled recently. */
  force?: boolean;
}

// A repeat of the same category + city + state within this many days needs `force`.
export const REPEAT_WINDOW_DAYS = 30;

export interface PreviousPull {
  id: string;
  created_at: string;
  status: string;
  results_count: number | null;
  new_leads_count: number | null;
  /** Leads from that pull still in the database. */
  leads_in_database: number;
}

/** Thrown when a search repeats a recent pull; the caller can show the old results instead of paying again. */
export class RepeatPullError extends Error {
  constructor(public previous: PreviousPull[]) {
    super("This search was already pulled recently");
  }
}

/**
 * Key that treats "Plumbers", "plumber" and " PLUMBER " as the same search,
 * so a repeat is recognised however it was typed.
 */
export function searchKey(category: string): string {
  let k = category.trim().toLowerCase().replace(/\s+/g, " ");
  if (k.length > 3 && k.endsWith("s") && !k.endsWith("ss")) k = k.slice(0, -1);
  return k;
}

/**
 * Earlier pulls of the same category + place within the repeat window.
 * City "" = whole state/region; state "" too = whole country.
 */
export async function findRecentPulls(
  env: Env,
  category: string,
  city: string,
  state: string | null,
  countryCode = "US",
): Promise<PreviousPull[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.category, s.created_at, s.status, s.results_count, s.new_leads_count,
            (SELECT COUNT(*) FROM search_leads sl WHERE sl.search_id = s.id) AS leads_in_database
     FROM searches s
     WHERE lower(trim(s.city)) = lower(trim(?))
       AND COALESCE(upper(s.state), '') = COALESCE(upper(?), '')
       AND COALESCE(s.country_code, 'US') = ?
       AND s.status IN ('pending', 'scraping', 'ingesting', 'enriching', 'done')
       AND s.created_at >= datetime('now', ?)
     ORDER BY s.created_at DESC LIMIT 200`,
  )
    .bind(city, state ?? "", countryCode.toUpperCase(), `-${REPEAT_WINDOW_DAYS} days`)
    .all<PreviousPull & { category: string }>();
  const key = searchKey(category);
  return results.filter((r) => searchKey(r.category) === key).slice(0, 5);
}

/** Resolves the typed search box into the values a search would use, and reports earlier pulls. */
export async function checkSearch(env: Env, categoryInput: string, cityInput: string) {
  const category = categoryInput.trim();
  const { city, state } = parseCityState(cityInput);
  return { category, city, state, previous: await findRecentPulls(env, category, city, state) };
}

export interface SearchRow {
  id: string;
  category: string;
  city: string;
  state: string | null;
  country: string;
  source_code: string | null;
  max_results: number;
  skip_phone_lookup: number;
  apify_actor_id: string | null;
  apify_run_id: string | null;
  apify_dataset_id: string | null;
  status: string;
  error: string | null;
  results_count: number | null;
  new_leads_count: number | null;
  skipped_count: number | null;
  cost_apify: number;
  cost_twilio: number;
  cost_anthropic: number;
  cost_estimate: number;
  country_code: string | null;
  region_name: string | null;
  ingest_offset: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export class ValidationError extends Error {}

/**
 * Default cap for a plain API call is MAX_RESULTS_DEFAULT. Anything bigger, including
 * 0 = no limit, needs allowLarge: the "Find leads" flow sets it after showing the cost.
 */
export function resolveMaxResults(env: Env, requested: number | null | undefined, allowLarge: boolean): number {
  const defaultMax = Number(env.MAX_RESULTS_DEFAULT);
  if (requested == null) return defaultMax;
  if (!Number.isInteger(requested) || requested < 0) throw new ValidationError("maxResults must be 0 (no limit) or a positive whole number");
  if ((requested === 0 || requested > defaultMax) && !allowLarge) {
    throw new ValidationError(`More than ${defaultMax} results (or no limit) needs allowLarge: true`);
  }
  return requested;
}

export async function createSearch(env: Env, input: SearchInput): Promise<SearchRow> {
  const category = input.category?.trim();
  if (!category) throw new ValidationError("category is required");
  const countryCode = (input.countryCode?.trim() || "US").toUpperCase();
  const isUS = countryCode === "US";
  if (isUS && !input.city?.trim() && !input.state?.trim()) throw new ValidationError("a city or a state is required");
  if (category.length > 120 || (input.city?.length ?? 0) > 120) throw new ValidationError("category/city too long");

  // No city means the whole state/region; outside the US, no state means the whole country.
  const { city, state } = !isUS
    ? { city: input.city?.trim() ?? "", state: input.state?.trim() || "" }
    : input.city?.trim()
      ? parseCityState(input.city, input.state)
      : { city: "", state: stateCode(input.state) };
  const countryName = input.countryName?.trim() || (isUS ? "USA" : countryCode);
  const maxResults = resolveMaxResults(env, input.maxResults, input.allowLarge === true);
  const sourceCode = input.sourceCode?.trim() || env.SOURCE_CODE_DEFAULT;
  const actorId = env.APIFY_ACTOR_ID;
  const id = crypto.randomUUID();

  if (!input.force) {
    const previous = await findRecentPulls(env, category, city, state, countryCode);
    if (previous.length) throw new RepeatPullError(previous);
  }

  const regionLabel = isUS ? stateName(state) : state || null;
  await env.DB.prepare(
    `INSERT INTO searches (id, category, city, state, country, country_code, region_name, source_code, max_results,
       skip_phone_lookup, apify_actor_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(id, category, city, state, countryName, countryCode, regionLabel, sourceCode, maxResults,
      input.skipPhoneLookup ? 1 : 0, actorId)
    .run();

  try {
    // e.g. "Orlando, FL, USA", "Florida, USA", "Pune, Maharashtra, India", "India"
    const location = isUS
      ? city
        ? [city, state, "USA"].filter(Boolean).join(", ")
        : `${stateName(state)}, USA`
      : [city, state, countryName].filter(Boolean).join(", ");
    const run = await startRun(env, actorId, { category, location, maxResults });
    await env.DB.prepare(
      `UPDATE searches SET status = 'scraping', apify_run_id = ?, apify_dataset_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(run.id, run.defaultDatasetId, id)
      .run();
  } catch (err) {
    await markFailed(env, id, err);
  }

  return (await getSearch(env, id))!;
}

export async function getSearch(env: Env, id: string): Promise<SearchRow | null> {
  return env.DB.prepare(`SELECT * FROM searches WHERE id = ?`).bind(id).first<SearchRow>();
}

async function markFailed(env: Env, id: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`search ${id} failed:`, message);
  await env.DB.prepare(
    `UPDATE searches SET status = 'failed', error = ?, updated_at = datetime('now'), finished_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(message.slice(0, 2000), id)
    .run();
}

// Businesses saved per sync step. Big pulls (tens of thousands) are saved over many
// steps so each Worker run stays well inside Cloudflare's per-request limits.
const PAGES_PER_STEP = 2;

/**
 * Advances one search by one step: checks its Apify run, and once it has finished,
 * saves the next ~1,000 businesses. Safe to call repeatedly and concurrently: a
 * lock (ingest_lock) makes sure only one caller saves a given page.
 */
export async function syncSearch(env: Env, id: string): Promise<SearchRow | null> {
  let search = await getSearch(env, id);
  if (!search || !search.apify_run_id) return search;

  try {
    if (search.status === "scraping") {
      const run = await getRun(env, search.apify_run_id);
      if (TERMINAL_FAILURE_STATUSES.includes(run.status)) {
        await markFailed(env, id, new Error(`Apify run ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ""}`));
        return getSearch(env, id);
      }
      if (run.status !== "SUCCEEDED") return search;
      const started = await env.DB.prepare(
        `UPDATE searches SET status = 'ingesting', cost_apify = ?, apify_dataset_id = ?, ingest_offset = 0,
           results_count = 0, new_leads_count = 0, skipped_count = 0, updated_at = datetime('now')
         WHERE id = ? AND status = 'scraping'`,
      )
        .bind(run.usageTotalUsd ?? 0, run.defaultDatasetId, id)
        .run();
      if (started.meta.changes === 0) return getSearch(env, id); // another caller got there first
      search = (await getSearch(env, id))!;
    }
    if (search.status !== "ingesting" || !search.apify_dataset_id) return search;

    const lock = crypto.randomUUID();
    const locked = await env.DB.prepare(
      `UPDATE searches SET ingest_lock = ?, ingest_locked_at = datetime('now')
       WHERE id = ? AND status = 'ingesting' AND (ingest_lock IS NULL OR ingest_locked_at < datetime('now', ?))`,
    )
      .bind(lock, id, `-${STALE_INGEST_MINUTES} minutes`)
      .run();
    if (locked.meta.changes === 0) return search; // someone else is saving right now

    try {
      const step = await ingestStep(env, search, search.apify_dataset_id, search.ingest_offset ?? 0);
      // Phase 2 will move finished pulls to 'enriching' here.
      await env.DB.prepare(
        `UPDATE searches SET ingest_offset = ingest_offset + ?, results_count = results_count + ?,
           new_leads_count = new_leads_count + ?, skipped_count = skipped_count + ?, ingest_lock = NULL,
           status = CASE WHEN ? THEN 'done' ELSE status END,
           finished_at = CASE WHEN ? THEN datetime('now') ELSE finished_at END, updated_at = datetime('now')
         WHERE id = ? AND ingest_lock = ?`,
      )
        .bind(step.read, step.results, step.newLeads, step.skipped, step.finished ? 1 : 0, step.finished ? 1 : 0, id, lock)
        .run();
    } catch (err) {
      await env.DB.prepare(`UPDATE searches SET ingest_lock = NULL WHERE id = ? AND ingest_lock = ?`).bind(id, lock).run();
      throw err;
    }
  } catch (err) {
    await markFailed(env, id, err);
  }
  return getSearch(env, id);
}

/** Cron entry point: advance every in-flight search by one step. */
export async function syncActiveSearches(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT id FROM searches WHERE status IN ('scraping', 'ingesting') ORDER BY created_at LIMIT 20`,
  ).all<{ id: string }>();
  for (const { id } of results) {
    await syncSearch(env, id);
  }
}

interface IngestStats {
  /** Dataset items read this step (advances the offset). */
  read: number;
  results: number;
  newLeads: number;
  skipped: number;
  /** No more items to save (end of dataset, or the pull's cap reached). */
  finished: boolean;
}

/**
 * Google occasionally reissues a listing's place id while its CID (the Maps listing
 * number) stays the same. Point such places at the row we already have, so the same
 * listing is never stored twice.
 */
async function reuseExistingByCid(env: Env, places: NormalizedPlace[]): Promise<void> {
  const cids = [...new Set(places.map((p) => p.cid).filter((c): c is string => !!c))];
  if (!cids.length) return;
  const { results } = await env.DB.prepare(
    `SELECT cid, google_place_id FROM leads WHERE cid IN (${cids.map(() => "?").join(", ")})`,
  )
    .bind(...cids)
    .all<{ cid: string; google_place_id: string }>();
  const existing = new Map(results.map((r) => [r.cid, r.google_place_id]));
  for (const p of places) {
    const known = p.cid ? existing.get(p.cid) : undefined;
    if (known) p.google_place_id = known;
  }
}

/** Replaces each lead's stored Google attributes with the latest scrape's. */
export async function writeAttributes(
  env: Env,
  rows: { leadId: string; attributes: { section: string; name: string }[] }[],
): Promise<void> {
  const statements = rows.flatMap(({ leadId, attributes }) => [
    env.DB.prepare(`DELETE FROM lead_attributes WHERE lead_id = ?`).bind(leadId),
    ...attributes.map((a) =>
      env.DB.prepare(`INSERT OR IGNORE INTO lead_attributes (lead_id, section, name) VALUES (?, ?, ?)`).bind(
        leadId,
        a.section,
        a.name,
      ),
    ),
  ]);
  for (let i = 0; i < statements.length; i += 90) await env.DB.batch(statements.slice(i, i + 90));
}

/** Saves up to PAGES_PER_STEP pages of the dataset, starting at `startOffset`. */
async function ingestStep(env: Env, search: SearchRow, datasetId: string, startOffset: number): Promise<IngestStats> {
  const stats: IngestStats = { read: 0, results: 0, newLeads: 0, skipped: 0, finished: false };
  const seen = new Set<string>();
  const seenCids = new Set<string>();
  const now = new Date();
  const leadDate = formatLeadDate(now, env.LEAD_TIMEZONE);
  const leadDateTime = formatLeadDateTime(now, env.LEAD_TIMEZONE);
  const cap = search.max_results > 0 ? search.max_results : Infinity; // 0 = no limit

  for (let page = 0; page < PAGES_PER_STEP; page++) {
    const offset = startOffset + stats.read;
    if (offset >= cap) {
      stats.finished = true;
      break;
    }
    const items = await getDatasetItems(env, datasetId, offset, Math.min(DATASET_PAGE_SIZE, cap - offset));
    stats.read += items.length;
    stats.results += items.length;

    const places: { place: NormalizedPlace; raw: string }[] = [];
    // Everything with a Google id is kept, including unverified and closed businesses:
    // the dashboard filters on those (defaulting to verified + open) instead.
    for (const item of items) {
      const place = normalizePlace(item);
      if (!place || seen.has(place.google_place_id) || (place.cid && seenCids.has(place.cid))) {
        stats.skipped++;
        continue;
      }
      seen.add(place.google_place_id);
      if (place.cid) seenCids.add(place.cid);
      // Service-area businesses (common for trades) hide their address on Google.
      // They showed up for this city, so file them under it rather than nowhere.
      if (!place.city) {
        place.city = search.city || null; // "" = a whole-state pull: no city to file under
        place.state ??= search.state || null;
      }
      // Google sometimes omits the country; the search knows it.
      place.country ??= (search.country_code ?? "US") === "US" ? "USA" : search.country;
      places.push({ place, raw: JSON.stringify(item) });
    }

    for (let i = 0; i < places.length; i += DB_BATCH_SIZE) {
      const chunk = places.slice(i, i + DB_BATCH_SIZE);
      await reuseExistingByCid(env, chunk.map((c) => c.place));
      const newIds = chunk.map(() => crypto.randomUUID());
      const upserts = chunk.map(({ place, raw }, j) =>
        upsertLeadStatement(env, place, raw, { id: newIds[j], search, leadDate, leadDateTime }),
      );
      const results = await env.DB.batch<{ id: string }>(upserts);
      const leadIds = results.map((r) => r.results[0].id);

      await env.DB.batch(
        leadIds.map((leadId, j) =>
          env.DB.prepare(`INSERT OR REPLACE INTO search_leads (search_id, lead_id, rank) VALUES (?, ?, ?)`).bind(
            search.id,
            leadId,
            chunk[j].place.gbp_rank,
          ),
        ),
      );

      await writeAttributes(
        env,
        leadIds.map((leadId, j) => ({ leadId, attributes: chunk[j].place.attributes })),
      );

      leadIds.forEach((leadId, j) => {
        if (leadId === newIds[j]) stats.newLeads++;
      });
    }

    if (items.length < DATASET_PAGE_SIZE) {
      stats.finished = true;
      break;
    }
  }
  return stats;
}

/**
 * Inserts a lead, or refreshes the scraped fields of an existing one (same place id).
 * Enrichment, status, source code and first-seen dates are left alone on re-scrape,
 * and a missing value in the new scrape never erases an existing one.
 * RETURNING id yields the existing row's id on conflict, which is how new leads are counted.
 */
function upsertLeadStatement(
  env: Env,
  p: NormalizedPlace,
  raw: string,
  ctx: { id: string; search: SearchRow; leadDate: string; leadDateTime: string },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO leads (
       id, search_id, google_place_id, cid, business_name, gbp_category, lead_category, sub_category,
       gbp_phone_raw, gbp_phone_formatted, phone_type, website, gbp_url, gbp_rank, rating, review_count,
       address, city, state, postal_code, country, latitude, longitude,
       is_claimed, permanently_closed, temporarily_closed, business_status, website_domain, has_street_address,
       industry, price_level, photos_count, neighborhood, logo_url, source_code, lead_date, lead_datetime, raw
     ) VALUES (${Array(38).fill("?").join(", ")})
     ON CONFLICT(google_place_id) DO UPDATE SET
       cid = COALESCE(excluded.cid, leads.cid),
       business_name = COALESCE(excluded.business_name, leads.business_name),
       gbp_category = COALESCE(excluded.gbp_category, leads.gbp_category),
       sub_category = COALESCE(excluded.sub_category, leads.sub_category),
       gbp_phone_raw = COALESCE(excluded.gbp_phone_raw, leads.gbp_phone_raw),
       gbp_phone_formatted = COALESCE(excluded.gbp_phone_formatted, leads.gbp_phone_formatted),
       -- A changed number invalidates the old line-type check.
       phone_type = CASE
         WHEN excluded.gbp_phone_formatted IS NOT leads.gbp_phone_formatted AND excluded.gbp_phone_formatted IS NOT NULL
           THEN excluded.phone_type
         ELSE COALESCE(leads.phone_type, excluded.phone_type) END,
       phone_carrier = CASE
         WHEN excluded.gbp_phone_formatted IS NOT leads.gbp_phone_formatted AND excluded.gbp_phone_formatted IS NOT NULL
           THEN NULL
         ELSE leads.phone_carrier END,
       website = COALESCE(excluded.website, leads.website),
       gbp_url = COALESCE(excluded.gbp_url, leads.gbp_url),
       gbp_rank = COALESCE(excluded.gbp_rank, leads.gbp_rank),
       rating = COALESCE(excluded.rating, leads.rating),
       review_count = COALESCE(excluded.review_count, leads.review_count),
       address = COALESCE(excluded.address, leads.address),
       city = COALESCE(excluded.city, leads.city),
       state = COALESCE(excluded.state, leads.state),
       postal_code = COALESCE(excluded.postal_code, leads.postal_code),
       country = COALESCE(excluded.country, leads.country),
       latitude = COALESCE(excluded.latitude, leads.latitude),
       longitude = COALESCE(excluded.longitude, leads.longitude),
       is_claimed = COALESCE(excluded.is_claimed, leads.is_claimed),
       permanently_closed = excluded.permanently_closed,
       temporarily_closed = excluded.temporarily_closed,
       business_status = excluded.business_status,
       website_domain = COALESCE(excluded.website_domain, leads.website_domain),
       has_street_address = excluded.has_street_address,
       industry = excluded.industry,
       price_level = COALESCE(excluded.price_level, leads.price_level),
       photos_count = COALESCE(excluded.photos_count, leads.photos_count),
       neighborhood = COALESCE(excluded.neighborhood, leads.neighborhood),
       logo_url = COALESCE(excluded.logo_url, leads.logo_url),
       raw = excluded.raw,
       updated_at = datetime('now')
     RETURNING id`,
  ).bind(
    ctx.id,
    ctx.search.id,
    p.google_place_id,
    p.cid,
    p.business_name,
    p.gbp_category,
    p.gbp_category,
    p.sub_category,
    p.gbp_phone_raw,
    p.gbp_phone_formatted,
    p.phone_type,
    p.website,
    p.gbp_url,
    p.gbp_rank,
    p.rating,
    p.review_count,
    p.address,
    p.city,
    p.state,
    p.postal_code,
    p.country,
    p.latitude,
    p.longitude,
    p.is_claimed,
    p.permanently_closed,
    p.temporarily_closed,
    p.business_status,
    p.website_domain,
    p.has_street_address,
    p.industry,
    p.price_level,
    p.photos_count,
    p.neighborhood,
    p.logo_url,
    ctx.search.source_code,
    ctx.leadDate,
    ctx.leadDateTime,
    raw,
  );
}
