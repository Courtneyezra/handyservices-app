import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { computeLaneBasePence, computeSetDatePremiumPence, isLaneEligible, deriveCustomerType } from '../server/lane-pricing';

async function main() {
  const [q] = await db.select().from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, 'xx3diece'));
  const cs: any = q.contextSignals || {};
  console.log(JSON.stringify({
    basePrice: q.basePrice,
    selectedTierPricePence: q.selectedTierPricePence,
    depositAmountPence: q.depositAmountPence,
    paymentType: q.paymentType,
    depositPaidAt: q.depositPaidAt,
    bookedAt: q.bookedAt,
    selectedDate: q.selectedDate,
    availableDates: q.availableDates,
    flexBookingWithinDays: q.flexBookingWithinDays,
    schedulingFeeInPence: q.schedulingFeeInPence,
    timeSlotType: q.timeSlotType,
    isWeekendBooking: q.isWeekendBooking,
    selectedExtras: q.selectedExtras,
    materialsCostWithMarkupPence: q.materialsCostWithMarkupPence,
    customerType: deriveCustomerType(q.contextSignals),
    vaContext: cs.vaContext,
    laneEligible: isLaneEligible(q.contextSignals),
    setDatePremiumPence: computeSetDatePremiumPence(q.basePrice || 0),
    dateTimeLane: computeLaneBasePence(q.basePrice || 0, q.contextSignals, 'date_time'),
  }, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
