-- Free-plan headroom (QA, 2026-09-30): fewer rows written per new business, fewer rows read
-- by the minute jobs and the dashboard.

-- Free businesses never have a Google listing number (cid), yet every save wrote an index entry
-- for the empty value. Lookups are always "cid = ?" / "cid IN (...)", which this still serves.
DROP INDEX IF EXISTS idx_leads_cid;
CREATE INDEX idx_leads_cid ON leads(cid) WHERE cid IS NOT NULL;

-- The minute job asks "is a collection running?" (status) twice a minute.
CREATE INDEX IF NOT EXISTS idx_free_imports_status ON free_imports(status, created_at);

-- Overview "hot leads": recently opened reports.
CREATE INDEX IF NOT EXISTS idx_leads_report_viewed ON leads(report_viewed_at) WHERE report_viewed_at IS NOT NULL;

-- Short-lived answers for the heaviest dashboard reads (filter counts, list totals, overview):
-- the same question within a few minutes is answered from here instead of re-reading every business.
CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
