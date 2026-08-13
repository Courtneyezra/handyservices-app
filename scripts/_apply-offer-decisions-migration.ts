/**
 * Apply migrations/20260812_quote_offer_decisions.sql — additive CREATE TABLE
 * IF NOT EXISTS only, safe to re-run. (Targeted DDL; never drizzle db:push.)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    const ddl = readFileSync(join(import.meta.dirname, '../migrations/20260812_quote_offer_decisions.sql'), 'utf8');
    const statements = ddl
        .replace(/--[^\n]*/g, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
    for (const stmt of statements) {
        await db.execute(sql.raw(stmt));
        console.log('OK:', stmt.slice(0, 70).replace(/\s+/g, ' '));
    }
    const check = await db.execute(sql.raw(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'quote_offer_decisions' ORDER BY ordinal_position",
    ));
    console.log('columns:', (check.rows as any[]).map((r) => r.column_name).join(', '));
    process.exit(0);
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
