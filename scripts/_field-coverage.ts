import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, sql } from 'drizzle-orm';

async function main() {
  const [r] = await db.select({
    paid: sql<number>`count(*) filter (where ${personalizedQuotes.depositPaidAt} is not null)`,
    flexSet: sql<number>`count(*) filter (where ${personalizedQuotes.flexBookingWithinDays} is not null and ${personalizedQuotes.depositPaidAt} is not null)`,
    dateSet: sql<number>`count(*) filter (where ${personalizedQuotes.selectedDate} is not null and ${personalizedQuotes.depositPaidAt} is not null)`,
    schedFeeSet: sql<number>`count(*) filter (where coalesce(${personalizedQuotes.schedulingFeeInPence},0) > 0 and ${personalizedQuotes.depositPaidAt} is not null)`,
    schedTierSet: sql<number>`count(*) filter (where ${personalizedQuotes.schedulingTier} is not null and ${personalizedQuotes.depositPaidAt} is not null)`,
    slotSet: sql<number>`count(*) filter (where ${personalizedQuotes.timeSlotType} is not null and ${personalizedQuotes.depositPaidAt} is not null)`,
    bookedSet: sql<number>`count(*) filter (where ${personalizedQuotes.bookedAt} is not null and ${personalizedQuotes.depositPaidAt} is not null)`,
    selTierNeqBase: sql<number>`count(*) filter (where ${personalizedQuotes.selectedTierPricePence} is not null and ${personalizedQuotes.selectedTierPricePence} <> ${personalizedQuotes.basePrice} and ${personalizedQuotes.depositPaidAt} is not null)`,
  }).from(personalizedQuotes);
  console.log('Across ALL paid quotes:');
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
