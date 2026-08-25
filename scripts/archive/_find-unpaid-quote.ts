import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { and, isNull, isNotNull, desc, eq } from 'drizzle-orm';
async function main() {
  const rows = await db.select({ slug: personalizedQuotes.shortSlug, name: personalizedQuotes.customerName, base: personalizedQuotes.basePrice })
    .from(personalizedQuotes)
    .where(and(isNotNull(personalizedQuotes.shortSlug), isNotNull(personalizedQuotes.basePrice), isNull(personalizedQuotes.depositPaidAt), eq(personalizedQuotes.segment as any, 'CONTEXTUAL')))
    .orderBy(desc(personalizedQuotes.createdAt)).limit(8);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
