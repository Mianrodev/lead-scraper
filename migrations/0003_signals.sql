-- Filters round 2: industry grouping, business signals (price, photos, Google attributes),
-- and indexes for local-area filters. Existing rows are filled by POST /api/admin/backfill.

-- Industry from src/taxonomy.ts for the lead's primary category; NULL = not in the list ("Other").
ALTER TABLE leads ADD COLUMN industry TEXT;
-- Google price level: "$" to "$$$$"; NULL when Google shows none.
ALTER TABLE leads ADD COLUMN price_level TEXT;
-- Number of photos on the Google profile.
ALTER TABLE leads ADD COLUMN photos_count INTEGER;

-- Google profile attributes that are switched on, e.g. "Onsite services", "Wheelchair accessible entrance".
CREATE TABLE lead_attributes (
  lead_id TEXT NOT NULL REFERENCES leads(id),
  section TEXT,
  name TEXT NOT NULL,
  PRIMARY KEY (lead_id, name)
);

CREATE INDEX idx_lead_attributes_name ON lead_attributes(name);
CREATE INDEX idx_leads_industry ON leads(industry);
CREATE INDEX idx_leads_postal ON leads(postal_code);
CREATE INDEX idx_leads_price ON leads(price_level);
CREATE INDEX idx_leads_updated ON leads(updated_at);
CREATE INDEX idx_leads_geo ON leads(latitude, longitude);
CREATE INDEX idx_search_leads_rank ON search_leads(lead_id, rank);
