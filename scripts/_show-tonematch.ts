import { db } from '../server/db';
import { calls } from '../shared/schema';
import { and, gte, isNotNull, sql } from 'drizzle-orm';
async function main() {
  const rows = await db.select({ name: calls.customerName, s: calls.aiScoreJson })
    .from(calls)
    .where(and(isNotNull(calls.aiScoredAt), gte(calls.startTime, new Date('2026-07-01'))))
    .orderBy(sql`(ai_score_json->>'overall')::int DESC`).limit(3);
  rows.forEach(r => {
    const d: any = (r.s as any).dimensions;
    console.log(`\n${r.name} — overall ${(r.s as any).overall} | rapport ${d.rapport.score} | toneMatch ${d.rapport.toneMatch?.score}`);
    console.log(`  tone evidence: "${d.rapport.toneMatch?.evidence}"`);
  });
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
