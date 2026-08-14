/**
 * DDL: contractor_diary_items — non-job entries in a contractor's day
 * (first kind: quote_visit). Occupies real time, no payout/deposit ceremony.
 * Targeted DDL — NEVER db:push (entangled schema).
 *
 * Run: npx tsx scripts/create-diary-items.ts
 */
import { Pool } from 'pg';
import dns from 'dns';
import 'dotenv/config';

// Force IPv4 (matching db.ts pattern)
const originalLookup = dns.lookup;
(dns as any).lookup = (hostname: string, options: any, callback: any) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  } else if (!options) {
    options = {};
  }
  options.family = 4;
  return (originalLookup as any)(hostname, options, callback);
};

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!.replace('-pooler', ''),
    max: 3,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contractor_diary_items (
      id varchar PRIMARY KEY,
      contractor_id varchar NOT NULL,
      date date NOT NULL,
      slot varchar(8) NOT NULL DEFAULT 'am',
      start_time varchar(5),
      minutes integer NOT NULL DEFAULT 45,
      kind varchar(20) NOT NULL DEFAULT 'quote_visit',
      customer_name varchar NOT NULL,
      customer_phone varchar,
      address text,
      postcode varchar(12),
      notes text,
      status varchar(10) NOT NULL DEFAULT 'open',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contractor_diary_items_contractor_date
      ON contractor_diary_items (contractor_id, date)
  `);

  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'contractor_diary_items' ORDER BY ordinal_position`,
  );
  console.log('contractor_diary_items columns:');
  for (const r of rows) console.log(`  ${r.column_name}  ${r.data_type}`);
  console.log('DDL applied (table + index).');
  await pool.end();
})();
