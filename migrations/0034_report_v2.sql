-- Report v2 (2026-10-15): "You vs. top businesses near you" on the report and in the GoHighLevel
-- download lists the 3 businesses of the same type in the same city with the most Google reviews.
-- This index answers that in a few rows instead of reading every business in the city (the
-- answer is also cached for a day per city and type). Partial: only businesses with Google
-- reviews are in it, so saving free / uploaded businesses costs no extra index write.
CREATE INDEX IF NOT EXISTS idx_leads_local_top ON leads(state, city, gbp_category, review_count) WHERE review_count IS NOT NULL;
