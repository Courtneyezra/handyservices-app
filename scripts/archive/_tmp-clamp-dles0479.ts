import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { clampLineItemMinutes } from '../shared/scheduling-caps';
import { composeScheduleMinutes } from '../shared/schedule-composition';

async function main() {
    const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'dles0479'));
    const lines = (q.pricingLineItems as any[]) || [];
    let t = 0;
    for (const l of lines) {
        const clamped = clampLineItemMinutes(l.category, l.scheduleMinutes ?? l.timeEstimateMinutes ?? 60);
        t += clamped;
        console.log(`${String(l.description).padEnd(36)} est ${String(l.timeEstimateMinutes).padStart(4)}  clamped ${String(clamped).padStart(4)}  verified ${l.verifiedMinutes ?? '-'}`);
    }
    console.log(`clamped total: ${t}min (${(t / 60).toFixed(1)}h)`);
    const composed = composeScheduleMinutes(lines, {
        floorNumber: (q as any).floorNumber, hasLift: (q as any).hasLift,
        parkingDistanceCategory: (q as any).parkingDistanceCategory,
        customerPresent: (q as any).customerPresent,
    } as any);
    console.log('composed:', JSON.stringify(composed));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
