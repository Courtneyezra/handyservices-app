-- P13 (6 Sep 2026): the job pack — ONE live record per quote from clerk to contractor.
--
--   job_packs        what a contractor at the door needs, structured, with one owner and one capture
--                    moment per field, carried unchanged to the job sheet. Not customer-facing (the
--                    quote's pricing_line_items are DERIVED from lines[]). Live: later thread messages
--                    file into job.* delivery fields with a change_log row; scope / sizes / spec / supply
--                    are a rescope (Scoper + Ben), never a silent edit. Dispatch reads it and never infers;
--                    a missing required field is a loud 422. Locked at dispatch (locked_at, dispatch_id).
--
--   lines jsonb      PackLine[]  (server/spine/job-pack.ts): lineId, title, evidence [{messageId,text}],
--                    mediaIds, detail, assumptions, exclusions, sizes, spec, supplyBy, procedure, category,
--                    minutesLow/Point/High, materials [{name,supplier,sku,size,qty,unitPricePence}], hazards,
--                    disposal, leadTime, pricePence/labourPence/materialsPence (Ben's, after confirm)
--   job jsonb        PackJob: accessMethod, accessCodes, onSiteContact {name,phone,role}, floor, hasLift,
--                    parkingDistance, occupied, pets, parkingPermit, prep, utilities, deliverySlot,
--                    doneLooksLike, accessNotes[]
--   required jsonb   string[] of field keys required for THIS job, derived from the lines
--   missing text[]   required minus known, recomputed on every write
--   change_log jsonb [{at, field, from, to, by, source}] append-only
--
-- Additive and idempotent. Apply with `npx tsx scripts/_apply-migration.ts migrations/20260906_job_packs.sql`,
-- never db:push. Apply BEFORE deploying the code that writes it.

CREATE TABLE IF NOT EXISTS job_packs (
    id              text PRIMARY KEY,
    quote_id        varchar NOT NULL,
    conversation_id varchar,
    intake_run_id   text,
    estimate_id     text,
    lines           jsonb NOT NULL DEFAULT '[]'::jsonb,
    job             jsonb NOT NULL DEFAULT '{}'::jsonb,
    required        jsonb NOT NULL DEFAULT '[]'::jsonb,
    missing         text[] NOT NULL DEFAULT '{}',
    change_log      jsonb NOT NULL DEFAULT '[]'::jsonb,
    locked_at       timestamptz,
    dispatch_id     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_packs_quote ON job_packs (quote_id);
CREATE INDEX IF NOT EXISTS idx_job_packs_conversation ON job_packs (conversation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_packs_dispatch ON job_packs (dispatch_id) WHERE dispatch_id IS NOT NULL;
