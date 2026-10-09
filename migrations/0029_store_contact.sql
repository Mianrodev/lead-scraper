-- Contact form on the public website (2026-10-09): /contact posts to /api/contact, which saves the
-- message here and puts a note on the owner's bell in the internal app (notifications, kind
-- 'store'). Rate limited per network (ip_hash, like store_removal_requests). See src/store/public.ts.

CREATE TABLE store_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT,                                    -- "A question", "Request access", "Buying credits", ...
  message TEXT NOT NULL,
  ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'new',              -- new | done
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  handled_at TEXT,
  handled_by TEXT
);
CREATE INDEX idx_store_messages_status ON store_messages(status, created_at);
CREATE INDEX idx_store_messages_ip ON store_messages(ip_hash, created_at);
