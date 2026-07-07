/**
 * One-off DDL: add the nullable `day_rate` (PENCE) column to handyman_profiles.
 *
 * db:push is blocked by unrelated schema drift, so we apply the additive column via
 * direct DDL (mirrors scripts/_create-quote-index.ts). Idempotent (IF NOT EXISTS).
 *
 *   npx tsx scripts/_add-day-rate-column.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

(async () => {
  await db.execute(sql`ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS day_rate integer;`);
  const r: any = await db.execute(sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'handyman_profiles' AND column_name = 'day_rate'
  `);
  const found = (r.rows ?? r);
  console.log("handyman_profiles.day_rate present:", found.length > 0, found[0] ?? "");
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
