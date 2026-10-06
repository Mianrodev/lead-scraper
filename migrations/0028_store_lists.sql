-- Store lists (2026-10-06): every "Get leads" in the customer app saves the leads of that
-- request as a named list ("Plumbers · Tampa, FL"), so buyers find, rename, download and delete
-- them by list. A list only groups leads the account already owns (store_purchases): deleting a
-- list never takes leads away. Team members of an account share its lists. See docs/store-api.md.

CREATE TABLE store_lists (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES store_accounts(id),
  name TEXT NOT NULL,
  query TEXT,                                      -- the search that made it (filter query string), for "new since" later
  lead_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,                                 -- store_users.id (who pressed "Get")
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_store_lists_account ON store_lists(account_id, created_at);

CREATE TABLE store_list_leads (
  list_id TEXT NOT NULL REFERENCES store_lists(id),
  lead_id TEXT NOT NULL,
  PRIMARY KEY (list_id, lead_id)
);
CREATE INDEX idx_store_list_leads_lead ON store_list_leads(lead_id);

-- Leads bought before lists existed: one "Earlier leads" list per account that has any.
INSERT INTO store_lists (id, account_id, name, query, lead_count, created_at)
  SELECT 'earlier-' || account_id, account_id, 'Earlier leads', NULL, COUNT(*), MIN(purchased_at)
    FROM store_purchases GROUP BY account_id;
INSERT INTO store_list_leads (list_id, lead_id)
  SELECT 'earlier-' || account_id, lead_id FROM store_purchases;
