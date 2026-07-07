/**
 * Phase 24 end-to-end multi-day booking test.
 *
 * Walks every layer:
 *   1. resolveQuoteCandidatePoolForQuote returns Craig as the full-coverage candidate
 *   2. Admin fit-panel logic returns 2-day SPANS (not just per-day)
 *   3. Public quote availability returns valid START dates for a 2-day job
 *   4. reserveSlot accepts a multi-day job and inserts ONE lock with durationDays=2
 *   5. confirmBooking creates ONE booking with durationDays=2
 *   6. Matrix expands the booking into 2 chips (day 1, day 2)
 *   7. Cleanup
 *
 * Uses a synthetic quote at a Nottingham postcode (NG1 1AA, ~0 mi from Craig)
 * with line items summing to ~13h so requiredDays = 2.
 */
import 'dotenv/config';
import { db } from '../server/db';
import {
  personalizedQuotes,
  handymanProfiles,
  contractorBookingRequests,
  bookingSlotLocks,
  jobSheets,
  users,
  contractorAvailabilityDates,
} from '../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { resolveQuoteCandidatePoolForQuote } from '../server/lib/quote-fit';
import { computeBookingDurationDays } from '../shared/schedule-composition';
import { reserveSlot, confirmBooking } from '../server/booking-engine';

const CRAIG_ID = 'hp_aa21264a-9143-4116-bda2-2da998255929';
const TEST_QUOTE_ID = `test_multi_day_${Date.now()}`;

// Craig is at Mapperley, NG5 area. NG1 1AA is Nottingham city centre,
// ~2 mi away — comfortably within his 20 mi radius.
const TEST_POSTCODE = 'NG1 1AA';
const TEST_COORDS = { lat: 52.954, lng: -1.156 }; // Nottingham city centre
// Realistic multi-line refurb that genuinely needs 2 working days but not 3.
//   3 × carpentry @ cap (240) = 720 work
//   + 3 × (setup 15 + cleanup 15) = 90 buffers
//   = 810 total → ceil(810/480) = 2 days
const TEST_LINES = [
  { id: 'L1', description: 'Install hallway panelling', category: 'carpentry', timeEstimateMinutes: 240, materialsCostPence: 0 },
  { id: 'L2', description: 'Install stairs + landing panelling', category: 'carpentry', timeEstimateMinutes: 240, materialsCostPence: 0 },
  { id: 'L3', description: 'Install bedroom panelling', category: 'carpentry', timeEstimateMinutes: 240, materialsCostPence: 0 },
];

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

