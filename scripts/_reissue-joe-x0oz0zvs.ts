import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';

// Re-issue Joe's landlord quote (x0oz0zvs) so the SAME link is payable again.
// Context: the £326.30 deposit (pi_3TSAeM4p9GekG4mY1i3kmeOz) was fully refunded
// on Stripe, but the app never recorded it — deposit_paid_at was still set, so the
// link showed an "already paid / amended" screen. This clears the booking/payment
// state (mirroring scripts/_clone-quote-for-debug.ts's proven "fresh quote" wipe),
// records the refund, and preserves the £763 price exactly. No price/discount changes.
const SLUG = 'x0oz0zvs';
const PI_ID = 'pi_3TSAeM4p9GekG4mY1i3kmeOz';

async function main() {
  const [before] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, SLUG))
    .limit(1);

  if (!before) {
    console.log(`Quote "${SLUG}" not found.`);
    process.exit(1);
  }

  console.log('── BEFORE ──────────────────────────────────────');
  console.log({
    slug: before.shortSlug,
    customer: before.customerName,
    status: (before as any).status,
    basePrice: `£${((before.basePrice ?? 0) / 100).toFixed(2)}`,
    selectedTierPrice: `£${(((before as any).selectedTierPricePence ?? 0) / 100).toFixed(2)}`,
    depositPaidAt: before.depositPaidAt,
    bookedAt: before.bookedAt,
    selectedDate: (before as any).selectedDate,
    stripePaymentIntentId: (before as any).stripePaymentIntentId,
    refundedAt: (before as any).refundedAt,
  });

  // Pull the actual Stripe refund timestamp for an accurate audit record.
  let refundedAt = new Date();
  let refundAmountPence = (before as any).depositAmountPence ?? 32630;
  try {
    const key = process.env.STRIPE_SECRET_KEY!;
    const stripe = new Stripe(key);
    const refunds = await stripe.refunds.list({ payment_intent: PI_ID, limit: 1 });
    const r = refunds.data[0];
    if (r) {
      refundedAt = new Date(r.created * 1000);
      refundAmountPence = r.amount;
    }
  } catch (e) {
    console.warn('Could not read Stripe refund time; using now(). ', (e as Error).message);
  }

  const now = new Date();
  await db
    .update(personalizedQuotes)
    .set({
      // ── Wipe booking/payment so the link renders as a fresh, payable quote ──
      // (same field set scripts/_clone-quote-for-debug.ts uses for a pristine clone)
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
      // ── Record the refund (dedicated audit columns) ──
      refundedAt,
      refundAmountPence,
      refundReason:
        'Deposit refunded on Stripe; quote re-issued at original £763 for re-payment (price unchanged, customer-agreed).',
      updatedAt: now,
    } as any)
    .where(eq(personalizedQuotes.shortSlug, SLUG));

  const [after] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, SLUG))
    .limit(1);

  console.log('\n── AFTER ───────────────────────────────────────');
  console.log({
    slug: after.shortSlug,
    customer: after.customerName,
    status: (after as any).status,
    basePrice: `£${((after.basePrice ?? 0) / 100).toFixed(2)}`,
    selectedTierPrice: `£${(((after as any).selectedTierPricePence ?? 0) / 100).toFixed(2)}`,
    depositPaidAt: after.depositPaidAt,
    bookedAt: after.bookedAt,
    selectedDate: (after as any).selectedDate,
    stripePaymentIntentId: (after as any).stripePaymentIntentId,
    refundedAt: (after as any).refundedAt,
    refundAmountPence: (after as any).refundAmountPence,
  });
  console.log(`\nLink ready: https://www.handyservices.app/quote-link/${SLUG}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
