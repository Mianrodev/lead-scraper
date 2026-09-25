# Filters round 2: final build spec for Lead Finder (Cloudflare Worker, Hono and D1)

Project: `C:\Users\admin\Links\lead-scraper`. This spec is written against the tree as it is today (checked 2026-09-24). Everything below is a change to that tree.

**What already exists (do not rebuild):**

- **`migrations/0002_filters.sql`** (applied) adds these columns to `leads`:
  - `business_status`
  - `website_domain`
  - `has_street_address`

  It also adds non-unique indexes on `cid`, `gbp_phone_formatted`, `website_domain` and `gbp_rank`.
- **`migrations/0003_signals.sql`** (pending locally, must not be edited) adds:
  - `leads.industry`, `leads.price_level TEXT` ('$'..'$$$$') and `leads.photos_count`
  - `lead_attributes(lead_id, section, name)`, which stores true values only
  - indexes `idx_leads_industry`, `idx_leads_postal`, `idx_leads_price`, `idx_leads_updated`, `idx_leads_geo(latitude, longitude)` and `idx_search_leads_rank`
- **`src/taxonomy.ts`** holds 19 industries and 758 categories. It exports `INDUSTRIES`, `TOP_100`, `industryOf()` and `categoriesOf()`.
- **`src/leads.ts`** parses these params:
  - lists: `industry`, `category`, `exclude_category`, `postal_code`, `price`, `attribute`, `search_id`, `state`, `city`, `phone_type`, `status`, `lead_status`, `source_code`
  - `top100`
  - `near` (`City|ST` or `zip:12345`) with `radius_miles`. The centre is the average position of stored leads, so no geocoding is needed.
  - `top_pct`: rank percentile of any search that found the lead, computed at query time from `search_leads.rank` and `searches.results_count`
  - `updated_from` / `updated_to`, `min_photos`
  - `verified`, `website`, `phone`, `location` (`storefront` | `service_area`)
  - `min_rating` / `max_rating`, `min_reviews` / `max_reviews`, `max_rank` (on `gbp_rank`)
  - `added_from` / `added_to`, `q`
  - `dedupe_website`, `dedupe_phone`, `dedupe_listing`

  Other behaviour already in `src/leads.ts`:
  - Lists longer than 20 values are inlined as escaped literals (`sqlString`, `MAX_BOUND_LIST = 20`).
  - `top100` is inlined as literals on `gbp_category`.
- **`src/pipeline.ts`**:
  - keeps unverified and closed rows
  - refuses a repeat of the same category + city + state within `REPEAT_WINDOW_DAYS = 30` (HTTP 409 with `RepeatPullError`)
  - `reuseExistingByCid()` points an incoming place at the existing row with the same CID
  - `writeAttributes()` does a DELETE plus one INSERT per attribute
- **`src/dashboard.ts`**:
  - left rail of `<details>` groups
  - Businesses / Pull history tabs
  - "You already pulled this" panel
  - `DEFAULTS = { verified: "verified", status: ["operational"] }`
- **`GET /api/leads/facets`** counts over the whole table and ignores active filters.

**Decisions this spec fixes:**

- **New migration.** It is `migrations/0004_filters2.sql`. It is not a new 0003, because 0003 already exists and re-adding its objects would fail.
- **Distance unit.** Miles everywhere, matching the existing `radius_miles` and US users.
- **No new category module.** The taxonomy stays in `src/taxonomy.ts`. It gains `LEGACY_ALIASES` and `canonicalCategory()`.
- **Bind limit.** D1 allows at most 100 bound parameters per statement. Taxonomy expansions (industry, Top 100) are never bound. They become 1-bind subqueries on precomputed columns (section 2).
- **Provider.** Production is Apify only (`compass/crawler-google-places`). DataForSEO derivations are specified for `src/providers/dataforseo-listings.ts` so they can be wired in later. They are tested with fixtures only.

---

## 1. Filter catalog

- **Control types:**
  - dropdown = single choice
  - multi = checkbox list with counts
  - range = from/to inputs
  - toggle = on/off switch
  - radio = pick one
- **"Existing"** means already parsed in `src/leads.ts`. The row then lists only what changes.
- **Where the SQL lives:** all SQL is inside `buildWhere()` over `leads l`. Subqueries use `l.id IN (SELECT lead_id ...)` so they compose with the dedupe CTEs in `buildLeadQuery()`. A future "select all matching" or export would reuse the same query.

