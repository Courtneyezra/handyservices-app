-- 16 Sep 2026: every inbound email the new comms desk accepts is kept before Resend is answered.
--
-- The inbound email webhook (server/comms-v2/channels/email-inbound.ts) answered Resend 200 and then
-- handed the email to the desk without waiting. A hand-over that failed after that answer (a
-- database blip, the gateway refusing to build) lost the email for good: Resend does not retry a
-- 200. The captain's answer was "Separate safeguard": the route writes the email here first and
-- answers only once the row is written, and a retry hands each row to the desk until the desk has
-- it (server/comms-v2/channels/inbound-email-store.ts).
--
-- One row per received email, keyed by Resend's email id, so a redelivery never makes a second row.
-- `envelope` is the turn the desk reads (server/comms-v2/channels/envelope.ts): the sender, the
-- words, the subject and the paths of the downloaded photos. `status` is pending until the desk has
-- the email, then done; failed when every attempt is spent, and kept. `claim_id` and
-- `claimed_until` are one attempt's hold on the row, so two attempts never run at once.
--
-- Written on the database the intake's case file store opens (server/comms-v2/live-database.ts):
-- the Neon branch COMMS_V2_DATABASE_URL names until cutover. On production this only creates an
-- empty table and its index; nothing writes it while COMMS_V2_EMAIL_INBOUND is off.
--
-- Additive and idempotent. Apply with
--   npx tsx scripts/_apply-migration.ts migrations/20260916_comms_v2_inbound_emails.sql
-- never db:push. Apply BEFORE deploying the code that writes it.

CREATE TABLE IF NOT EXISTS comms_v2_inbound_emails (
    email_id         text PRIMARY KEY,
    envelope         jsonb NOT NULL,
    status           text NOT NULL DEFAULT 'pending',
    attempts         integer NOT NULL DEFAULT 0,
    next_attempt_at  timestamptz NOT NULL DEFAULT now(),
    claim_id         text,
    claimed_until    timestamptz,
    last_error       text,
    received_at      timestamptz NOT NULL DEFAULT now(),
    handed_at        timestamptz,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comms_v2_inbound_emails_due ON comms_v2_inbound_emails (next_attempt_at) WHERE status = 'pending';
