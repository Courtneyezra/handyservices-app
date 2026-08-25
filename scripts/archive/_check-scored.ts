import { db } from '../server/db';
import { calls } from '../shared/schema';
import { and, gte, lt, sql, isNotNull } from 'drizzle-orm';
async function main() {
  const rows = await db.select({
    name: calls.customerName, phone: calls.phoneNumber, start: calls.startTime,
    overall: sql<number>`(ai_score_json->>'overall')::int`,
    note: sql<string>`ai_score_json->>'coachingNote'`,
  }).from(calls).where(and(isNotNull(calls.aiScoredAt), gte(calls.startTime, new Date('2026-06-01')), lt(calls.startTime, new Date('2026-07-01'))));
  console.log(`Persisted scorecards: ${rows.length}`);
  rows.forEach(r => console.log(`  ${r.start?.toISOString().slice(0,10)} ${r.name ?? r.phone} — overall ${r.overall}`));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
