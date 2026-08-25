import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { and, isNotNull, desc } from 'drizzle-orm';
async function main() {
  const rows = await db.select({ slug: personalizedQuotes.shortSlug, name: personalizedQuotes.customerName, base: personalizedQuotes.basePrice, pli: personalizedQuotes.pricingLineItems })
    .from(personalizedQuotes).where(isNotNull(personalizedQuotes.pricingLineItems)).orderBy(desc(personalizedQuotes.createdAt)).limit(120);
  let skuQuote: any = null, sample: any = null;
  const sources = new Set<string>();
  for (const r of rows) {
    const pli = (r.pli as any[]) || [];
    for (const l of pli) { if (l.source) sources.add(l.source); }
    if (!skuQuote && pli.some(l => l.source === 'sku' || l.skuCode || l.source === 'catalog')) {
      skuQuote = { slug: r.slug, name: r.name, base: r.base, lines: pli.map(l=>({d:l.description, src:l.source, sku:l.skuCode||l.sku_code, cat:l.category})) };
    }
    if (!sample) sample = pli[0];
  }
  console.log('distinct sources seen:', [...sources]);
  console.log('\nsample stored line keys:', sample ? Object.keys(sample) : 'none');
  console.log('\nfirst SKU/catalog quote:', skuQuote ? JSON.stringify(skuQuote, null, 1) : 'NONE FOUND (all custom)');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
