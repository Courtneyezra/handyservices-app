-- Migration: Add BUSY_PRO Calendar-Based Scheduling Fields
-- Created: 2026-02-01
-- Description: Adds scheduling tier, date, time slot, and fee fields for calendar-based dynamic pricing

ALTER TABLE personalized_quotes
ADD COLUMN IF NOT EXISTS scheduling_tier VARCHAR(20),
ADD COLUMN IF NOT EXISTS selected_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_weekend_booking BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS time_slot_type VARCHAR(20),
ADD COLUMN IF NOT EXISTS exact_time_requested VARCHAR(10),
ADD COLUMN IF NOT EXISTS scheduling_fee_in_pence INTEGER DEFAULT 0;

-- Add comments for documentation
COMMENT ON COLUMN personalized_quotes.scheduling_tier IS 'Scheduling tier selected: express, priority, standard, or flexible';
COMMENT ON COLUMN personalized_quotes.selected_date IS 'Date customer selected for service';
COMMENT ON COLUMN personalized_quotes.is_weekend_booking IS 'Whether the selected date is a weekend (Sat/Sun)';
COMMENT ON COLUMN personalized_quotes.time_slot_type IS 'Time slot type: am, pm, exact, or out_of_hours';
COMMENT ON COLUMN personalized_quotes.exact_time_requested IS 'Exact time if exact time slot selected (e.g., 10:00)';
COMMENT ON COLUMN personalized_quotes.scheduling_fee_in_pence IS 'Total scheduling fee in pence (date + time combined)';
