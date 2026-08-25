import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes, invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'xx3diece')).limit(1);
if (!q) { console.log('quote not found'); process.exit(1); }
const { id, shortSlug, customerName, status, basePrice, depositPaidAt, bookedAt, jobDescription, address, postcode } = q as any;
console.log('QUOTE:', JSON.stringify({ id, shortSlug, customerName, status, basePrice, depositPaidAt, bookedAt, jobDescription, address, postcode }, null, 2));
console.log('lineItems:', JSON.stringify((q as any).lineItems ?? (q as any).quoteLineItems ?? null, null, 2));

const invs = await db.select().from(invoices).where(eq(invoices.quoteId, id));
console.log('INVOICES:', JSON.stringify(invs, null, 2));
process.exit(0);
