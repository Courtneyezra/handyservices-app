import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { resolveQuoteCandidatePoolForQuote } from '../server/lib/quote-fit';
import { eq, or, and, gte, lte, inArray } from 'drizzle-orm';
import { contractorAvailabilityDates, handymanAvailability, contractorBookingRequests, bookingSlotLocks, masterBlockedDates } from '../shared/schema';
import { toZonedTime, format as formatTz } from 'date-fns-tz';
import { addDays, getDay, startOfDay, isBefore, parseISO } from 'date-fns';
import { timeRangeCoversSlot } from '../shared/slot-times';

const UK_TZ = 'Europe/London';

async function main() {
  const quote = await db.query.personalizedQuotes.findFirst({
    where: or(eq(personalizedQuotes.shortSlug, 'vqb49nhc'), eq(personalizedQuotes.id, 'vqb49nhc'))
  });
  if (!quote) { console.log('Quote not found'); process.exit(1); }

  const fit = await resolveQuoteCandidatePoolForQuote(quote);
  const contractorIds = fit.candidates.map(c => c.contractorId);
  console.log('Candidates:', contractorIds);

  const slot = 'am'; // test with 'am'
  const ukNow = toZonedTime(new Date(), UK_TZ);
  const ukToday = startOfDay(ukNow);
  const rangeStart = ukToday;
  const rangeEnd = addDays(ukToday, 30);
  
  const rangeStartStr = formatTz(rangeStart, 'yyyy-MM-dd', { timeZone: UK_TZ });
  const rangeEndStr = formatTz(rangeEnd, 'yyyy-MM-dd', { timeZone: UK_TZ });
  console.log(`Range: ${rangeStartStr} → ${rangeEndStr}`);
  console.log(`rangeStart UTC: ${rangeStart.toISOString()}`);
  console.log(`rangeEnd UTC: ${rangeEnd.toISOString()}`);

  const [dateOverrides, weeklyPatterns, masterBlocked] = await Promise.all([
    db.select().from(contractorAvailabilityDates).where(and(
      inArray(contractorAvailabilityDates.contractorId, contractorIds),
      gte(contractorAvailabilityDates.date, rangeStart),
      lte(contractorAvailabilityDates.date, rangeEnd)
    )),
    db.select().from(handymanAvailability).where(and(
      inArray(handymanAvailability.handymanId, contractorIds),
      eq(handymanAvailability.isActive, true)
    )),
    db.select().from(masterBlockedDates).where(and(
      gte(masterBlockedDates.date, rangeStartStr),
      lte(masterBlockedDates.date, rangeEndStr)
    )),
  ]);

  console.log(`\nDate overrides fetched: ${dateOverrides.length}`);
  dateOverrides.forEach(o => console.log(`  ${o.contractorId.substring(0,20)} | ${new Date(o.date).toISOString().split('T')[0]} | avail=${o.isAvailable}`));
  console.log(`Weekly patterns: ${weeklyPatterns.length}`);
  console.log(`Blocked dates: ${masterBlocked.length}`);

  const blockedDateSet = new Set(masterBlocked.map(b => String(b.date)));
  const overrideMap = new Map<string, any>();
  for (const o of dateOverrides) {
    const dateStr = new Date(o.date).toISOString().split('T')[0];
    overrideMap.set(`${o.contractorId}-${dateStr}`, o);
    console.log(`  overrideMap key: ${o.contractorId.substring(0,20)}-${dateStr}`);
  }

  // Simulate checking July 6 and July 7
  const checkDates = ['2026-07-06', '2026-07-07'];
  for (const ds of checkDates) {
    const checkDate = new Date(ds + 'T00:00:00Z');
    const dayOfWeek = getDay(toZonedTime(checkDate, UK_TZ));
    console.log(`\n--- ${ds} (dayOfWeek=${dayOfWeek}) ---`);
    if (blockedDateSet.has(ds)) { console.log('BLOCKED'); continue; }
    
    for (const cId of contractorIds) {
      const overrideKey = `${cId}-${ds}`;
      const override = overrideMap.get(overrideKey);
      console.log(`  Contractor ${cId.substring(0,20)}: override=${JSON.stringify(override ? { avail: override.isAvailable, start: override.startTime, end: override.endTime } : null)}`);
      if (override) {
        const covers = override.isAvailable ? timeRangeCoversSlot(override.startTime, override.endTime, slot) : false;
        console.log(`    covers ${slot}: ${covers}`);
      }
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
