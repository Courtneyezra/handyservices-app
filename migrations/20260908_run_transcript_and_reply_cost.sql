-- Plan v2, item 0.4 (8 Sep 2026): "Cost per reply, and the run transcript kept".
--
-- 1. agent_runs.transcript — the lean per-step run trail (tool calls, tool results, assistant
--    text) the runner already built and then threw away. Same shape as ops_messages.transcript
--    (LeanRunStep[], shared/ops-types.ts); no second shape. Bounded to 64 KiB of JSON by
--    server/agents/transcript-store.ts, largest tool results dropped first, so one long run
--    cannot bloat a row. Written by finishAgentRun.
--
-- 2. message_drafts.cost_pence — the model spend behind THIS reply: the drafting run plus every
--    run DESCENDED from it (the estimator's own attempt run, and the search_web call inside that
--    attempt), summed from agent_runs.cost_pence at send time by modelCostPenceForRun. Cost per
--    reply, not per run.
--
-- Additive and idempotent. Apply with
--   npx tsx scripts/_apply-migration.ts migrations/20260908_run_transcript_and_reply_cost.sql
-- never db:push. Apply BEFORE deploying the code that writes it.

ALTER TABLE agent_runs      ADD COLUMN IF NOT EXISTS transcript  jsonb;
ALTER TABLE message_drafts  ADD COLUMN IF NOT EXISTS cost_pence  integer;

-- 3. The 09:00 digest rolls yesterday's sends up by cost (server/agents/silence-breaker.ts), which
--    is a range scan over sent_at on the sent rows only. idx_message_drafts_status is on
--    (status, created_at) and does not serve it.
CREATE INDEX IF NOT EXISTS idx_message_drafts_sent_at ON message_drafts (sent_at) WHERE status = 'sent';
