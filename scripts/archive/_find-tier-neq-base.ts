import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { and, isNotNull, sql, ne, desc } from 'drizzle-orm';

const gbp = (p?: number | null) => (p == null ? '—' : '£' + (p / 100).toFixed(2));
const dt = (d?: Date | string | null) => (!d ? '—' : new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false }));

async function main() {
  const rows = await db.select().from(personalizedQuotes)
    .where(and(
      isNotNull(personalizedQuotes.depositPaidAt),
      isNotNull(personalizedQuotes.selectedTierPricePence),
      ne(personalizedQuotes.selectedTierPricePence, personalizedQuotes.basePrice),
    ))
    .orderBy(desc(personalizedQuotes.depositPaidAt));
  for (const q of rows as any[]) {
    console.log(`${q.shortSlug}  ${(q.customerName||'').trim()}  [${q.segment}/${q.paymentType}]`);
    console.log(`   SHOWN selectedTier ${gbp(q.selectedTierPricePence)}  vs  basePrice ${gbp(q.basePrice)}  (Δ ${gbp((q.selectedTierPricePence||0)-(q.basePrice||0))})`);
    console.log(`   depositShown ${gbp(q.depositAmountPence)}  PI ${q.stripePaymentIntentId||'—'}`);
    console.log(`   generatedAt ${dt(q.createdAt)}  selectedAt ${dt(q.selectedAt)}  updatedAt ${dt(q.updatedAt)}  paidAt ${dt(q.depositPaidAt)}`);
    console.log(`   job: ${(q.jobDescription||'').replace(/\s+/g,' ').slice(0,80)}`);
    console.log('');
  }
  console.log(`${rows.length} quotes where selectedTierPricePence != basePrice`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
