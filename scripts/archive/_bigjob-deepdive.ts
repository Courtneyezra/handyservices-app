import { db } from '../server/db';
import { personalizedQuotes as q } from '../shared/schema';
const isTest=(r:any)=>{const p=(r.phone||'');const id=(r.id||'');const nm=(r.customerName||'');const em=(r.email||'');
  return /^0?7700900/.test(p.replace(/\D/g,''))||id.startsWith('test_q_')||/\b(test|qa|phase|dummy|demo|sample)\b/i.test(nm)||/@example\.com$/i.test(em);};
async function main(){
  const rows:any[]=await db.select().from(q);
  const cutoff=new Date('2026-04-01T00:00:00Z');
  const clean=rows.filter(r=>!isTest(r)&&r.createdAt&&new Date(r.createdAt)>=cutoff);
  const P=(p:number)=>p?p/100:0;
  // big = basePrice >= £1000, viewed
  const big=clean.filter(r=>P(r.basePrice)>=1000 && r.viewedAt);
  const paid=big.filter(r=>r.depositPaidAt); const lost=big.filter(r=>!r.depositPaidAt);
  console.log(`£1k+ viewed quotes: ${big.length} | paid: ${paid.length} | lost: ${lost.length} | conv ${(100*paid.length/big.length).toFixed(0)}%\n`);

  const av=(a:number[])=>a.length?(a.reduce((x,y)=>x+y,0)/a.length):0;
  const med=(a:number[])=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
  const cmp=(label:string,fn:(r:any)=>number)=>console.log(`${label.padEnd(26)} paid ${av(paid.map(fn)).toFixed(1).padStart(7)} | lost ${av(lost.map(fn)).toFixed(1).padStart(7)}  (med ${med(paid.map(fn))} vs ${med(lost.map(fn))})`);
  console.log('=== PAID vs LOST (£1k+) averages ===');
  cmp('basePrice £',r=>P(r.basePrice));
  cmp('view count',r=>r.viewCount||0);
  cmp('# tasks',r=>r.tasks?.length||0);
  cmp('# categories',r=>r.categories?.length||0);
  cmp('# optional extras',r=>Array.isArray(r.optionalExtras)?r.optionalExtras.length:0);
  cmp('materials cost £',r=>P(r.materialsCostWithMarkupPence));
  cmp('regen count',r=>r.regenerationCount||0);

  const share=(label:string,pred:(r:any)=>boolean)=>{const pp=paid.filter(pred).length,ll=lost.filter(pred).length;
    console.log(`${label.padEnd(30)} paid ${(100*pp/paid.length).toFixed(0)}% | lost ${(100*ll/lost.length).toFixed(0)}%`);};
  console.log('\n=== share with feature ===');
  share('used installments/pay-in-3',r=>r.paymentType==='installments'||r.totalInstallments>1&&r.installmentStatus);
  share('has optional extras offered',r=>Array.isArray(r.optionalExtras)&&r.optionalExtras.length>0);
  share('deferred line items (split)',r=>Array.isArray(r.deferredLineItems)&&r.deferredLineItems.length>0);
  share('source = call',r=>r.sourceChannel==='call');
  share('viewed 4+ times',r=>(r.viewCount||0)>=4);
  share('viewed only once',r=>(r.viewCount||0)<=1);
  share('reissued/extended',r=>r.regenerationCount>0||r.extensionCount>0);

  // price sub-bands within 1k+
  console.log('\n=== conversion by band within £1k+ ===');
  const band=(r:any)=>{const g=P(r.basePrice);if(g<1500)return 'a £1-1.5k';if(g<2000)return 'b £1.5-2k';if(g<3000)return 'c £2-3k';if(g<5000)return 'd £3-5k';return 'e £5k+';};
  const m=new Map<string,{n:number,p:number}>();
  for(const r of big){const k=band(r);const o=m.get(k)||{n:0,p:0};o.n++;if(r.depositPaidAt)o.p++;m.set(k,o);}
  [...m.entries()].sort().forEach(([k,o])=>console.log(`  ${(100*o.p/o.n).toFixed(0).padStart(3)}% (${o.p}/${o.n}) ${k}`));

  // list the paid ones — what do winning big jobs look like
  console.log('\n=== the big jobs that PAID ===');
  paid.sort((a,b)=>P(b.basePrice)-P(a.basePrice)).forEach(r=>console.log(`  £${P(r.basePrice).toFixed(0).padEnd(6)} views=${String(r.viewCount||0).padStart(2)} extras=${Array.isArray(r.optionalExtras)?r.optionalExtras.length:0} split=${Array.isArray(r.deferredLineItems)&&r.deferredLineItems.length?'Y':'-'} | ${(r.jobDescription||'').slice(0,60).replace(/\n/g,' ')}`));
  console.log('\n=== a sample of big jobs that were LOST (top value) ===');
  lost.sort((a,b)=>P(b.basePrice)-P(a.basePrice)).slice(0,15).forEach(r=>console.log(`  £${P(r.basePrice).toFixed(0).padEnd(6)} views=${String(r.viewCount||0).padStart(2)} | ${(r.jobDescription||'').slice(0,60).replace(/\n/g,' ')}`));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
