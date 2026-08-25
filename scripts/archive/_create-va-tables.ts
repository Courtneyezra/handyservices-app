import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS va_endpoints (
      id varchar PRIMARY KEY NOT NULL,
      user_id varchar REFERENCES users(id),
      sip_address varchar NOT NULL,
      display_name varchar(100),
      active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_va_endpoints_sip ON va_endpoints (sip_address)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS va_shifts (
      id varchar PRIMARY KEY NOT NULL,
      va_endpoint_id varchar REFERENCES va_endpoints(id),
      day_of_week integer NOT NULL,
      start_minute integer NOT NULL,
      end_minute integer NOT NULL,
      created_at timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_va_shifts_endpoint ON va_shifts (va_endpoint_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_va_shifts_day ON va_shifts (day_of_week)`);
  const r = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_name IN ('va_endpoints','va_shifts')`);
  console.log('Tables present:', (r as any).rows?.map((x:any)=>x.table_name));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
