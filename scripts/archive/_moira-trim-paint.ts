import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { activeLineItems } from '../shared/split-scope';
import { computeBookingDurationDays } from '../shared/schedule-composition';

const PAINT_LINE_ID = 'ws1cibic';
const NEW_MINUTES = 150; // 2.5h — brings kept scope to 465min (1-day job). Price untouched.

async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, '0mbr8erj')).limit(1);
  if (!q) { console.log('not found'); process.exit(1); }

  const items = (q.pricingLineItems as any[]) || [];
  const paint = items.find((l) => String(l.lineId) === PAINT_LINE_ID);
  if (!paint) { console.log('paint line not found'); process.exit(1); }

  console.log('BEFORE:', { lineId: paint.lineId, label: paint.skuName || paint.description, scheduleMinutes: paint.scheduleMinutes, timeEstimateMinutes: paint.timeEstimateMinutes, pricePence: paint.guardedPricePence ?? paint.pricePence });

  const updated = items.map((l) => String(l.lineId) === PAINT_LINE_ID
    ? { ...l, scheduleMinutes: NEW_MINUTES, timeEstimateMinutes: NEW_MINUTES }
    : l);

  await db.update(personalizedQuotes).set({ pricingLineItems: updated as any }).where(eq(personalizedQuotes.id, q.id));

  // Re-verify on the kept scope.
  const active = activeLineItems(updated, (q as any).deferredLineItems);
  const days = computeBookingDurationDays(active, {});
  const after = updated.find((l) => String(l.lineId) === PAINT_LINE_ID);
  console.log('AFTER :', { scheduleMinutes: after.scheduleMinutes, timeEstimateMinutes: after.timeEstimateMinutes, pricePence: after.guardedPricePence ?? after.pricePence });
  console.log(`\n✅ Kept scope now computes ${days} day(s). Price unchanged.`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
