-- Recovery-agent nudge queue (14 Aug 2026). Additive only; safe to re-run.
-- Apply with: npx tsx scripts/_apply-nudge-queue-migration.ts
-- (NEVER drizzle db:push - schema is entangled; targeted DDL only.)

CREATE TABLE IF NOT EXISTS nudge_queue (
    id          varchar PRIMARY KEY,
    quote_id    varchar NOT NULL,
    slug        varchar,
    phone       varchar,
    status      varchar(20) NOT NULL DEFAULT 'proposed',
    lever       varchar(30),
    message     text,
    reason      text,
    send_after  timestamp,
    agent_run   varchar,
    created_at  timestamp NOT NULL DEFAULT now(),
    approved_at timestamp,
    sent_at     timestamp
);

CREATE INDEX IF NOT EXISTS idx_nudge_queue_quote ON nudge_queue (quote_id);
CREATE INDEX IF NOT EXISTS idx_nudge_queue_status ON nudge_queue (status);
CREATE INDEX IF NOT EXISTS idx_nudge_queue_created ON nudge_queue (created_at);
