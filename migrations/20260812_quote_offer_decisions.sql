-- Offer decision log — docs/OFFER_DECISION_PLAYBOOK.md §6 (v1 LOCKED 12 Aug 2026)
-- Append-only router decisions. Additive only; safe to run repeatedly.
-- Apply with: npx tsx scripts/_apply-offer-decisions-migration.ts
-- (NEVER drizzle db:push — schema is entangled; targeted DDL only.)

CREATE TABLE IF NOT EXISTS quote_offer_decisions (
    id            varchar PRIMARY KEY,
    quote_id      varchar NOT NULL,
    slug          varchar,
    decided_at    timestamp NOT NULL DEFAULT now(),
    moment        varchar NOT NULL DEFAULT 'first_view',
    inputs        jsonb,
    rule_fired    varchar NOT NULL,
    goal          varchar,
    target_play   varchar NOT NULL,
    served_play   varchar NOT NULL,
    rationale     text,
    decided_by    varchar NOT NULL DEFAULT 'rules',
    shadow_play      varchar,
    shadow_stakes    varchar,
    shadow_rationale text,
    shadow_model     varchar
);

CREATE INDEX IF NOT EXISTS idx_offer_decisions_quote ON quote_offer_decisions (quote_id);
CREATE INDEX IF NOT EXISTS idx_offer_decisions_decided_at ON quote_offer_decisions (decided_at);
