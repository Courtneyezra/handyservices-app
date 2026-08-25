import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const r = await db.execute(sql`SELECT id, short_slug, base_price, materials_cost_with_markup_pence, batch_discount_percent, pricing_line_items FROM personalized_quotes WHERE short_slug IN ('faprev01','guarprev') LIMIT 2`);
  for (const row of r.rows as any[]) {
    const li = row.pricing_line_items || [];
    const raw = (l:any)=> (l.guardedPricePence||0)+(l.materialsWithMarginPence||0)+(l.structuralSharePence||0);
    const gross = li.reduce((s:number,l:any)=>s+raw(l),0);
    console.log('\n===', row.short_slug, '===');
    console.log('base_price(pence):', row.base_price, '| batch%:', row.batch_discount_percent, '| materials:', row.materials_cost_with_markup_pence);
    console.log('lineSum gross(pence):', gross, '| gross*(1-batch%):', Math.round(gross*(1-(row.batch_discount_percent||0)/100)));
    console.log('lines:', JSON.stringify(li.map((l:any)=>({id:l.lineId, g:l.guardedPricePence, m:l.materialsWithMarginPence||0, s:l.structuralSharePence||0, raw:raw(l), cat:l.category}))));
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
