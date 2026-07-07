import { db } from '../server/db';
import { calls } from '../shared/schema';
import { and, gte, lt, sql } from 'drizzle-orm';
async function main() {
  const june = and(gte(calls.startTime, new Date('2026-06-01')), lt(calls.startTime, new Date('2026-07-01')));
  const dist = await db.select({ hb: calls.handledBy, n: sql<number>`count(*)`, scored: sql<number>`count(*) filter (where ai_scored_at is not null)` })
    .from(calls).where(june).groupBy(calls.handledBy);
  console.log('June handledBy distribution (scored):');
  dist.forEach(d => console.log(`  ${d.hb ?? 'null'}: ${d.n} (${d.scored} scored)`));
  const scored = await db.select({ name: calls.customerName, hb: calls.handledBy, overall: sql<number>`(ai_score_json->>'overall')::int` })
    .from(calls).where(and(june, sql`ai_scored_at is not null`));
  console.log('\nScored so far:');
  scored.forEach(s => console.log(`  ${s.name} [${s.hb}] — ${s.overall}`));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
