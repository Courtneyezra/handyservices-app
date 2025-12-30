-- Migration: Add comprehensive call logging with SKU management
-- Created: 2025-12-27

-- Add new columns to calls table for comprehensive logging
ALTER TABLE calls 
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR,
  ADD COLUMN IF NOT EXISTS email VARCHAR,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS postcode VARCHAR,
  ADD COLUMN IF NOT EXISTS duration INTEGER,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMP,
  ADD COLUMN IF NOT EXISTS outcome VARCHAR,
  ADD COLUMN IF NOT EXISTS urgency VARCHAR,
  ADD COLUMN IF NOT EXISTS lead_type VARCHAR,
  ADD COLUMN IF NOT EXISTS detected_skus_json JSONB,
  ADD COLUMN IF NOT EXISTS sku_detection_method VARCHAR,
  ADD COLUMN IF NOT EXISTS manual_skus_json JSONB,
  ADD COLUMN IF NOT EXISTS total_price_pence INTEGER,
  ADD COLUMN IF NOT EXISTS last_edited_by VARCHAR,
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS segments JSONB;

-- Create call_skus junction table for many-to-many relationship
CREATE TABLE IF NOT EXISTS call_skus (
  id VARCHAR PRIMARY KEY,
  call_id VARCHAR NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  sku_id VARCHAR NOT NULL REFERENCES productized_services(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  price_pence INTEGER NOT NULL,
  source VARCHAR NOT NULL, -- 'detected' | 'manual'
  confidence INTEGER, -- For detected SKUs (0-100)
  detection_method VARCHAR, -- 'keyword' | 'embedding' | 'gpt' | 'hybrid'
  added_by VARCHAR, -- User ID for manual additions
  added_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_call_skus_call_id ON call_skus(call_id);
CREATE INDEX IF NOT EXISTS idx_call_skus_sku_id ON call_skus(sku_id);
CREATE INDEX IF NOT EXISTS idx_calls_customer_name ON calls(customer_name);
CREATE INDEX IF NOT EXISTS idx_calls_phone_number ON calls(phone_number);
CREATE INDEX IF NOT EXISTS idx_calls_start_time ON calls(start_time);
CREATE INDEX IF NOT EXISTS idx_calls_outcome ON calls(outcome);

-- Add comment for documentation
COMMENT ON TABLE call_skus IS 'Junction table linking calls to productized services (SKUs) with quantity and pricing';
COMMENT ON COLUMN calls.detected_skus_json IS 'AI-detected SKUs with confidence scores from call transcript';
COMMENT ON COLUMN calls.manual_skus_json IS 'Manually added/edited SKUs by VA';
COMMENT ON COLUMN calls.total_price_pence IS 'Calculated total price from all SKUs in pence';
