-- Build plan v2, item 3.4 (8 Sep 2026): the knowledge base — the place Ben writes what is true
-- about the business, and the only place a factual answer to a customer may come from.
--
-- WHY THE SHAPE. A later item (3.2) makes a factual answer BE the approved words of an entry,
-- selected verbatim, not the model's paraphrase of them. The s10 review established that nothing
-- in this codebase can check whether a claim about the business is true, so the entry is not a
-- hint to the model: it is the sentence that gets sent. Everything below follows from that.
--
--   kind            'answer'   an entry with words that may be sent verbatim once reviewed.
--                   'question' an OPEN QUESTION for Ben, never an answer and never sendable.
--                              The website says things the desk's rules forbid (a free quote, no
--                              call-out charge, Gas Safe engineers, a no-charge fix); those are
--                              seeded as questions so Ben resolves the conflict rather than the
--                              desk inheriting it (review s29 finding 1.19).
--   approved_words  what may be SENT, word for word. Empty on a question, by CHECK.
--   banned_words    phrases that must never be used on this topic (the website's own wording,
--                   the brand-voice ban list) — read by the review screen and by 3.2 later.
--   status          'unreviewed' (the seed lands here) | 'reviewed' (Ben has said yes; the ONLY
--                   status the customer-facing accessor returns) | 'retired' (never again).
--   reviewed_by     human:<id> — always a person. reviewed_at goes with it.
--   ben_note        on a question, the conflict itself (required). On an answer, what to check.
--   id              the stable citation id a reply cites. A readable slug, not a uuid, so a run
--                   record and a Pushover both read as English.
--
-- THE RAILS ARE IN THE TABLE, not only in the accessor:
--   * a reviewed row must be an answer AND must have words — a blank or a question can never be
--     'reviewed', so no reachable path can turn one into something sendable;
--   * a question can never carry approved words at all;
--   * a reviewed row must name who reviewed it and when.
--
-- Additive and idempotent. Apply with
--   npx tsx scripts/_apply-migration.ts migrations/20260908_kb_entries.sql
-- never db:push. Apply BEFORE deploying the code that reads it. Seed with
--   npx tsx scripts/seed-knowledge-base.ts

CREATE TABLE IF NOT EXISTS kb_entries (
    id             text PRIMARY KEY,
    kind           text NOT NULL DEFAULT 'answer',
    topic          text NOT NULL,
    approved_words text NOT NULL DEFAULT '',
    banned_words   text[] NOT NULL DEFAULT '{}',
    status         text NOT NULL DEFAULT 'unreviewed',
    reviewed_by    text,
    reviewed_at    timestamptz,
    ben_note       text,
    source_note    text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The vocabulary. Anything else is not a knowledge-base row.
ALTER TABLE kb_entries DROP CONSTRAINT IF EXISTS kb_entries_kind_check;
ALTER TABLE kb_entries ADD CONSTRAINT kb_entries_kind_check
    CHECK (kind IN ('answer', 'question'));

ALTER TABLE kb_entries DROP CONSTRAINT IF EXISTS kb_entries_status_check;
ALTER TABLE kb_entries ADD CONSTRAINT kb_entries_status_check
    CHECK (status IN ('unreviewed', 'reviewed', 'retired'));

-- A reviewed row is an answer with words, reviewed by a named person at a known time. This is the
-- rail: it makes "an unreviewed entry reached a customer" and "an empty entry was sent" unreachable
-- from any code path, present or future, not just from the accessor written today.
ALTER TABLE kb_entries DROP CONSTRAINT IF EXISTS kb_entries_reviewed_check;
ALTER TABLE kb_entries ADD CONSTRAINT kb_entries_reviewed_check
    CHECK (
        status <> 'reviewed'
        OR (kind = 'answer'
            AND btrim(approved_words) <> ''
            AND reviewed_by IS NOT NULL
            AND reviewed_at IS NOT NULL)
    );

-- A question is a question for Ben. It carries no words that could ever be sent, and it says what
-- the conflict is.
ALTER TABLE kb_entries DROP CONSTRAINT IF EXISTS kb_entries_question_check;
ALTER TABLE kb_entries ADD CONSTRAINT kb_entries_question_check
    CHECK (kind <> 'question' OR (btrim(approved_words) = '' AND btrim(coalesce(ben_note, '')) <> ''));

-- The customer-facing read: reviewed answers only, newest review first.
CREATE INDEX IF NOT EXISTS idx_kb_entries_reviewed
    ON kb_entries (reviewed_at DESC) WHERE status = 'reviewed' AND kind = 'answer';
-- The admin page: everything, questions and unreviewed first in the page's own order.
CREATE INDEX IF NOT EXISTS idx_kb_entries_status ON kb_entries (status, updated_at DESC);
