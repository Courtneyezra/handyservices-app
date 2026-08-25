import { db } from '../server/db';
import { calls } from '../shared/schema';
import { and, gte, sql } from 'drizzle-orm';
async function main() {
  const start = new Date(); start.setHours(0,0,0,0);
  const totals = await db.select({ hb: calls.handledBy, n: sql<number>`count(*)` })
    .from(calls).where(gte(calls.startTime, start)).groupBy(calls.handledBy);
  console.log('TODAY by handledBy bucket:');
  totals.forEach(t => console.log(`  ${t.hb ?? 'NULL (unclassified)'}: ${t.n}`));
  const detail = await db.select({ hb: calls.handledBy, outcome: calls.outcome, missed: calls.missedReason, dur: calls.duration, tlen: sql<number>`length(coalesce(transcription,''))` })
    .from(calls).where(and(gte(calls.startTime, start), sql`${calls.handledBy} IS NULL`));
  console.log('\nUnclassified (handledBy NULL) calls detail:');
  detail.forEach(d => console.log(`  outcome=${d.outcome ?? '-'} missedReason=${d.missed ?? '-'} dur=${d.dur ?? '-'}s tlen=${d.tlen}`));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
