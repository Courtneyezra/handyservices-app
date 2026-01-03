import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function addElevenLabsColumns() {
    try {
        console.log('Adding ElevenLabs columns to leads table...');

        await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS eleven_labs_conversation_id VARCHAR;`);
        console.log('- Added eleven_labs_conversation_id');

        await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS eleven_labs_summary TEXT;`);
        console.log('- Added eleven_labs_summary');

        await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS eleven_labs_recording_url TEXT;`);
        console.log('- Added eleven_labs_recording_url');

        await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS eleven_labs_success_score INTEGER;`);
        console.log('- Added eleven_labs_success_score');

        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (e) {
        console.error('Migration failed:', e);
        process.exit(1);
    }
}

addElevenLabsColumns();
