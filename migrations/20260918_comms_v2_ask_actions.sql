-- Handy Desk (18 Sep 2026): the ask agent's proposals, comms_v2_ask_actions.
--
-- Every change the ask agent wants to make (send a held draft, send a message, resend a quote link,
-- move a booking, start a call) is saved here first as a proposal: its kind, its exact arguments,
-- the exact preview Ben reads and a hash of it, and when it expires (15 minutes, or London
-- midnight, whichever is first). Nothing runs until the signed-in person confirms it through
-- POST /api/comms-v2/ask/actions/:id/confirm, which re-checks the preconditions and the preview
-- hash, runs the change through the desk's one sender or function, and writes the outcome back
-- here: who confirmed (`human:<email or user id>`, from the session), when, under which run id,
-- and the result. server/comms-v2/ask/actions.ts; server/scrub/plan.ts classifies every column.
--
-- A proposal moves only forward: proposed -> confirmed -> executed | refused, or proposed ->
-- cancelled | expired | refused. The confirm is a compare-and-set on status, so one action runs once.
--
-- Additive and idempotent. Apply with
--   npx tsx scripts/_apply-migration.ts migrations/20260918_comms_v2_ask_actions.sql
-- never db:push. Apply BEFORE deploying the code that writes it.

CREATE TABLE IF NOT EXISTS comms_v2_ask_actions (
    id            text PRIMARY KEY,
    session_id    text NOT NULL REFERENCES comms_v2_ask_sessions(id),
    message_id    text,
    ask_run_id    text,
    kind          text NOT NULL,
    case_file_id  text,
    args          jsonb NOT NULL,
    preview_text  text NOT NULL,
    preview_hash  text NOT NULL,
    proposed_by   text NOT NULL,
    proposed_at   timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    confirmed_by  text,
    confirmed_at  timestamptz,
    run_id        text,
    result        jsonb,
    status        text NOT NULL DEFAULT 'proposed',
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comms_v2_ask_actions_session ON comms_v2_ask_actions (session_id, proposed_at);
CREATE INDEX IF NOT EXISTS idx_comms_v2_ask_actions_open ON comms_v2_ask_actions (kind, case_file_id) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_comms_v2_ask_actions_ask_run ON comms_v2_ask_actions (ask_run_id);
