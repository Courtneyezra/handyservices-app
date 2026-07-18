import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main(){
  await db.execute(sql`UPDATE personalized_quotes SET view_count=0, viewed_at=NULL, deposit_paid_at=NULL, booked_at=NULL, deferred_line_items=NULL WHERE short_slug='faprev01'`);
  const after = await db.execute(sql`SELECT view_count, deposit_paid_at, booked_at FROM personalized_quotes WHERE short_slug='faprev01'`);
  console.log('after:', JSON.stringify(after.rows[0]));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
