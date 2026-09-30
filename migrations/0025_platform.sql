-- Public self-serve lead platform (2026-10-01), see docs/platform-plan.md: free monthly
-- allowance, team members, saved searches, "remove my business" requests, sign-up modes.

ALTER TABLE store_accounts ADD COLUMN free_period TEXT;
ALTER TABLE store_accounts ADD COLUMN free_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';

CREATE TABLE store_saved_searches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES store_accounts(id),
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_store_saved_account ON store_saved_searches(account_id);

CREATE TABLE store_removal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  email TEXT,
  name TEXT,
  contact_email TEXT,
  message TEXT,
  ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'new',              -- new | done | dismissed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  handled_at TEXT,
  handled_by TEXT
);
CREATE INDEX idx_store_removals_status ON store_removal_requests(status, created_at);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('store_signup_mode', 'open'), ('store_free_per_month', '50'), ('store_public_pages', '0');
