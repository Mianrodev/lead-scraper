-- Nine features (2026-09-26): website visitor, scores, chains, do-not-contact list,
-- send to GoHighLevel, saved searches, radius search, audit reports, website speed.

-- 1. Website visitor: what each business's website tells us (one row per lead).
ALTER TABLE leads ADD COLUMN website_audit_status TEXT;   -- NULL | queued | done | failed
ALTER TABLE leads ADD COLUMN website_audit_at TEXT;
CREATE INDEX idx_leads_audit_queue ON leads(website_audit_status) WHERE website_audit_status = 'queued';
CREATE TABLE website_audits (
  lead_id TEXT PRIMARY KEY REFERENCES leads(id),
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  final_url TEXT,
  http_status INTEGER,                    -- NULL = could not connect
  reachable INTEGER NOT NULL DEFAULT 0,   -- 1 = the site loaded
  https INTEGER,                          -- 1 = served over https
  social_only INTEGER NOT NULL DEFAULT 0, -- the "website" is really a Facebook / directory page
  title TEXT,
  builder TEXT,                           -- wordpress | wix | squarespace | shopify | godaddy | weebly | duda | webflow | highlevel | other | NULL
  has_meta_pixel INTEGER NOT NULL DEFAULT 0,
  has_google_tag INTEGER NOT NULL DEFAULT 0,   -- gtag / Tag Manager / Analytics
  has_tiktok_pixel INTEGER NOT NULL DEFAULT 0,
  has_booking INTEGER NOT NULL DEFAULT 0,
  booking_tool TEXT,
  has_contact_form INTEGER NOT NULL DEFAULT 0,
  has_chat_widget INTEGER NOT NULL DEFAULT 0,
  mobile_viewport INTEGER NOT NULL DEFAULT 0,  -- has <meta name="viewport">
  emails_found INTEGER NOT NULL DEFAULT 0,
  socials_found INTEGER NOT NULL DEFAULT 0,
  copyright_year INTEGER,
  pages_checked INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  -- Google PageSpeed (mobile), filled in a separate step because it is slow.
  psi_status TEXT,                        -- NULL | queued | done | failed
  psi_score INTEGER,                      -- 0-100
  psi_lcp_ms INTEGER,
  psi_checked_at TEXT,
  psi_error TEXT
);
CREATE INDEX idx_website_audits_psi_queue ON website_audits(psi_status) WHERE psi_status = 'queued';

-- 2. Scores (rules, no AI): the Phase 2 audit columns of the CSV.
ALTER TABLE leads ADD COLUMN gbp_score INTEGER;       -- 0-100, Google profile completeness / reputation
ALTER TABLE leads ADD COLUMN website_score INTEGER;   -- 0-100, NULL until the site was visited (0 when there is none)
ALTER TABLE leads ADD COLUMN presence_score INTEGER;  -- 0-100 overall
ALTER TABLE leads ADD COLUMN score_notes TEXT;        -- JSON {gbpComment, websiteComment, websiteRanking, suggestions[]}
ALTER TABLE leads ADD COLUMN scored_at TEXT;

-- 3. Chains and franchises (1 = chain, 0 = independent, NULL = not worked out yet).
ALTER TABLE leads ADD COLUMN is_chain INTEGER;

-- 4. Do-not-contact list (existing clients, opt-outs, already in GHL).
CREATE TABLE suppressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- phone | email | domain | cid
  value TEXT NOT NULL,         -- normalised: E.164 phone, lower-case email, bare domain, Google cid
  reason TEXT NOT NULL,        -- client | dnc | sent_to_ghl | in_ghl | manual
  note TEXT,
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, value)
);
ALTER TABLE leads ADD COLUMN suppressed TEXT;        -- reason when the lead matches the list, else NULL
CREATE INDEX idx_leads_suppressed ON leads(suppressed) WHERE suppressed IS NOT NULL;

-- 5. Send to GoHighLevel.
ALTER TABLE leads ADD COLUMN ghl_contact_id TEXT;
ALTER TABLE leads ADD COLUMN ghl_sent_at TEXT;
ALTER TABLE leads ADD COLUMN ghl_error TEXT;
CREATE TABLE ghl_jobs (
  id TEXT PRIMARY KEY,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  tags TEXT,                              -- JSON array of tag names
  pipeline_id TEXT,
  stage_id TEXT,
  error TEXT,
  finished_at TEXT
);
CREATE TABLE ghl_job_leads (
  job_id TEXT NOT NULL REFERENCES ghl_jobs(id),
  lead_id TEXT NOT NULL REFERENCES leads(id),
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | skipped | failed
  error TEXT,
  PRIMARY KEY (job_id, lead_id)
);
CREATE INDEX idx_ghl_job_leads_queue ON ghl_job_leads(job_id, status);

-- 6. Saved searches, with an optional weekly "new businesses" count alert.
CREATE TABLE saved_searches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  request TEXT NOT NULL,        -- JSON: the Find request (types, places, up to, options)
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  alert_new INTEGER NOT NULL DEFAULT 0,
  last_count INTEGER,
  last_count_at TEXT,
  last_alert_at TEXT,
  last_run_at TEXT
);

-- 7. Radius search ("within 25 miles of Orlando").
ALTER TABLE searches ADD COLUMN radius_miles REAL;
ALTER TABLE searches ADD COLUMN center_lat REAL;
ALTER TABLE searches ADD COLUMN center_lng REAL;

-- 8. Audit report pages (public link per business, unguessable).
ALTER TABLE leads ADD COLUMN report_token TEXT;
CREATE UNIQUE INDEX idx_leads_report_token ON leads(report_token) WHERE report_token IS NOT NULL;

-- Settings the Admin page edits.
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('agency_name', ''), ('agency_phone', ''), ('agency_email', ''), ('agency_website', ''), ('agency_blurb', ''),
  ('ghl_pipeline_id', ''), ('ghl_stage_id', ''), ('ghl_default_tags', 'Lead Finder'),
  ('chains_rowid', '0'), ('saved_search_check_at', '');
