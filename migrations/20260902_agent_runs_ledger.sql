-- Phase 1 of the comms rebuild ("See everything, never go silent"), 2 Sep 2026.
-- COMMS_AGENTS_V3_DESIGN §3.7: agent_runs, run_id on every draft / flag / nudge, and a run_id on
-- the write-at-source ledger. Additive and idempotent. Apply with a targeted run, never db:push.

CREATE TABLE IF NOT EXISTS agent_runs (
    id              text PRIMARY KEY,
    agent           text NOT NULL,
    pack_id         text,
    pack_version    integer,
    trigger         text,
    -- conversations.id is a 32-hex varchar, not a uuid, so a uuid column here could never join it.
    conversation_id varchar,
    case_file_ref   text,
    model           text,
    model_snapshot  text,
    prompt_hash     text,
    decision        text,
    lane            text,
    proposal        jsonb,
    guards_hit      text[] NOT NULL DEFAULT '{}',
    usage           jsonb,
    cost_pence      integer,
    duration_ms     integer,
    transcript_ref  text,
    error           text,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_started ON agent_runs (conversation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_started ON agent_runs (agent, started_at DESC);

ALTER TABLE message_drafts  ADD COLUMN IF NOT EXISTS run_id text;
ALTER TABLE agent_questions ADD COLUMN IF NOT EXISTS run_id text;
ALTER TABLE nudge_queue     ADD COLUMN IF NOT EXISTS run_id text;
ALTER TABLE comms_events    ADD COLUMN IF NOT EXISTS run_id text;

CREATE INDEX IF NOT EXISTS idx_message_drafts_run ON message_drafts (run_id);
CREATE INDEX IF NOT EXISTS idx_comms_events_run   ON comms_events (run_id);
