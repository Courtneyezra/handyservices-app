import { db } from '../server/db';
import { contractorAvailabilityDates } from '../shared/schema';
import { inArray, gte } from 'drizzle-orm';
import { toZonedTime, format as formatTz } from 'date-fns-tz';
import { addDays, startOfDay } from 'date-fns';

const UK_TZ = 'Europe/London';

async function main() {
  // 1. Raw DB entries
  const all = await db.select().from(contractorAvailabilityDates)
    .where(inArray(contractorAvailabilityDates.contractorId, [
      'hp_9e032a88-28bc-4398-80cb-267de3cfcdcc',
      'hp_aa21264a-9143-4116-bda2-2da998255929',
    ]));
  
  console.log('=== Raw DB entries for both contractors ===');
  all.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  all.forEach(r => {
    const raw = new Date(r.date);
    console.log(`${r.contractorId.substring(0,20)}… | raw=${raw.toISOString()} | ukDate=${formatTz(toZonedTime(raw, UK_TZ), 'yyyy-MM-dd', { timeZone: UK_TZ })} | avail=${r.isAvailable} | ${r.startTime}-${r.endTime}`);
  });

  // 2. What does the buildAvailabilityResponse window look like?
  const ukNow = toZonedTime(new Date(), UK_TZ);
  const ukToday = startOfDay(ukNow);
  console.log('\n=== Date Range ===');
  console.log('ukToday:', formatTz(ukToday, 'yyyy-MM-dd HH:mm', { timeZone: UK_TZ }), '(as UTC:', ukToday.toISOString(), ')');
  const rangeEnd = addDays(ukToday, 30);
  console.log('rangeEnd (+30d):', formatTz(rangeEnd, 'yyyy-MM-dd HH:mm', { timeZone: UK_TZ }), '(as UTC:', rangeEnd.toISOString(), ')');
  
  // 3. Check if July 6 and 7 are within range
  const jul6 = new Date('2026-07-06T00:00:00.000Z');
  const jul7 = new Date('2026-07-07T00:00:00.000Z');
  console.log('\nJuly 6 within range?', jul6 >= ukToday && jul6 <= rangeEnd);
  console.log('July 7 within range?', jul7 >= ukToday && jul7 <= rangeEnd);
  console.log('July 6 UK date string:', formatTz(toZonedTime(jul6, UK_TZ), 'yyyy-MM-dd', { timeZone: UK_TZ }));
  console.log('July 7 UK date string:', formatTz(toZonedTime(jul7, UK_TZ), 'yyyy-MM-dd', { timeZone: UK_TZ }));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
