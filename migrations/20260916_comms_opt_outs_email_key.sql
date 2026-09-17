-- 16 Sep 2026: the opt-out ledger matches on the email address as a second key.
--
-- comms_opt_outs was keyed on the phone number only, so a party with a phone and an email who
-- opted out of everything was still reachable by email. From this migration a row carries the
-- normalised email address (`optOutEmailKey` in server/opt-out.ts) beside the phone key, and a row
-- may carry either key alone: an opt-out that arrived against an email address has no phone to
-- key on. At least one of the two is always present.
--
-- On production this: adds the nullable column email_key, drops NOT NULL from phone_key (every
-- existing row keeps its phone key), adds the check that a row has at least one key, and adds an
-- index on email_key. No row is rewritten.
--
-- Additive and idempotent. Apply with
--   npx tsx scripts/_apply-migration.ts migrations/20260916_comms_opt_outs_email_key.sql
-- never db:push. Apply BEFORE deploying the code, which reads email_key on every ledger lookup,
-- not only when it writes one.

ALTER TABLE comms_opt_outs ADD COLUMN IF NOT EXISTS email_key varchar;

ALTER TABLE comms_opt_outs ALTER COLUMN phone_key DROP NOT NULL;

ALTER TABLE comms_opt_outs DROP CONSTRAINT IF EXISTS comms_opt_outs_has_key;

ALTER TABLE comms_opt_outs ADD CONSTRAINT comms_opt_outs_has_key CHECK (phone_key IS NOT NULL OR email_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_comms_opt_outs_email_key ON comms_opt_outs (email_key);
