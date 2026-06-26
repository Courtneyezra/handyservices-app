-- Phase: SKU matching + post-commitment upsells
-- Adds keyword/embedding columns for skuDetector migration to service_catalog
-- and upsell_sku_codes for post-commitment "While we're there..." intercept.

ALTER TABLE service_catalog
  ADD COLUMN IF NOT EXISTS keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS negative_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_prompt_hint text,
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS upsell_sku_codes text[] NOT NULL DEFAULT '{}';

-- ivfflat index added after embeddings are seeded (requires rows with non-null embedding)
-- CREATE INDEX CONCURRENTLY idx_sc_embedding ON service_catalog USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
