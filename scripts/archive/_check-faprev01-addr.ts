import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [q] = await db.select({ addr: personalizedQuotes.address }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  console.log('address in DB:', JSON.stringify(q?.addr));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
