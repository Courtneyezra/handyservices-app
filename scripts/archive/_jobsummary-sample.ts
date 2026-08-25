import { db } from '../server/db';
import { calls } from '../shared/schema';
import { and, gte, isNotNull, sql } from 'drizzle-orm';
async function main() {
  const rows = await db.select({ name: calls.customerName, js: calls.jobSummary })
    .from(calls).where(and(gte(calls.startTime, new Date('2026-06-01')), isNotNull(calls.jobSummary), sql`length(job_summary) > 3`))
    .limit(20);
  rows.forEach(r => console.log(`${(r.name ?? '').padEnd(16)} | ${r.js}`));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
