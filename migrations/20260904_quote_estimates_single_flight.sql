-- P8 / A-fix (4 Sep 2026): exactly ONE live estimate per intake run.
-- First live Route A pass (Gemma, 396cc967…): two estimator runs one second apart, both truncated,
-- no draft. The claim is the quote_estimates row itself (insert status 'running' keyed on
-- intake_run_id; a second insert for a live intake is refused). This index makes the refusal a
-- database guarantee across processes, not just a read-then-insert.
-- Additive and idempotent. Apply with `npx tsx scripts/_apply-migration.ts migrations/20260904_quote_estimates_single_flight.sql`,
-- never db:push.

CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_estimates_live_intake
    ON quote_estimates (intake_run_id)
    WHERE superseded_at IS NULL AND intake_run_id IS NOT NULL;
