/**
 * Apply migrations/20260812_gift_claim_persistence.sql — additive ALTERs only,
 * safe to re-run. (Targeted DDL; never drizzle db:push.)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    const ddl = readFileSync(join(import.meta.dirname, '../migrations/20260812_gift_claim_persistence.sql'), 'utf8');
    const statements = ddl
        .replace(/--[^\n]*/g, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
    for (const stmt of statements) {
        await db.execute(sql.raw(stmt));
        console.log('OK:', stmt.replace(/\s+/g, ' ').slice(0, 80));
    }
    process.exit(0);
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
