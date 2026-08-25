import { db } from '../server/db';
import { calls } from '../shared/schema';
import { and, gte, isNotNull, sql } from 'drizzle-orm';
async function main() {
  const scored = await db.select({
    name: calls.customerName,
    captured: sql<boolean>`(ai_score_json->'dimensions'->'discovery'->'captured'->>'name')::boolean`,
    t: calls.transcription,
  }).from(calls).where(and(isNotNull(calls.aiScoredAt), gte(calls.startTime, new Date('2026-06-01'))));

  const generic = (n: string | null) => !n || /^(voice caller|unknown caller|unknown)$/i.test(n.trim());
  const genericCount = scored.filter(r => generic(r.name)).length;
  const genericButCaptured = scored.filter(r => generic(r.name) && r.captured).length;
  console.log(`Scored calls (Jun+): ${scored.length}`);
  console.log(`  Generic placeholder name: ${genericCount}`);
  console.log(`  ...of which scorer says name WAS captured on the call: ${genericButCaptured}`);
  console.log('\nExamples (generic name, but caller stated a name in transcript):');
  scored.filter(r => generic(r.name) && r.captured).slice(0, 5).forEach(r => {
    const m = (r.t ?? '').match(/(my name is|i'm|this is|it's)\s+([A-Z][a-z]+(\s+[A-Z][a-z]+)?)/i);
    console.log(`  "${r.name}" — transcript hint: ${m ? m[0] : '(name present, no simple pattern)'}`);
  });
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
