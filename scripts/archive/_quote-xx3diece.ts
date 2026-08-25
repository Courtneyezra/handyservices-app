import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const [q] = await db.select({
    id: personalizedQuotes.id,
    slug: personalizedQuotes.shortSlug,
    name: personalizedQuotes.customerName,
    createdAt: personalizedQuotes.createdAt,
    expiresAt: personalizedQuotes.expiresAt,
    depositPaidAt: personalizedQuotes.depositPaidAt,
    viewCount: personalizedQuotes.viewCount,
  }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'xx3diece'));
  console.log(JSON.stringify(q, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
