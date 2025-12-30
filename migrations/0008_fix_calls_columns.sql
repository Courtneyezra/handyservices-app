-- Migration to add missing columns to calls table
-- Run this manually or via drizzle-kit

-- Add customer information fields
ALTER TABLE calls ADD COLUMN IF NOT EXISTS customer_name VARCHAR;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS email VARCHAR;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS address VARCHAR;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS postcode VARCHAR;

-- Add call metadata fields
ALTER TABLE calls ADD COLUMN IF NOT EXISTS duration INTEGER;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS outcome VARCHAR;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS urgency VARCHAR;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_type VARCHAR;

-- Add SKU tracking fields
ALTER TABLE calls ADD COLUMN IF NOT EXISTS detected_skus_json JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS sku_detection_method VARCHAR;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS manual_skus_json JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS total_price_pence INTEGER;

-- Add audit trail fields
ALTER TABLE calls ADD COLUMN IF NOT EXISTS last_edited_by VARCHAR;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add segments field for transcript
ALTER TABLE calls ADD COLUMN IF NOT EXISTS segments JSONB;
