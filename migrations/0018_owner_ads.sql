-- Owner name and advertising signs from the website check (2026-09-29).
ALTER TABLE website_audits ADD COLUMN owner_name TEXT;
ALTER TABLE website_audits ADD COLUMN owner_title TEXT;
ALTER TABLE website_audits ADD COLUMN has_google_ads INTEGER NOT NULL DEFAULT 0;   -- Google Ads conversion tag on the site
ALTER TABLE website_audits ADD COLUMN has_bing_ads INTEGER NOT NULL DEFAULT 0;     -- Microsoft Ads (UET) tag
ALTER TABLE website_audits ADD COLUMN call_tracking TEXT;                          -- CallRail, WhatConverts, ... (usually means paid ads)

-- Sites checked before this change are checked again to pick these up (new sites still go first).
UPDATE leads SET website_audit_status = 'queued'
WHERE website_audit_status IN ('done', 'failed') AND website_domain IS NOT NULL;
