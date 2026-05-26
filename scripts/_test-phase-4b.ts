import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { composeScheduleMinutes } from '../shared/schedule-composition';

const BASE = process.env.BASE_URL || 'http://localhost:53879';

async function main() {
  const r = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Phase 4b UI Test',
      phone: '07700900444',
      email: 'phase4b@test.com',
      address: '14 Lenton Boulevard',
      postcode: 'NG7 2BY',
      coordinates: { lat: 52.9389, lng: -1.1789 },
      vaContext: 'Test for phase 4b property context — 3rd floor walkup.',
      lines: [
        { id: 'l1', description: 'Repaint hallway', category: 'painting', estimatedMinutes: 180 },
      ],
      signals: {},
      floorNumber: 3,
      hasLift: false,
      parkingDistanceCategory: 'street_within_50m',
      customerPresent: true,
      availableDates: ['2026-05-30'],
      createdByName: 'Phase 4b Test',
    }),
  });
  const j = await r.json();
  console.log('Created quote:', j.shortSlug, '(' + r.status + ')');

  const [row] = await db.select({
    floorNumber: personalizedQuotes.floorNumber,
    hasLift: personalizedQuotes.hasLift,
    parkingDistanceCategory: personalizedQuotes.parkingDistanceCategory,
    customerPresent: personalizedQuotes.customerPresent,
    basePrice: personalizedQuotes.basePrice,
    pricingLineItems: personalizedQuotes.pricingLineItems,
  }).from(personalizedQuotes).where(eq(personalizedQuotes.id, j.quoteId));

  console.log('\nPersisted context:', { floor: row?.floorNumber, lift: row?.hasLift, parking: row?.parkingDistanceCategory, present: row?.customerPresent });
  console.log('Price: £' + ((row?.basePrice || 0) / 100).toFixed(0));
  const lineMin = (row?.pricingLineItems as any[])?.[0]?.timeEstimateMinutes;
  console.log('LLM-set line time (should NOT inflate for floor/no-lift):', lineMin, 'min');

  const b = composeScheduleMinutes(row?.pricingLineItems as any[], {
    floorNumber: row?.floorNumber,
    hasLift: row?.hasLift,
    parkingDistanceCategory: row?.parkingDistanceCategory,
    customerPresent: row?.customerPresent,
  });
  console.log('\nSchedule breakdown:', b);
  console.log('Total schedule:', b.totalMinutes, 'min  (', (b.totalMinutes / 60).toFixed(1), 'h)');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
