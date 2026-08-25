import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const r = await db.execute(sql`select column_name from information_schema.columns where table_name = 'calls' and column_name in ('ring_seconds','handled_by','handled_by_user_id','ai_score_json','ai_scored_at')`);
  console.log('Found columns:', (r as any).rows?.map((x: any) => x.column_name) ?? r);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
