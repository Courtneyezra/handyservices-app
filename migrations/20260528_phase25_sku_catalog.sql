-- Phase 25 — SKU catalog + flex booking column.
--
-- Two changes, both idempotent so the script is safe to re-run:
--
-- 1. service_catalog table — the source of truth for line-item pricing and
--    on-site duration. Replaces the inline timeEstimateMinutes × hourly-rate
--    calculation for the ~87% of quotes that map to a catalog SKU.
--
-- 2. personalized_quotes.flex_booking_within_days — flags a quote that was
--    sold as a flex booking ("we pick a day within N days"). Dispatcher will
--    use this in a later phase to route to thin days for yield management.

CREATE TABLE IF NOT EXISTS service_catalog (
    id                                SERIAL PRIMARY KEY,
    sku_code                          VARCHAR(40) UNIQUE NOT NULL,
    name                              VARCHAR(120) NOT NULL,
    category                          VARCHAR(50) NOT NULL,
    shape                             VARCHAR(16) NOT NULL,

    -- Type A (fixed)
    price_pence                       INTEGER,
    schedule_minutes                  INTEGER,

    -- Type B (per_unit)
    unit_label                        VARCHAR(40),
    price_per_unit_pence              INTEGER,
    minimum_units                     INTEGER,
    minutes_per_unit                  INTEGER,
    setup_minutes                     INTEGER,

    -- Type C (tiered)
    tiers                             JSONB,

    -- Descriptions
    customer_description              TEXT NOT NULL,
    admin_description                 TEXT,

    -- Yield rules
    flex_eligible                     BOOLEAN NOT NULL DEFAULT TRUE,
    off_peak_weekend_premium_pence    INTEGER NOT NULL DEFAULT 0,

    -- Telemetry
    pick_count                        INTEGER NOT NULL DEFAULT 0,

    -- Audit
    is_active                         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                        TIMESTAMP DEFAULT NOW(),
    updated_at                        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_category   ON service_catalog (category);
CREATE INDEX IF NOT EXISTS idx_service_catalog_is_active  ON service_catalog (is_active);

ALTER TABLE personalized_quotes
    ADD COLUMN IF NOT EXISTS flex_booking_within_days INTEGER;
