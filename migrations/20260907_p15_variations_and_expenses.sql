-- P15 (3 Sep 2026): two schema gaps the build panes found but could not close (no DB access).
--
-- 1. dispatch_variations.dispatch_id is NOT NULL with an FK to job_dispatches, but a job booked
--    straight off a quote has NO job_dispatches row (MJ, booking 2d21da09-…). The contractor's
--    "customer wants something extra" button therefore refused on every booking-based job. The
--    table is empty (0 rows), so relaxing it is safe. A variation now hangs off EITHER a dispatch
--    or a booking, and a check constraint insists on one of them.
--
-- 2. job_material_expenses is declared in shared/schema.ts (the quote-accuracy work, Jul 2026) but
--    was never applied. P15 part 4's materials claim writes here; without the table the claim
--    swallowed a 42P01 and kept only the copy on the booking. Creating it makes the claim durable.
--
-- Additive and idempotent. Apply with `npx tsx scripts/_apply-migration.ts migrations/20260907_p15_variations_and_expenses.sql`,
-- never db:push. Apply BEFORE deploying the code that writes it.

ALTER TABLE dispatch_variations ALTER COLUMN dispatch_id DROP NOT NULL;
ALTER TABLE dispatch_variations ADD COLUMN IF NOT EXISTS booking_id varchar;
CREATE INDEX IF NOT EXISTS idx_dispatch_variations_booking ON dispatch_variations (booking_id) WHERE booking_id IS NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_variations_has_parent') THEN
        ALTER TABLE dispatch_variations ADD CONSTRAINT dispatch_variations_has_parent
            CHECK (dispatch_id IS NOT NULL OR booking_id IS NOT NULL);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS job_material_expenses (
    id                  varchar PRIMARY KEY,
    quote_id            varchar REFERENCES personalized_quotes(id),
    booking_request_id  varchar,
    contractor_id       varchar REFERENCES handyman_profiles(id),
    amount_pence        integer NOT NULL,
    vendor              varchar(160),
    description         text,
    spend_date          varchar(10),
    source              varchar(20) NOT NULL DEFAULT 'manual',
    external_ref        varchar(160),
    receipt_url         text,
    entered_by          varchar,
    entered_by_name     varchar(100),
    created_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_material_expenses_quote ON job_material_expenses (quote_id);
CREATE INDEX IF NOT EXISTS idx_job_material_expenses_booking ON job_material_expenses (booking_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_material_expenses_external ON job_material_expenses (source, external_ref) WHERE external_ref IS NOT NULL;
