import 'dotenv/config';
import { db } from '../server/db';
import { appSettings } from '../shared/schema';

async function checkSettings() {
    const settings = await db.select().from(appSettings);
    console.log(JSON.stringify(settings, null, 2));
    process.exit(0);
}

checkSettings();
