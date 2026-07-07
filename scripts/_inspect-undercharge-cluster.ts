import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes, invoices } from '../shared/schema';
import { inArray, eq } from 'drizzle-orm';

const slugs = ['qf3tpwu1','eupqbc7n','oCcvd-B2','3p53XbRf','PeA07uEY','Z8p1lRId'];
const gbp = (p?: number|null) => p==null?'—':'£'+(p/100).toFixed(2);

async function main() {
  const qs = await db.select().from(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, slugs));
  for (const q of qs as any[]) {
    const inv = (await db.select().from(invoices).where(eq(invoices.quoteId, q.id)))[0] as any;
    console.log(`${q.shortSlug}  ${(q.customerName||'').trim()}`);
    console.log(`   email=${q.email||'—'}  phone=${q.customerPhone||q.phone||'—'}  segment=${q.segment}  status=${q.status||'—'}  paymentType=${q.paymentType}`);
    console.log(`   basePrice=${gbp(q.basePrice)}  depositAmountPence=${gbp(q.depositAmountPence)}  bookedAt=${q.bookedAt?'yes':'no'}  createdBy=${q.createdByName||q.createdBy||'—'}`);
    console.log(`   invoice: ${inv?`${inv.invoiceNumber} status=${inv.status} total=${gbp(inv.totalAmount)} depositPaid=${gbp(inv.depositPaid)} balanceDue=${gbp(inv.balanceDue)} paidAt=${inv.paidAt||'—'}`:'NONE'}`);
    console.log('');
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
