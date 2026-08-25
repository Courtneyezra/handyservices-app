import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const r = await db.execute(sql`
    UPDATE nudge_queue SET status = 'dismissed',
      reason = COALESCE(reason, '') || ' | DISMISSED by owner 15 Aug: customer messaged yesterday asking about wood/roofing specs (message not in our ingest — case-file blind spot) AND split lever invalid for an integral single-build job.'
    WHERE slug = 'g1dhem56' AND status = 'proposed'`);
  console.log('dismissed rows:', (r as any).rowCount);
  process.exit(0);
}
main();
