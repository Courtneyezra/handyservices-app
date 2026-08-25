import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { and, isNotNull, sql, desc } from 'drizzle-orm';
async function main() {
  const rows = await db.select({ slug: personalizedQuotes.shortSlug, name: personalizedQuotes.customerName, base: personalizedQuotes.basePrice, pli: personalizedQuotes.pricingLineItems })
    .from(personalizedQuotes)
    .where(and(isNotNull(personalizedQuotes.pricingLineItems), isNotNull(personalizedQuotes.basePrice)))
    .orderBy(desc(personalizedQuotes.createdAt)).limit(8);
  for (const r of rows) {
    const n = Array.isArray(r.pli) ? r.pli.length : 0;
    if (n >= 2 && !/test|edittest/i.test(r.name||'')) {
      console.log(`slug=${r.slug} name="${r.name}" base=£${((r.base||0)/100).toFixed(2)} lines=${n}`);
      console.log('  descriptions:', (r.pli as any[]).map(l=>l.description).join(' | '));
      break;
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
