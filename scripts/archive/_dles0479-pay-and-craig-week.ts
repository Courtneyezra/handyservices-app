/**
 * Read-only diagnostic (22 Aug 2026):
 *   1. Pull quote dles0479 (Harbans) and run its lines through the canonical
 *      contractor pay engine (computeContractorPay) at Craig's delivery tier.
 *   2. List Craig's availability + existing bookings/diary items next week
 *      (Mon 24 Aug – Sun 30 Aug 2026) to see the two open dates and what
 *      schedule time the quote's items need to fill them.
 *
 * Run: npx tsx scripts/_dles0479-pay-and-craig-week.ts
 */
import { db } from '../server/db';
import {
    personalizedQuotes, handymanProfiles, contractorAvailabilityDates,
    contractorBookingRequests, contractorDiaryItems, users,
} from '../shared/schema';
import { eq, and, gte, lte, ilike } from 'drizzle-orm';
import { computeContractorPay } from '../server/lib/contractor-pay';
import { lineScheduleMinutes } from '../shared/schedule-composition';

const SLUG = process.argv[2] || 'dles0479';
const WEEK_START = new Date('2026-08-24T00:00:00Z');
const WEEK_END = new Date('2026-08-30T23:59:59Z');

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;
const hrs = (m: number) => `${(m / 60).toFixed(1)}h`;

