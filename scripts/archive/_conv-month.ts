import { db } from '../server/db';
import { personalizedQuotes, users } from '../shared/schema';
import { and, eq, gte, lt } from 'drizzle-orm';

const arg = process.argv[2] || '2026-07';
const [y,m] = arg.split('-').map(Number);
const start = new Date(Date.UTC(y, m-1, 1));
const end = new Date(Date.UTC(m===12?y+1:y, m===12?0:m, 1));
const isTest = (q:any)=> (q.id??'').startsWith('test_q_') || /07700900|447700900|449900001/.test((q.phone??'').replace(/\D/g,'')) || /@example\.com$/i.test(q.email??'') || /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.customerName??'');

const [ben] = await db.select({id:users.id}).from(users).where(eq(users.firstName,'Ben'));
// All quotes CREATED this month
const rows = (await db.select().from(personalizedQuotes)
  .where(and(gte(personalizedQuotes.createdAt, start), lt(personalizedQuotes.createdAt, end)))) as any[];
const real = rows.filter(q=>!isTest(q));

function funnel(qs:any[], label:string){
  const generated = qs.length;
  const viewed = qs.filter(q=>q.viewedAt).length;
  const paid = qs.filter(q=>q.depositPaidAt).length;
  const selected = qs.filter(q=>q.selectedAt).length;
  const pctViewGen = generated? (100*viewed/generated):0;
  const pctPaidView = viewed? (100*paid/viewed):0;
  const pctPaidGen = generated? (100*paid/generated):0;
  console.log(`\n=== ${label} (created ${arg}) ===`);
  console.log(`Generated: ${generated}`);
  console.log(`Viewed:    ${viewed}  (${pctViewGen.toFixed(1)}% of generated)`);
  console.log(`Selected:  ${selected}`);
  console.log(`Paid:      ${paid}  (deposit_paid_at)`);
  console.log(`>> CONVERSION (paid % of viewed):   ${pctPaidView.toFixed(1)}%`);
  console.log(`   (paid % of generated):           ${pctPaidGen.toFixed(1)}%`);
}
funnel(real, 'ALL quotes');
funnel(real.filter(q=>q.createdBy===ben?.id), "BEN's quotes");
process.exit(0);
