/**
 * Remove DUMMY flexible-job test data seeded by `seed-dummy-flex-jobs.ts`.
 *
 * This script ONLY EVER touches rows whose quote id matches the frozen
 * test prefix `test_q_flex_`. It deletes children first (to respect FKs),
 * then the quotes themselves. It can never affect the ~77 real customer
 * jobs because every WHERE clause is anchored on `test_q_flex_%`.
 *
 * Usage:
 *   npx tsx scripts/cleanup-dummy-flex-jobs.ts
 */

import { db } from '../server/db';
import { sql } from 'drizzle-orm';

// ── Frozen test signature (must match the seed script) ────────────────
const LIKE_PATTERN = 'test_q_flex_%';

/** True if a table exists in the current database. */
async function tableExists(table: string): Promise<boolean> {
    const res = await db.execute(sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${table}
        LIMIT 1
    `);
    return res.rows.length > 0;
}

/** True if a column exists on a table in the current database. */
async function columnExists(table: string, column: string): Promise<boolean> {
    const res = await db.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
        LIMIT 1
    `);
    return res.rows.length > 0;
}

/**
 * Delete from a child table by its quote_id column, guarded so a missing
 * table/column is skipped (not fatal). RETURNING count gives exact rows.
 * The pattern is hard-coded to `test_q_flex_%` so this is always safe.
 */
async function deleteChild(table: string): Promise<number | null> {
    if (!(await tableExists(table))) {
        console.log(`  • ${table.padEnd(28)} skipped (table not present)`);
        return null;
    }
    if (!(await columnExists(table, 'quote_id'))) {
        console.log(`  • ${table.padEnd(28)} skipped (no quote_id column)`);
        return null;
    }
    // sql.raw is safe here: `table` is one of our own hard-coded literals,
    // never user input. The value (the LIKE pattern) is still parameterised.
    const res = await db.execute(
        sql`DELETE FROM ${sql.raw(table)} WHERE quote_id LIKE ${LIKE_PATTERN}`,
    );
    const n = res.rowCount ?? 0;
    console.log(`  • ${table.padEnd(28)} removed ${n}`);
    return n;
}

async function main() {
    console.log(`\nCleaning up DUMMY flex jobs matching id LIKE '${LIKE_PATTERN}' ...\n`);

    // Safety: count exactly what we're about to remove up front.
    const pre = await db.execute(
        sql`SELECT count(*)::int AS n FROM personalized_quotes WHERE id LIKE ${LIKE_PATTERN}`,
    );
    const preCount = (pre.rows[0] as { n: number }).n;
    console.log(`  ${preCount} dummy quote(s) currently present.\n`);

    if (preCount === 0) {
        console.log('  Nothing to clean up. DB is already free of test_q_flex rows.\n');
        process.exit(0);
    }

    let total = 0;
    try {
        // 1-3: children first, FK-safe. Each guarded for missing table/column.
        const a = await deleteChild('contractor_booking_requests');
        const b = await deleteChild('job_sheets');
        const c = await deleteChild('invoices');

        // 4: the quotes themselves — the parent rows.
        const res = await db.execute(
            sql`DELETE FROM personalized_quotes WHERE id LIKE ${LIKE_PATTERN}`,
        );
        const parent = res.rowCount ?? 0;
        console.log(`  • personalized_quotes        removed ${parent}`);

        total = (a ?? 0) + (b ?? 0) + (c ?? 0) + parent;
    } catch (err: any) {
        console.error(`\n✗ Cleanup failed: ${err.message}`);
        process.exit(1);
    }

    // Verify nothing matching the prefix remains.
    const post = await db.execute(
        sql`SELECT count(*)::int AS n FROM personalized_quotes WHERE id LIKE ${LIKE_PATTERN}`,
    );
    const postCount = (post.rows[0] as { n: number }).n;

    console.log(`\n  Total rows removed (incl. children): ${total}`);
    console.log(`  Remaining test_q_flex quotes: ${postCount}`);
    if (postCount === 0) {
        console.log('\n✓ DB is clean — exactly the dummies were removed.\n');
        process.exit(0);
    } else {
        console.error(`\n✗ ${postCount} dummy quote(s) still present — investigate.\n`);
        process.exit(1);
    }
}

main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
});
