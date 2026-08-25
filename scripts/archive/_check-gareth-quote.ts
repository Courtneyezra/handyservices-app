import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes, invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const slug = '9fitx3o1';
let [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug)).limit(1);
if (!q) {
  // maybe full slug
  const all = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.slug, slug)).limit(1);
  q = all[0] as any;
}
if (!q) { console.log('quote not found for', slug); process.exit(1); }
console.log('FULL QUOTE:', JSON.stringify(q, null, 2));

const invs = await db.select().from(invoices).where(eq(invoices.quoteId, (q as any).id));
console.log('INVOICES:', JSON.stringify(invs, null, 2));
process.exit(0);
