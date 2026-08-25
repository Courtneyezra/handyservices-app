import { db } from '../server/db';
import { calls } from '../shared/schema';
import { and, gte, lt, isNotNull, sql } from 'drizzle-orm';
async function main() {
  const rows = await db.select({ name: calls.customerName, hb: calls.handledBy, score: calls.aiScoreJson })
    .from(calls)
    .where(and(isNotNull(calls.aiScoredAt), gte(calls.startTime, new Date('2026-06-01')), lt(calls.startTime, new Date('2026-07-01'))))
    .orderBy(sql`(ai_score_json->>'overall')::int DESC`);
  for (const r of rows) {
    const s: any = r.score;
    console.log(`\n===== ${r.name} [${r.hb}] — overall ${s.overall} =====`);
    console.log(`conversion ${s.dimensions.conversionBehaviour.score} (next step: ${s.dimensions.conversionBehaviour.nextStepSecured}) | discovery ${s.dimensions.discovery.score} | rapport ${s.dimensions.rapport.score} | accuracy ${s.dimensions.accuracy.score}`);
    console.log(`conversion evidence: "${s.dimensions.conversionBehaviour.evidence}"`);
    console.log(`coaching: ${s.coachingNote}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
