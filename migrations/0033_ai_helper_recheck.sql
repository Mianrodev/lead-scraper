-- AI helper: results from before the stricter checks (2026-10-13) are read again under the new rules.
-- Fact-checking 16 real results showed owner names taken from customer reviews and openers with
-- years the website never states; src/ai-helper.ts now rejects both. Runs once, like any migration.

-- Owner names the AI found under the old rule are cleared; the re-read keeps them only if the page
-- says that person owns / founded / runs the business. Names from the registry or the website
-- check (owner_source 'registry' / 'website') are not touched.
UPDATE leads SET owner_name = NULL, owner_title = NULL, owner_source = NULL
WHERE owner_source = 'ai' AND ai_checked_at < '2026-10-14';

-- The businesses read under the old rules wait in line again, ahead of new ones (ai_priority), and are
-- re-read within the normal daily limit. Their current summary / opener stay until the re-read replaces them.
UPDATE leads SET ai_status = NULL, ai_priority = CAST(strftime('%s', 'now') AS INTEGER)
WHERE ai_status = 'done' AND ai_checked_at < '2026-10-14';
