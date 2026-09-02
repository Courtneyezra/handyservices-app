-- Phase 3 of the comms rebuild ("Earn sending"), 3 Sep 2026.
--   agent_runs.shadow_decision  what the spine WOULD have done on a thread while the switch was in
--                               'shadow' mode (send | pending | flag | drop | none). Null on live and
--                               legacy runs. scripts/_shadow-report.ts pairs these with the legacy run
--                               on the same thread to produce the Phase 2 exit evidence.
-- The sampler needs "yesterday's automatic sends" quickly: decision + finished_at.
-- Additive only. Apply with a targeted run, never db:push.

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS shadow_decision text;
CREATE INDEX IF NOT EXISTS idx_agent_runs_decision_finished ON agent_runs (decision, finished_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_shadow ON agent_runs (finished_at) WHERE shadow_decision IS NOT NULL;
