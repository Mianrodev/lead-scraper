-- Daily free collection: a list of type x place the app collects from the free data by itself,
-- a batch at a time, keeping roughly harvest_daily_target new businesses a day flowing in.
-- Each item is collected again after 30 days (new businesses appear, closed ones drop out).
CREATE TABLE free_harvest (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  place TEXT NOT NULL,          -- JSON ResolvedPlace (country, state, region name, city, label)
  label TEXT NOT NULL,          -- "Plumber in all of Florida"
  added_by TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_import_id TEXT,
  last_collected_at TEXT,
  UNIQUE (label)
);
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('harvest_enabled', '0'), ('harvest_daily_target', '4000'), ('harvest_last_start', '');
