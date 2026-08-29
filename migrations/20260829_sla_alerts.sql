-- SLA breach alerts (per-lane escalation sweep, 29 Aug 2026 — T6b).
-- One OPEN row per (conversation, lane): the row is the idempotency claim that Ben was
-- already pinged for this lane episode, so the 15s sweep cannot re-ping every pass.
-- Written and resolved only by server/agents/sla-sweep.ts; nothing customer-facing here.
-- Additive only — creates one table, touches nothing else. Apply with a targeted run,
-- never db:push (shared production DB).

CREATE TABLE IF NOT EXISTS sla_alerts (
    id              varchar PRIMARY KEY NOT NULL,
    conversation_id varchar NOT NULL,
    lane            varchar(24) NOT NULL,        -- quote_ready | needs_ben | needs_info | visit_first (+ decline reserved for T6a)
    lane_entered_at timestamp NOT NULL,          -- when the lane verdict/flag was recorded (pins the episode)
    first_alert_at  timestamp NOT NULL DEFAULT now(),
    last_alert_at   timestamp NOT NULL DEFAULT now(),  -- reminder clock (at most one reminder/day while breached)
    alert_count     integer NOT NULL DEFAULT 1,
    resolved_at     timestamp,
    resolve_reason  varchar(80)                  -- lane_changed | lane_reentered | conversation_closed | ...
);

CREATE INDEX IF NOT EXISTS idx_sla_alerts_conversation ON sla_alerts (conversation_id);
-- One OPEN episode per (conversation, lane), enforced by the database, not by a
-- check-then-act read (see the 27 Aug 2026 triple-send post-mortem in comms-sweep.ts).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_alerts_open ON sla_alerts (conversation_id, lane)
    WHERE resolved_at IS NULL;
