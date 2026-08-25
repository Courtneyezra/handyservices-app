import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { and, isNotNull, sql, desc } from 'drizzle-orm';
async function main() {
  const [q] = await db.select({ slug: personalizedQuotes.shortSlug, name: personalizedQuotes.customerName, vc: personalizedQuotes.viewCount })
    .from(personalizedQuotes)
    .where(and(isNotNull(personalizedQuotes.shortSlug), isNotNull(personalizedQuotes.basePrice)))
    .orderBy(desc(personalizedQuotes.createdAt)).limit(1);
  console.log(JSON.stringify(q));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
