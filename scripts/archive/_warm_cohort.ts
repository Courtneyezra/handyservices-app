import { db } from "../server/db";
import { sql } from "drizzle-orm";

function normPhone(p: string | null): string {
  if (!p) return '';
  let s = p.replace(/[^0-9+]/g, '');
  if (s.startsWith('0')) s = '+44' + s.slice(1);
  if (s.startsWith('44')) s = '+' + s;
  return s;
}

async function main() {
  const rows = await db.execute(sql`
    SELECT customer_name, phone, segment, base_price,
           created_at::date AS created,
           viewed_at, view_count, deposit_paid_at
    FROM personalized_quotes
    WHERE created_at >= '2026-04-01' AND created_at < '2026-06-01'
      AND (viewed_at IS NOT NULL OR view_count > 0)
      AND deposit_paid_at IS NULL
    ORDER BY base_price DESC NULLS LAST
  `);
  const data = rows.rows as any[];
  console.log(`viewed-but-unpaid Apr+May: ${data.length} rows`);
  console.log(`(base_price sanity — first raw value: ${data[0]?.base_price})`);
  console.log('');
  for (const r of data) {
    const pounds = r.base_price ? `£${Math.round(r.base_price/100)}` : '—';
    console.log(`${pounds.padStart(6)} | ${String(r.segment||'').padEnd(11)} | ${r.created} | v:${String(r.view_count||0).padStart(2)} | ${normPhone(r.phone).padEnd(15)} | ${r.customer_name||''}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
