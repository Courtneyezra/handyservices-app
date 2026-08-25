import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq, inArray } from 'drizzle-orm';
async function main() {
  const rows = await db.select({ slug: personalizedQuotes.shortSlug, segment: personalizedQuotes.segment, ctx: personalizedQuotes.contextSignals, items: personalizedQuotes.pricingLineItems })
    .from(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, ['hoprev01','faprev01']));
  for (const r of rows) {
    const ctx = r.ctx as any;
    console.log(r.slug, '| segment=', r.segment, '| customerType=', ctx?.customerType, '| vaContext=', (ctx?.vaContext||'').slice(0,40), '| lineItems=', (r.items as any[])?.length);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
