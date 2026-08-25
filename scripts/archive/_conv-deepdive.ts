import { db } from '../server/db';
import { personalizedQuotes as q } from '../shared/schema';
import { sql } from 'drizzle-orm';

// ---- test-data scrubbing (per project rules) ----
const isTest=(r:any)=>{
  const p=(r.phone||''); const id=(r.id||''); const nm=(r.customerName||''); const em=(r.email||'');
  return /^0?7700900/.test(p.replace(/\D/g,'')) || id.startsWith('test_q_') ||
    /\b(test|qa|phase|dummy|demo|sample)\b/i.test(nm) || /@example\.com$/i.test(em);
};

async function main(){
  const rows:any[] = await db.select().from(q);
  const cutoff = new Date('2026-04-01T00:00:00Z'); // real trends start (Stripe live)
  const clean = rows.filter(r=>!isTest(r) && r.createdAt && new Date(r.createdAt)>=cutoff);
  const viewed = clean.filter(r=>r.viewedAt);          // funnel: report paid-% of VIEWED
  const paidSet = clean.filter(r=>r.depositPaidAt);
  console.log(`Total quotes (post-Apr, non-test): ${clean.length}`);
  console.log(`Viewed: ${viewed.length} | Paid: ${paidSet.length}`);
  console.log(`Overall conversion (paid / viewed): ${(100*paidSet.length/viewed.length).toFixed(1)}%\n`);

  const pounds=(pence:number)=>pence? pence/100 : 0;
  const paid=(r:any)=>!!r.depositPaidAt;

  // generic breakdown helper on the VIEWED base
  const brk=(label:string, keyFn:(r:any)=>string|null, minN=6)=>{
    const m=new Map<string,{v:number,p:number}>();
    for(const r of viewed){ const k=keyFn(r); if(k==null) continue; const o=m.get(k)||{v:0,p:0}; o.v++; if(paid(r))o.p++; m.set(k,o); }
    const out=[...m.entries()].filter(([_,o])=>o.v>=minN).map(([k,o])=>({k,v:o.v,p:o.p,rate:100*o.p/o.v})).sort((a,b)=>b.rate-a.rate);
    if(!out.length) return;
    console.log(`\n### ${label}  (conv% = paid/viewed, n=viewed)`);
    for(const o of out) console.log(`  ${o.rate.toFixed(0).padStart(3)}%  (${o.p}/${o.v})  ${o.k}`);
  };

  // price buckets
  brk('PRICE BUCKET (basePrice)', r=>{const gbp=pounds(r.basePrice); if(!gbp)return null;
    if(gbp<100)return 'a <£100'; if(gbp<200)return 'b £100-200'; if(gbp<350)return 'c £200-350';
    if(gbp<600)return 'd £350-600'; if(gbp<1000)return 'e £600-1k'; if(gbp<1500)return 'f £1k-1.5k';
    if(gbp<2500)return 'g £1.5k-2.5k'; return 'h £2.5k+';});

  brk('SEGMENT', r=>r.segment||'UNKNOWN');
  brk('JOB TYPE', r=>r.jobType);
  brk('QUOTABILITY', r=>r.quotability);
  brk('SOURCE CHANNEL', r=>r.sourceChannel);
  brk('DESIRED TIMEFRAME', r=>r.desiredTimeframe);
  brk('URGENCY', r=>r.urgency);
  brk('OWNERSHIP CONTEXT', r=>r.ownershipContext);
  brk('PERSONA', r=>r.persona);
  brk('MATERIALS BY', r=>r.materialsBy);
  brk('SCHEDULING TIER', r=>r.schedulingTier);
  brk('PAYMENT TYPE', r=>r.paymentType);
  brk('CREATED BY', r=>r.createdByName||r.createdBy||null);
  brk('HAS CUSTOMER PHOTOS', r=>Array.isArray(r.customerPhotoUrls)&&r.customerPhotoUrls.length? 'photos':'no photos');
  brk('VIEW COUNT', r=>{const c=r.viewCount||0; if(c<=1)return '1 view'; if(c<=3)return '2-3 views'; if(c<=6)return '4-6 views'; return '7+ views';});
  brk('WAS REISSUED', r=>(r.regenerationCount>0||r.extensionCount>0)?'reissued/extended':'original');
  brk('DAY OF WEEK created', r=>{const d=new Date(r.createdAt).getUTCDay(); return ['0 Sun','1 Mon','2 Tue','3 Wed','4 Thu','5 Fri','6 Sat'][d];});
  brk('# TASKS (complexity)', r=>{const n=(r.tasks?.length||0)+(r.categories?.length||0); if(n===0)return null; if(n<=1)return '1 item'; if(n<=3)return '2-3 items'; if(n<=6)return '4-6 items'; return '7+ items';});

  // time-to-view (speed the customer opened it) among viewed
  console.log('\n### TIME-TO-FIRST-VIEW vs conversion');
  const ttv=(r:any)=> (new Date(r.viewedAt).getTime()-new Date(r.createdAt).getTime())/3600000;
  const tvb=(r:any)=>{const h=ttv(r); if(h<0.25)return 'a <15min'; if(h<1)return 'b 15-60min'; if(h<6)return 'c 1-6h'; if(h<24)return 'd 6-24h'; return 'e >24h';};
  const tm=new Map<string,{v:number,p:number}>();
  for(const r of viewed){const k=tvb(r);const o=tm.get(k)||{v:0,p:0};o.v++;if(paid(r))o.p++;tm.set(k,o);}
  [...tm.entries()].sort().forEach(([k,o])=>console.log(`  ${(100*o.p/o.v).toFixed(0).padStart(3)}%  (${o.p}/${o.v})  ${k}`));

  // avg price paid vs not
  const av=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
  console.log('\n### AVG QUOTE VALUE');
  console.log('  paid   £', av(paidSet.map(r=>pounds(r.basePrice)).filter(Boolean)).toFixed(0));
  console.log('  viewed-not-paid £', av(viewed.filter(r=>!paid(r)).map(r=>pounds(r.basePrice)).filter(Boolean)).toFixed(0));

  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
