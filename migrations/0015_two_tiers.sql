-- Two tiers (2026-09-28):
--   Free tier: businesses from Overture Maps open data, collected by a GitHub Actions job
--              (or this computer) and saved a slice at a time within the free plan's limits.
--   Paid tier: "Get Google details" looks chosen businesses up on Google Maps (Apify) and adds
--              rating, reviews, verified status and map position to the same row.

-- Where a search's businesses come from: google (Apify, paid) | free (Overture) | google_details (paid top-up).
ALTER TABLE searches ADD COLUMN source TEXT NOT NULL DEFAULT 'google';
ALTER TABLE searches ADD COLUMN free_import_id TEXT;
ALTER TABLE searches ADD COLUMN rows_expected INTEGER;          -- free: businesses the collector found

-- One free collection request (one collector run covers all its searches).
CREATE TABLE free_imports (
  id TEXT PRIMARY KEY,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | collecting | received | done | failed
  runner TEXT,                             -- github | local
  release TEXT,                            -- Overture release used
  dispatched_at TEXT,
  collected_at TEXT,
  rows_received INTEGER NOT NULL DEFAULT 0,
  chunks INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  finished_at TEXT
);

-- Batches of businesses sent back by the collector, parked in R2 until they're saved.
CREATE TABLE free_import_chunks (
  import_id TEXT NOT NULL REFERENCES free_imports(id),
  n INTEGER NOT NULL,
  search_id TEXT NOT NULL,
  rows INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  saved_rows INTEGER NOT NULL DEFAULT 0,  -- how far saving has got inside this chunk
  done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (import_id, n)
);
CREATE INDEX idx_free_chunks_todo ON free_import_chunks(done, import_id, n) WHERE done = 0;

-- Leads: where the data came from, and the Google top-up.
ALTER TABLE leads ADD COLUMN data_source TEXT NOT NULL DEFAULT 'google';  -- google | free | free+google
ALTER TABLE leads ADD COLUMN google_checked_at TEXT;
ALTER TABLE leads ADD COLUMN google_match TEXT;                           -- matched | not_found
-- Matching free businesses to ones we already have (same website).
CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(website_domain) WHERE website_domain IS NOT NULL;

-- "Get Google details": which search string belongs to which business.
CREATE TABLE google_detail_items (
  search_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  lead_id TEXT NOT NULL,
  query TEXT NOT NULL,
  PRIMARY KEY (search_id, idx)
);
CREATE INDEX idx_google_detail_items_query ON google_detail_items(search_id, query);

-- Free plan: businesses saved per day from free collections (the database allows ~100k row writes a day).
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('free_daily_limit', '5000'), ('free_saved_today', '');
