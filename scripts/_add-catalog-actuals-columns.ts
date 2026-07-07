/**
 * One-off DDL: add learned-actuals columns to service_catalog (mirrors _add-day-rate-column.ts).
 * db:push is drift-blocked here, so apply additive columns via direct idempotent DDL.
 *   npx tsx scripts/_add-catalog-actuals-columns.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

(async () => {
  await db.execute(sql`ALTER TABLE service_catalog ADD COLUMN IF NOT EXISTS actual_minutes_per_unit integer;`);
  await db.execute(sql`ALTER TABLE service_catalog ADD COLUMN IF NOT EXISTS actual_sample_count integer NOT NULL DEFAULT 0;`);
  const r: any = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'service_catalog' AND column_name IN ('actual_minutes_per_unit','actual_sample_count')
    ORDER BY column_name`);
  console.log("service_catalog actuals columns present:", (r.rows ?? r).map((c: any) => c.column_name).join(", "));
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
