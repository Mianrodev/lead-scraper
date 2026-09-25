-- Phone-type checks are opt-in per pull ("Check phone types" on the Find form), so paid or
-- limited free checks are only spent on searches that asked for them. Existing pulls: off.
ALTER TABLE searches ADD COLUMN check_phones INTEGER NOT NULL DEFAULT 0;
