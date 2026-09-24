-- Filters round 1: keep unverified / closed businesses (filtered instead of dropped),
-- derived columns for status, website dedup and physical location, and indexes for
-- duplicate detection. Derived values for existing rows are backfilled by
-- POST /api/admin/backfill (same TypeScript logic as ingest, so there's one source of truth).

-- operational | temporarily_closed | permanently_closed
ALTER TABLE leads ADD COLUMN business_status TEXT NOT NULL DEFAULT 'operational';
-- Lower-cased host without "www." (NULL when no website or a shared platform like facebook.com)
ALTER TABLE leads ADD COLUMN website_domain TEXT;
-- 1 = has a street address (storefront/office), 0 = service-area business (no address shown), NULL = unknown
ALTER TABLE leads ADD COLUMN has_street_address INTEGER;

UPDATE leads SET business_status = CASE
  WHEN permanently_closed = 1 THEN 'permanently_closed'
  WHEN temporarily_closed = 1 THEN 'temporarily_closed'
  ELSE 'operational' END;

CREATE INDEX idx_leads_business_status ON leads(business_status);
CREATE INDEX idx_leads_domain ON leads(website_domain);
CREATE INDEX idx_leads_phone ON leads(gbp_phone_formatted);
CREATE INDEX idx_leads_cid ON leads(cid);
CREATE INDEX idx_leads_rank ON leads(gbp_rank);
CREATE INDEX idx_leads_reviews ON leads(review_count);
CREATE INDEX idx_searches_lookup ON searches(category, city, state, created_at);
