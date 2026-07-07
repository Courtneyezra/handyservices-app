import { db } from '../server/db';
import { calls } from '../shared/schema';
import { and, gte, lt, eq, inArray, sql } from 'drizzle-orm';
async function main() {
  const june = and(gte(calls.startTime, new Date('2026-06-01')), lt(calls.startTime, new Date('2026-07-01')));
  const rows = await db.select({ name: calls.customerName, hb: calls.handledBy, dur: calls.duration, t: calls.transcription })
    .from(calls)
    .where(and(june, inArray(calls.handledBy, ['missed', 'voicemail'])))
    .orderBy(sql`length(transcription) DESC NULLS LAST`)
    .limit(6);
  console.log('=== LONGEST transcripts now classified missed/voicemail (top 6) ===');
  rows.forEach(r => {
    console.log(`\n--- ${r.name} | ${r.hb} | ${r.dur}s | tlen=${(r.t ?? '').length}`);
    console.log((r.t ?? '').slice(0, 500));
  });
  const vaLeft = await db.select({ name: calls.customerName, dur: calls.duration, tlen: sql<number>`length(transcription)` })
    .from(calls).where(and(june, eq(calls.handledBy, 'va')));
  console.log('\n=== Remaining va rows ===');
  vaLeft.forEach(r => console.log(`  ${r.name} ${r.dur}s tlen=${r.tlen}`));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
