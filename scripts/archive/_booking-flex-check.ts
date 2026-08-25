import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { inArray } from 'drizzle-orm';

const slugs = process.argv.slice(2);
const targets = slugs.length ? slugs : ['vc0ikyds', 'xsbc3ynk', 'xfz2r059'];

async function main() {
  const rows = await db
    .select({
      shortSlug: personalizedQuotes.shortSlug,
      customerName: personalizedQuotes.customerName,
      flexBookingWithinDays: personalizedQuotes.flexBookingWithinDays,
      selectedDate: personalizedQuotes.selectedDate,
      schedulingTier: personalizedQuotes.schedulingTier,
      timeSlotType: personalizedQuotes.timeSlotType,
      isWeekendBooking: personalizedQuotes.isWeekendBooking,
      schedulingFeeInPence: personalizedQuotes.schedulingFeeInPence,
      batchDiscountPercent: personalizedQuotes.batchDiscountPercent,
      bookingModes: personalizedQuotes.bookingModes,
      availableDates: personalizedQuotes.availableDates,
      dateTimePreferences: personalizedQuotes.dateTimePreferences,
      selectedExtras: personalizedQuotes.selectedExtras,
      basePrice: personalizedQuotes.basePrice,
      depositAmountPence: personalizedQuotes.depositAmountPence,
      paymentType: personalizedQuotes.paymentType,
    })
    .from(personalizedQuotes)
    .where(inArray(personalizedQuotes.shortSlug, targets));

  // preserve requested order
  targets.forEach((s) => {
    const r = rows.find((x) => x.shortSlug === s);
    if (!r) {
      console.log(`\n${s}: NOT FOUND`);
      return;
    }
    const flex = r.flexBookingWithinDays != null;
    console.log(`\n=== ${r.shortSlug} — ${r.customerName} ===`);
    console.log(`  flexBookingWithinDays : ${r.flexBookingWithinDays ?? 'null'}  ${flex ? '→ FLEX ("I\'m flexible")' : ''}`);
    console.log(`  selectedDate          : ${r.selectedDate ? new Date(r.selectedDate).toISOString() : 'null'}`);
    console.log(`  schedulingTier        : ${r.schedulingTier ?? 'null'}`);
    console.log(`  timeSlotType          : ${r.timeSlotType ?? 'null'}`);
    console.log(`  isWeekendBooking      : ${r.isWeekendBooking}`);
    console.log(`  schedulingFeeInPence  : ${r.schedulingFeeInPence ?? 'null'}`);
    console.log(`  batchDiscountPercent  : ${r.batchDiscountPercent ?? 'null'}`);
    console.log(`  bookingModes          : ${JSON.stringify(r.bookingModes)}`);
    console.log(`  availableDates        : ${JSON.stringify(r.availableDates)}`);
    console.log(`  dateTimePreferences   : ${JSON.stringify(r.dateTimePreferences)}`);
    console.log(`  selectedExtras        : ${JSON.stringify(r.selectedExtras)}`);
    console.log(`  basePrice / deposit   : £${((r.basePrice ?? 0) / 100).toFixed(2)} / ${r.depositAmountPence != null ? '£' + (r.depositAmountPence / 100).toFixed(2) : 'null'} (${r.paymentType})`);

    const verdict = flex
      ? 'FLEX — customer chose "I\'m flexible" (we pick the day)'
      : r.selectedDate
        ? 'PICK-A-DATE — customer selected a specific date'
        : 'NEITHER captured — paid without a flex flag or a selectedDate';
    console.log(`  >>> VERDICT: ${verdict}`);
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
