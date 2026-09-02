-- P7 (4 Sep 2026): no reply may go out that was written before the customer's latest message.
-- Incident 2 Sep, thread 46a13bdb… (Janet): a draft asking for a measurement stayed pending while the
-- measurement photo arrived; the source dedupe blocked the fresh run and Ben was one tap from sending it.
--
--   message_drafts.based_on_inbound_id  the inbound message the draft was written against (the latest
--                                       non-quarantined inbound on the thread at queue time). Null on
--                                       rows written before this migration and on drafts with no thread.
--   message_drafts.held_reason          gains the value 'stale_by_inbound': approveAndSendDraft refused
--                                       to send because a newer inbound exists; the draft is back to
--                                       pending and a fresh run has been requested. (Existing values:
--                                       'due_expired'.) No DDL change: held_reason is free text.
--   approved_by = 'system:stale_by_inbound' on drafts REJECTED by supersedeStaleDrafts when a newer
--                                       inbound landed (agent sources only; the rules layer is untouched).
-- Additive and idempotent. Apply with `npx tsx scripts/_apply-migration.ts migrations/20260904_message_drafts_based_on_inbound.sql`,
-- never db:push. Apply BEFORE deploying the code that writes it (queueDraft inserts the column).

ALTER TABLE message_drafts ADD COLUMN IF NOT EXISTS based_on_inbound_id text;
CREATE INDEX IF NOT EXISTS idx_message_drafts_conversation_status ON message_drafts (conversation_id, status);
