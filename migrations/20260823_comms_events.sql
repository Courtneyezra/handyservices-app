-- Comms event ledger (COMMS_ARCHITECTURE verdict, 23 Aug 2026).
-- Append-only union of communication events across audiences, with three-hand attribution.
-- Populated by server/comms-ledger.ts; idempotent on (ref_table, ref_id, event_type).
-- Additive only — creates one table, touches nothing else. Apply with a targeted run, never db:push.

CREATE TABLE IF NOT EXISTS comms_events (
    id              varchar PRIMARY KEY NOT NULL,
    occurred_at     timestamp NOT NULL,
    event_type      varchar(24) NOT NULL,
    channel         varchar(16) NOT NULL,
    phone           varchar NOT NULL,
    role_profile    varchar(16) NOT NULL DEFAULT 'customer',
    conversation_id varchar,
    job_ref         varchar,
    actor           varchar(60) NOT NULL,
    drafted_by      varchar(60),
    edited_by       varchar(60),
    sent_by         varchar(60),
    body            text,
    ref_table       varchar(32) NOT NULL,
    ref_id          varchar NOT NULL,
    meta            jsonb,
    created_at      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_comms_events_ref ON comms_events (ref_table, ref_id, event_type);
CREATE INDEX IF NOT EXISTS idx_comms_events_phone_time ON comms_events (phone, occurred_at);
CREATE INDEX IF NOT EXISTS idx_comms_events_type_time ON comms_events (event_type, occurred_at);
