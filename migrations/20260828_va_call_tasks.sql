-- VA call tasks (speed-to-lead calling on text-channel enquiries, 28 Aug 2026).
-- One open task per conversation: "ring this person within 15 working minutes".
-- Written by server/agents/va-call-tasks.ts; read by /api/va-call-tasks and the
-- comms sweep's expiry pass. Never sends anything to a customer itself.
-- Additive only — creates one table, touches nothing else. Apply with a
-- targeted run, never db:push (shared production DB).

CREATE TABLE IF NOT EXISTS va_call_tasks (
    id              varchar PRIMARY KEY NOT NULL,
    conversation_id varchar NOT NULL,
    phone           varchar NOT NULL,
    contact_name    varchar,
    channel         varchar(16) NOT NULL,
    reason          text,
    created_at      timestamp NOT NULL DEFAULT now(),
    due_at          timestamp NOT NULL,
    completed_at    timestamp,
    dismissed_at    timestamp,
    dismissed_by    varchar(60),
    dismiss_reason  varchar(80),
    notified_at     timestamp
);

CREATE INDEX IF NOT EXISTS idx_va_call_tasks_conversation ON va_call_tasks (conversation_id);
CREATE INDEX IF NOT EXISTS idx_va_call_tasks_due ON va_call_tasks (due_at);
-- One OPEN task per conversation, enforced by the database (no advisory
-- check-then-act — see the 27 Aug 2026 triple-send post-mortem in comms-sweep.ts).
CREATE UNIQUE INDEX IF NOT EXISTS uq_va_call_tasks_open ON va_call_tasks (conversation_id)
    WHERE completed_at IS NULL AND dismissed_at IS NULL;
