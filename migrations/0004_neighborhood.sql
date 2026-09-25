-- Neighborhood (Google's name for the area, e.g. "Southeast Orlando"). Filled for existing
-- rows by POST /api/admin/backfill.
ALTER TABLE leads ADD COLUMN neighborhood TEXT;
CREATE INDEX idx_leads_neighborhood ON leads(neighborhood);