| # | UI label | Group | Control | Query param(s) | SQL semantics | Column(s) | Ingest derivation | Targetron equivalent | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Country | Location | dropdown filled from data | `country` | `l.country = ?` | `leads.country` | existing | Country | Only "United States" exists today. Pulls stay US-only because the Apify location string, `stateCode()` and `src/us-cities.ts` are all US-only, and the meeting note scopes this to US. |
| 2 | State | Location | multi | `state` | existing `l.state IN (...)` | `leads.state` | existing | State | Facet counts become filter-aware (section 4). |
| 3 | City | Location | multi, narrowed by the chosen states | `city` | existing | `leads.city` | Existing. The city of service-area rows now stays fixed (3.3). | City/Town | The row shows "City guessed" when `city_inferred = 1`. |
| 4 | ZIP code | Location | multi with a search box | `postal_code` (existing) | existing `IN` | `leads.postal_code` | existing | Postal Code | Targetron takes one ZIP; we allow several. |
| 5 | Neighborhood | Location | multi, hidden when the facet is empty | `neighborhood` | `l.neighborhood IN (...)` | `leads.neighborhood` (new) | Apify `neighborhood` (28/40); DFS `address_info.borough` (15/50) | Neighborhood | |
| 6 | Near a place | Local area | text/typeahead + radius dropdown (5/10/25/50 mi) | `near` = `City\|ST`, `zip:12345` or **new** `@lat,lng`; `radius_miles` | Existing flat-earth distance. **Add** a sargable box first: `l.latitude BETWEEN ? AND ? AND l.longitude BETWEEN ? AND ?` (dLat = r/69.0, dLng = r/(69.172·cos lat)) so `idx_leads_geo` is used. | `latitude`, `longitude` | existing | Map point + radius | Centre lookup order: `src/us-cities.ts`, then the average of stored leads (existing), then no match (`0 = 1`, existing). `@lat,lng` covers Targetron's "pick a point". |
| 7 | Distance from the pulled city | Local area | dropdown Any / 5 / 10 / 25 / 50 mi. Disabled until a pull is picked under "Pulls & dates". | `within_miles` (only applies with `search_id`) | `l.id IN (SELECT lead_id FROM search_leads WHERE search_id IN (...) AND distance_miles <= ?)` | `search_leads.distance_miles` (new) | 3.6 | Map circle | Hides results that come from outside the searched area, e.g. Lakeland (~50 mi) in an Orlando pull. |
| 8 | Only businesses inside the pulled city | Local area | toggle | `same_city=1` (only applies with `search_id`) | `l.city_inferred = 0 AND lower(l.city) IN (SELECT lower(city) FROM searches WHERE id IN (...))` | `city_inferred` | 3.3 | none | Case-insensitive, because legacy `searches.city` is free text. |
| 9 | Industry | Category | multi, each industry with a "Select all" | `industry` (existing) | any-match: `l.id IN (SELECT lead_id FROM lead_categories WHERE industry IN (?,...))`; primary-match: existing `l.industry IN (...)`. "Other" = `l.industry IS NULL` (existing). | `lead_categories.industry` (new), `leads.industry` | 3.2 | none (Targetron is a flat list) | 1 bind per picked industry, never the expanded list. The 19 industries are listed in section 2. |
| 10 | Category | Category | multi grouped under industry, search box across all names | `category` (existing), `category_match=any\|primary` (new, default `any`) | any: `l.id IN (SELECT lead_id FROM lead_categories WHERE category IN (...))` (column is `COLLATE NOCASE`); primary: existing `l.gbp_category IN (...)` | `lead_categories.category`, `leads.gbp_category` | 3.2 | Category | "any" catches secondary categories, e.g. Pro-Tech lists 7. |
| 11 | Top 100 categories | Category | button for all industries, plus a "Top 100 in this industry" link under each industry | `top100=1` (existing) | any: `l.id IN (SELECT lead_id FROM lead_categories WHERE is_top100 = 1 [AND industry IN (?)])`; primary: existing inlined literals | `lead_categories.is_top100` (new) | 3.2 | none | With `industry` set, both conditions go in **one** subquery (the category must be Top 100 *and* in that industry). |
| 12 | Leave out these categories | Category | multi | `exclude_category` (existing) | any-match: `l.id NOT IN (SELECT lead_id FROM lead_categories WHERE category IN (...))`; primary: existing | `lead_categories.category` | — | Exclude | |
| 13 | Open or closed | Business status | multi Open / Temporarily closed / Permanently closed, default Open | `status` | existing | `business_status` | Existing. DFS fix in 3.2. | Business Status | Tooltip: "Our Google Maps pulls skip permanently closed businesses, so that count is usually 0." |
| 14 | Google verified | Business status | radio Any / Verified / Not verified, **default Any** | `verified` | existing | `is_claimed` | existing | Verification | Default changes from Verified to Any, with counts on each option (reason under Rejected / decisions). |
| 15 | Phone number | Contact info | dropdown Any / Has one / None | `phone` | existing | `gbp_phone_formatted` | existing | Phone with / without | |
| 16 | Specific phone number | Contact info | text | `phone_number` (new) | `l.gbp_phone_formatted = ?`, with the input run through `toE164()` in `parseFilters`; unparsable input gives `0 = 1` | `gbp_phone_formatted` | — | Phone: Enter Number | |
| 17 | Phone type | Contact info | multi | `phone_type` | existing | `phone_type` | existing | none (goes beyond Targetron) | |
| 18 | Website | Contact info | dropdown **Any / Has one / Has one, one business per website / None** | `website`; the third option sets `website=yes&dedupe_website=1` | existing | `website`, `website_domain` | existing | Website | Puts "one business per website" inside Contact info, as the meeting note asks. |
| 19 | Website is | Contact info | text | `domain` (new) | `l.website_domain = ?`, with the input run through `websiteDomain()` first so `https://www.x.com/about` matches | `website_domain` | 3.4 | Website: Enter domain | Exact match on the domain. Label says "is", not "contains". |
| 20 | Email address | Contact info | dropdown Any / Has one / None. Disabled with the hint "(coming with email lookup)". | `email` (new) | yes: `EXISTS (SELECT 1 FROM lead_emails e WHERE e.lead_id = l.id)`; no: `NOT EXISTS` | `lead_emails` | none yet (table exists, never written) | Email | Targetron's "email and phone" is `phone=yes&email=yes`; no extra option. |
| 21 | Social media | Contact info | hint text only | — | — | `leads.socials` | none | none | Placeholder for later. |
| 22 | One business per phone number | Remove duplicates | toggle | `dedupe_phone` | existing | | existing | none | Tooltip: "Branches that share one number (for example a toll-free line) collapse to the one with the most reviews." |
| 23 | One per Google listing | Remove duplicates | toggle | `dedupe_listing` | existing | `cid` | existing | none | After the unique index this only affects rows with no listing number. Tooltip: "Google listing number". |
| 24 | Hide paid ads | Remove duplicates | toggle | `hide_ads=1` (new) | `l.is_advertisement = 0` | `is_advertisement` (new) | Apify `isAdvertisement` | none | The group also carries a note: "One per website is under Contact info". |
| 25 | Google rating | Ratings & reviews | chips (2.0+, 3.0+, 3.5+, 4.0+, 4.5+, "3.0 and below", "4.0 and below") + from/to + "Not rated yet" | `min_rating`, `max_rating`, `rating=unrated` (new) | existing ranges (a bound never matches NULL); `unrated`: `l.rating IS NULL`, and it clears min/max | `rating` | existing | Rating ≥ / ≤ | |
| 26 | Number of reviews | Ratings & reviews | chips (None, 1–10, 10–100, 100–1,000, 1,000–10,000, 10,000+) + from/to | `min_reviews`, `max_reviews`, `reviews=none` (new) | existing; `none`: `COALESCE(l.review_count,0) = 0` | `review_count` | existing | Reviews | Chips just set min/max. |
| 27 | Share of 1-star reviews | Ratings & reviews | dropdown Any / 10%+ / 20%+ | `min_one_star_share` (new) | `l.one_star_share >= ?` | `one_star_share` (new) | 3.2 | none | Flags businesses with reputation problems. |
| 28 | **Top % of Google results** | Search position | dropdown Any / Top 1% / 5% / 10% / 25% (listed first in the group) | `top_pct` (existing) | Existing: `EXISTS (... sl.rank <= MAX(1, (results_count * P + 99) / 100))`, i.e. rank ≤ ceil(P% × results of that pull), for any pull that found the lead | `search_leads.rank`, `searches.results_count` | existing | none (Targetron has no rank) | This is the meeting note's "Position – Top 1%". Tooltip: "Where it appeared in Google Maps for the search that found it. Approximate: Google's order changes across the map." Pair with "Hide paid ads", because rank 1 can be an ad. |
| 29 | Top position in Google results | Search position | dropdown Any / Top 3 / 10 / 20 / 50 | `max_rank` (existing) | changes to `l.best_rank <= ?` | `best_rank` (new) | best (lowest) rank over all pulls (3.5) | none | |
| 30 | Top % by reviews in its city | Search position | dropdown Any / 1% / 5% / 10% / 25% | `top_reviews_pct` (new) | `l.market_pct <= ?/100.0` | `market_pct`, `market_cohort_size` (new) | 3.7 | none | Secondary control. Tooltip: "Compared with businesses of the same main category in the same city, by number of reviews. Only for groups of 5 or more." |
| 31 | Photos on Google | Business signals | dropdown Any / 1+ / 10+ / 50+ | `min_photos` (existing) | existing | `photos_count` | existing | Photos (export column only) | |
| 32 | Opening hours listed | Business signals | toggle | `has_hours=1` | `l.has_hours = 1` | `has_hours` (new) | 3.2 | none | |
| 33 | Open 24 hours | Business signals | toggle | `open_24h=1` | `l.open_24h = 1` | `open_24h` (new) | 3.2 | none | 17/40 in the Apify sample. |
| 34 | Has a description | Business signals | toggle | `has_description=1` | `l.has_description = 1` | `has_description` (new) | 3.2 | none | |
| 35 | Price level | Business signals | multi $ / $$ / $$$ / $$$$ | `price` (existing, TEXT values) | existing `l.price_level IN ('$',...)` | `price_level` | existing | Price | Hidden when the facet is empty. It is empty for trades (price is null in 40/40 Apify and 50/50 DFS items); it only appears for restaurants and similar categories. |
| 36 | Google profile features | Business signals | multi: a curated "common" list, then "More" with every feature seen in the data, all with counts | `attribute` (existing param; values are now keys) | existing HAVING-count pattern on `key` with `value = 1` (section 2) | `lead_attributes` (reshaped) | 3.2 | Attributes | Every Google yes/no feature is stored, so restaurant and medical features appear automatically. |
| 37 | Street address | Physical location | radio Any / Has a street address / Service area only (no address on Google) | `location` | existing | `has_street_address` | existing | Location type | |
| 38 | Date added to your list | Pulls & dates | date range | `added_from`, `added_to` | existing | `created_at` | existing | Added Date Range | |
| 39 | Details changed on Google between | Pulls & dates | date range | `updated_from`, `updated_to` (existing names) | now `l.data_changed_at >= ? AND l.created_at < ?` (from) and `l.data_changed_at < date(?, '+1 day')` (to) | `data_changed_at` (new) | 3.5 | Updated Date Range | Excludes businesses added during the range, as Targetron does. |
| 40 | Last seen in a pull | Pulls & dates | date range | `seen_from`, `seen_to` (new) | `l.last_seen_at >= ?` / `< date(?, '+1 day')` | `last_seen_at` (new) | 3.5 | none | |
| 41 | Found in these pulls | Pulls & dates | multi (pull list with counts) | `search_id` | existing | `search_leads` | existing | none | |
| 42 | First found by these pulls (new businesses only) | Pulls & dates | multi | `first_search_id` (new) | `l.search_id IN (...)` | `leads.search_id` | existing | none | |
| 43 | Found in 2 or more pulls | Pulls & dates | toggle | `min_pulls=2` (new) | `l.pull_count >= ?` | `pull_count` (new) | 3.5 | none | |
| 44 | Source code | Pulls & dates | multi | `source_code` | existing | | | none | |
| 45 | Lead status | Pulls & dates | multi | `lead_status` | existing | | | none | |
| 46 | Business name contains | Name | text | `q` | existing LIKE | `business_name` | | Business Name | |

**Rules for bound parameters, applied in `parseFilters` and `buildWhere`:**

- **Size caps.** Each list param is capped at 200 values. Beyond that the request gets HTTP 400 ("Too many values for city"). This keeps the SQL well under D1's statement-size limit.
- **Bind budget.** `inList` binds values only while `binds.length + values.length <= 80`. Otherwise it inlines them with `sqlString()`.
  - The existing rule of inlining lists over 20 values stays.
  - Scalars (numbers and dates) are always bound.
  - The page query adds 2 binds (LIMIT and OFFSET), so a statement never exceeds 100.

**Dropped, with reasons.** The UI hint under Business signals reads: "Company size, revenue, website technology and contact job titles need a paid data provider and aren't available."

