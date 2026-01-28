-- Migration: Add proposal mode and make customer fields optional
-- Date: 2026-01-24
-- Purpose: Support "Quick Links" (anonymous quotes) and "Proposal Mode" feature

-- Add proposal_mode_enabled column
ALTER TABLE personalized_quotes 
ADD COLUMN IF NOT EXISTS proposal_mode_enabled BOOLEAN DEFAULT false;

-- Make customer_name nullable (for Quick Links)
ALTER TABLE personalized_quotes 
ALTER COLUMN customer_name DROP NOT NULL;

-- Make phone nullable (for Quick Links)
ALTER TABLE personalized_quotes 
ALTER COLUMN phone DROP NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN personalized_quotes.proposal_mode_enabled IS 'Enables cinematic intro/educational experience before showing price';
COMMENT ON COLUMN personalized_quotes.customer_name IS 'Customer name - nullable for Quick Links (anonymous quotes)';
COMMENT ON COLUMN personalized_quotes.phone IS 'Customer phone - nullable for Quick Links (anonymous quotes)';
