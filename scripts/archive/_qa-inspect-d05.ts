import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'qd2505'));
console.log(JSON.stringify(q?.pricingLineItems, null, 2));
process.exit(0);
