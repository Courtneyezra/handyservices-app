-- Site survey — a contractor (e.g. Joe) opens a tokenised /survey/:slug link on
-- their phone and fills a per-item survey (scope, time estimate, materials,
-- notes, photos) for additional works found on site. The response is stored as
-- jsonb on the quote row (MVP — no new table); the office is pinged on submit.
--
-- Additive only — two new nullable columns on personalized_quotes.
-- Apply with a targeted run against the Neon DB (NEVER `db:push` — the schema is
-- entangled). e.g. psql "$DATABASE_URL" -f migrations/20260812_site_survey_response.sql

ALTER TABLE personalized_quotes
    ADD COLUMN IF NOT EXISTS survey_response     jsonb,
    ADD COLUMN IF NOT EXISTS survey_submitted_at timestamp;
