import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { inArray } from 'drizzle-orm';
const slugs = ['qa25fixd', 'qa25mixc', 'qa25tier'];
const r = await db.delete(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, slugs));
console.log(`Removed QA quotes: ${slugs.join(', ')}`);
process.exit(0);
