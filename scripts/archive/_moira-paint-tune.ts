import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { activeLineItems } from '../shared/split-scope';
import { totalScheduleMinutes, computeBookingDurationDays } from '../shared/schedule-composition';

async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, '0mbr8erj')).limit(1);
  const active = activeLineItems(q.pricingLineItems, (q as any).deferredLineItems) as any[];
  const paint = active.find((l) => /paint bathroom walls/i.test(l.skuName || l.customerDescription || l.description || l.label || ''));
  console.log('paint line id:', paint?.lineId, 'current scheduleMinutes:', paint?.scheduleMinutes);

  for (const cand of [240, 180, 150, 135, 120, 105, 90]) {
    const cloned = active.map((l) => l === paint ? { ...l, scheduleMinutes: cand, timeEstimateMinutes: cand } : l);
    const mins = totalScheduleMinutes(cloned, {});
    const days = computeBookingDurationDays(cloned, {});
    console.log(`  paint=${cand}min → total=${mins}min → ${days} day(s)${days === 1 ? '  ✅' : ''}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
