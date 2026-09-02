-- P8 / A (4 Sep 2026): Route A — intake → estimate → priced draft → Ben confirms.
--
--   quote_estimates                the estimator's judgement per intake run: time ranges, materials with
--                                  cost, flags, confidence. NEVER a price (the engine prices; Ben decides).
--                                  One live row per intake run; a new intake supersedes (superseded_at).
--   personalized_quotes            additive columns for the automatic draft the chain creates:
--     pricing_suggestions jsonb    per-line { suggestedPence, bandLowPence, bandHighPence, checkThis, reason, basis }
--                                  — SUGGESTIONS ONLY; every customer-visible price column stays NULL until
--                                  Ben confirms on /admin/price/<slug> (pane B).
--     estimate_id text             the quote_estimates row the suggestions came from.
--     superseded_at / superseded_by  an unsent draft replaced by a newer intake (never deleted).
-- Additive and idempotent. Apply with `npx tsx scripts/_apply-migration.ts migrations/20260904_quote_estimates.sql`,
-- never db:push. Apply BEFORE deploying the code that writes it.

CREATE TABLE IF NOT EXISTS quote_estimates (
    id              text PRIMARY KEY,
    conversation_id varchar,
    run_id          text,
    draft_quote_id  text,
    intake_run_id   text,
    status          text NOT NULL DEFAULT 'running',   -- running | complete | failed
    lines           jsonb,
    job             jsonb,
    confidence      text,                              -- low | medium | high
    model           text,
    cost_pence      integer,
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    superseded_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_quote_estimates_conversation ON quote_estimates (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_estimates_intake_run ON quote_estimates (intake_run_id);
CREATE INDEX IF NOT EXISTS idx_quote_estimates_live ON quote_estimates (conversation_id) WHERE superseded_at IS NULL;

ALTER TABLE personalized_quotes ADD COLUMN IF NOT EXISTS pricing_suggestions jsonb;
ALTER TABLE personalized_quotes ADD COLUMN IF NOT EXISTS estimate_id text;
ALTER TABLE personalized_quotes ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE personalized_quotes ADD COLUMN IF NOT EXISTS superseded_by text;
CREATE INDEX IF NOT EXISTS idx_personalized_quotes_estimate ON personalized_quotes (estimate_id) WHERE estimate_id IS NOT NULL;