| Targetron item | Why dropped | Closest thing we offer |
|---|---|---|
| Company Type, Number of Employees, Revenue, CMS Generator, Preferred Contacts (job position) | No data. These come from third-party company data or crawling each website, not from Google Maps. | none |
| County / District | Neither provider returns a county field. Adding it needs a static ZIP-to-county table (~40k rows) and a backfill, which is out of scope for this round. The data itself could be obtained. | ZIP multi-select (#4) and Near a place (#6) |
| Map polygon / rectangle drawing | Scope. It needs a map widget (Leaflet from jsDelivr would work without a build step), drawing tools and point-in-polygon SQL. The data (lat/lng) exists. | Near a place + radius (#6), including `@lat,lng` |
| Export step (format, quantity, columns) | Scope. It is its own feature (section 9). | `buildLeadQuery()` is shaped so export can reuse it |

---

## 2. Schema migration `migrations/0004_filters2.sql`

Do not edit `0003_signals.sql`. Apply 0003 and then 0004 in order.

```sql
-- Filters round 2: every category per lead, all Google yes/no features, business signals,
-- location detail, position/prominence, pull bookkeeping, fingerprints, batch pulls.
-- Derived values for existing rows: POST /api/admin/backfill (section 3.8).

-- ===== 1. Merge any leads that share a Google listing number (cid), then make cid unique =====
-- No-op on today's data (79 leads, 79 distinct cids) but must be safe on any copy.
CREATE TABLE _cid_merge AS
  SELECT d.id AS loser,
         (SELECT k.id FROM leads k WHERE k.cid = d.cid ORDER BY k.created_at, k.id LIMIT 1) AS keeper
  FROM leads d
  WHERE d.cid IS NOT NULL
    AND d.id <> (SELECT k.id FROM leads k WHERE k.cid = d.cid ORDER BY k.created_at, k.id LIMIT 1);

-- Keep the user's work from the copy being removed.
UPDATE leads SET
  lead_status = COALESCE((SELECT x.lead_status FROM _cid_merge m JOIN leads x ON x.id = m.loser
                          WHERE m.keeper = leads.id AND x.lead_status <> 'Untouched' LIMIT 1), lead_status),
  source_code = COALESCE(source_code, (SELECT x.source_code FROM _cid_merge m JOIN leads x ON x.id = m.loser
                                       WHERE m.keeper = leads.id AND x.source_code IS NOT NULL LIMIT 1)),
  phone_type  = COALESCE(phone_type, (SELECT x.phone_type FROM _cid_merge m JOIN leads x ON x.id = m.loser
                                      WHERE m.keeper = leads.id AND x.phone_type IS NOT NULL LIMIT 1))
WHERE id IN (SELECT keeper FROM _cid_merge);

UPDATE OR IGNORE search_leads SET lead_id = (SELECT keeper FROM _cid_merge WHERE loser = search_leads.lead_id)
 WHERE lead_id IN (SELECT loser FROM _cid_merge);
DELETE FROM search_leads    WHERE lead_id IN (SELECT loser FROM _cid_merge);
DELETE FROM lead_attributes WHERE lead_id IN (SELECT loser FROM _cid_merge);
DELETE FROM lead_emails     WHERE lead_id IN (SELECT loser FROM _cid_merge);
DELETE FROM lead_phones     WHERE lead_id IN (SELECT loser FROM _cid_merge);
DELETE FROM leads           WHERE id      IN (SELECT loser FROM _cid_merge);
DROP TABLE _cid_merge;

DROP INDEX IF EXISTS idx_leads_cid;
CREATE UNIQUE INDEX idx_leads_cid_unique ON leads(cid) WHERE cid IS NOT NULL;

-- ===== 2. leads: new derived columns =====
ALTER TABLE leads ADD COLUMN street TEXT;
ALTER TABLE leads ADD COLUMN neighborhood TEXT;
ALTER TABLE leads ADD COLUMN city_inferred INTEGER NOT NULL DEFAULT 0;  -- 1 = city copied from the search
ALTER TABLE leads ADD COLUMN has_hours INTEGER;                         -- 1/0, NULL unknown
ALTER TABLE leads ADD COLUMN open_24h INTEGER;
ALTER TABLE leads ADD COLUMN days_open INTEGER;
ALTER TABLE leads ADD COLUMN description TEXT;
ALTER TABLE leads ADD COLUMN has_description INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN is_advertisement INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN one_star_share REAL;                       -- 0..1
ALTER TABLE leads ADD COLUMN best_rank INTEGER;                         -- lowest rank over every pull
ALTER TABLE leads ADD COLUMN market_pct REAL;                           -- 0 = most reviewed in (state, city, gbp_category)
ALTER TABLE leads ADD COLUMN market_cohort_size INTEGER;
ALTER TABLE leads ADD COLUMN pull_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE leads ADD COLUMN last_seen_at TEXT;
ALTER TABLE leads ADD COLUMN last_scraped_at TEXT;
ALTER TABLE leads ADD COLUMN data_changed_at TEXT;                      -- name/phone/website/rating/reviews/status changed
ALTER TABLE leads ADD COLUMN google_first_seen_at TEXT;                 -- DataForSEO first_seen; NULL for Apify
ALTER TABLE leads ADD COLUMN provider TEXT NOT NULL DEFAULT 'apify';    -- apify | dataforseo

UPDATE leads SET best_rank = COALESCE((SELECT MIN(rank) FROM search_leads sl WHERE sl.lead_id = leads.id), gbp_rank);
UPDATE leads SET pull_count = MAX(1, (SELECT COUNT(*) FROM search_leads sl WHERE sl.lead_id = leads.id));
UPDATE leads SET last_seen_at = COALESCE(
    (SELECT MAX(COALESCE(s.finished_at, s.created_at)) FROM search_leads sl JOIN searches s ON s.id = sl.search_id
      WHERE sl.lead_id = leads.id), updated_at),
  last_scraped_at = updated_at;
-- Best effort; the backfill refines it from raw.
UPDATE leads SET city_inferred = 1 WHERE has_street_address = 0 AND (address IS NULL OR trim(address) = '');
UPDATE leads SET provider = 'dataforseo' WHERE search_id IN (SELECT id FROM searches WHERE apify_actor_id = 'dataforseo-test');

CREATE INDEX idx_leads_neighborhood ON leads(neighborhood);
CREATE INDEX idx_leads_best_rank ON leads(best_rank);
CREATE INDEX idx_leads_market_pct ON leads(market_pct);
CREATE INDEX idx_leads_last_seen ON leads(last_seen_at);
CREATE INDEX idx_leads_changed ON leads(data_changed_at);
CREATE INDEX idx_leads_first_search ON leads(search_id);

-- ===== 3. Every category a business lists, with its taxonomy industry and Top 100 flag =====
CREATE TABLE lead_categories (
  lead_id   TEXT NOT NULL REFERENCES leads(id),
  position  INTEGER NOT NULL,                 -- 0 = primary
  category  TEXT NOT NULL COLLATE NOCASE,     -- canonical name (canonicalCategory)
  industry  TEXT,                             -- industryOf(category); NULL = not in taxonomy
  is_top100 INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (lead_id, position)
);
CREATE INDEX idx_lead_categories_category ON lead_categories(category, lead_id);
CREATE INDEX idx_lead_categories_industry ON lead_categories(industry, lead_id);
CREATE INDEX idx_lead_categories_top100   ON lead_categories(is_top100, industry, lead_id);
-- Seed position 0 from existing columns so filters work before the backfill runs.
INSERT INTO lead_categories (lead_id, position, category, industry, is_top100)
  SELECT id, 0, gbp_category, industry, 0 FROM leads WHERE gbp_category IS NOT NULL;

-- ===== 4. Google yes/no features: reshape 0003's table to keep false values and a stable key =====
DROP TABLE lead_attributes;                   -- refilled from raw by the backfill
CREATE TABLE lead_attributes (
  lead_id TEXT NOT NULL REFERENCES leads(id),
  key     TEXT NOT NULL,     -- attributeKey(name), e.g. 'online-estimates'; section-independent
  section TEXT,              -- last seen section, display only
  name    TEXT NOT NULL,     -- Google's label, e.g. 'Online estimates'
  value   INTEGER NOT NULL,  -- 1 offered, 0 explicitly not offered
  PRIMARY KEY (lead_id, key)
);
CREATE INDEX idx_lead_attributes_key ON lead_attributes(key, value, lead_id);

-- ===== 5. searches: canonical inputs, provider, geography, batch, cost, breakdown =====
ALTER TABLE searches ADD COLUMN provider TEXT NOT NULL DEFAULT 'apify';
ALTER TABLE searches ADD COLUMN canonical_category TEXT;                -- filled in TS (backfill + createSearch)
ALTER TABLE searches ADD COLUMN fingerprint TEXT;                       -- filled in TS: 'plumber|orlando|FL|apify'
ALTER TABLE searches ADD COLUMN batch_id TEXT;                          -- set when several categories are pulled together
ALTER TABLE searches ADD COLUMN center_lat REAL;
ALTER TABLE searches ADD COLUMN center_lng REAL;
ALTER TABLE searches ADD COLUMN center_source TEXT;                     -- city_list | results | NULL
ALTER TABLE searches ADD COLUMN radius_miles REAL;
ALTER TABLE searches ADD COLUMN estimated_cost REAL;
ALTER TABLE searches ADD COLUMN skipped_no_id INTEGER;
ALTER TABLE searches ADD COLUMN skipped_duplicate INTEGER;              -- same place id / cid twice in one run
ALTER TABLE searches ADD COLUMN known_before INTEGER;                   -- results that were already in the table
ALTER TABLE searches ADD COLUMN requested_by TEXT;                      -- Cf-Access-Authenticated-User-Email
ALTER TABLE searches ADD COLUMN options_json TEXT;                      -- pull settings, shown in history

UPDATE searches SET provider = 'dataforseo' WHERE apify_actor_id = 'dataforseo-test';
CREATE INDEX idx_searches_fingerprint ON searches(fingerprint, created_at);
CREATE INDEX idx_searches_batch ON searches(batch_id);
CREATE INDEX idx_searches_provider ON searches(provider);

-- ===== 6. search_leads: distance from the pull centre and when it was seen =====
ALTER TABLE search_leads ADD COLUMN distance_miles REAL;
ALTER TABLE search_leads ADD COLUMN seen_at TEXT;
CREATE INDEX idx_search_leads_distance ON search_leads(search_id, distance_miles);
```

`searches.status` gains the value `queued`, which is used by batch pulls in section 5. It is a TEXT column, so the schema does not change.

**Runbook (README, not in the migration).** Before `db:migrate:remote`, run `SELECT cid, COUNT(*) FROM leads WHERE cid IS NOT NULL GROUP BY cid HAVING COUNT(*) > 1;` to see what step 1 will merge.

**Taxonomy storage: a static TS module (`src/taxonomy.ts`), not a D1 table.**

Why:
1. The list changes together with code (aliases, placement). A table would need a seed migration for every edit.
2. Unit tests import it directly.
3. `GET /api/categories` returns it as one blob with counts joined at request time.
4. About 25 KB is trivial for a Worker.

The only per-row copy is `lead_categories.industry` / `is_top100`. That copy exists so SQL never has to bind the expanded lists. When the taxonomy changes, run the backfill to refresh it.

What to add to `taxonomy.ts`:
- `LEGACY_ALIASES`:
  - `Moving company` → `Moving service`
  - `Commercial cleaning service` → `Janitorial service`
  - `Attorney` → `Lawyer`
  - `Handyman` → `Handyman/Handywoman/Handyperson`
  - `Makeup artist` → `Make-up artist`
- `canonicalCategory(name)`, which works in this order:
  1. Trim the name and apply the aliases.
  2. Try a case-insensitive exact match to a taxonomy name.
  3. Try a plural strip: `ies`→`y`, then `es`, then `s`. For example "plumbers" → "Plumber".
  4. Otherwise return the trimmed input.
- `isTop100(category)`.

The 19 industries, as the file stands today:
- Medical & Healthcare
- Dental
- Home Services
- Construction & Contractors
- Automotive
- Legal
- Financial & Insurance
- Real Estate
- Beauty & Personal Care
- Fitness & Wellness
- Restaurants & Food
- Retail
- Professional Services
- Education & Childcare
- Pets & Veterinary
- Events & Photography
- Travel & Hospitality
- Technology & Repair
- Senior Care, Home Health & Funeral

**Source.** The file's header cites the lobstr GCID-deduped GBP category list (github.com/lobstrio/google-business-categories, Sept 2026) as the source of truth. `TOP_100` has exactly 100 names, and each one is in some industry. `Service establishment` (a generic DataForSEO category) is never an industry match.

**Feature labels: new static module `src/attributes.ts`.**

- `attributeKey(name)`: lowercase the name, replace non-alphanumerics with `-`, and trim the dashes. For example "Identifies as women-owned" → `identifies-as-women-owned`. The key ignores the section because Google moves features between sections.
- `DFS_ATTRIBUTE_KEYS: Record<string, string>` maps DataForSEO keys to the same key:

  | DataForSEO key | Our key |
  |---|---|
  | `has_onsite_services` | `onsite-services` |
  | `offers_online_estimates` | `online-estimates` |
  | `has_service_repair` | `repair-services` |
  | `has_service_installation` | `installation-service` |
  | `pay_credit_card` | `credit-cards` |
  | `pay_debit_card` | `debit-cards` |
  | `pay_mobile_nfc` | `nfc-mobile-payments` |
  | `has_wheelchair_accessible_entrance` | `wheelchair-accessible-entrance` |
  | `welcomes_lgbtq` | `lgbtq-friendly` |
  | `is_owned_by_women` | `identifies-as-women-owned` |
  | `is_owned_by_veterans` | `identifies-as-veteran-owned` |
  | `is_owned_by_latinx` | `identifies-as-latino-owned` |
  | `requires_appointments` | `appointment-required` |

  DFS keys may arrive grouped (`crowd/welcomes_lgbtq`). Match on the part after the last `/`.
- `FEATURED`: an ordered list of `{ key, label }`, shown first in the rail. It only contains keys observed in `test-runs/provider-test/apify-dataset.json`:

  | Key | Label |
  |---|---|
  | `onsite-services` | Comes to you |
  | `online-estimates` | Online estimates |
  | `repair-services` | Repair services |
  | `installation-service` | Installation |
  | `service-guarantee` | Service guarantee |
  | `credit-cards` | Takes credit cards |
  | `debit-cards` | Takes debit cards |
  | `nfc-mobile-payments` | Tap-to-pay |
  | `wheelchair-accessible-entrance` | Wheelchair accessible |
  | `lgbtq-friendly` | LGBTQ+ friendly |
  | `identifies-as-women-owned` | Women-owned |
  | `identifies-as-veteran-owned` | Veteran-owned |
  | `identifies-as-latino-owned` | Latino-owned |
  | `small-business` | Small business |

  Every other key appears under "More features" with Google's own `name` as the label.

---

## 3. Ingest changes (`src/normalize.ts`, `src/pipeline.ts`, `src/providers/dataforseo-listings.ts`)

### 3.1 `NormalizedPlace` changes

```ts
categories: string[];                 // canonical, deduped (case-insensitive), primary first
street: string | null;
neighborhood: string | null;
has_hours: 0 | 1 | null;
open_24h: 0 | 1 | null;
days_open: number | null;
description: string | null;
has_description: 0 | 1;
is_advertisement: 0 | 1;
one_star_share: number | null;
google_first_seen_at: string | null;
provider: "apify" | "dataforseo";
attributes: { key: string; section: string | null; name: string; value: 0 | 1 }[];  // replaces {section,name}
// unchanged: industry, price_level (TEXT), photos_count, everything else
```

`profileAttributes()` changes:
- It keeps `false` values (value 0) as well as `true`.
- It emits `key = attributeKey(name)`.
- It de-duplicates by key, and the first occurrence wins.

### 3.2 Derivations

Each rule gives the Apify field first; the DataForSEO equivalent follows in brackets.

- **`categories`.** Build `[categoryName, ...categories]` [`[category, ...additional_categories]`]. Then:
  1. Apply `canonicalCategory()` to each.
  2. Drop empties.
  3. Drop `Service establishment` unless it is the only one.
  4. De-duplicate case-insensitively.

  Then set:
  - `gbp_category = categories[0]`
  - `sub_category = categories[1] ?? null` (same meaning as today)
  - `industry = industryOf(categories[0])` (unchanged; primary only)
- **`street`.** `str(item.street)` [first comma part of `address_info.address` when it starts with a digit].
- **`neighborhood`.** `str(item.neighborhood)` [`address_info.borough`].
- **`has_hours` and `days_open`.**
  - `has_hours = Array.isArray(openingHours) ? (openingHours.length > 0 ? 1 : 0) : null`
  - `days_open` = number of entries whose `hours` is not `/^closed$/i`

  [DataForSEO: `work_time?.work_hours?.timetable`. `has_hours` = timetable present. `days_open` = number of days with a non-null, non-empty slot array.]
- **`open_24h`.** 1 when `days_open === 7` and every `hours` matches `/^open 24 hours$/i`; otherwise 0; null when there are no hours. [DataForSEO: 1 when every one of the 7 days has exactly one slot with `open {hour:0, minute:0}` and `close {hour:24, minute:0}`.]
- **`description`.** `str(item.description, item.ownerDescription)` [`description`], cut to 2,000 characters. `has_description = description ? 1 : 0`.
- **`price_level`.** Existing `priceLevel()` (TEXT) [same function on `price_level`].
- **`is_advertisement`.** `item.isAdvertisement === true ? 1 : 0` [0].
- **`one_star_share`.**
  - Apify: `reviewsDistribution {oneStar, twoStar, threeStar, fourStar, fiveStar}`.
  - [DataForSEO: `rating_distribution {"1".."5"}`.]
  - `total = sum`. The value is `total > 0 ? round(oneStar / total, 4) : null`.
- **`google_first_seen_at`.** null for Apify. [DataForSEO: `first_seen` is `"2024-07-28 00:14:49 +00:00"`, so parse it with `new Date(s.replace(" +00:00", "Z").replace(" ", "T")).toISOString()`, and use null if that throws or gives an invalid date.]
- **`business_status`** [DataForSEO only]:
  - `work_time?.work_hours?.current_status === "closed_forever"` → `permanently_closed`
  - otherwise `operational` (`close` only means closed at that hour)
  - Remove the hard-coded `permanently_closed: 0`.
- **`attributes`.**
  - Apify: `additionalInfo` = `{ [section]: Array<{ [name]: boolean }> }`. Each boolean gives `{ key: attributeKey(name), section, name, value }`.
  - [DataForSEO: `attributes.available_attributes[group][]` gives value 1 and `unavailable_attributes` gives value 0. The key is `DFS_ATTRIBUTE_KEYS[k] ?? attributeKey(k)`, and the name is the label from `FEATURED`, falling back to the raw key.]
- **`provider`.** `"apify"` [`"dataforseo"`].
- **Unchanged:** place id, cid, name, phone (`toE164`), website, `website_domain` (section 3.4), rank, rating, review_count, address, city/state/postal, coordinates, `is_claimed`, `has_street_address`, logo.

### 3.3 City of service-area businesses (fixes an existing bug)

**Today:** `ingestDataset` fills a missing city from the search. The upsert then writes `city = COALESCE(excluded.city, leads.city)`, so a service-area business first filed under Orlando is re-filed under Kissimmee by the next pull.

**Change:**
- In `ingestDataset`, when `place.city` is null, set `city`/`state` from the search **and** set `city_inferred = 1`. Otherwise `city_inferred = 0`. `city_inferred` is a column value passed to the upsert, not a normalize output.
- In the upsert:
  - `city = CASE WHEN excluded.city_inferred = 1 AND leads.city IS NOT NULL THEN leads.city ELSE COALESCE(excluded.city, leads.city) END`
  - Apply the same rule to `state`.
  - `city_inferred = CASE WHEN excluded.city_inferred = 0 THEN 0 WHEN leads.city IS NULL THEN 1 ELSE leads.city_inferred END`
- In the backfill, set `city_inferred = 1` when raw exists and both `raw.city` and `cityStateFromAddress(raw.address).city` are empty.

### 3.4 Website domain normalisation (`websiteDomain()`, existing; this is the contract)

1. Trim the input. If it has no scheme, prepend `https://`.
2. Take `new URL(...).hostname`. This drops path, query (including `utm_*`), fragment, port and credentials.
3. Lowercase it.
4. Strip one leading `www.` **or `m.`** (new).
5. Strip a trailing `.`.
6. Return null when:
   - the input cannot be parsed
   - there is no dot in the host
   - the host is in `SHARED_HOSTS` (the existing set: facebook, instagram, linktr.ee, g.page, yelp, ...)

The same function normalises the `domain` filter input (#19).

### 3.5 Upsert (`upsertLeadStatement`) and child tables

**New columns on the INSERT branch:**
- `street`, `neighborhood`, `city_inferred`
- `has_hours`, `open_24h`, `days_open`
- `description`, `has_description`
- `is_advertisement`, `one_star_share`
- `google_first_seen_at`, `provider`
- `best_rank = gbp_rank`
- `pull_count = 1`
- `last_seen_at = datetime('now')`
- `last_scraped_at = datetime('now')`
- `data_changed_at = NULL`

**ON CONFLICT(google_place_id) DO UPDATE additions:**
```sql
cid = COALESCE(leads.cid, excluded.cid),          -- never move a stored cid (was COALESCE(excluded, leads))
street = COALESCE(excluded.street, leads.street),
neighborhood = COALESCE(excluded.neighborhood, leads.neighborhood),
has_hours = COALESCE(excluded.has_hours, leads.has_hours),
open_24h = COALESCE(excluded.open_24h, leads.open_24h),
days_open = COALESCE(excluded.days_open, leads.days_open),
description = COALESCE(excluded.description, leads.description),
has_description = MAX(excluded.has_description, leads.has_description),
is_advertisement = excluded.is_advertisement,
one_star_share = COALESCE(excluded.one_star_share, leads.one_star_share),
google_first_seen_at = COALESCE(leads.google_first_seen_at, excluded.google_first_seen_at),
provider = excluded.provider,
best_rank = CASE WHEN excluded.gbp_rank IS NULL THEN leads.best_rank
                 WHEN leads.best_rank IS NULL THEN excluded.gbp_rank
                 ELSE MIN(excluded.gbp_rank, leads.best_rank) END,
-- Requires the search_leads row for THIS search to be written AFTER this upsert (see below).
pull_count = leads.pull_count + CASE WHEN EXISTS (SELECT 1 FROM search_leads
               WHERE lead_id = leads.id AND search_id = ?) THEN 0 ELSE 1 END,   -- bind search.id
last_seen_at = datetime('now'),
last_scraped_at = datetime('now'),
data_changed_at = CASE WHEN
    excluded.business_name IS NOT leads.business_name
 OR (excluded.gbp_phone_formatted IS NOT NULL AND excluded.gbp_phone_formatted IS NOT leads.gbp_phone_formatted)
 OR (excluded.website_domain IS NOT NULL AND excluded.website_domain IS NOT leads.website_domain)
 OR (excluded.rating IS NOT NULL AND excluded.rating IS NOT leads.rating)
 OR (excluded.review_count IS NOT NULL AND excluded.review_count IS NOT leads.review_count)
 OR excluded.business_status IS NOT leads.business_status
  THEN datetime('now') ELSE leads.data_changed_at END,
-- city/state/city_inferred: section 3.3
```

**Rules that stay the same:**
- `search_id` keeps the first finder.
- `lead_status`, `source_code`, phone check and `created_at` are untouched.
- The `industry` overwrite stays.

**Child tables.** These are written after each upsert batch, in the same chunk loop. Add a comment in `ingestDataset`: *"search_leads must be written after the lead upsert batch; pull_count depends on it."*
```sql
-- 1 statement per lead:
INSERT OR REPLACE INTO search_leads (search_id, lead_id, rank, distance_miles, seen_at) VALUES (?, ?, ?, ?, datetime('now'));
-- 2 statements per lead:
DELETE FROM lead_categories WHERE lead_id = ?;
INSERT INTO lead_categories (lead_id, position, category, industry, is_top100) VALUES (?,?,?,?,?),(?,?,?,?,?)...;  -- ≤ 10 rows = 50 binds
-- 1 + ceil(n/19) statements per lead (5 binds per row, stay ≤ 95):
DELETE FROM lead_attributes WHERE lead_id = ?;
INSERT INTO lead_attributes (lead_id, key, section, name, value) VALUES (?,?,?,?,?),...;
```
- `writeAttributes()` is rewritten to take the new shape and emit multi-row inserts.
- Each lead needs about 6 statements. Batches stay at 50 statements per `env.DB.batch`.
- `known_before` counts results where `RETURNING id` came back different from the new UUID; that is the existing new-lead logic inverted.

### 3.6 Dedup policy (recommended)

**Identity is the place id OR the cid.** Phone and domain matches are never merged and never linked.

- **Place id stays the primary key.** The unique index on `google_place_id` stays, and so does the upsert.
- **CID is the second identity key.** It gets a partial unique index (section 2). `reuseExistingByCid()` rewrites the incoming place id to the stored one, so the upsert updates the existing row.
- **Guard against CID collisions.** A cid can collide that the pre-lookup missed (a concurrent ingest, or an existing row with NULL cid gaining one). Wrap each chunk's upsert batch in `try/catch`:
  - On an error whose message contains `idx_leads_cid_unique` or `UNIQUE constraint failed: leads.cid`, re-run `reuseExistingByCid(chunk)` and retry the batch once.
  - If it fails again, retry that chunk one lead at a time. For each lead that still fails, set `cid = NULL` on the incoming place, count it in `skipped_duplicate`, and log it. The paid pull is never marked failed because of this.
- **Same place id or cid twice in one run.** Skip it (the existing `seen` / `seenCids` sets) and count it in the new `skipped_duplicate`. Items with no place id are counted in `skipped_no_id`. `skipped_count` stays the total.
- **Same phone but a different cid** (e.g. Pro-Tech: two branches, one toll-free number), and **same domain but a different cid** (e.g. Mechanical One ×3): keep both rows, with no `duplicate_of` link. They are different Google listings. The query-time toggles (#18 "one business per website", #22, #23) collapse them when wanted. The response already reports `duplicatesHidden`, and the UI shows "(N duplicates hidden)". A stored link would need invalidating every time a phone or website changes.
- **Same name and nearly the same position with different ids** (e.g. "Discount Water Heaters" ×2): kept. These are distinct listings.
- **Apify `fid` / DFS `feature_id`:** not stored. They cover exactly the same rows as cid in both samples and add nothing.

### 3.7 Search geography

- **New `src/us-cities.ts`.**
  - Contents: `US_CITIES: [city, stateCode, lat, lng][]` from the GeoNames `cities15000` US subset (CC BY 4.0; credit it in the README). That is a few thousand rows and roughly 100–150 KB, which is acceptable as a Worker module.
  - `findCity(city, state)`: case-insensitive, and treats `St.`/`Saint` and `Ft.`/`Fort` as the same.
  - `suggestCities(state, prefix, limit)`.
- **`createSearch`.**
  - `center = findCity(city, state)`, giving `center_lat`/`center_lng` with `center_source = 'city_list'`.
  - `radius_miles` comes from the form (10 / 25 / 50, default `env.SEARCH_RADIUS_MILES` = 25). The Apify input still gets the location string, because the actor has no radius. The radius only drives `distance_miles` and filter #7.
- **During ingest.** When there is a centre, `distance_miles = round(haversineMiles(center, place), 2)`. It is NULL when either point is missing. `haversineMiles()` goes in a new `src/geo.ts`.
- **When the city is not in the list.** After ingest:
  1. Set the centre to the median lat/lng of results with `has_street_address = 1 AND city_inferred = 0 AND lower(city) = lower(search.city)`, with `center_source = 'results'`.
  2. Compute distances in JS for that search's `search_leads` rows.
  3. Write them back with `UPDATE search_leads SET distance_miles = ? WHERE search_id = ? AND lead_id = ?` in batches of 50.
  4. With fewer than 3 such rows, leave the centre NULL. Filter #7 is then disabled for that pull ("No centre for this pull").
- **`resolveFilters()` for `near`.** Try `findCity()` first, then the existing average of stored leads. Also accept `@lat,lng`.

### 3.8 Market percentile (`leads.market_pct`, `market_cohort_size`)

New `recomputeMarketPct(env, searchId?)` in `src/maintenance.ts`. `syncSearch` calls it after `status = 'done'` with that search id. The backfill calls it with no id, meaning every cohort. It restricts the work to the (state, city) cohorts touched by the pull, and only writes rows whose value actually changed:

```sql
UPDATE leads SET market_pct = r.p, market_cohort_size = r.n
FROM (
  SELECT id, COUNT(*) OVER w AS n,
         CASE WHEN COUNT(*) OVER w < 5 THEN NULL
              ELSE PERCENT_RANK() OVER (w ORDER BY COALESCE(review_count,0) DESC, COALESCE(rating,0) DESC) END AS p
  FROM leads
  WHERE business_status = 'operational' AND state IS NOT NULL AND city IS NOT NULL AND gbp_category IS NOT NULL
    AND (?1 IS NULL OR (state, city) IN (SELECT l2.state, l2.city FROM leads l2
                                         JOIN search_leads sl ON sl.lead_id = l2.id WHERE sl.search_id = ?1))
  WINDOW w AS (PARTITION BY state, city, gbp_category)
) r
WHERE r.id = leads.id AND (leads.market_pct IS NOT r.p OR leads.market_cohort_size IS NOT r.n);

UPDATE leads SET market_pct = NULL, market_cohort_size = NULL
 WHERE business_status <> 'operational' AND market_pct IS NOT NULL;
```

**Semantics:**
- `market_pct = 0` is the most-reviewed business in its cohort. Ties on reviews and rating share a value, so a tie at the top returns every tied business.
- Cohorts smaller than 5 get NULL.
- "Top 1%" therefore returns the #1 row(s) of every cohort of 5 or more. For example, it returns the single top plumber of a 32-plumber Orlando cohort.

### 3.9 Backfill (`POST /api/admin/backfill`)

Extend `backfillDerivedColumns`:
- **Rows with raw** (Apify): run the full `normalizePlace(JSON.parse(raw))`. Write every derived column, including `city_inferred` as in 3.3, then `lead_categories` and `lead_attributes` using the 3.5 statements.
- **Rows without raw** (DataForSEO test imports): write only `lead_categories` from `gbp_category` and `sub_category`, plus `industry`.
- **Searches:** set `canonical_category = canonicalCategory(category)` and `fingerprint = fingerprintOf(...)` for every search.
- Then call `recomputeMarketPct(env)`.

It is paged at 200 leads per page and 50 statements per batch, and it can be run again safely.

New `GET /api/admin/backfill/status` returns:
```json
{ "leadsWithRaw": 0, "leadsWithoutRaw": 0, "withRawMissingCategories": 0, "searchesMissingFingerprint": 0, "cohortsComputed": 0 }
```

---

## 4. API

### `GET /api/leads` (existing)

**New params:** `country`, `neighborhood[]`, `category_match`, `phone_number`, `domain`, `email`, `hide_ads`, `rating=unrated`, `reviews=none`, `min_one_star_share`, `top_reviews_pct`, `has_hours`, `open_24h`, `has_description`, `seen_from`, `seen_to`, `first_search_id[]`, `min_pulls`, `within_miles`, `same_city`.

**Changed semantics:**
- `near` also accepts `@lat,lng`.
- `industry`, `top100`, `category` and `exclude_category` follow `category_match` (#9–#12).
- `max_rank` now uses `best_rank`.
- `updated_from` / `updated_to` now use `data_changed_at`.
- `attribute` values are keys and match `value = 1`.

**Response.** Unchanged in shape: `{ total, duplicatesHidden, nearNotFound, page, pageSize, results }`.
- `LIST_COLUMNS` gains `neighborhood`, `street`, `city_inferred`, `best_rank`, `market_pct`, `pull_count`, `last_seen_at`, `is_advertisement`, `one_star_share`.
- New `sort` keys: `position` (`best_rank`), `market` (`market_pct`), `seen` (`last_seen_at`), `pulls` (`pull_count`).

### `GET /api/leads/facets` (existing; now follows the active filters)

- It takes the same params as `/api/leads`.
- Each dimension counts over the filtered set **with that dimension's own selection removed**. This goes through a helper `whereWithout(filters, dim)`.
  - Clearing `category` clears `industries`, `top100`, `categories` and `excludeCategories` together.
  - Clearing `rating` clears `min_rating`, `max_rating` and `unrated` together.
- Dedupe toggles are ignored for facet counts; say so in a tooltip on the count badges.
- Everything runs as one `env.DB.batch`. Each statement is `SELECT ... FROM leads l <where>`, with the subquery joins noted below:

| key | SQL |
|---|---|
| `countries`, `states`, `neighborhoods`, `statuses`, `leadStatuses`, `sourceCodes`, `prices` | `SELECT <col> AS value, COUNT(*) n ... GROUP BY 1` |
| `verified`, `location`, `phoneTypes` | existing CASE queries, with the WHERE added |
| `cities` | `SELECT city, state, COUNT(*) n ... GROUP BY city, state` |
| `postalCodes` | `... WHERE postal_code IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 300` |
| `industries` | any-match: `SELECT COALESCE(lc.industry,'Other') value, COUNT(DISTINCT lc.lead_id) n FROM lead_categories lc JOIN leads l ON l.id = lc.lead_id <where> GROUP BY 1`; primary-match: `GROUP BY COALESCE(l.industry,'Other')` |
| `categories` | any-match: `SELECT lc.category value, COUNT(DISTINCT lc.lead_id) n FROM lead_categories lc JOIN leads l ... GROUP BY 1`; primary-match: on `l.gbp_category` |
| `top100` | `SELECT COALESCE(lc.industry,'Other') value, COUNT(DISTINCT lc.lead_id) n ... AND lc.is_top100 = 1 GROUP BY 1` (feeds "Top 100 in this industry (n)") |
| `ratingBuckets` | `CASE WHEN rating IS NULL THEN 'unrated' WHEN rating>=4.5 THEN '4.5+' WHEN rating>=4 THEN '4+' WHEN rating>=3.5 THEN '3.5+' WHEN rating>=3 THEN '3+' ELSE 'under3' END` |
| `reviewBuckets` | `CASE WHEN COALESCE(review_count,0)=0 THEN 'none' WHEN review_count<=10 THEN '1-10' WHEN review_count<=100 THEN '10-100' WHEN review_count<=1000 THEN '100-1000' WHEN review_count<=10000 THEN '1000-10000' ELSE '10000+' END` |
| `positions` | one row: `SUM(best_rank<=3) top3, SUM(best_rank<=10) top10, SUM(best_rank<=20) top20, SUM(best_rank<=50) top50` |
| `attributes` | `SELECT a.key value, MAX(a.name) label, COUNT(*) n FROM lead_attributes a JOIN leads l ON l.id = a.lead_id <where> AND a.value = 1 GROUP BY a.key ORDER BY n DESC LIMIT 150` |
| `flags` | one row: `SUM(has_hours=1), SUM(open_24h=1), SUM(has_description=1), SUM(is_advertisement=1), SUM(pull_count>=2), SUM(one_star_share>=0.1), SUM(EXISTS(SELECT 1 FROM lead_emails e WHERE e.lead_id=l.id)) has_email` |
| `pulls` | `SELECT s.id, s.category, s.city, s.state, s.created_at, s.status, COUNT(*) n FROM search_leads sl JOIN searches s ON s.id = sl.search_id JOIN leads l ON l.id = sl.lead_id <where> GROUP BY s.id ORDER BY s.created_at DESC LIMIT 200` |

Top % rank buckets are not counted; the query is too expensive for a facet. That dropdown shows no counts.

### `GET /api/categories` (existing `categoryTree`)

**Response:**
```json
{ "industries": [ { "industry": "...", "top100Count": 23, "categories": [ { "name": "...", "top100": true, "n": 12 } ] } ],
  "other": [ { "name": "...", "n": 3 } ],
  "top100": [],
  "legacyAliases": {} }
```

- `n` counts `lead_categories` rows (any position). It changes from primary-only.
- Results are cached in memory per isolate for 60 s.
- Used by the rail and the pull form.

### `GET /api/locations?state=FL&q=orl` (new)

**Response:**
```json
{ "states": [ { "code": "FL", "name": "Florida" } ],
  "cities": [ { "city": "Orlando", "state": "FL", "pulled": true, "leads": 57 } ] }
```

- `states` is the static list of 51 (from `format.ts`).
- `cities` is `suggestCities()` merged with the distinct cities in `leads` and `searches`, so small towns pulled before still appear. At most 50 rows.

### `GET /api/search/preview` (new; `/api/search/check` stays as an alias for one release)

**Params:** `category` (repeatable, at most 100), `city`, `state`, `radius_miles`, `max_results`.

**Response:**
```json
{ "city": "Orlando", "state": "FL", "windowDays": 30, "radiusMiles": 25, "center": {"lat": 28.54, "lng": -81.38},
  "items": [ {
    "category": "Plumber", "canonical": "Plumber", "known": true,
    "fingerprint": "plumber|orlando|FL|apify",
    "previous": [ { "id": "…", "created_at": "…", "status": "done", "max_results": 100, "results_count": 40,
                    "new_leads_count": 3, "leads_in_database": 40, "cost": 0.21 } ],
    "knownInCity": 57,
    "knownNearby": 71,
    "nearbyFrom": [ { "city": "Kissimmee", "state": "FL", "n": 14 } ],
    "estimatedCost": 0.40,
    "recommend": "reuse"
  } ],
  "totalEstimatedCost": 0.40, "needsCostConfirm": false }
```

Field definitions:
- `known`: false for a category that is not in the taxonomy. The UI then warns "Not a standard Google category, results may be broad".
- `knownInCity`: businesses with this category at any position, where `lower(city)` matches and the state matches.
- `knownNearby`: the same category within `radius_miles` of the centre, using the bounding box plus the distance clause from #6.
- `nearbyFrom`: which other cities those businesses came from.
- `estimatedCost`: `max_results × env.APIFY_PRICE_PER_PLACE`. Set that variable to the actor's current per-place price from its Apify page; it is a variable because the price changes.
- `needsCostConfirm`: true when the total exceeds `env.COST_CONFIRM_USD` (default 1.00).

`recommend` is decided per category, in this order:
1. **`reuse`**: a `done` pull with the same fingerprint exists inside the window, and the requested `max_results` is no larger than that pull's `max_results`.
2. **`more`**: such a pull exists, the new `max_results` is larger, **and** the old pull hit its cap (`results_count >= max_results`).
3. **`mostly_known`**: no exact match, but `knownNearby >= max(20, 0.5 × max_results)`. For example, Kissimmee and Orlando pulls already cover the area.
4. **`refresh`**: the last exact pull is older than the window.
5. **`new`**: nothing matched.

### `POST /api/search` (existing) and `POST /api/search/batch` (new)

**`POST /api/search` body additions:**
- `state` (explicit, from the dropdown)
- `radiusMiles`
- `windowDays`
- `force`
- `confirmCost` (boolean)
- `provider`: only `apify`; `dataforseo` returns 400 "not enabled yet"

**Server behaviour:**
- Canonicalises the category.
- Writes `canonical_category`, `fingerprint = fingerprintOf(canonical, city, state, provider)` (see the format below), `center_*`, `radius_miles`, `estimated_cost`, `requested_by`, and `options_json = {category, canonical, city, state, radiusMiles, maxResults, skipClosedPlaces: true, skipPhoneLookup, batchId}`.
- `fingerprintOf` returns `lower(canonical) | lower(city) | UPPER(state) | provider`, for example `plumber|orlando|FL|apify`. It is computed in TS only.
- `requested_by` comes from the `Cf-Access-Authenticated-User-Email` header, which Cloudflare Access sets. A client-sent `X-User` is ignored.
- `findRecentPulls` matches on `fingerprint`, **or**, for legacy rows with no fingerprint, on `lower(canonical_category)` + city + state.
- Returns 409 inside the window unless `force` is set. The 409 body is `{ repeat, previous, windowDays, preview }`.
- Returns 402 `{ needsCostConfirm: true, estimatedCost }` when the estimate exceeds `COST_CONFIRM_USD` and `confirmCost` is not set.

**`POST /api/search/batch`** pulls a whole industry, "Top 100 in this industry", or any list of categories.

Body:
```json
{ "categories": [], "industry": "...", "top100Only": false, "city": "...", "state": "...",
  "radiusMiles": 25, "maxResults": 100, "sourceCode": "...", "force": false, "confirmCost": false }
```

Behaviour:
- **Expansion.** `industry` with `top100Only` expands to that industry's Top 100 categories. `industry` without it expands to all of the industry's categories. At most 100 categories per batch (Top 100 across every industry = 100).
- **Repeat rule, per category.** Categories inside the repeat window are skipped unless `force`, and are returned in `skipped`.
- **Cost check.** The total estimate for the remaining categories must pass the cost check once (402 without `confirmCost`).
- **Rows.** One `searches` row is created per remaining category with a shared `batch_id` and `status = 'queued'`.

Response:
```json
{ "batchId": "...", "created": [], "skipped": [ { "category": "...", "previous": [] } ], "estimatedCost": 0 }
```

**Queue:** the cron adds `startQueuedSearches(env)`, which starts `queued` searches (oldest first) while fewer than `env.MAX_CONCURRENT_RUNS` (default 3) are in `scraping`. Single searches also queue when that limit is reached.

### `GET /api/searches` (existing history)

**New params** (existing ones stay):
- `provider`
- `batch_id`
- `search_id[]`
- `source_code[]`
- `has_new=1` (`new_leads_count > 0`)
- `requested_by`
- `sort=created_at|cost|results|new`, `dir`
- `limit`, `offset`

The existing `category` LIKE filter also matches `canonical_category`.

**Each row adds:**
- `provider`, `canonical_category`, `fingerprint`, `batch_id`
- `radius_miles`, `center_source`
- `estimated_cost`, `known_before`, `skipped_no_id`, `skipped_duplicate`
- `requested_by`, `options_json`
- `leads_in_database` (existing)

The response becomes `{ total, rows }`, with a total count for paging. Update the dashboard to match.

---

## 5. Not paying twice for the same businesses

**Facts, stated plainly in the UI:**
- Apify's Google Maps actor bills per place scraped.
- DataForSEO bills per item returned.
- **Neither accepts a list of businesses to skip.** A repeat search always pays again for the businesses it already found.
- Apify cannot skip the first N results. Pulling 200 after an earlier pull of 100 pays for all 200.

So the savings come from **not repeating a search**, plus free dedup at ingest (which already exists). DataForSEO's `offset_token` early stop (stop paging once a whole page is already known) is out of scope, because DataForSEO is not in the production pipeline (section 9).

**Flow:**
1. **Preview line under the form.** The pull form uses dropdowns: Industry → Category (one, several, or "All in this industry" / "Top 100 in this industry"), State → City, "How far around the city", How many. Any change calls `GET /api/search/preview` after a 400 ms debounce. A status line under the form shows, per category or summed for a batch:
   - **`reuse`**: "Already pulled on 12 Sep (40 businesses, all still in your list). Pulling again would cost about $0.40 for mostly the same businesses." Buttons: **Show those businesses** (primary; sets `search_id`, no new pull) / **Pull again anyway** (`force`).
   - **`more`**: "Last time you asked for 100 and got 100. Asking for 200 costs about $0.80 and repeats the first 100." Button: **Pull 200**.
   - **`mostly_known`**: "You already have 71 plumbers within 25 miles (from Kissimmee, Winter Park pulls)." Buttons: **Show them** (applies `category` + `near=Orlando|FL&radius_miles=25`) / **Pull anyway**.
   - **`refresh`**: "Last pulled 45 days ago. A fresh pull updates phones and ratings and finds new businesses (about $0.40)." Button: **Pull fresh**.
   - **`new`**: "Not pulled before. About $0.40." Button: **Find businesses**.
   - **Batch**: "12 categories: 3 already pulled (skipped), 9 new, about $3.60 total." Buttons: **Pull the 9 new ones** / **Include the 3 already pulled**.
2. **Cost confirmation.** Above `COST_CONFIRM_USD` the button turns into "Yes, spend $3.60" (sends `confirmCost: true`).
3. **Server-side guards.** The server enforces both the 409 and the 402 rules, whatever the UI does.
4. **Window.** `REPEAT_WINDOW_DAYS` moves to `env.REPEAT_WINDOW_DAYS` (fallback 30). The form offers a per-request override: "Treat pulls older than [30] days as out of date".
5. **What a re-pull does to stored rows.**
   - The upsert on place id / cid refreshes the scraped fields.
   - It bumps `pull_count`, `last_seen_at`, `last_scraped_at` and `best_rank`, and `data_changed_at` if something changed.
   - It adds a `search_leads` row with the distance.
   - `search_id` (first finder), `lead_status`, `source_code`, phone type and enrichment are untouched.
   - `known_before` counts the hits and `new_leads_count` counts the inserts.
   - No duplicate row is possible (section 3.6).
6. **Legacy free-text pulls.** The backfill gives them `canonical_category` (for example "plumbers" → "Plumber"), so the repeat guard catches them.

---

## 6. Pull history

**Meaning (decision; confirm with the user).** "Data pulling history with the data filters" means:
1. every pull with its **pull settings** (category, location, radius, how many, closed skipped, phone check);
2. the history table has its own filters;
3. the business list can be filtered by pull.

Saving the business-list filters used when a list was viewed or exported is deferred to the exports log (section 9). Until then the URL hash (section 7) makes any filtered view bookmarkable.

**"Pull history" tab: server-side table.** Uses `GET /api/searches` and pages 50 rows at a time.

- **Columns:**
  - checkbox
  - Date
  - Business type
  - Location ("Orlando, FL · 25 mi")
  - Source ("Google Maps (Apify)" / "DataForSEO")
  - Status (badge; an error message becomes the tooltip; `queued` shows "Waiting")
  - Asked for
  - Found
  - New
  - Already had (`known_before`)
  - Skipped (tooltip: "no Google id: N, repeated in this pull: N")
  - Still in your list (`leads_in_database`)
  - Cost (the actual `cost_estimate`, or "est. $x" before it finishes)
  - Pull settings (readable summary of `options_json`, e.g. "100 max · closed skipped · phone check on")
  - Source code
  - Who
  - Batch (a link that filters by `batch_id`)
- **Row actions:**
  - **View businesses** (`search_id`)
  - **View new only** (`first_search_id`)
  - **Pull again** (prefills the form, which then runs the preview flow)
- **Filters row:**
  - Business type (taxonomy dropdown, plus free text)
  - State
  - City
  - Source
  - Status
  - Date from / to
  - "Only pulls that found something new"
  - Source code
  - Who
  - Batch

  Clicking the Date, Cost, Found or New headers sorts the table.
- **Selection buttons:**
  - **View businesses from selected pulls** (exists; sets `search_id[]`)
  - **View only the NEW businesses from selected pulls** (sets `first_search_id[]`)

**In the left rail** (group "Pulls & dates", #38–#45): Found in these pulls, First found by these pulls, Found in 2+ pulls, Date added, Details changed on Google, Last seen, Source code, Lead status.

---

## 7. Dashboard layout (`src/dashboard.ts`, single page, no build step)

**Top bar: "Find businesses" form.**
- Industry (dropdown)
- Category (searchable multi-select filtered by industry, with shortcuts "All in this industry" and "Top 100 in this industry")
- State (dropdown)
- City (typeahead from `/api/locations`)
- How far around the city (10 / 25 / 50 mi)
- How many (max 500 without the existing `allowLarge`)
- Source code
- Button

The preview line sits under the form (section 5). The `#repeat` panel stays for the 409 case. Tabs: **Businesses** | **Pull history**.

**Left rail** (`<aside id="filters">`):
- Groups are `<details>`, each with an "N on" badge.
- Options show counts from `/api/leads/facets`.
- "Clear all filters" sits at the top and at the bottom.

Groups, in order:
1. **Location** (open): Country (single option), State, City (narrowed by state), ZIP code (search box, top 30, "show more"), Neighborhood (hidden when empty).
2. **Local area**:
   - "Near a place" (typeahead that accepts a city, "ZIP 32801" or a pasted "28.54, -81.38") + radius
   - "Distance from the pulled city" (disabled with the hint "Pick a pull under Pulls & dates first")
   - "Only businesses inside the pulled city"
3. **Category** (open):
   - "Top 100 categories (n)" button
   - Industry list: each industry has "Select all" and "Top 100 in this industry (n)", and expands to its categories with counts
   - One search box across all names
   - "Match: any category the business lists / main category only"
   - "Leave out these categories"
4. **Business status** (open): Google verified (Any / Verified n / Not verified n; default Any), Open or closed (default Open).
5. **Contact information**: Phone number, Specific phone number, Phone type, Website (including "Has one, one business per website"), Website is…, Email address (disabled with a hint), Social media (hint).
6. **Remove duplicates**: One per phone number, One per Google listing, Hide paid ads. Note: "One per website: see Contact information".
7. **Ratings & reviews**: rating chips + from/to + "Not rated yet"; review chips + from/to; "Share of 1-star reviews".
8. **Search position**: "Top % of Google results" (first), "Top position in Google results", "Top % by reviews in its city", each with its tooltip from section 1.
9. **Business signals**: Photos, Opening hours listed, Open 24 hours, Has a description, Price level (hidden when empty), Google profile features (featured list, then "More features"), and the grey "not available" hint.
10. **Physical location**: Street address radio.
11. **Pulls & dates**: #38–#45.
12. **Name**: contains.

**Results table.**
- New columns: Industry, ZIP, Best position, "Top x%" (from `market_pct`), Photos, Pulls (`pull_count`), Last seen.
- Row badges:
  - "No address on Google" when `has_street_address = 0`
  - "City guessed" when `city_inferred = 1`
  - "Ad" when `is_advertisement = 1`
- `#dupInfo` keeps "(N duplicates hidden)".

**Refresh.** On every change, `/api/leads` and `/api/leads/facets` are called together with the same query string, debounced 300 ms.

**URL state.** The query string is written to `location.hash` and restored on load, so a filter set can be bookmarked or shared. "Clear all" resets the hash too.

**Defaults.** `DEFAULTS = { verified: "", status: ["operational"], location: "" }`.

**Wording.** The UI never shows "CID", "SAB", "E.164", "place id", "fingerprint" or "percentile". Tooltips can say "Google listing number", "service-area business (no street address on Google)" and "standard phone format".

**Phone width.** Below 860 px the rail stacks above the table, with no horizontal page scroll.

---

## 8. Test plan

### Unit tests (vitest)

Extend `test/filters.test.ts`, `test/normalize.test.ts` and `test/providers.test.ts`. Add `test/taxonomy.test.ts`, `test/geo.test.ts`, `test/attributes.test.ts` and `test/sql.test.ts`.

**`test/taxonomy.test.ts`:**
- `canonicalCategory`:
  - the aliases: `Moving company` → `Moving service`, `Attorney` → `Lawyer`, `Makeup artist` → `Make-up artist`
  - case-insensitive matching
  - plural strip: `plumbers` → `Plumber`, `dentists` → `Dentist`, `pharmacies` → `Pharmacy`
  - an unknown name passes through trimmed
- `INDUSTRIES`:
  - every category is unique across industries
  - all 19 industry names listed in section 2 are present
  - `TOP_100` has 100 unique names, each found by `industryOf`
  - `industryOf("Plumber") === "Home Services"`

**`test/normalize.test.ts`** uses real items from `test-runs/provider-test/apify-dataset.json`:
- Pro-Tech (7 categories, toll-free, features):
  - `categories` keep their order and are deduped
  - `Service establishment` is dropped when other categories exist
- Mr. Rooter (no street): `street` is null
- an `isAdvertisement` item: `is_advertisement` = 1
- an "Open 24 hours" item: `open_24h` = 1, `days_open` = 7
- an item with a "Closed" day: `days_open` < 7
- items with no hours: null
- `one_star_share`: equals oneStar/sum to 4 dp, and is null when the total is 0
- features:
  - `Service options / Online estimates: false` → `{key:'online-estimates', value:0}`
  - `Crowd / LGBTQ+ friendly` → key `lgbtq-friendly`, whatever the section
- `price_level`: `"$$"` stays `"$$"` and junk becomes null

**`test/providers.test.ts`**, for `dataforseoItemToPlace`, using items from `test-runs/provider-test/dataforseo-response.json`:
- `closed_forever` → `permanently_closed`; `close` → `operational`
- `first_seen` `"2024-07-28 00:14:49 +00:00"` → `"2024-07-28T00:14:49.000Z"`
- a 0:00–24:00 week → `open_24h = 1`
- `additional_categories` are all kept
- features from `available_attributes` / `unavailable_attributes` map via `DFS_ATTRIBUTE_KEYS`
- `crowd/welcomes_lgbtq` → `lgbtq-friendly`

**`test/attributes.test.ts`:**
- Every `FEATURED` key has at least one hit across both sample files. Fail on 0.
- `attributeKey` is stable across sections.

**Domain tests (`websiteDomain`):**
- existing cases
- `m.example.com` → `example.com`
- a `utm_*` query is dropped
- `:8080` is dropped
- `https://www.Example.com/about?utm_source=x` → `example.com`
- `facebook.com/page` → null

**`test/geo.test.ts`:**
- `haversineMiles`: Orlando to Lakeland ≈ 50 mi (±2); the same point is 0; a missing coordinate gives null
- `findCity`: `("Saint Petersburg","FL")` and `("St. Petersburg","fl")` return the same row

**`parseFilters` and `buildWhere`:**
- `category_match` defaults to `any`
- `industry=Home Services` gives the `lead_categories.industry IN (?)` form with **1** bind
- `top100=1&industry=Dental` gives one subquery containing `is_top100 = 1 AND industry IN (?)`
- `category_match=primary` keeps the existing `l.industry` / `l.gbp_category` clauses
- `top_pct` accepts only 1/5/10/25 and `top_reviews_pct` the same
- `within_miles` and `same_city` are ignored without `search_id`
- `phone_number=(407) 555-0101` binds `+14075550101`; junk input gives `0 = 1`
- `domain=https://www.x.com/about` binds `x.com`
- `exclude_category` gives `NOT IN`
- `email=yes` gives `EXISTS`
- `rating=unrated` gives `IS NULL`
- `hide_ads` is applied
- `max_rank` binds against `best_rank`
- `updated_from` targets `data_changed_at` together with `created_at <`
- **Bind budget:** a request with every list param at 200 values and every scalar set still produces fewer than 100 binds for the page query and every facet query
- a list of 201 values throws a 400
- `whereWithout(f, "category")` clears industries, top100, categories and excludes; `whereWithout(f, "states")` clears only states
- `fingerprintOf("plumbers","Orlando","fl","apify") === "plumber|orlando|FL|apify"`
- `recommend`:
  - inside the window → `reuse`
  - larger `max_results` with the old pull capped → `more`
  - nearby coverage → `mostly_known`
  - outside the window → `refresh`
  - no history → `new`

**`test/sql.test.ts`** uses Node's built-in `node:sqlite` (`DatabaseSync`, Node 22.5 or later). If that is not available, move these checks into the manual list and run them with `wrangler d1 execute --local`.
- Applying migrations 0001–0004 in order to a database seeded with two leads that share a cid:
  - leaves one lead
  - its `search_leads`, `lead_status` and `phone_type` are merged
  - the unique index exists
- Applying 0004 twice is not required; D1 tracks applied migrations.
- The `recomputeMarketPct` SQL on a 6-row cohort and a 2-row cohort:
  - the 2-row cohort gets NULL
  - the best-reviewed of the 6 gets 0
  - two rows tied at the top both get 0
- The upsert SQL, run twice for the same place with ranks 7 then 3: `best_rank` = 3, `pull_count` = 2, and `data_changed_at` is set only when `review_count` changed.
- The 3.3 rule: a service-area place re-ingested from a Kissimmee search keeps `city = 'Orlando'`.
- A cid collision on insert triggers the retry path. Stub the batch function so it throws once.

### Manual checklist (local `npm run dev` with D1)

1. Run `npm run db:migrate:local` to apply 0003 and 0004. Then `POST /api/admin/backfill`. `GET /api/admin/backfill/status` should show `withRawMissingCategories: 0` and `searchesMissingFingerprint: 0`. Rows without raw are reported separately.
2. Pull "Home Services → Plumber / Orlando / FL / 25 mi / 100":
   - The preview says "Not pulled before".
   - After the pull finishes, reopening the form says "Already pulled" with the same numbers as the history row.
   - "Show those businesses" filters the table.
   - "Pull again anyway" shows New ≈ 0, Already had ≈ all, and a cost above 0.
   - Changing the form to "plumbers" (free text) is still caught as a repeat.
3. Batch: choose Home Services → "Top 100 in this industry":
   - The preview lists 23 categories, marks Plumber as already pulled, and shows the total cost.
   - The confirm button reads "Yes, spend $…".
   - History shows a batch of 22 with at most 3 scraping and the rest "Waiting".
4. Rail categories:
   - Home Services "Select all" counts businesses listing any Home Services category. The industry facet count equals the result count.
   - Adding "Leave out: Plumbing supply store" lowers the count.
   - "Main category only" lowers the count for multi-category businesses.
5. Local area:
   - With the Orlando pull selected, "Distance ≤ 25 mi" hides Lakeland.
   - "Near a place: 28.54, -81.38, 10 mi" works.
   - "Only businesses inside the pulled city" hides rows with "City guessed" and rows from other towns.
6. Service area only: Mr. Rooter, Sago, Flow Remodeling and others appear with "No address on Google" and "City guessed". A later Kissimmee pull does not move them to Kissimmee.
7. Dedup:
   - "Website: Has one, one business per website" collapses same-domain branches and shows "(N duplicates hidden)".
   - "One per phone number" hides one Pro-Tech branch.
   - "Hide paid ads" hides the ad row.
8. Ratings: "4.5+" then "Not rated yet" (choosing one clears the other). The review chips set from/to correctly.
9. Position:
   - "Top 1% of Google results" returns rank-1 rows of each pull.
   - "Top % by reviews in its city = 1%" returns the single most-reviewed business per cohort of 5 or more (for example one Orlando plumber), and nothing for smaller cohorts. The tooltip explains this.
10. Features: the "Online estimates" count matches `SELECT COUNT(*) FROM lead_attributes WHERE key='online-estimates' AND value=1`. "More features" lists every other key.
11. Verified defaults to Any and shows both counts. Picking "Not verified" shows the 6 unclaimed Orlando plumbers.
12. History: filter Source, Status = failed, a date range and Batch. Select two pulls and use "View businesses" and "View only the NEW businesses"; the counts match the New column.
13. Reload with the hash URL: the same filters and counts come back. "Clear all filters" resets every control and the hash.
14. Phone width (< 860 px): the rail stacks above the table, with no horizontal overflow.

---

## 9. Out of scope / later

- **Email and social-link lookup.** It will write `lead_emails` and `leads.socials`. The Email filter (#20) and the Social media placeholder switch on then. DataForSEO `contact_info` "mail" entries (20/50 in the sample) can seed `lead_emails` once DataForSEO is in the pipeline.
- **DataForSEO in the pipeline.** Wiring it into `createSearch` as a selectable provider, including `offset_token` early stop. The adapter derivations and the `provider` column are ready.
- **Export.** CSV / GHL export, "select all matching", and an `exports(id, filters_query, row_count, requested_by, created_at)` log shown in Pull history. Targetron's Export step (format, quantity, columns) belongs here. `buildLeadQuery()` is the query to reuse.
- **Bulk lead-status changes; AI summary; saved filter presets** beyond the URL hash.
- **More geography:** map polygon/rectangle drawing, County/District (ZIP-to-county table), and non-US pulls.
- **Duplicate badge:** "Shares a phone with N others", computed as `COUNT(*) OVER (PARTITION BY gbp_phone_formatted)`. Persistent `duplicate_of` links are rejected (3.6).
- **Taxonomy refresh:** a quarterly refresh of `src/taxonomy.ts` from Google's category list, diffed by GCID, followed by the backfill. Documented in the README only.
- **Company data filters:** company size, revenue, CMS and job-title filters need third-party company data.

---

### Rejected critique points

- **"Store `rank_pct` per `search_leads` row."** Rejected. `top_pct` already computes rank ≤ ceil(P% × results) per pull at query time in `src/leads.ts`. A stored copy would go stale if `results_count` is corrected, and a DB with dozens of pulls gains no speed from it.
- **"Drop polygon because a no-build page can't host a map UI."** The reason is corrected rather than accepted. Leaflet can load from jsDelivr without a build step. It is dropped for scope (section 1).
- **"Record lead-filter state with every 'View businesses' click."** Deferred. That logs views with no clear consumer. Filter snapshots arrive with the exports log, and the URL hash covers bookmarking now. The decision is recorded in section 6 for the user to confirm.
- **"Make country a real multi-country filter."** Partially accepted. Country is a facet filled from data. Pulls stay US-only, and the reason is stated in #1.
- **"Default Verified with a hidden-count badge."** Not taken. The default changes to Any, because unclaimed profiles are prime GoHighLevel prospects and Targetron's default is All. Both counts show on the control.
- **"Bind taxonomy lists as inlined literals (Option B)."** Not taken for industry and Top 100 any-match. Option A (`lead_categories.industry` / `is_top100`, one bind each) was chosen. Inlined literals stay only on the existing primary-match path.