-- P8 / B (4 Sep 2026): Ben's "price and send" screen — one row per quote line Ben confirmed.
--
-- The chain (P8 / A) suggests a price per line from the estimator's minutes and the real engine;
-- Ben's tap on /admin/price/<slug> is the ONLY thing that turns a suggestion into a customer-visible
-- price. This table records that tap line by line so the Route B graduation trigger in
-- docs/COMMS_AGENTS_V3_DESIGN.md §6 (≥ 30 quotes / 90 d, ≤ 20 % variance, ≥ 80 % unedited-in-band for
-- 30 d) can be computed per category, read-only, on /admin/staff.
--
--   slug / quote_id      personalized_quotes.short_slug / .id
--   line_id              pricing_line_items[].lineId
--   category             the line's category at confirm time (denormalised so stats need no join)
--   suggested_pence      what the chain suggested (null when the chain had nothing for the line)
--   band_low/high_pence  the engine band (minutesLow / minutesHigh); null when no band
--   final_pence          what Ben sent
--   in_band              band present and band_low ≤ final ≤ band_high
--   edited               no suggestion, or final ≠ suggested
--   check_this           the chain flagged the line (fallback price) — Ben was told to check it
--   by                   human:<id> — always a person (the money rule)
--   at                   when Ben tapped Send
--
-- Additive and idempotent. Apply with `npx tsx scripts/_apply-migration.ts migrations/20260904_quote_price_verdicts.sql`,
-- never db:push.

CREATE TABLE IF NOT EXISTS quote_price_verdicts (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug             varchar(8) NOT NULL,
    quote_id         varchar NOT NULL,
    line_id          text NOT NULL,
    category         text,
    suggested_pence  integer,
    band_low_pence   integer,
    band_high_pence  integer,
    final_pence      integer NOT NULL,
    in_band          boolean NOT NULL DEFAULT false,
    edited           boolean NOT NULL DEFAULT false,
    check_this       boolean NOT NULL DEFAULT false,
    by               text NOT NULL,
    at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT quote_price_verdicts_final_check CHECK (final_pence > 0),
    CONSTRAINT quote_price_verdicts_by_check CHECK (by LIKE 'human:%')
);

CREATE INDEX IF NOT EXISTS idx_quote_price_verdicts_at ON quote_price_verdicts (at);
CREATE INDEX IF NOT EXISTS idx_quote_price_verdicts_slug ON quote_price_verdicts (slug);
CREATE INDEX IF NOT EXISTS idx_quote_price_verdicts_category_at ON quote_price_verdicts (category, at);
