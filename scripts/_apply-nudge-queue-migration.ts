/** Apply migrations/20260814_nudge_queue.sql — additive, safe to re-run. */
import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    const ddl = readFileSync(join(import.meta.dirname, '../migrations/20260814_nudge_queue.sql'), 'utf8');
    const statements = ddl.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
        await db.execute(sql.raw(stmt));
        console.log('OK:', stmt.replace(/\s+/g, ' ').slice(0, 70));
    }
    process.exit(0);
}
main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
