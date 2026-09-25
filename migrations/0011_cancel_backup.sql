-- Cancel a running pull (whatever was already collected is still saved).
ALTER TABLE searches ADD COLUMN cancelled_at TEXT;
ALTER TABLE searches ADD COLUMN cancelled_by TEXT;

-- Every lead uses the one source code.
UPDATE leads SET source_code = 'ILS' WHERE source_code IS NOT 'ILS';
UPDATE searches SET source_code = 'ILS' WHERE source_code IS NOT 'ILS';

-- Nightly backups to R2: one row per backup copy.
CREATE TABLE backups (
  id TEXT PRIMARY KEY,               -- e.g. 2026-09-25
  status TEXT NOT NULL DEFAULT 'running', -- running | done | failed
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  table_index INTEGER NOT NULL DEFAULT 0, -- which table is being copied
  last_rowid INTEGER NOT NULL DEFAULT 0,  -- copied up to this row of that table
  part INTEGER NOT NULL DEFAULT 0,        -- files written so far
  rows_copied INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

-- Old leads keep Google's full listing; this marks how far the one-off trim has got.
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('raw_trim_rowid', '0');
