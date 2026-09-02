/**
 * Export conversation_memory before the Phase 5 DROP (migrations/20260903_drop_conversation_memory.sql).
 *
 *   npx tsx scripts/_export-conversation-memory.ts                 # → server/storage/archive/conversation_memory-<YYYY-MM-DD>.json
 *   npx tsx scripts/_export-conversation-memory.ts --out <path>    # elsewhere
 *   npx tsx scripts/_export-conversation-memory.ts --force         # overwrite an existing file
 *
 * READ-ONLY on the database (one SELECT *, plus count/max(updated_at) for the log line). The table
 * is gone from shared/schema.ts (Phase 5), so this reads it by raw SQL. Writes ONE file under
 * server/storage/archive/ (gitignored: it holds customer thread summaries). The orchestrator then
 * applies the commented DROP by hand, per the migration's note. Refuses to overwrite without --force.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../server/db';

const TABLE = 'conversation_memory';
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const outIdx = argv.indexOf('--out');
const day = new Date().toISOString().slice(0, 10);
const outPath = outIdx >= 0 && argv[outIdx + 1]
    ? path.resolve(argv[outIdx + 1])
    : path.resolve(process.cwd(), 'server/storage/archive', `${TABLE}-${day}.json`);

async function main() {
    const reg = await db.execute(sql`SELECT to_regclass(${TABLE}) AS reg`);
    if (!(reg.rows[0] as any)?.reg) {
        console.log(`${TABLE} does not exist in this database (already dropped?). Nothing to export.`);
        process.exit(0);
    }
    if (fs.existsSync(outPath) && !FORCE) {
        console.error(`${outPath} exists. Add --force to overwrite, or --out <path>.`);
        process.exit(2);
    }
    const cols = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${TABLE} ORDER BY ordinal_position`);
    const columns = cols.rows.map((r: any) => ({ name: r.column_name, type: r.data_type }));
    const hasUpdatedAt = columns.some((c) => c.name === 'updated_at');
    const meta = await db.execute(hasUpdatedAt
        ? sql`SELECT count(*)::int AS n, max(updated_at) AS last FROM conversation_memory`
        : sql`SELECT count(*)::int AS n, NULL AS last FROM conversation_memory`);
    const { n, last } = meta.rows[0] as any;
    const rows = (await db.execute(sql`SELECT * FROM conversation_memory`)).rows;

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const payload = {
        table: TABLE,
        exportedAt: new Date().toISOString(),
        database: (process.env.DATABASE_URL ?? '').replace(/^.*@/, '').replace(/[/?].*$/, ''),
        rowCount: rows.length,
        maxUpdatedAt: last ?? null,
        columns,
        rows,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 1));
    const size = fs.statSync(outPath).size;
    console.log(`${TABLE}: ${rows.length} rows (count(*)=${n}, max(updated_at)=${last ?? 'n/a'}), ${columns.length} columns`);
    console.log(`wrote ${outPath} (${(size / 1024).toFixed(1)} KB, gitignored)`);
    console.log(`Next: confirm the file opens, then apply the DROP by hand — migrations/20260903_drop_conversation_memory.sql (uncomment, run once).`);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