async function main() {
    const [quote] = await db.select().from(personalizedQuotes)
        .where(eq(personalizedQuotes.shortSlug, SLUG));
    if (!quote) throw new Error(`Quote ${SLUG} not found`);

    console.log(`QUOTE ${SLUG} — ${quote.customerName ?? '?'}`);
    console.log(`  status: booked=${quote.bookedAt?.toISOString() ?? 'no'} depositPaid=${quote.depositPaidAt?.toISOString() ?? 'no'}`);
    console.log(`  basePrice: ${gbp(quote.basePrice || 0)}  batchDiscount: ${quote.batchDiscountPercent || 0}%`);
    console.log(`  postcode: ${(quote as any).postcode ?? (quote as any).customerPostcode ?? '?'}`);
    console.log(`  scheduledDates: ${JSON.stringify((quote as any).scheduledDates ?? null)}`);

    const lines = ((quote.pricingLineItems as any[]) || []);
    console.log(`\nLINE ITEMS (${lines.length}):`);
    let totalSched = 0;
    for (const l of lines) {
        const sched = lineScheduleMinutes(l);
        totalSched += sched;
        console.log(`  ${l.lineId}  ${String(l.description).padEnd(36)} labour ${gbp(l.guardedPricePence || 0).padStart(8)}`
            + `  mats(cost) ${gbp(l.materialsCostPence || 0).padStart(8)}  sched ${String(sched).padStart(4)}min (${hrs(sched)})`);
    }
    console.log(`  total schedule time: ${totalSched}min (${hrs(totalSched)})`);

    // ── Craig ────────────────────────────────────────────────────────────────
    const craigRows = await db.select({ profile: handymanProfiles, user: users })
        .from(handymanProfiles)
        .innerJoin(users, eq(handymanProfiles.userId, users.id))
        .where(ilike(users.firstName, '%craig%'));
    if (craigRows.length !== 1) {
        console.log(`\nCraig profiles found: ${craigRows.map(c => `${c.profile.id} ${c.user.firstName} ${c.user.lastName} tier=${c.profile.deliveryTier}`).join('; ')}`);
    }
    const craig = craigRows[0]?.profile;
    if (!craig) throw new Error('No Craig profile found');
    console.log(`\nCRAIG: ${craigRows[0].user.firstName} ${craigRows[0].user.lastName} (${craig.id})  deliveryTier=${craig.deliveryTier}  priority=${craig.deliveryPriority}`);

    // ── Pay engine, with batch discount applied pro-rata (matches generation) ─
    const discountFactor = 1 - (Number(quote.batchDiscountPercent) || 0) / 100;
    const payLines = lines.map((l) => ({
        category: l.category,
        description: l.description,
        guardedPricePence: Math.round((l.guardedPricePence || 0) * discountFactor),
        materialsCostPence: l.materialsCostPence,
        timeEstimateMinutes: l.timeEstimateMinutes,
        scheduleMinutes: l.scheduleMinutes,
        verifiedMinutes: l.verifiedMinutes,
    }));
    const pay = computeContractorPay(payLines, (craig as any).deliveryTier);

    console.log(`\nCONTRACTOR PAY (tier=${pay.deliveryTier}, uplift=${pay.sharePctUplift}, effective ${pay.effectiveSharePercent}% of labour):`);
    for (const ln of pay.lines) {
        console.log(`  ${String(ln.category).padEnd(22)} ${String(ln.description ?? '').padEnd(36)}`
            + ` labour ${gbp(ln.labourPence).padStart(8)}  pay ${gbp(ln.payPence).padStart(8)} (${ln.method})`
            + `  mats ${gbp(ln.materialsPence).padStart(8)}`);
    }
    console.log(`  ──`);
    console.log(`  labour total   ${gbp(pay.totalLabourPence)}`);
    console.log(`  PAY total      ${gbp(pay.totalPayPence)}`);
    console.log(`  materials pass-through (at cost): ${gbp(pay.totalMaterialsPence)}`);
    if (pay.flags.length) console.log(`  flags:\n    - ${pay.flags.join('\n    - ')}`);

    // ── Next week: availability, bookings, diary ─────────────────────────────
    const avail = await db.select().from(contractorAvailabilityDates)
        .where(and(
            eq(contractorAvailabilityDates.contractorId, craig.id),
            gte(contractorAvailabilityDates.date, WEEK_START),
            lte(contractorAvailabilityDates.date, WEEK_END),
        ));
    console.log(`\nCRAIG AVAILABILITY 24–30 Aug:`);
    for (const a of avail.sort((x, y) => +x.date - +y.date)) {
        console.log(`  ${a.date.toISOString().slice(0, 10)}  available=${a.isAvailable}  ${a.startTime ?? ''}-${a.endTime ?? ''}  ${a.notes ?? ''}`);
    }
    if (!avail.length) console.log('  (no explicit date overrides)');

    const bookings = await db.select().from(contractorBookingRequests)
        .where(and(
            gte(contractorBookingRequests.scheduledDate, WEEK_START),
            lte(contractorBookingRequests.scheduledDate, WEEK_END),
        ));
    const craigBookings = bookings.filter(b =>
        b.contractorId === craig.id || b.assignedContractorId === craig.id);
    console.log(`\nCRAIG BOOKINGS 24–30 Aug (${craigBookings.length}):`);
    for (const b of craigBookings.sort((x, y) => +(x.scheduledDate || 0) - +(y.scheduledDate || 0))) {
        console.log(`  ${b.scheduledDate?.toISOString().slice(0, 10)}  ${b.scheduledStartTime ?? '?'}-${b.scheduledEndTime ?? '?'}`
            + `  ${String(b.customerName).padEnd(20)} status=${b.status}/${b.assignmentStatus}  quote=${b.quoteId ?? '-'}`);
        console.log(`      scheduled_dates: ${JSON.stringify((b as any).scheduledDates ?? null)}`);
    }

    const diary = await db.select().from(contractorDiaryItems)
        .where(and(
            eq(contractorDiaryItems.contractorId, craig.id),
            gte(contractorDiaryItems.date, WEEK_START),
            lte(contractorDiaryItems.date, WEEK_END),
        ));
    console.log(`\nCRAIG DIARY ITEMS 24–30 Aug (${diary.length}):`);
    for (const d of diary) {
        console.log(`  ${d.date.toISOString().slice(0, 10)} ${d.slot} ${d.startTime ?? ''} ${d.minutes}min ${d.kind} — ${d.customerName}`);
    }

    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
