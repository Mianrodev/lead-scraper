-- 2026-09-30: report opens, activity timeline, demo websites, the free-audit form, opener templates.

-- What happened to a business, newest first in its timeline.
CREATE TABLE lead_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  user_id TEXT,                 -- who did it (NULL = the prospect or the app)
  kind TEXT NOT NULL,           -- stage | assigned | note | report_shared | report_viewed | demo_shared | demo_viewed | dnc | form | verified
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lead_events_lead ON lead_events(lead_id, id);
CREATE INDEX idx_lead_events_kind ON lead_events(kind, created_at);

-- Report / demo opens (for "opened" badges and hot-lead alerts).
ALTER TABLE leads ADD COLUMN report_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN report_viewed_at TEXT;
ALTER TABLE leads ADD COLUMN demo_token TEXT;
CREATE UNIQUE INDEX idx_leads_demo_token ON leads(demo_token) WHERE demo_token IS NOT NULL;

-- The free-audit form on the agency's own website: a public key, and a limit per visitor.
CREATE TABLE form_hits (
  ip_hash TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_form_hits ON form_hits(ip_hash, at);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('form_key', lower(hex(randomblob(12)))), ('opener_templates', '');
