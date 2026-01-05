-- Migration: Add Action Center fields to calls table
-- Created: 2026-01-04

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS action_status VARCHAR DEFAULT 'pending', -- 'pending', 'attempting', 'resolved', 'dismissed'
  ADD COLUMN IF NOT EXISTS action_urgency INTEGER DEFAULT 3, -- 1=Critical, 2=High, 3=Normal, 4=Low
  ADD COLUMN IF NOT EXISTS missed_reason VARCHAR, -- 'out_of_hours', 'busy_agent', 'no_answer', 'user_hangup'
  ADD COLUMN IF NOT EXISTS tags TEXT[]; -- Array of tags e.g. ['ai_incomplete', 'no_lead_info']

-- Add index for fast sorting in Action Center
CREATE INDEX IF NOT EXISTS idx_calls_action_urgency ON calls(action_urgency);
CREATE INDEX IF NOT EXISTS idx_calls_action_status ON calls(action_status);
