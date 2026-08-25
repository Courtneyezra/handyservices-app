import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [q] = await db.select({ jd: personalizedQuotes.jobDescription, li: personalizedQuotes.pricingLineItems, coords: personalizedQuotes.coordinates })
    .from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  const items = (q?.li as any[]) || [];
  console.log('jobDescription:', q?.jd);
  console.log('line items:', items.map((i:any)=>i.description||i.name||i.title).join(' | '));
  console.log('categories:', [...new Set(items.flatMap((i:any)=>i.categories||i.category||[]))]);
  console.log('has coords:', !!q?.coords);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
