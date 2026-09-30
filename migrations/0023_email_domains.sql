-- Free email pre-check (2026-09-30): one row per email domain, from public DNS.
-- has_mail: 1 = takes email, 0 = no mail server / domain doesn't exist, NULL = DNS didn't say.
CREATE TABLE IF NOT EXISTS email_domains (
  domain TEXT PRIMARY KEY,
  has_mail INTEGER,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
