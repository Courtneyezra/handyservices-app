-- P6 close-out of the comms rebuild, 4 Sep 2026 (P2-spine "not done": agent_runs has no parent-run column).
--   agent_runs.parent_run_id  the spine run this row belongs to. One runOnce pass writes one row under
--                             the spine's run id; the triage model call, the vision describe_video calls
--                             and the legacy runners the clerk / recovery wrap (quote-prep, recovery)
--                             write their own rows and now carry the parent's id here. Null on
--                             top-level runs and on every row written before this migration.
--                             AgentRunsDrawer groups children under their parent.
-- Additive and idempotent. Apply with `npx tsx scripts/_apply-migration.ts migrations/20260904_agent_runs_parent_run.sql`,
-- never db:push. Apply BEFORE deploying the code that writes it (startAgentRun inserts the column).

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS parent_run_id text;
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs (parent_run_id) WHERE parent_run_id IS NOT NULL;
