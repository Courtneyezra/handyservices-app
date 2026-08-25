import { db } from '../server/db';
import { calls } from '../shared/schema';
import { and, gte, lt, isNotNull, sql } from 'drizzle-orm';
async function main() {
  const r = await db.update(calls)
    .set({ aiScoreJson: null, aiScoredAt: null })
    .where(and(isNotNull(calls.aiScoredAt), gte(calls.startTime, new Date('2026-06-01')), lt(calls.startTime, new Date('2026-07-01'))));
  console.log('cleared v1 scorecards');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
