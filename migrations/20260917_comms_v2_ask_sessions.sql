-- Handy Desk (17 Sep 2026): the comms-v2 ask agent's sessions and messages.
--
-- Ben asks the new desk a question from the Handy Desk ask bar (server/comms-v2/ask/). One session
-- per admin per London day; every ask and every answer is a message row. An assistant row carries
-- the run's lean transcript (LeanRunStep[]) and its OpsAnswer (shared/ops-types.ts), the typed
-- surface the desk renders. Kept apart from ops_sessions/ops_messages, which belong to the old Ops
-- Manager and retire with it.
--
-- Nothing here is a customer message: the agent's only customer-facing write is a draft on a case
-- file's hold (comms_v2_case_files), which a person sends through the board's human send path.
-- server/scrub/plan.ts classifies every column below.
--
-- Additive and idempotent. Apply with
--   npx tsx scripts/_apply-migration.ts migrations/20260917_comms_v2_ask_sessions.sql
-- never db:push. Apply BEFORE deploying the code that writes it.

CREATE TABLE IF NOT EXISTS comms_v2_ask_sessions (
    id          text PRIMARY KEY,
    title       text NOT NULL,
    created_by  text NOT NULL,
    day         text NOT NULL,
    status      text NOT NULL DEFAULT 'active',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comms_v2_ask_sessions_owner_day ON comms_v2_ask_sessions (created_by, day);

CREATE TABLE IF NOT EXISTS comms_v2_ask_messages (
    id           text PRIMARY KEY,
    session_id   text NOT NULL REFERENCES comms_v2_ask_sessions(id),
    role         text NOT NULL,
    content      text NOT NULL,
    via          text,
    ask_context  jsonb,
    run_id       text,
    transcript   jsonb,
    answer       jsonb,
    usage        jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comms_v2_ask_messages_session ON comms_v2_ask_messages (session_id, created_at);
