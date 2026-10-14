-- AI helper: a website that was busy (429), slow (timed out) or erroring (5xx) is tried again the next
-- day instead of giving up. leads.ai_status 'later' = waiting for that second try; after it, 'failed'.
CREATE INDEX IF NOT EXISTS idx_leads_ai_later ON leads(ai_checked_at) WHERE ai_status = 'later';
