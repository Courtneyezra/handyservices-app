import { db } from "../server/db";
import { sql } from "drizzle-orm";
(async () => {
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_booking_requests_quote ON contractor_booking_requests (quote_id)`);
  const r: any = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE tablename='contractor_booking_requests' AND indexname='idx_booking_requests_quote'`);
  console.log("idx_booking_requests_quote present:", (r.rows ?? r).length > 0);
  process.exit(0);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
