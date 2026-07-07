// Adds personalized_quotes.slot_offer (jsonb, nullable) — the customer slot-offer handshake.
// Run directly (db:push is drift-blocked); idempotent.
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

(async () => {
  await db.execute(sql`ALTER TABLE personalized_quotes ADD COLUMN IF NOT EXISTS slot_offer jsonb;`);
  // Partial index so the dispatch soft-hold / awaiting-customer queries are fast.
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pq_slot_offer_status ON personalized_quotes ((slot_offer->>'status')) WHERE slot_offer IS NOT NULL;`);
  const r: any = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name='personalized_quotes' AND column_name='slot_offer';`);
  console.log('slot_offer column present:', (r.rows ?? r).length > 0);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
