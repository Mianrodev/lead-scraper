-- Cached "how many businesses exist" answers from DataForSEO, so the same question
-- isn't paid for twice within a week. key = category|country|region|city|website|claimed
CREATE TABLE count_cache (
  key TEXT PRIMARY KEY,
  total INTEGER NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pulls now record the country (ISO code) and a readable region name for any country.
ALTER TABLE searches ADD COLUMN country_code TEXT;
ALTER TABLE searches ADD COLUMN region_name TEXT;
UPDATE searches SET country_code = 'US' WHERE country_code IS NULL;

-- Big pulls are saved in steps: how far saving has got, and who is saving right now.
ALTER TABLE searches ADD COLUMN ingest_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE searches ADD COLUMN ingest_lock TEXT;
ALTER TABLE searches ADD COLUMN ingest_locked_at TEXT;
