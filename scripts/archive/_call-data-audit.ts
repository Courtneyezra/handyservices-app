import { db } from '../server/db';
import { calls } from '../shared/schema';
import { and, gte, lt, sql } from 'drizzle-orm';

async function main() {
  const jun = and(gte(calls.startTime, new Date('2026-06-01')), lt(calls.startTime, new Date('2026-07-01')));
  const [r] = await db.select({
    total: sql<number>`count(*)`,
    withTranscript: sql<number>`count(*) filter (where ${calls.transcription} is not null and length(${calls.transcription}) > 20)`,
    withSegments: sql<number>`count(*) filter (where ${calls.segments} is not null)`,
    withRecordingUrl: sql<number>`count(*) filter (where ${calls.recordingUrl} is not null)`,
    withInboundRec: sql<number>`count(*) filter (where ${calls.inboundRecordingUrl} is not null)`,
    withDuration: sql<number>`count(*) filter (where ${calls.duration} is not null and ${calls.duration} > 0)`,
    withJobSummary: sql<number>`count(*) filter (where ${calls.jobSummary} is not null)`,
    withDetectedSku: sql<number>`count(*) filter (where ${calls.detectedSkusJson} is not null)`,
    missed: sql<number>`count(*) filter (where ${calls.outcome} = 'MISSED_CALL' or ${calls.missedReason} is not null)`,
    avgDuration: sql<number>`round(avg(${calls.duration}) filter (where ${calls.duration} > 0))`,
  }).from(calls).where(jun);
  console.log('=== JUNE 2026 CALL DATA DENSITY ===');
  console.log(r);
  const outcomes = await db.select({ outcome: calls.outcome, n: sql<number>`count(*)` }).from(calls).where(jun).groupBy(calls.outcome);
  console.log('\nOutcomes:', outcomes);
  const missReasons = await db.select({ reason: calls.missedReason, n: sql<number>`count(*)` }).from(calls).where(and(jun, sql`${calls.missedReason} is not null`)).groupBy(calls.missedReason);
  console.log('Missed reasons:', missReasons);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
