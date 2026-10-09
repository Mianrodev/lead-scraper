-- QA clean-up (safe to run more than once: every step only touches rows that still need it).

-- 1. Old notices with texts that should never have been shown ("DataForSEO", "$-0.01 left",
--    "Payment Required"): dismissed, not deleted, so their dedupe keys still stop repeats.
UPDATE notifications SET dismissed_at = datetime('now'), dismissed_by = 'cleanup'
 WHERE dismissed_at IS NULL AND kind IN ('credit', 'counts')
   AND (message LIKE '%DataForSEO%' OR message LIKE '%$-%' OR message LIKE '%Payment Required%');

-- 2. Saved email addresses tidied the same way new ones are (src/normalize.ts cleanEmail):
--    %xx decoded, "mailto:" and stray spaces / brackets / quotes dropped, lower case, a doubled
--    ending (".com.com") fixed; then rows that aren't an address, and exact duplicates for the same
--    business, are removed. lead_emails' key is (lead_id, position), so changing the email text
--    never clashes; of two equal addresses the one listed first (lowest position) is kept.
UPDATE lead_emails SET email =
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    email, '%20', ''), '%09', ''), '%0A', ''), '%0a', ''), '%0D', ''), '%0d', ''), '%22', ''), '%27', ''),
    '%3C', ''), '%3c', ''), '%3E', ''), '%3e', ''), '%40', '@'), '%2B', '+'), '%2b', '+'), '%2D', '-'), '%2d', '-'),
    '%2E', '.'), '%2e', '.'), '%5F', '_')
 WHERE email LIKE '%\%%' ESCAPE '\';
UPDATE lead_emails SET email = substr(email, 8) WHERE lower(email) LIKE 'mailto:%';
UPDATE lead_emails SET email = substr(email, 1, instr(email, '?') - 1) WHERE instr(email, '?') > 1;
UPDATE lead_emails SET email = lower(trim(email, ' <>"''(),;:[].' || char(9, 10, 13)))
 WHERE email <> lower(trim(email, ' <>"''(),;:[].' || char(9, 10, 13)));
UPDATE lead_emails SET email = substr(email, 1, length(email) - 4) WHERE email LIKE '%_.com.com';
UPDATE lead_emails SET email = substr(email, 1, length(email) - 4) WHERE email LIKE '%_.com.com';
UPDATE lead_emails SET email = substr(email, 1, length(email) - 4) WHERE email LIKE '%_.net.net';
UPDATE lead_emails SET email = substr(email, 1, length(email) - 4) WHERE email LIKE '%_.org.org';
UPDATE lead_emails SET email = substr(email, 1, length(email) - 4) WHERE email LIKE '%_.biz.biz';
UPDATE lead_emails SET email = substr(email, 1, length(email) - 5) WHERE email LIKE '%_.info.info';
UPDATE lead_emails SET email = substr(email, 1, length(email) - 3) WHERE email LIKE '%_.us.us';
UPDATE lead_emails SET email = substr(email, 1, length(email) - 3) WHERE email LIKE '%_.co.co';
DELETE FROM lead_emails
 WHERE email = '' OR instr(email, '@') < 2 OR instr(email, ' ') > 0 OR email NOT LIKE '%_@_%._%'
    OR length(email) - length(replace(email, '@', '')) <> 1;
DELETE FROM lead_emails
 WHERE EXISTS (SELECT 1 FROM lead_emails d WHERE d.lead_id = lead_emails.lead_id AND d.email = lead_emails.email AND d.position < lead_emails.position);

-- 3. Counts and the overview are cached for a few minutes: start fresh after the clean-up.
DELETE FROM api_cache WHERE key LIKE 'count?%' OR key LIKE 'facets?%' OR key LIKE 'overview%';
