-- AI helper (src/ai-helper.ts): with a free Google Gemini key, each business's own website is
-- read and what's missing is filled in (owner name, emails, social pages), plus a short summary,
-- a list of services and a personal opening line for outreach.
--
-- leads.ai_status: NULL = not read yet, 'done', 'nothing' (the site had no usable text),
--   'failed' (the site didn't load, wasn't a web page, or the AI couldn't answer).
-- leads.ai_services: comma-joined, at most 6 short items. ai_summary / ai_opener: AI-written text.
-- leads.ai_priority: > 0 = someone asked for this business to be read next ("Run AI helper").
-- leads.owner_source can now also be 'ai' (an owner name the AI found on the business's site,
--   only kept when the name appears word for word on the page).

ALTER TABLE leads ADD COLUMN ai_status TEXT;
ALTER TABLE leads ADD COLUMN ai_checked_at TEXT;
-- (leads.ai_summary already exists since 0001_init.sql, unused until now.)
ALTER TABLE leads ADD COLUMN ai_services TEXT;
ALTER TABLE leads ADD COLUMN ai_opener TEXT;
ALTER TABLE leads ADD COLUMN ai_priority INTEGER;

-- Next businesses to read: only rows still waiting are in these (small) indexes. The queries in
-- src/ai-helper.ts repeat each WHERE condition so SQLite uses them.
CREATE INDEX IF NOT EXISTS idx_leads_ai_todo ON leads(created_at)
  WHERE ai_status IS NULL AND website_audit_status = 'done' AND suppressed IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_ai_priority ON leads(ai_priority)
  WHERE ai_priority > 0 AND ai_status IS NULL;
-- Businesses someone is working (assigned, or moved past "Untouched") go first.
CREATE INDEX IF NOT EXISTS idx_leads_ai_worked ON leads(created_at)
  WHERE ai_status IS NULL AND website_audit_status = 'done' AND suppressed IS NULL
    AND (assigned_to IS NOT NULL OR COALESCE(lead_status, 'Untouched') <> 'Untouched');
