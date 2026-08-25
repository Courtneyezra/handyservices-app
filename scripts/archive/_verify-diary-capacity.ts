/**
 * Verification: reserveSlot must count OPEN diary items' minutes.
 * Craig has a 45min quote_visit on Mon 2026-08-17 AM (TEST item).
 *  - fat job (~230min) on Mon AM  → must FAIL the fit gates
 *  - small job (~60min) on Mon AM → must SUCCEED (lock released after)
 * Test quotes are cloned from a real coord-bearing quote, id test_q_*, and
 * deleted afterwards. No booking is ever confirmed.
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { reserveSlot, releaseSlot } from '../server/booking-engine';
import { composeScheduleMinutes } from '../shared/schedule-composition';

const CRAIG = 'hp_aa21264a-9143-4116-bda2-2da998255929';
const SRC = 'quote_CvKK6MGyU0JmnmwM0-Kye'; // NG1 5FS, has coordinates

function lines(mins: number) {
  return JSON.stringify([{
    description: 'TEST diary capacity check',
    verifiedMinutes: mins,
    setupMinutes: 0,
    cleanupMinutes: 0,
    materialCollectionMinutes: 0,
  }]);
}

async function makeQuote(id: string, mins: number) {
  await db.execute(sql`delete from personalized_quotes where id = ${id}`);
  await db.execute(sql.raw(`
    create temp table _tq as select * from personalized_quotes where id = '${SRC}';
    update _tq set id = '${id}',
      short_slug = '${id.slice(-8)}', tenant_booking_token = null,
      customer_name = 'TEST QA diary',
      phone = '07700900123',
      pricing_line_items = '${lines(mins)}'::jsonb,
      deferred_line_items = null,
      deposit_paid_at = null,
      booked_at = null;
    insert into personalized_quotes select * from _tq;
    drop table _tq;
  `));
  const composed = composeScheduleMinutes(JSON.parse(lines(mins)) as any, {});
  console.log(`[setup] ${id}: composed schedule minutes = ${composed.totalMinutes}`);
}

async function main() {
  const monday = new Date('2026-08-17T09:00:00');

  await makeQuote('test_q_diary_fat', 230);
  await makeQuote('test_q_diary_small', 60);

  console.log('\n--- FAT (230min) on Mon AM: expect FAIL ---');
  const fat = await reserveSlot({ quoteId: 'test_q_diary_fat', scheduledDate: monday, scheduledSlot: 'am', candidateContractorIds: [CRAIG] });
  console.log('fat result:', JSON.stringify(fat));
  if (fat.success && fat.lockId) { await releaseSlot(fat.lockId); console.log('!! unexpected success — lock released'); }

  console.log('\n--- SMALL (60min) on Mon AM: expect SUCCESS ---');
  const small = await reserveSlot({ quoteId: 'test_q_diary_small', scheduledDate: monday, scheduledSlot: 'am', candidateContractorIds: [CRAIG] });
  console.log('small result:', JSON.stringify(small));
  if (small.success && small.lockId) { await releaseSlot(small.lockId); console.log('lock released — no booking confirmed'); }

  // Cleanup: test quotes + any stray locks for them
  await db.execute(sql`delete from booking_slot_locks where quote_id in ('test_q_diary_fat','test_q_diary_small')`);
  await db.execute(sql`delete from personalized_quotes where id in ('test_q_diary_fat','test_q_diary_small')`);
  console.log('\n[cleanup] test quotes + locks deleted');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
