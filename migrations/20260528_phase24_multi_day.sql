-- Phase 24a — multi-day booking foundation
-- Adds duration_days to bookings + locks. Default 1 keeps every existing
-- single-day quote unchanged. 2+ means the booking/lock spans that many
-- consecutive working days starting at scheduled_date.

ALTER TABLE contractor_booking_requests
    ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 1;

ALTER TABLE booking_slot_locks
    ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 1;
