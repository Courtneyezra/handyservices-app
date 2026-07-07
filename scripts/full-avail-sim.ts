import { db } from '../server/db';
import { personalizedQuotes, contractorAvailabilityDates, handymanAvailability, contractorBookingRequests, bookingSlotLocks, masterBlockedDates } from '../shared/schema';
import { resolveQuoteCandidatePoolForQuote } from '../server/lib/quote-fit';
import { eq, or, and, gte, lte, inArray } from 'drizzle-orm';
import { toZonedTime, format as formatTz } from 'date-fns-tz';
import { addDays, getDay, startOfDay, isBefore } from 'date-fns';
import { timeRangeCoversSlot } from '../shared/slot-times';

const UK_TZ = 'Europe/London';

async function main() {
  const quote = await db.query.personalizedQuotes.findFirst({
    where: or(eq(personalizedQuotes.shortSlug, 'vqb49nhc'), eq(personalizedQuotes.id, 'vqb49nhc'))
  });
  if (!quote) { console.log('Quote not found'); process.exit(1); }

  const fit = await resolveQuoteCandidatePoolForQuote(quote);
  const contractorIds = fit.candidates.map(c => c.contractorId);

  // Simulate server (using UTC as prod server would)
  // Force UTC behavior
  const nowUTC = new Date();
  const ukNow = toZonedTime(nowUTC, UK_TZ);
  const ukToday = startOfDay(ukNow);
  const rangeStart = ukToday;
  const rangeEnd = addDays(ukToday, 30);
  const totalDays = 31;
  const slot = 'am';
  
  const rangeStartStr = formatTz(rangeStart, 'yyyy-MM-dd', { timeZone: UK_TZ });
  const rangeEndStr = formatTz(rangeEnd, 'yyyy-MM-dd', { timeZone: UK_TZ });
  console.log(`Range: ${rangeStartStr} → ${rangeEndStr}`);

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

  const blockedDateSet = new Set(masterBlocked.map(b => String(b.date)));
  const overrideMap = new Map<string, any>();
  for (const o of dateOverrides) {
    const ds = new Date(o.date).toISOString().split('T')[0];
    overrideMap.set(`${o.contractorId}-${ds}`, o);
  }
  const patternMap = new Map<string, any>();
  for (const p of weeklyPatterns) {
    patternMap.set(`${p.handymanId}-${p.dayOfWeek}`, p);
  }
  
  const todayStr = formatTz(ukToday, 'yyyy-MM-dd', { timeZone: UK_TZ });
  const currentHour = ukNow.getHours();

  function isContractorFree(contractorId: string, dateStr: string, dayOfWeek: number): boolean {
    if (blockedDateSet.has(dateStr)) return false;
    const override = overrideMap.get(`${contractorId}-${dateStr}`);
    if (override) {
      return override.isAvailable && timeRangeCoversSlot(override.startTime, override.endTime, slot);
    }
    const pattern = patternMap.get(`${contractorId}-${dayOfWeek}`);
    return pattern ? timeRangeCoversSlot(pattern.startTime, pattern.endTime, slot) : false;
  }

  const results: string[] = [];
  for (let i = 0; i <= totalDays; i++) {
    const checkDate = addDays(rangeStart, i);
    if (isBefore(checkDate, ukToday)) continue;
    const dateStr = formatTz(checkDate, 'yyyy-MM-dd', { timeZone: UK_TZ });
    const dayOfWeek = getDay(checkDate);
    
    const available = contractorIds.some(cId => isContractorFree(cId, dateStr, dayOfWeek));
    if (available) results.push(dateStr);
  }

  console.log(`\nAvailable dates (${results.length}):`);
  results.forEach(d => console.log(' ', d));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
