-- 2026-09-29: owners from state registries, email/domain setup, lead pipeline (notes, assignment),
-- uploaded lists, API keys and webhooks.

-- Owners: where the name came from, and the state registry match.
ALTER TABLE leads ADD COLUMN owner_title TEXT;
ALTER TABLE leads ADD COLUMN owner_source TEXT;           -- website | registry
ALTER TABLE leads ADD COLUMN registry_name TEXT;          -- legal name on the state registry
ALTER TABLE leads ADD COLUMN registry_id TEXT;            -- e.g. FL:L21000123456
ALTER TABLE leads ADD COLUMN registry_checked_at TEXT;    -- NULL = not looked up yet
CREATE INDEX idx_leads_registry_todo ON leads(state) WHERE registry_checked_at IS NULL;

-- Email / domain setup (from the website check).
ALTER TABLE website_audits ADD COLUMN email_provider TEXT;  -- Google Workspace, Microsoft 365, ..., "No email on this domain"
ALTER TABLE website_audits ADD COLUMN domain_created TEXT;  -- YYYY-MM-DD
ALTER TABLE website_audits ADD COLUMN ssl_expires TEXT;     -- YYYY-MM-DD

-- Pipeline: who works the lead, and notes.
ALTER TABLE leads ADD COLUMN assigned_to TEXT;             -- users.id
ALTER TABLE leads ADD COLUMN status_changed_at TEXT;
CREATE INDEX idx_leads_assigned ON leads(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE TABLE lead_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  user_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lead_notes_lead ON lead_notes(lead_id);

-- API keys (hashed) and webhooks.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,                  -- first characters, to recognise the key
  key_hash TEXT NOT NULL UNIQUE,         -- SHA-256 of the key; the key itself is shown once
  can_collect INTEGER NOT NULL DEFAULT 0, -- 1 = may start searches (spends money / free collections)
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,                  -- signs each delivery (X-LeadFinder-Signature)
  events TEXT NOT NULL,                  -- comma list: search.finished, saved_search.new, list.uploaded
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_status TEXT,
  last_sent_at TEXT,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE webhook_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_webhook_outbox_next ON webhook_outbox(next_at);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('registry_fl_last_run', '');
