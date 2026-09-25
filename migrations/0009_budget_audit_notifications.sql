-- Super admin (the owner), monthly spending limit, activity log, notifications.

-- The first admin of each database becomes the super admin: not audit-logged, sees the
-- activity log, sets the budget, and can't be changed by other admins.
UPDATE users SET role = 'super_admin'
WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'super_admin');

-- Simple key/value settings (e.g. monthly_budget_usd).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('monthly_budget_usd', '25');

-- Pull cost as estimated when it started; counts toward the budget until the real cost is known.
ALTER TABLE searches ADD COLUMN estimated_cost REAL;

-- Spend that isn't tied to a pull (e.g. "how many exist" counts).
CREATE TABLE spend_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,             -- count
  amount_usd REAL NOT NULL,
  user_id TEXT
);
CREATE INDEX idx_spend_log_at ON spend_log(at);

-- Who did what. The super admin's own actions are not recorded.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  details TEXT                    -- JSON
);
CREATE INDEX idx_audit_at ON audit_log(at);
CREATE INDEX idx_audit_user ON audit_log(user_id, at);
CREATE INDEX idx_audit_action ON audit_log(action, at);

-- Problems worth telling the team about (failed pulls, paused phone checks, low credit, budget).
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL DEFAULT 'warn', -- info | warn | error
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  -- Same key = same problem: not repeated while an undismissed one exists.
  dedupe_key TEXT,
  dismissed_at TEXT,
  dismissed_by TEXT
);
CREATE INDEX idx_notifications_open ON notifications(dismissed_at, created_at);
CREATE INDEX idx_notifications_key ON notifications(dedupe_key);
