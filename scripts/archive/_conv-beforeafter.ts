import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const NT = sql`(id NOT LIKE 'test\_q\_%' AND (phone IS NULL OR (phone NOT LIKE '%447700900%' AND phone NOT LIKE '%07700900%' AND phone NOT LIKE '%449900001%')) AND (email IS NULL OR email NOT LIKE '%@example.com') AND (customer_name IS NULL OR customer_name !~* '\\b(test|qa|phase|debug|preview|dummy|sample)\\b'))`;
// conversion = paid % of VIEWED, bucket by view date
async function win(name:string, lo:string, hi:string){
  const r = await db.execute(sql`
    SELECT count(*) FILTER (WHERE viewed_at IS NOT NULL)::int AS viewed,
           count(*) FILTER (WHERE deposit_paid_at IS NOT NULL)::int AS paid
    FROM personalized_quotes
    WHERE ${NT} AND viewed_at >= ${lo} AND viewed_at < ${hi}`);
  const x = r.rows[0] as any;
  return { name, viewed:x.viewed, paid:x.paid, p: x.viewed? x.paid/x.viewed : 0 };
}
function ci(p:number,n:number){ if(!n) return [0,0]; const se=Math.sqrt(p*(1-p)/n); return [Math.max(0,p-1.96*se), Math.min(1,p+1.96*se)]; }
function ztest(a:any,b:any){ // 2-proportion z, is b different from a
  const p=(a.paid+b.paid)/(a.viewed+b.viewed);
  const se=Math.sqrt(p*(1-p)*(1/a.viewed+1/b.viewed));
  const z=(b.p-a.p)/se; const pval=2*(1-normcdf(Math.abs(z)));
  return {z:z.toFixed(2), pval:pval.toFixed(3)};
}
function normcdf(x:number){ return 0.5*(1+erf(x/Math.SQRT2)); }
function erf(x:number){ const t=1/(1+0.3275911*Math.abs(x)); const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x); return x>=0?y:-y; }

const A = await win('① BEFORE page (May1–Jun26)      ', '2026-05-01','2026-06-27');
const B = await win('② PAGE only, pre-GW (Jun27–Jul2)', '2026-06-27','2026-07-03');
const C = await win('③ PAGE + Groundwire (Jul3–now)  ', '2026-07-03','2026-08-01');
for(const w of [A,B,C]){ const [l,h]=ci(w.p,w.viewed); console.log(`${w.name} viewed ${String(w.viewed).padStart(3)}  paid ${String(w.paid).padStart(3)}  conv ${(100*w.p).toFixed(1)}%  (95% CI ${(100*l).toFixed(0)}–${(100*h).toFixed(0)}%)`); }
console.log('\nIsolating the PAGE (② vs ①, same lead source, no Groundwire):');
const t1=ztest(A,B); console.log(`  ${(100*A.p).toFixed(1)}% → ${(100*B.p).toFixed(1)}%   z=${t1.z}  p=${t1.pval}  ${+t1.pval<0.05?'SIGNIFICANT':'NOT significant (within noise)'}`);
console.log('\nPage+Groundwire vs before (③ vs ①, confounded):');
const t2=ztest(A,C); console.log(`  ${(100*A.p).toFixed(1)}% → ${(100*C.p).toFixed(1)}%   z=${t2.z}  p=${t2.pval}  ${+t2.pval<0.05?'SIGNIFICANT':'NOT significant'}`);
process.exit(0);
