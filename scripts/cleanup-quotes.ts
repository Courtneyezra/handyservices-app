
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNull } from 'drizzle-orm';

async function cleanup() {
    console.log('Cleaning up invalid quotes...');
    try {
        const res = await db.delete(personalizedQuotes).where(isNull(personalizedQuotes.contractorId));
        console.log('Deleted quotes count:', res.rowCount);
    } catch (e) {
        console.error('Error cleaning up:', e);
    }
    process.exit(0);
}
cleanup();
