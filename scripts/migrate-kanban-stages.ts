/**
 * One-off data migration: /admin/comms board stages from conversation-mechanics to FUNNEL.
 *
 *   new     → enquiry      (new + unanswered, SLA clock running)
 *   active  → scoping      (in conversation, gathering what a quote needs)
 *   waiting → quote_sent   when the thread is tagged 'quote_sent' OR a non-draft
 *                          personalized_quote exists for the phone; otherwise scoping
 *                          ('waiting' meant "ball in their court", which without a quote
 *                          out is just an in-progress conversation)
 *   closed  → closed       (unchanged)
 *
 * conversations.stage is a plain varchar — no enum DDL involved, pure row updates.
 * Idempotent: rerunning finds nothing left in the old vocabulary. Reports per-stage
 * row counts before and after.
 *
 *   npx tsx scripts/migrate-kanban-stages.ts --dry-run   # counts + what would change
 *   npx tsx scripts/migrate-kanban-stages.ts             # migrate
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function stageCounts(label: string): Promise<void> {
    const rows = await db.execute(sql`
        SELECT coalesce(stage, '(null)') AS stage, count(*)::int AS n
        FROM conversations GROUP BY 1 ORDER BY 2 DESC
    `);
    console.log(`\n${label}:`);
    for (const r of rows.rows as any[]) console.log(`  ${String(r.stage).padEnd(12)} ${r.n}`);
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    await stageCounts('BEFORE (rows per stage)');

    // How the waiting column will split, decided BEFORE mutating anything.
    const waitingSplit = await db.execute(sql`
        SELECT
            count(*) FILTER (WHERE 'quote_sent' = ANY(coalesce(tags, '{}'))
                OR EXISTS (
                    SELECT 1 FROM personalized_quotes q
                    WHERE regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g')
                        = regexp_replace(c.phone_number, '[^0-9]', '', 'g')
                    AND coalesce(q.is_draft, false) = false
                ))::int AS to_quote_sent,
            count(*)::int AS total
        FROM conversations c WHERE c.stage = 'waiting'
    `);
    const split = (waitingSplit.rows as any[])[0] ?? { to_quote_sent: 0, total: 0 };
    console.log(`\nwaiting split: ${split.to_quote_sent} → quote_sent, ${split.total - split.to_quote_sent} → scoping`);

    if (dryRun) {
        console.log('\nDry run — nothing written.');
        process.exit(0);
    }

    const newRes = await db.execute(sql`
        UPDATE conversations SET stage = 'enquiry', updated_at = now() WHERE stage = 'new'
    `);
    console.log(`\nnew     → enquiry:     ${newRes.rowCount ?? 0} rows`);

    const activeRes = await db.execute(sql`
        UPDATE conversations SET stage = 'scoping', updated_at = now() WHERE stage = 'active'
    `);
    console.log(`active  → scoping:     ${activeRes.rowCount ?? 0} rows`);

    const waitingQuoteRes = await db.execute(sql`
        UPDATE conversations c SET stage = 'quote_sent', updated_at = now()
        WHERE c.stage = 'waiting'
        AND ('quote_sent' = ANY(coalesce(c.tags, '{}'))
            OR EXISTS (
                SELECT 1 FROM personalized_quotes q
                WHERE regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g')
                    = regexp_replace(c.phone_number, '[^0-9]', '', 'g')
                AND coalesce(q.is_draft, false) = false
            ))
    `);
    console.log(`waiting → quote_sent:  ${waitingQuoteRes.rowCount ?? 0} rows`);

    const waitingScopingRes = await db.execute(sql`
        UPDATE conversations SET stage = 'scoping', updated_at = now() WHERE stage = 'waiting'
    `);
    console.log(`waiting → scoping:     ${waitingScopingRes.rowCount ?? 0} rows`);

    await stageCounts('AFTER (rows per stage)');
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