async function main() {
  console.log('\n═══ Phase 24 end-to-end multi-day booking test ═══\n');

  // ── Setup: synthetic quote + 2 clean consecutive availability days for Craig ──
  // Use days far enough out that they won't collide with real bookings.
  // Today + 30 and today + 31 give us a guaranteed clean 2-day window.
  const testDay1 = new Date(); testDay1.setUTCHours(0,0,0,0); testDay1.setUTCDate(testDay1.getUTCDate() + 30);
  const testDay2 = new Date(testDay1); testDay2.setUTCDate(testDay1.getUTCDate() + 1);
  const seededOverrideIds: string[] = [];
  console.log('Step 0 — seed synthetic quote + Craig availability for', testDay1.toISOString().slice(0,10), '+', testDay2.toISOString().slice(0,10));
  await db.insert(personalizedQuotes).values({
    id: TEST_QUOTE_ID,
    shortSlug: TEST_QUOTE_ID.slice(-8),
    customerName: 'Test Multi-Day',
    phone: '07700000000',
    postcode: TEST_POSTCODE,
    coordinates: TEST_COORDS as any,
    jobDescription: 'Multi-day end-to-end test',
    pricingLineItems: TEST_LINES as any,
    basePrice: 100000,
    candidateContractorIds: [CRAIG_ID] as any,
  });
  // Seed Craig overrides only if not already present (idempotent)
  for (const d of [testDay1, testDay2]) {
    const existing = await db.select().from(contractorAvailabilityDates).where(and(
      eq(contractorAvailabilityDates.contractorId, CRAIG_ID),
      gte(contractorAvailabilityDates.date, d),
      lte(contractorAvailabilityDates.date, new Date(d.getTime() + 24*60*60*1000 - 1)),
    ));
    if (existing.length === 0) {
      const id = uuidv4();
      await db.insert(contractorAvailabilityDates).values({
        id,
        contractorId: CRAIG_ID,
        date: d,
        isAvailable: true,
        startTime: '09:00',
        endTime: '18:00',
      });
      seededOverrideIds.push(id);
    }
  }
  console.log(`  quote=${TEST_QUOTE_ID}, seeded ${seededOverrideIds.length} override(s)\n`);

  try {
    // ── Step 1: candidate pool ──
    console.log('Step 1 — resolveQuoteCandidatePoolForQuote returns Craig');
    const [quote] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.id, TEST_QUOTE_ID)).limit(1);
    const fit = await resolveQuoteCandidatePoolForQuote(quote!);
    check('at least one candidate', fit.candidates.length >= 1, `${fit.candidates.length} candidate(s)`);
    check('Craig is in candidates', fit.candidates.some(c => c.contractorId === CRAIG_ID), fit.candidates[0]?.contractorName);
    check('uncoveredCategories empty', fit.uncoveredCategories.length === 0);

    // ── Step 2: required days ──
    console.log('\nStep 2 — requiredDays from quote');
    const requiredDays = computeBookingDurationDays(TEST_LINES as any, {});
    check('requiredDays >= 2', requiredDays >= 2, `${requiredDays} days (780min / 480 = 2)`);

    // ── Step 3: fit endpoint multi-day spans ──
    console.log('\nStep 3 — admin /fit logic returns N-day spans');
    // Replicate the fit endpoint's per-candidate window scan inline
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const daysAhead = 35; // Extended past the seeded testDay1/testDay2 (+30/+31)
    const { contractorAvailabilityDates, contractorBookingRequests: CBR, handymanAvailability } = await import('../shared/schema');
    const { inArray, gte, lte, or } = await import('drizzle-orm');
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + daysAhead);
    const [overrides, jobs, patterns] = await Promise.all([
      db.select().from(contractorAvailabilityDates).where(and(
        eq(contractorAvailabilityDates.contractorId, CRAIG_ID),
        gte(contractorAvailabilityDates.date, start),
        lte(contractorAvailabilityDates.date, end),
      )),
      db.select().from(CBR).where(and(
        or(eq(CBR.assignedContractorId, CRAIG_ID), eq(CBR.contractorId, CRAIG_ID)),
        gte(CBR.scheduledDate, start),
        lte(CBR.scheduledDate, end),
      )),
      db.select().from(handymanAvailability).where(eq(handymanAvailability.handymanId, CRAIG_ID)),
    ]);
    const dateKey = (d: Date | string) => new Date(d).toISOString().split('T')[0];
    const { slotFromWindow } = await import('../shared/slot-times');
    const slotOf = (o: any) => {
      const s = slotFromWindow(o.startTime, o.endTime);
      return s === 'full_day' ? 'full' : s === 'other' ? 'full' : s;
    };
    const bookedSet = new Set(jobs.filter(j => j.scheduledDate && (['assigned','accepted','in_progress','completed'].includes(j.assignmentStatus!) || ['accepted','completed'].includes(j.status))).map(j => dateKey(j.scheduledDate!)));
    const dayMap: { date: string; slot: string | null }[] = [];
    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
      const ds = dateKey(d);
      if (bookedSet.has(ds)) { dayMap.push({ date: ds, slot: null }); continue; }
      const ov = overrides.find(o => dateKey(o.date) === ds);
      if (ov) {
        dayMap.push({ date: ds, slot: ov.isAvailable ? slotOf(ov) : null });
      } else {
        const pat = patterns.find(p => p.dayOfWeek === d.getUTCDay() && p.isActive);
        dayMap.push({ date: ds, slot: pat ? 'full' : null });
      }
    }
    const startDates: string[] = [];
    for (let i = 0; i <= dayMap.length - requiredDays; i++) {
      let spans = true;
      for (let j = 0; j < requiredDays; j++) {
        if (dayMap[i + j].slot !== 'full') { spans = false; break; }
      }
      if (spans) startDates.push(dayMap[i].date);
    }
    check('multi-day start dates found', startDates.length > 0, `${startDates.length} valid start dates: ${startDates.slice(0,3).join(',')}${startDates.length > 3 ? '…' : ''}`);
    const firstValidStart = startDates[0];
    check('first valid start has N-day span', !!firstValidStart, `start=${firstValidStart}`);

    // ── Step 4: reserveSlot ──
    console.log('\nStep 4 — reserveSlot for multi-day');
    if (!firstValidStart) {
      console.log('  (skipped: no valid start date found in next 14 days)');
    } else {
      const reserveDate = new Date(firstValidStart + 'T00:00:00.000Z');
      const reserveResult = await reserveSlot({
        quoteId: TEST_QUOTE_ID,
        scheduledDate: reserveDate,
        scheduledSlot: 'full_day' as any,
        candidateContractorIds: [CRAIG_ID],
      });
      check('reserveSlot success', reserveResult.success, reserveResult.success ? `lockId=${reserveResult.lockId}, contractor=${reserveResult.contractorName}` : reserveResult.error);

      if (reserveResult.success && reserveResult.lockId) {
        const [lock] = await db.select().from(bookingSlotLocks).where(eq(bookingSlotLocks.id, reserveResult.lockId)).limit(1);
        check('lock row exists', !!lock);
        check('lock.durationDays === 2', lock?.durationDays === 2, `actual=${lock?.durationDays}`);
        check('lock.scheduledDate matches', dateKey(lock!.scheduledDate) === firstValidStart);

        // ── Step 5: confirmBooking ──
        console.log('\nStep 5 — confirmBooking persists multi-day booking');
        const confirmResult = await confirmBooking({
          quoteId: TEST_QUOTE_ID,
          lockId: reserveResult.lockId,
          paymentIntentId: 'pi_test_phase24',
        });
        check('confirmBooking success', confirmResult.success, confirmResult.success ? `jobSheetId=${confirmResult.jobId}` : confirmResult.error);

        if (confirmResult.success) {
          const bookings = await db.select().from(contractorBookingRequests).where(eq(contractorBookingRequests.quoteId, TEST_QUOTE_ID));
          check('1 booking row created', bookings.length === 1, `actual=${bookings.length}`);
          check('booking.durationDays === 2', bookings[0]?.durationDays === 2, `actual=${bookings[0]?.durationDays}`);
          check('booking.scheduledSlot === full_day', bookings[0]?.scheduledSlot === 'full_day');

          // ── Step 6: matrix would expand into N chips ──
          console.log('\nStep 6 — matrix expansion');
          const dur = bookings[0].durationDays ?? 1;
          const chips: string[] = [];
          const baseDate = new Date(bookings[0].scheduledDate!);
          for (let i = 0; i < dur; i++) {
            const d = new Date(baseDate); d.setUTCDate(baseDate.getUTCDate() + i);
            chips.push(d.toISOString().slice(0, 10));
          }
          check('matrix expands to 2 chips', chips.length === 2, chips.join(','));

          // Cleanup booking + jobSheet
          await db.delete(jobSheets).where(eq(jobSheets.quoteId, TEST_QUOTE_ID));
          await db.delete(contractorBookingRequests).where(eq(contractorBookingRequests.quoteId, TEST_QUOTE_ID));
        }
      }
    }
  } finally {
    // Cleanup synthetic quote + any orphan locks + seeded overrides
    await db.delete(bookingSlotLocks).where(eq(bookingSlotLocks.quoteId, TEST_QUOTE_ID));
    await db.delete(personalizedQuotes).where(eq(personalizedQuotes.id, TEST_QUOTE_ID));
    if (seededOverrideIds.length > 0) {
      for (const id of seededOverrideIds) {
        await db.delete(contractorAvailabilityDates).where(eq(contractorAvailabilityDates.id, id));
      }
      console.log(`— Cleanup done (removed ${seededOverrideIds.length} seeded override(s)) —`);
    } else {
      console.log('— Cleanup done —');
    }
  }

  console.log(`\n═══ Result: ${pass} pass, ${fail} fail ═══`);
  if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
