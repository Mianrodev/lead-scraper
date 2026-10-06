-- Store launch pieces (2026-10-06): card payments for credit packs (Stripe Checkout), one-time
-- email links (password reset, email confirmation) and the owner's launch checklist settings.
-- Everything stays switched off until the matching keys are added to the store Worker.

-- One row per Stripe Checkout session started by a customer. Credits are added once, when
-- Stripe confirms the payment (status open -> paid in the same step as the credits).
CREATE TABLE store_payments (
  id TEXT PRIMARY KEY,                             -- Stripe Checkout Session id (cs_...)
  account_id TEXT NOT NULL REFERENCES store_accounts(id),
  user_id TEXT,
  credits INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'open',             -- open | paid | expired
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE INDEX idx_store_payments_account ON store_payments(account_id, created_at);
CREATE INDEX idx_store_payments_paid ON store_payments(paid_at) WHERE status = 'paid';

-- One-time links sent by email. Only a SHA-256 of the token is stored.
CREATE TABLE store_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES store_users(id),
  purpose TEXT NOT NULL,                           -- reset | verify
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_store_tokens_user ON store_tokens(user_id, purpose, created_at);

-- Email confirmation: people who signed up before emails existed count as confirmed.
ALTER TABLE store_users ADD COLUMN email_verified_at TEXT;
UPDATE store_users SET email_verified_at = created_at;

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('store_credit_packs', '[]'),        -- [{"credits":100,"price":50}, ...] set by the owner
  ('store_email_from', ''),            -- e.g. Miami Goes Local <hello@leads.example.com>
  ('store_legal_reviewed', '0'),       -- the owner ticks it once a lawyer has checked the legal pages
  ('store_paid_plan', '0'),            -- the owner ticks it once Cloudflare Workers Paid is on
  ('store_features', '{}');            -- what the store Worker has switched on (it writes this itself)
