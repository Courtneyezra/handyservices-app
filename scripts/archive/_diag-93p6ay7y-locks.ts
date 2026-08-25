import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const locks = await db.execute(sql`
    SELECT * FROM booking_slot_locks
    WHERE quote_id = 'quote_6vUOY1XkKFMmIkmNCyslk'
    ORDER BY created_at DESC
  `).catch((e: any) => ({ rows: [`locks error: ${e.message}`] }));
  console.log('--- booking_slot_locks ---');
  console.log(JSON.stringify(locks.rows, null, 2));

  const inv = await db.execute(sql`
    SELECT * FROM invoices WHERE quote_id = 'quote_6vUOY1XkKFMmIkmNCyslk'
  `).catch((e: any) => ({ rows: [`invoices error: ${e.message}`] }));
  console.log('--- invoices ---');
  console.log(JSON.stringify(inv.rows, null, 2));

  const who = await db.execute(sql`
    SELECT id, name, availability_status FROM handyman_profiles
    WHERE id IN ('95ef53b1-7cb2-4c22-ae15-097a24d65cc9','hp_aa21264a-9143-4116-bda2-2da998255929')
  `).catch((e: any) => ({ rows: [`profiles error: ${e.message}`] }));
  console.log('--- contractors ---');
  console.log(JSON.stringify(who.rows, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
