import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { and, gte, lt, isNotNull } from 'drizzle-orm';

const isTest = (q:any)=> (q.id??'').startsWith('test_q_') || /07700900|447700900|449900001/.test((q.phone??'').replace(/\D/g,'')) || /@example\.com$/i.test(q.email??'') || /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.customerName??'');

// bucket by VIEW date (the flow is experienced at view time)
const from = new Date('2026-05-01T00:00:00Z');
const rows = (await db.select().from(personalizedQuotes)
  .where(and(isNotNull(personalizedQuotes.viewedAt), gte(personalizedQuotes.viewedAt, from)))) as any[];
const real = rows.filter(q=>!isTest(q));

const FLOW = new Date('2026-06-27T00:00:00Z');   // 3-stage offer flow shipped
const GW   = new Date('2026-07-01T00:00:00Z');   // Groundwire live (approx)

function bucket(name:string, lo:Date, hi:Date){
  const qs = real.filter(q=> q.viewedAt>=lo && q.viewedAt<hi);
  const viewed = qs.length;
  const paid = qs.filter(q=>q.depositPaidAt).length;
  const conv = viewed? (100*paid/viewed):0;
  console.log(`${name.padEnd(34)} viewed ${String(viewed).padStart(3)}  paid ${String(paid).padStart(3)}  conv ${conv.toFixed(1)}%`);
}
console.log('Split by VIEW date, conversion = paid % of viewed:\n');
bucket('① Pre-flow  (May1–Jun26)', from, FLOW);
bucket('② New flow, pre-GW (Jun27–30)', FLOW, GW);
bucket('③ New flow + Groundwire (Jul1+)', GW, new Date('2026-08-01T00:00:00Z'));
console.log('\n① vs ② isolates the PAGE-FLOW effect (same lead source).');
console.log('② vs ③ isolates the GROUNDWIRE effect (same page).');
process.exit(0);
