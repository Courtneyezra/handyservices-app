
import { db } from '../server/db';
import { conversations } from '../shared/schema';
import { count } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, '../server/whatsapp_history.json');

async function main() {
    console.log("Checking Data State...");

    // 1. Check DB
    try {
        const result = await db.select({ count: count() }).from(conversations);
        console.log(`DB Conversations: ${result[0].count}`);

        const all = await db.query.conversations.findMany();
        console.log("Conversations:", JSON.stringify(all, null, 2));
    } catch (e) {
        console.error("DB Check Failed:", e);
    }

    // 2. Check JSON History
    if (fs.existsSync(HISTORY_FILE)) {
        const stats = fs.statSync(HISTORY_FILE);
        console.log(`Legacy History File exists: ${HISTORY_FILE} (${stats.size} bytes)`);
        const content = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        console.log(`Legacy Message Count: ${content.length}`);
    } else {
        console.log("No Legacy History File found.");
    }

    process.exit(0);
}

main();
