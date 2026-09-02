-- Phase 3 of the comms rebuild ("Earn sending"), 3 Sep 2026. COMMS_AGENTS_V3_DESIGN §4/§5.
-- Earned autonomy lives in the database: pack_intent_tiers is the current tier per (pack, intent)
-- overlaid on the static launch defaults in server/spine/packs/*.ts; pack_tier_events is the
-- append-only log of every promotion / demotion with the evidence that decided it.
-- Additive and idempotent. Apply with a targeted run, never db:push.

CREATE TABLE IF NOT EXISTS pack_intent_tiers (
    pack_id     text NOT NULL,
    intent      text NOT NULL,
    tier        text NOT NULL,          -- READ | PROPOSE | DRAFT | SEND
    reason      text,
    changed_by  text,                   -- system:autonomy | human:<id>
    changed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (pack_id, intent)
);

CREATE TABLE IF NOT EXISTS pack_tier_events (
    id          text PRIMARY KEY,
    pack_id     text NOT NULL,
    intent      text NOT NULL,
    from_tier   text,
    to_tier     text NOT NULL,
    reason      text,
    evidence    jsonb,
    by          text NOT NULL,
    at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pack_tier_events_pack_at ON pack_tier_events (pack_id, intent, at DESC);
