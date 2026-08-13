-- Gift-claim persistence (12 Aug 2026): record WHICH gift an accept picked and
-- pin a validated provisional claim to the quote so it survives a reload.
-- Additive only; safe to run repeatedly.
-- Apply with: npx tsx scripts/_apply-gift-claim-migration.ts
-- (NEVER drizzle db:push - schema is entangled; targeted DDL only.)

ALTER TABLE quote_offer_events ADD COLUMN IF NOT EXISTS gift_id varchar(100);

ALTER TABLE personalized_quotes ADD COLUMN IF NOT EXISTS claimed_gift_id varchar(100);
