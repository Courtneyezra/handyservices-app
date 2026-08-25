import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { activeLineItems } from '../shared/split-scope';
import { totalScheduleMinutes, computeBookingDurationDays, composeScheduleMinutes } from '../shared/schedule-composition';

async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, '0mbr8erj')).limit(1);
  const full = (q.pricingLineItems as any[]) || [];
  const active = activeLineItems(q.pricingLineItems, (q as any).deferredLineItems);
  const ctx = {
    floorNumber: (q as any).floorNumber ?? null,
    hasLift: (q as any).hasLift ?? null,
    parkingDistanceCategory: (q as any).parkingDistanceCategory ?? null,
    customerPresent: (q as any).customerPresent ?? null,
  };

  console.log('scheduleContext:', JSON.stringify(ctx));
  console.log('\nPer-line schedule fields:');
  for (const l of full) {
    const label = l.skuName || l.customerDescription || l.description || l.label || '?';
    const def = ((q as any).deferredLineItems || []).some((d:any)=>String(d.lineId)===String(l.lineId));
    console.log(`  ${def?'✗':'✓'} ${label.slice(0,42).padEnd(42)} scheduleMinutes=${l.scheduleMinutes ?? '—'} timeEstimateMinutes=${l.timeEstimateMinutes ?? '—'} durationMins=${l.durationMins ?? '—'}`);
  }

  console.log('\n── FULL 8 lines ──');
  console.log('  totalScheduleMinutes(no ctx):', totalScheduleMinutes(full, {}));
  console.log('  totalScheduleMinutes(ctx)   :', totalScheduleMinutes(full, ctx));
  console.log('  composeScheduleMinutes(ctx) :', JSON.stringify(composeScheduleMinutes(full, ctx)));
  console.log('  computeBookingDurationDays  :', computeBookingDurationDays(full, ctx));

  console.log('\n── KEPT 4 lines ──');
  console.log('  totalScheduleMinutes(no ctx):', totalScheduleMinutes(active, {}));
  console.log('  totalScheduleMinutes(ctx)   :', totalScheduleMinutes(active, ctx));
  console.log('  composeScheduleMinutes(ctx) :', JSON.stringify(composeScheduleMinutes(active, ctx)));
  console.log('  computeBookingDurationDays  :', computeBookingDurationDays(active, ctx));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
