import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { or, eq } from 'drizzle-orm';
import { computeBookingDurationDays } from '../shared/schedule-composition';

async function main() {
  const q = await db.query.personalizedQuotes.findFirst({
    where: or(eq(personalizedQuotes.shortSlug, 'vqb49nhc'), eq(personalizedQuotes.id, 'vqb49nhc'))
  });
  const lineItems = (q?.pricingLineItems as any[]) || [];
  console.log('Line items:', JSON.stringify(lineItems, null, 2));
  const requiredDays = computeBookingDurationDays(lineItems, {
    floorNumber: (q as any)?.floorNumber ?? null,
    hasLift: (q as any)?.hasLift ?? null,
    parkingDistanceCategory: (q as any)?.parkingDistanceCategory ?? null,
    customerPresent: (q as any)?.customerPresent ?? null,
  });
  console.log('\nrequiredDays:', requiredDays);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
