/**
 * A-WP1 verification — for the next 28 days, compare the customer-facing
 * availability_slots listing against real contractor capacity.
 *
 *   npx tsx scripts/_verify-capacity.ts
 *
 * Prints: date | listed (unbooked) slots | computed capacity | diff flags
 *   PHANTOM  — slots listed but zero free contractors (double-booking risk)
 *   UNLISTED — free contractors but nothing listed (lost bookings)
 */
import { db } from '../server/db';
import { availabilitySlots } from '../shared/schema';
import { and, gte, lte, eq } from 'drizzle-orm';
import { getCapacityForDates, validateSlotBookable } from '../server/availability-capacity';

const DAYS = 28;

async function main() {
    const start = new Date();
    const dateStrs: string[] = [];
    for (let i = 0; i < DAYS; i++) {
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
        dateStrs.push(d.toISOString().slice(0, 10));
    }

    const slots = await db.select().from(availabilitySlots).where(and(
        gte(availabilitySlots.date, dateStrs[0]),
        lte(availabilitySlots.date, dateStrs[dateStrs.length - 1]),
        eq(availabilitySlots.isBooked, false),
    ));

    const capacities = await getCapacityForDates(dateStrs);

    console.log(`Capacity audit ${dateStrs[0]} → ${dateStrs[dateStrs.length - 1]} (mode env AVAILABILITY_CAPACITY_CHECK=${process.env.AVAILABILITY_CAPACITY_CHECK || 'off'})`);
    console.log('date       | listed slots                 | capacity | flags');
    console.log('-----------|------------------------------|----------|------');

    let phantom = 0, unlisted = 0;
    for (const ds of dateStrs) {
        const daySlots = slots.filter(s => s.date === ds);
        const detail = capacities.get(ds)!;
        const listedDesc = daySlots.length
            ? daySlots.map(s => s.slotType).join(',')
            : '—';
        const flags: string[] = [];
        if (daySlots.length > 0 && detail.capacity === 0) {
            flags.push(detail.masterBlocked ? 'PHANTOM(master_blocked)' : 'PHANTOM');
            phantom++;
        }
        if (daySlots.length === 0 && detail.capacity > 0) {
            flags.push('UNLISTED');
            unlisted++;
        }
        console.log(
            `${ds} | ${listedDesc.padEnd(28)} | ${String(detail.capacity).padEnd(8)} | ${flags.join(' ') || 'ok'}`
            + (detail.bookedContractorIds.length ? `  (booked: ${detail.bookedContractorIds.length}/${detail.availableContractorIds.length + 0} avail=${detail.availableContractorIds.length})` : ''),
        );
    }

    console.log('---');
    console.log(`Summary: ${phantom} phantom day(s) [listed but zero capacity], ${unlisted} unlisted day(s) [capacity but no slots]`);

    // Spot-check the slot-aware validator on the first few listed slots
    const sample = slots.slice(0, 5);
    if (sample.length) {
        console.log('---');
        console.log('validateSlotBookable spot checks:');
        for (const s of sample) {
            const r = await validateSlotBookable(s.date, s.slotType);
            console.log(`  ${s.date} ${s.slotType.padEnd(9)} → bookable=${r.bookable} capacity=${r.capacity}${r.reason ? ` reason=${r.reason}` : ''}`);
        }
    }

    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
