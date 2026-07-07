import { db } from '../server/db';
import { calls } from '../shared/schema';
import { isNotNull } from 'drizzle-orm';
async function main() {
  const rows = await db.select({ id: calls.id, name: calls.customerName, t: calls.transcription, handledBy: calls.handledBy, outcome: calls.outcome, dur: calls.duration })
    .from(calls).where(isNotNull(calls.aiScoredAt));
  rows.forEach(r => {
    console.log(`\n===== ${r.name} | handledBy=${r.handledBy} | outcome=${r.outcome} | ${r.dur}s | tlen=${(r.t ?? '').length} =====`);
    console.log((r.t ?? '').slice(0, 700));
  });
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
