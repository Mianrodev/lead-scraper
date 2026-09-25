-- Hardening from the review: retry transient failures instead of failing pulls, retry
-- phone checks after provider outages, rate-limit sign-in attempts per IP, and a
-- single-runner lock for phone checks (so numbers are never checked, or paid for, twice).

-- Consecutive errors while syncing a pull; it only fails after several in a row.
ALTER TABLE searches ADD COLUMN sync_errors INTEGER NOT NULL DEFAULT 0;

-- Phone checks that hit a timeout / provider error; the number is retried a few times.
ALTER TABLE leads ADD COLUMN phone_check_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_leads_phone_pending ON leads(created_at) WHERE phone_type IS NULL AND gbp_phone_formatted IS NOT NULL;

-- Sign-in attempts per IP address in the current window.
CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Only one phone-check run at a time.
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('phone_check_lock', '');
