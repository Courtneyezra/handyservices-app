import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [u] = await db.update(personalizedQuotes)
    .set({ expiresAt: new Date(Date.now() + 7*24*3600*1000) })
    .where(eq(personalizedQuotes.shortSlug, 'hoprev01'))
    .returning({ slug: personalizedQuotes.shortSlug, expiresAt: personalizedQuotes.expiresAt });
  console.log('EXTENDED:', JSON.stringify(u));
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
