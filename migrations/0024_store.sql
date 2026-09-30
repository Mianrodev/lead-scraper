-- Lead Store (2026-09-30): customer companies buy leads with credits in a separate app that
-- shares this database. See docs/store-api.md. Nothing here is visible to the internal app's
-- members; the owner manages it from the Admin page.

CREATE TABLE store_accounts (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | active | suspended
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  welcome_given INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);

CREATE TABLE store_users (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES store_accounts(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE INDEX idx_store_users_account ON store_users(account_id);

CREATE TABLE store_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES store_users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_store_sessions_user ON store_sessions(user_id);

-- Every change to an account's credits, with the balance after it.
CREATE TABLE store_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES store_accounts(id),
  delta INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  kind TEXT NOT NULL,                              -- grant | purchase | refund | adjust
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_store_ledger_account ON store_ledger(account_id, id);

-- Leads a customer has unlocked (theirs to download again for free).
CREATE TABLE store_purchases (
  account_id TEXT NOT NULL REFERENCES store_accounts(id),
  lead_id TEXT NOT NULL,
  tier TEXT NOT NULL,                              -- free | google
  credits INTEGER NOT NULL,
  purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, lead_id)
);
CREATE INDEX idx_store_purchases_lead ON store_purchases(lead_id);
CREATE INDEX idx_store_purchases_when ON store_purchases(account_id, purchased_at);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('store_price_free', '1'), ('store_price_google', '3'), ('store_brand_name', 'Lead Store'),
  ('store_brand_color', '#4f46e5'), ('store_support_email', ''), ('store_signup_open', '0'),
  ('store_welcome_credits', '0'), ('store_url', '');
