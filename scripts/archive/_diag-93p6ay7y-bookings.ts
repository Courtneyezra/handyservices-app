import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const req = await db.execute(sql`
    SELECT *
    FROM contractor_booking_requests
    WHERE quote_id = 'quote_6vUOY1XkKFMmIkmNCyslk'
       OR scheduled_date::date = '2026-07-10'
    ORDER BY created_at DESC
  `);
  console.log('--- contractor_booking_requests (quote OR 2026-07-10) ---');
  console.log(JSON.stringify(req.rows, null, 2));

  const v2 = await db.execute(sql`
    SELECT * FROM v2_bookings WHERE quote_id = 'quote_6vUOY1XkKFMmIkmNCyslk' OR scheduled_date::date = '2026-07-10' ORDER BY created_at DESC
  `).catch((e: any) => ({ rows: [`v2_bookings error: ${e.message}`] }));
  console.log('--- v2_bookings ---');
  console.log(JSON.stringify(v2.rows, null, 2));

  const inv = await db.execute(sql`
    SELECT id, quote_id, status, total_pence, deposit_pence, created_at
    FROM invoices WHERE quote_id = 'quote_6vUOY1XkKFMmIkmNCyslk'
  `).catch((e: any) => ({ rows: [`invoices error: ${e.message}`] }));
  console.log('--- invoices ---');
  console.log(JSON.stringify(inv.rows, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
