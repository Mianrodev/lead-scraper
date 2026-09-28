-- Website check (run by the free collector on GitHub) + scores + chains, 2026-09-28.
-- The work queue covers both waiting ('queued') and in-progress ('checking') sites, so the
-- collector's claim and the stale-batch watchdog never scan the whole leads table.
DROP INDEX IF EXISTS idx_leads_audit_queue;
CREATE INDEX idx_leads_audit_work ON leads(website_audit_status, website_audit_at)
  WHERE website_audit_status IN ('queued', 'checking');

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('website_check_enabled', '1'),
  ('website_check_daily_limit', '3000'),
  ('website_checks_today', ''),
  ('website_queue_rowid', '0'),
  ('score_rowid', '0');
