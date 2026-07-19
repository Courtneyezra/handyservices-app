import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main(){
  await db.execute(sql`UPDATE personalized_quotes SET view_count=0, viewed_at=NULL, deposit_paid_at=NULL, booked_at=NULL WHERE short_slug='paytest1'`);
  console.log('paytest1 reset');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
