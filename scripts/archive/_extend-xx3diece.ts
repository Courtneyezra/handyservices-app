import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Mirrors QUOTE_VALIDITY_MS in server/quotes.ts
const QUOTE_VALIDITY_MS = 48 * 60 * 60 * 1000;

async function main() {
  const newExpiry = new Date(Date.now() + QUOTE_VALIDITY_MS);
  const [updated] = await db.update(personalizedQuotes)
    .set({ expiresAt: newExpiry })
    .where(eq(personalizedQuotes.shortSlug, 'xx3diece'))
    .returning({ slug: personalizedQuotes.shortSlug, expiresAt: personalizedQuotes.expiresAt });
  console.log(JSON.stringify(updated, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
