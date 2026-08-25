import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const check = await db.execute(sql.raw(
    "SELECT short_slug, customer_name, phone, created_at::date AS created, deposit_paid_at, base_price FROM personalized_quotes WHERE short_slug IN ('kjh5wget','vvkfdht2')"
  ));
  console.log('to delete:', JSON.stringify(check.rows, null, 1));
  for (const r of check.rows as any[]) {
    if (r.deposit_paid_at) { console.error('ABORT: ' + r.short_slug + ' has a paid deposit — not deleting'); process.exit(1); }
  }
  const ids = await db.execute(sql.raw("SELECT id FROM personalized_quotes WHERE short_slug IN ('kjh5wget','vvkfdht2')"));
  const idList = (ids.rows as any[]).map(r => `'${r.id}'`).join(',');
  if (!idList) { console.log('nothing to delete'); process.exit(0); }
  const e = await db.execute(sql.raw(`DELETE FROM quote_offer_events WHERE quote_id IN (${idList})`));
  const d = await db.execute(sql.raw(`DELETE FROM quote_offer_decisions WHERE quote_id IN (${idList})`));
  const q = await db.execute(sql.raw(`DELETE FROM personalized_quotes WHERE id IN (${idList})`));
  console.log('deleted — events:', (e as any).rowCount, '| decisions:', (d as any).rowCount, '| quotes:', (q as any).rowCount);
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
