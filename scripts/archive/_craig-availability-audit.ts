import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const id = 'hp_aa21264a-9143-4116-bda2-2da998255929';
  const overrides = await db.execute(sql`SELECT * FROM contractor_availability_dates WHERE contractor_id = ${id} AND date >= CURRENT_DATE ORDER BY date LIMIT 40`);
  const patterns = await db.execute(sql`SELECT day_of_week, is_active FROM handyman_availability WHERE handyman_id = ${id}`);
  const bookings = await db.execute(sql`SELECT scheduled_date::date AS d, scheduled_slot, assignment_status FROM contractor_booking_requests WHERE assigned_contractor_id = ${id} AND scheduled_date >= CURRENT_DATE ORDER BY scheduled_date LIMIT 40`);
  console.log('future overrides:', JSON.stringify(overrides.rows));
  console.log('weekly patterns:', JSON.stringify(patterns.rows));
  console.log('future bookings:', JSON.stringify(bookings.rows));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
