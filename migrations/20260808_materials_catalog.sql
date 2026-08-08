-- Materials Catalog — self-building product cache for the quote materials picker.
-- Additive only. No changes to existing tables. Line-item `materials` lives inside
-- the existing personalized_quotes.pricing_line_items jsonb, so no column change there.
--
-- Apply with a targeted run against the Neon DB (NEVER `db:push` — the schema is
-- entangled). e.g. psql "$DATABASE_URL" -f migrations/20260808_materials_catalog.sql

CREATE TABLE IF NOT EXISTS materials_catalog (
    id                    varchar PRIMARY KEY NOT NULL,
    supplier              varchar(20) NOT NULL DEFAULT 'manual',
    supplier_item_number  varchar(64),
    name                  varchar(300) NOT NULL,
    brand                 varchar(160),
    description           text,
    category              varchar(160),
    image_url             text,
    supplier_url          text,
    price_pence_ex_vat    integer,
    price_pence_inc_vat   integer,
    currency              varchar(8) DEFAULT 'GBP',
    usage_count           integer NOT NULL DEFAULT 0,
    last_price_sync_at    timestamp,
    created_at            timestamp DEFAULT now(),
    updated_at            timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materials_catalog_name     ON materials_catalog (name);
CREATE INDEX IF NOT EXISTS idx_materials_catalog_usage    ON materials_catalog (usage_count);
CREATE INDEX IF NOT EXISTS idx_materials_catalog_supplier ON materials_catalog (supplier);

-- NULL supplier_item_number rows (manual items) coexist because NULLs are distinct;
-- this only blocks caching the same supplier product twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_materials_catalog_supplier_item
    ON materials_catalog (supplier, supplier_item_number);
