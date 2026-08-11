-- Survey gate for contextual quotes — when a job can't be safely committed
-- sight-unseen, the customer must book & pay a site survey first instead of
-- booking the job via flex / date-pick. Prevents mis-scoped jobs (the "Alicia"
-- failure case).
--
-- Additive only — two new nullable columns on personalized_quotes.
-- Apply with a targeted run against the Neon DB (NEVER `db:push` — the schema is
-- entangled). e.g. psql "$DATABASE_URL" -f migrations/20260811_survey_required_gate.sql

ALTER TABLE personalized_quotes
    ADD COLUMN IF NOT EXISTS survey_required  boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS survey_fee_pence integer;
