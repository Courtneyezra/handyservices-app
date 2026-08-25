import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
const QUOTE_VALIDITY_MS = 48 * 60 * 60 * 1000;
async function main() {
  const newExpiry = new Date(Date.now() + QUOTE_VALIDITY_MS);
  const [u] = await db.update(personalizedQuotes)
    .set({ expiresAt: newExpiry })
    .where(eq(personalizedQuotes.shortSlug, 'tstprev1'))
    .returning({ slug: personalizedQuotes.shortSlug, expiresAt: personalizedQuotes.expiresAt, name: personalizedQuotes.customerName });
  console.log(JSON.stringify(u, null, 2));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
