-- B5: Add Database Indexes for SKU Detection Performance
-- This migration adds GIN index for array keyword searching and filtered index for active SKUs

-- GIN index for faster array searching on keywords
CREATE INDEX IF NOT EXISTS idx_productized_services_keywords 
ON productized_services USING GIN (keywords);

-- Index for active SKUs (most queries filter on this)
CREATE INDEX IF NOT EXISTS idx_productized_services_active 
ON productized_services (is_active) 
WHERE is_active = true;

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_productized_services_active_category
ON productized_services (is_active, category)
WHERE is_active = true;
