-- Quote-level "standard assumptions" — the caveats a fixed price is based on
-- (access, parking, existing installs sound, no hidden hazards…). Shown on the
-- quote page so there's a documented basis to re-price if reality differs.
-- Per-line assumptions live inside the existing pricing_line_items jsonb, so no
-- column is needed for those.
--
-- Additive only — one new nullable jsonb column on personalized_quotes.
-- Apply with a targeted run against the Neon DB (NEVER `db:push` — the schema is
-- entangled). e.g. psql "$DATABASE_URL" -f migrations/20260811_quote_assumptions.sql

ALTER TABLE personalized_quotes
    ADD COLUMN IF NOT EXISTS quote_assumptions jsonb;
