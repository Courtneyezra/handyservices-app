import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { or, ilike, eq, desc } from 'drizzle-orm';
const gbp = (p?: number | null) => p == null ? '—' : '£' + (p / 100).toFixed(2);
async function main() {
  const qs = await db.select().from(personalizedQuotes)
    .where(or(
      ilike(personalizedQuotes.email, '%hafsahahmed24%'),
      ilike(personalizedQuotes.phone, '%7397668567%'),
      ilike(personalizedQuotes.customerName, '%hafsah%'),
    ))
    .orderBy(desc(personalizedQuotes.createdAt)) as any[];
  console.log('Found', qs.length, 'quote(s) for Hafsah:\n');
  for (const q of qs) {
    console.log(`slug=${q.shortSlug}  id=${q.id}`);
    console.log(`   created=${q.createdAt}  by=${q.createdByName||q.createdBy||'—'}  mode=${q.quoteMode}`);
    console.log(`   basePrice=${gbp(q.basePrice)}  selectedTier=${gbp(q.selectedTierPricePence)}  pkg=${q.selectedPackage}  deposit=${gbp(q.depositAmountPence)}  paymentType=${q.paymentType}`);
    console.log(`   flexDays=${q.flexBookingWithinDays}  depositPaidAt=${q.depositPaidAt||'—'}  jobTitle=${q.title||q.description||'—'}`);
    const li = Array.isArray(q.pricingLineItems) ? q.pricingLineItems.map((x:any)=>`${x.description}(${gbp(x.pricePence)},${x.scheduleMinutes}m)`).join('; ') : '—';
    console.log(`   lines: ${li}`);
    console.log('');
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
