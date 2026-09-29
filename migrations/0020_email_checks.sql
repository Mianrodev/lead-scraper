-- Email verification (MillionVerifier), 2026-09-30. One row per address, shared by every
-- business that has it, so no address is ever paid for twice.
CREATE TABLE email_checks (
  email TEXT PRIMARY KEY,
  result TEXT NOT NULL,          -- queued | ok | catch_all | unknown | invalid | disposable | error
  subresult TEXT,
  quality TEXT,
  is_role INTEGER,
  is_free INTEGER,
  checked_at TEXT,
  queued_at TEXT NOT NULL DEFAULT (datetime('now')),
  error TEXT
);
CREATE INDEX idx_email_checks_queue ON email_checks(queued_at) WHERE result = 'queued';
