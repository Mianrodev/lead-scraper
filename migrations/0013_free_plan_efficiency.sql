-- Free-plan efficiency and QA fixes (2026-09-25).

-- 1. Phone checks become an explicit queue, so the minute timer never scans every business.
--    phone_check_requested: 0 = not queued, 1 = queued by a pull that asked for phone types,
--    2 = asked for by hand (checked first). The old answer stays until a new one arrives.
ALTER TABLE leads ADD COLUMN phone_check_requested_at TEXT;
UPDATE leads SET phone_check_requested = 1, phone_check_requested_at = datetime('now')
WHERE phone_check_requested = 0 AND phone_type IS NULL AND gbp_phone_formatted IS NOT NULL
  AND COALESCE(is_claimed, 1) = 1 AND business_status = 'operational'
  AND EXISTS (SELECT 1 FROM search_leads sl JOIN searches s ON s.id = sl.search_id
              WHERE sl.lead_id = leads.id AND s.check_phones = 1);
UPDATE leads SET phone_check_requested = 2 WHERE phone_check_requested = 1 AND phone_type IS NULL
  AND NOT (COALESCE(is_claimed, 1) = 1 AND business_status = 'operational');
UPDATE leads SET phone_check_requested = 0 WHERE phone_type IS NOT NULL AND phone_check_requested <> 0;
DROP INDEX IF EXISTS idx_leads_phone_pending;
CREATE INDEX idx_leads_phone_queue ON leads(phone_check_requested DESC, phone_check_requested_at) WHERE phone_check_requested > 0;

-- 2. Businesses saved per pull, kept as a number instead of being recounted on every page refresh.
ALTER TABLE searches ADD COLUMN leads_saved INTEGER NOT NULL DEFAULT 0;
UPDATE searches SET leads_saved = (SELECT COUNT(*) FROM search_leads sl WHERE sl.search_id = searches.id);

-- 3. Pull syncing: rotate through running pulls; only fail after errors have lasted a while;
--    notice a saving step that keeps stopping at the same place.
ALTER TABLE searches ADD COLUMN last_synced_at TEXT;
ALTER TABLE searches ADD COLUMN sync_error_since TEXT;
ALTER TABLE searches ADD COLUMN ingest_stalls INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_searches_created ON searches(created_at);

-- 4. Fewer indexes on leads: each one costs a database write for every business saved.
--    Kept: google_place_id (unique), cid, phone, created_at, state+city, category, phone queue.
DROP INDEX IF EXISTS idx_leads_rating;
DROP INDEX IF EXISTS idx_leads_status;
DROP INDEX IF EXISTS idx_leads_claimed;
DROP INDEX IF EXISTS idx_leads_business_status;
DROP INDEX IF EXISTS idx_leads_domain;
DROP INDEX IF EXISTS idx_leads_rank;
DROP INDEX IF EXISTS idx_leads_reviews;
DROP INDEX IF EXISTS idx_leads_neighborhood;
DROP INDEX IF EXISTS idx_leads_industry;
DROP INDEX IF EXISTS idx_leads_postal;
DROP INDEX IF EXISTS idx_leads_price;
DROP INDEX IF EXISTS idx_leads_updated;
DROP INDEX IF EXISTS idx_leads_geo;
DROP INDEX IF EXISTS idx_search_leads_lead;

-- 5. Attributes are only rewritten when they change.
ALTER TABLE leads ADD COLUMN attributes_hash TEXT;
