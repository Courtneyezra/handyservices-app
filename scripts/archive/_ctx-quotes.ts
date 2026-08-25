import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { and, isNotNull, sql, desc } from 'drizzle-orm';
async function main() {
  const rows = await db.select({
      slug: personalizedQuotes.shortSlug,
      name: personalizedQuotes.customerName,
      seg: personalizedQuotes.segment,
      tier: personalizedQuotes.layoutTier,
      items: sql<number>`jsonb_array_length(${personalizedQuotes.pricingLineItems})`,
      created: personalizedQuotes.createdAt,
    })
    .from(personalizedQuotes)
    .where(and(isNotNull(personalizedQuotes.shortSlug), isNotNull(personalizedQuotes.pricingLineItems)))
    .orderBy(desc(personalizedQuotes.createdAt)).limit(12);
  for (const r of rows) console.log(`${r.items}items  tier=${r.tier}  seg=${r.seg}  /quote/${r.slug}  ${r.name}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
