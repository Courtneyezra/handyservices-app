-- Phase 1 of the comms rebuild ("See everything, never go silent"), 2 Sep 2026.
-- Due times on drafts and flags, so nothing can sit unanswered without a clock on it:
--   message_drafts.due_at     when a pending draft must have been acted on (4 office hours,
--                             Mon-Fri 08-18 Europe/London; set at queue time by server/message-drafts.ts)
--   message_drafts.held_reason why a pending draft is still pending after due ('due_expired' once the
--                             rules layer has sent the holding line; other markers reserved)
--   agent_questions.due_at    when a flag/question for Ben must have been answered (4 office hours;
--                             20 office minutes for callback_requested / urgent threads)
--   agent_questions.expired_at set by the rules layer when due_at passed unanswered and the customer
--                             got the holding line (server/agents/silence-breaker.ts)
-- Additive only. Apply with a targeted run, never db:push (shared production DB).

ALTER TABLE message_drafts  ADD COLUMN IF NOT EXISTS due_at      timestamptz;
ALTER TABLE message_drafts  ADD COLUMN IF NOT EXISTS held_reason text;
ALTER TABLE agent_questions ADD COLUMN IF NOT EXISTS due_at      timestamptz;
ALTER TABLE agent_questions ADD COLUMN IF NOT EXISTS expired_at  timestamptz;

-- The expiry sweep polls "pending and past due" / "open and past due" every 15s.
CREATE INDEX IF NOT EXISTS idx_message_drafts_due_pending
    ON message_drafts (due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_agent_questions_due_open
    ON agent_questions (due_at) WHERE expired_at IS NULL;
