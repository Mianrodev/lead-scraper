-- Company facts (2026-10-02): every officer from the state registries as contacts, the founding
-- date, extra phone numbers from websites (lead_phones already exists), employee and revenue
-- ranges from the public PPP loan records (2020-21) or a labelled estimate, and local averages
-- (rating and reviews per business type and city) for the "above / below local average" labels.

-- People at the business: registry officers (owner first) and names found on the website.
CREATE TABLE lead_contacts (
  lead_id TEXT NOT NULL REFERENCES leads(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  source TEXT NOT NULL,                 -- registry | website
  PRIMARY KEY (lead_id, position)
);

-- Founded: the state registry's filing date (YYYY-MM-DD).
ALTER TABLE leads ADD COLUMN founded TEXT;
-- When the registry details (all officers + founding date) were collected. Businesses checked
-- before this existed get them on a gentle daily re-check.
ALTER TABLE leads ADD COLUMN registry_details_at TEXT;

-- Size: ranges, never exact figures. Source 'ppp' = SBA PPP loan record (jobs reported, loan
-- amount; 2020-21), 'estimate' = estimated from the business type and reviews.
ALTER TABLE leads ADD COLUMN employees_min INTEGER;
ALTER TABLE leads ADD COLUMN employees_max INTEGER;
ALTER TABLE leads ADD COLUMN revenue_min INTEGER;
ALTER TABLE leads ADD COLUMN revenue_max INTEGER;
ALTER TABLE leads ADD COLUMN size_source TEXT;
ALTER TABLE leads ADD COLUMN size_year INTEGER;
ALTER TABLE leads ADD COLUMN ppp_checked_at TEXT;
CREATE INDEX idx_leads_ppp_todo ON leads(state) WHERE ppp_checked_at IS NULL;

-- Average rating and review count per business type and city (refreshed daily), for the
-- "above / below local average" and "low review count" labels.
CREATE TABLE local_averages (
  category TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  businesses INTEGER NOT NULL,
  avg_rating REAL,
  avg_reviews REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (state, city, category)
);

-- Phones found on websites are matched against the do-not-contact list.
CREATE INDEX IF NOT EXISTS idx_lead_phones_phone ON lead_phones(phone);
