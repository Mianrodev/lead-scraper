-- Base schema from the build spec (Section 4), plus:
--   searches: source_code, max_results, skip_phone_lookup, actor/dataset ids, counts,
--             error, and per-provider cost columns (Section 8 guardrails)
--   leads:    cid, is_claimed (verified-only requirement), closure flags, postal code,
--             coordinates, and the raw actor item for reprocessing
--   search_leads: which searches surfaced which leads (a lead can appear in many)
--   lead_emails / lead_phones: (lead_id, position) primary key so re-enrichment is idempotent

CREATE TABLE searches (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT,
  country TEXT DEFAULT 'USA',
  source_code TEXT,
  max_results INTEGER NOT NULL,
  skip_phone_lookup INTEGER NOT NULL DEFAULT 0,
  apify_actor_id TEXT,
  apify_run_id TEXT,
  apify_dataset_id TEXT,
  status TEXT DEFAULT 'pending',     -- pending | scraping | ingesting | enriching | done | failed
  error TEXT,
  results_count INTEGER,             -- items returned by the actor
  new_leads_count INTEGER,           -- leads not previously in the table
  skipped_count INTEGER,             -- items dropped (no place id, closed, unclaimed)
  cost_apify REAL DEFAULT 0,
  cost_twilio REAL DEFAULT 0,
  cost_anthropic REAL DEFAULT 0,
  cost_estimate REAL GENERATED ALWAYS AS (cost_apify + cost_twilio + cost_anthropic) VIRTUAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX idx_searches_status ON searches(status);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  search_id TEXT REFERENCES searches(id),   -- search that first found this lead
  google_place_id TEXT NOT NULL,
  cid TEXT,
  business_name TEXT,
  gbp_category TEXT,
  lead_category TEXT,
  sub_category TEXT,
  gbp_phone_raw TEXT,
  gbp_phone_formatted TEXT,                 -- E.164, used for Twilio Lookup
  phone_type TEXT,
  phone_carrier TEXT,
  website TEXT,
  owner_name TEXT,
  gbp_url TEXT,
  gbp_rank INTEGER,
  rating REAL,
  review_count INTEGER,
  address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'USA',
  latitude REAL,
  longitude REAL,
  is_claimed INTEGER,                       -- 1 claimed/verified, 0 unclaimed, NULL unknown
  permanently_closed INTEGER DEFAULT 0,
  temporarily_closed INTEGER DEFAULT 0,
  socials TEXT,
  logo_url TEXT,
  ai_summary TEXT,
  lead_source TEXT DEFAULT 'Google',
  source_code TEXT,
  lead_status TEXT DEFAULT 'Untouched',
  lead_date TEXT,
  lead_datetime TEXT,
  enrichment_status TEXT DEFAULT 'pending', -- pending | done | partial | failed | skipped (Phase 2)
  enrichment_error TEXT,
  raw TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_leads_dedup ON leads(google_place_id);
CREATE INDEX idx_leads_city_state ON leads(state, city);
CREATE INDEX idx_leads_category ON leads(gbp_category);
CREATE INDEX idx_leads_rating ON leads(rating);
CREATE INDEX idx_leads_status ON leads(lead_status);
CREATE INDEX idx_leads_created ON leads(created_at);
CREATE INDEX idx_leads_claimed ON leads(is_claimed);

CREATE TABLE search_leads (
  search_id TEXT NOT NULL REFERENCES searches(id),
  lead_id TEXT NOT NULL REFERENCES leads(id),
  rank INTEGER,
  PRIMARY KEY (search_id, lead_id)
);

CREATE INDEX idx_search_leads_lead ON search_leads(lead_id);

CREATE TABLE lead_emails (
  lead_id TEXT NOT NULL REFERENCES leads(id),
  email TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (lead_id, position)
);

CREATE TABLE lead_phones (
  lead_id TEXT NOT NULL REFERENCES leads(id),
  phone TEXT NOT NULL,
  phone_type TEXT,
  position INTEGER NOT NULL,
  PRIMARY KEY (lead_id, position)
);

CREATE INDEX idx_lead_emails_email ON lead_emails(email);
CREATE INDEX idx_lead_phones_type ON lead_phones(phone_type);
