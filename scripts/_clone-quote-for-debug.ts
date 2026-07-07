import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// Clone an existing quote into a pristine, pre-booking slug so we can walk the
// booking flow live without touching the original. READ + single INSERT only.
const SRC = process.argv[2] || 'xsbc3ynk'; // Gavin — £75 homeowner CONTEXTUAL
const NEW = process.argv[3] || 'dbgflex1';

async function main() {
  const [src] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, SRC))
    .limit(1);

  if (!src) {
    console.log(`Source slug "${SRC}" not found.`);
    process.exit(1);
  }

  // Remove any prior debug clone at this slug.
  await db.delete(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, NEW));

  const now = new Date();
  const clone: any = {
    ...src,
    id: uuidv4(),
    shortSlug: NEW,
    customerName: 'Debug Homeowner',
    // Wipe everything booking/payment so it renders as a fresh, un-booked quote.
    status: 'quote_sent',
    depositPaidAt: null,
    bookedAt: null,
    stripePaymentIntentId: null,
    selectedDate: null,
    selectedTimeSlot: null,
    timeSlotType: null,
    schedulingTier: null,
    isWeekendBooking: null,
    schedulingFeeInPence: null,
    flexBookingWithinDays: null,
    matchedContractorId: null,
    matchedContractorName: null,
    candidateContractorIds: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(personalizedQuotes).values(clone);

  console.log('Cloned quote ready:');
  console.log(`  src slug    : ${SRC}`);
  console.log(`  new slug    : ${NEW}`);
  console.log(`  segment     : ${src.segment}`);
  console.log(`  customerType: ${(src as any).contextSignals?.customerType ?? '(none)'}`);
  console.log(`  basePrice   : £${((src.basePrice ?? 0) / 100).toFixed(2)}`);
  console.log(`  line items  : ${Array.isArray(src.pricingLineItems) ? (src.pricingLineItems as any[]).length : 0}`);
  console.log(`  URL         : /quote-link/${NEW}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
