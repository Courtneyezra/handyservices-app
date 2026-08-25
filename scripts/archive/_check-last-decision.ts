import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const r = await db.execute(sql.raw(
    "SELECT slug, rule_fired, target_play, served_play, inputs FROM quote_offer_decisions WHERE slug IN ('gji6qm2f','6ol1vcgh') ORDER BY decided_at DESC"
  ));
  for (const row of r.rows as any[]) console.log(row.slug, row.rule_fired, row.target_play, '→', row.served_play, JSON.stringify(row.inputs));
  process.exit(0);
}
main();
