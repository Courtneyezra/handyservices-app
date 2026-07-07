import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { inArray } from 'drizzle-orm';
const slugs = ['qd2501','qd2502','qd2503','qd2504','qd2505','qd2506','qd2507','qd2508','qd2509','qd2510','qd2511','qd2512'];
await db.delete(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, slugs));
console.log('Removed Phase 26 QA quotes');
process.exit(0);
