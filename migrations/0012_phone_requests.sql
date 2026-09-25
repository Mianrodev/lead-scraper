-- Phone checks asked for by hand (any business, verified or not), picked up by the normal checker.
ALTER TABLE leads ADD COLUMN phone_check_requested INTEGER NOT NULL DEFAULT 0;
