import { db } from '../server/db';
import { users, personalizedQuotes } from '../shared/schema';
import { and, eq, gte, lt, isNotNull } from 'drizzle-orm';
const arg = process.argv[2];
const [y,m] = arg.split('-').map(Number);
const start = new Date(Date.UTC(y, m-1, 1));
const end = new Date(Date.UTC(m===12?y+1:y, m===12?0:m, 1));
const isTest = (q:any)=> (q.id??'').startsWith('test_q_') || /07700900|447700900|449900001/.test((q.phone??'').replace(/\D/g,'')) || /@example\.com$/i.test(q.email??'') || /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.customerName??'');
const materials=(q:any)=>{let mat=0;((q.pricingLineItems as any[])||[]).forEach(it=>mat+=(it.materialsWithMarginPence??0));if(mat===0&&q.materialsCostWithMarkupPence)mat=q.materialsCostWithMarkupPence;return mat/100;};
const [ben]=await db.select({id:users.id}).from(users).where(eq(users.firstName,'Ben'));
const rows=(await db.select().from(personalizedQuotes).where(and(eq(personalizedQuotes.createdBy,ben.id),isNotNull(personalizedQuotes.selectedAt),gte(personalizedQuotes.selectedAt,start),lt(personalizedQuotes.selectedAt,end)))) as any[];
for(const q of rows.filter(r=>!isTest(r)).sort((a,b)=>+a.selectedAt-+b.selectedAt)){
  const rev=(q.basePrice??0)/100, mat=materials(q), lab=rev-mat;
  console.log(`| ${q.selectedAt.toISOString().slice(0,10)} | ${(q.customerName??'—').trim()} | £${rev.toFixed(2)} | £${mat.toFixed(2)} | £${lab.toFixed(2)} | £${(lab*0.1).toFixed(2)} |${q.bookedAt?' ✓':''}`);
}
process.exit(0);
