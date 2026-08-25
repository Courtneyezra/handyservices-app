import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const NOT_TEST = sql`(id NOT LIKE 'test\_q\_%' AND (phone IS NULL OR (phone NOT LIKE '%447700900%' AND phone NOT LIKE '%07700900%' AND phone NOT LIKE '%449900001%')) AND (email IS NULL OR email NOT LIKE '%@example.com') AND (customer_name IS NULL OR customer_name !~* '\\b(test|qa|phase|debug|preview|dummy|sample)\\b'))`;
const mcol = sql`to_char(date_trunc('month', created_at),'YYYY-MM')`;
// conversion = paid % of VIEWED, cohort by created-month
async function by(dim: any, label: string){
  const r = await db.execute(sql`
    SELECT ${mcol} AS mth, ${dim} AS grp,
      count(*) FILTER (WHERE viewed_at IS NOT NULL)::int AS viewed,
      count(*) FILTER (WHERE deposit_paid_at IS NOT NULL)::int AS paid
    FROM personalized_quotes
    WHERE ${NOT_TEST} AND created_at >= '2026-05-01' AND viewed_at IS NOT NULL
    GROUP BY 1,2 ORDER BY 2,1`);
  console.log(`\n=== ${label} (conv = paid % of viewed) ===`);
  const rows = r.rows as any[];
  const grps = [...new Set(rows.map(x=>x.grp))];
  console.log(`${'group'.padEnd(16)} | May          | Jun          | Jul`);
  for (const g of grps){
    const cells = ['2026-05','2026-06','2026-07'].map(m=>{
      const x = rows.find(r=>r.grp===g && r.mth===m);
      if(!x||x.viewed===0) return '  –        ';
      const c = (100*x.paid/x.viewed).toFixed(0);
      return `${String(x.paid)}/${String(x.viewed)} ${c.padStart(3)}%`.padEnd(12);
    });
    console.log(`${String(g??'—').padEnd(16)} | ${cells[0]} | ${cells[1]} | ${cells[2]}`);
  }
}
const band = sql`CASE WHEN base_price<10000 THEN '1 <£100' WHEN base_price<20000 THEN '2 £100-200' WHEN base_price<50000 THEN '3 £200-500' WHEN base_price<100000 THEN '4 £500-1k' ELSE '5 £1k+' END`;
await by(band, 'PRICE BAND');
await by(sql`segment`, 'SEGMENT');
await by(sql`persona`, 'PERSONA');
await by(sql`COALESCE(source_channel,'(none)')`, 'SOURCE CHANNEL');
// time-to-pay
const t = await db.execute(sql`
  SELECT ${mcol} AS mth,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL)::int AS paid,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (deposit_paid_at - viewed_at))/3600) FILTER (WHERE deposit_paid_at IS NOT NULL)::numeric,1) AS median_hrs
  FROM personalized_quotes WHERE ${NOT_TEST} AND created_at >= '2026-05-01' AND viewed_at IS NOT NULL GROUP BY 1 ORDER BY 1`);
console.log(`\n=== TIME-TO-PAY (median hrs viewed→paid) ===`);
for(const x of t.rows as any[]) console.log(`${x.mth}  paid ${x.paid}  median ${x.median_hrs}h`);
process.exit(0);
