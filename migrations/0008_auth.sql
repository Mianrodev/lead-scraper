-- Team sign-in: users and their sign-in sessions. Passwords are stored only as salted
-- PBKDF2-SHA256 hashes; session tokens only as SHA-256 hashes.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member',        -- admin | member
  password_hash TEXT NOT NULL,                -- base64 PBKDF2 output
  password_salt TEXT NOT NULL,                -- base64
  password_iterations INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                -- SHA-256 of the cookie value
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Who started each pull.
ALTER TABLE searches ADD COLUMN created_by TEXT;
