import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const r = await db.execute(sql.raw(
    "SELECT slug, rule_fired, target_play, served_play, shadow_play, shadow_stakes, left(shadow_rationale, 90) AS shadow_why FROM quote_offer_decisions ORDER BY decided_at DESC LIMIT 5"
  ));
  console.table(r.rows);
  process.exit(0);
}
main();
