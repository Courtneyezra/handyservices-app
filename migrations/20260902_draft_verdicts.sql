-- Phase 1 / C of the comms rebuild (docs/COMMS_AGENTS_V3_DESIGN.md §4, §8): Ben's verdicts.
--
-- One row per human decision on a machine-drafted message: approve as-is, edit then approve,
-- or reject — each with a reason code. This is the evidence stream that promotes an intent to
-- SEND (§4: ≥ 30 verdicts / 30 days, unedited-approval ≥ 90%, zero 'unsafe') and demotes it.
-- Phase 3's morning sample reviews reuse the table with verdict 'sample_fine' / 'sample_not_fine'.
--
-- draft_id is varchar, not uuid: message_drafts.id is varchar (32-hex, no dashes) and a uuid
-- column could not hold it.

CREATE TABLE IF NOT EXISTS draft_verdicts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id       varchar NOT NULL,
    run_id         text NULL,
    verdict        text NOT NULL CHECK (verdict IN ('approve', 'edit', 'reject', 'sample_fine', 'sample_not_fine')),
    reason         text NULL CHECK (reason IS NULL OR reason IN ('fine', 'tone', 'wrong_move', 'unsafe', 'missing_info')),
    original_body  text NOT NULL,
    final_body     text NULL,
    "by"           text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draft_verdicts_created_at ON draft_verdicts (created_at);
CREATE INDEX IF NOT EXISTS idx_draft_verdicts_draft_id ON draft_verdicts (draft_id);

-- The body as first drafted, kept so "edit" can be told from "approve" at approval time.
-- Set by the first PATCH on a pending draft; null means never edited.
ALTER TABLE message_drafts ADD COLUMN IF NOT EXISTS original_body text NULL;
