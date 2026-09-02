/**
 * APPROVER BACKFILL — rewrite pre-Phase-0 `message_drafts.approved_by` strings to enum values.
 *
 *   npx tsx scripts/_approver-backfill.ts            # DRY RUN: counts per mapping, nothing written
 *   npx tsx scripts/_approver-backfill.ts --apply    # one transaction of UPDATEs + a system_events row
 *
 * Mapping lives in server/approver-backfill.ts (pure, tested). Unmapped values are printed and left
 * alone. After a clean apply, the legacy prefixes in isAutomatedApprover (server/approver.ts) can go.
 * DO NOT run this until the legacy agent is retired and the spine is live (PHASE5-LEGACY-RETIRE.md).
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { planBackfill, renderPlan } from '../server/approver-backfill';
import { logSystemEvent } from '../server/system-events';

const APPLY = process.argv.includes('--apply');

async function main() {
    console.log(`Approver backfill (${APPLY ? 'APPLY' : 'DRY RUN'})\n`);
    const r: any = await db.execute(sql`
        SELECT approved_by AS "approvedBy", count(*)::int AS count
        FROM message_drafts
        WHERE approved_by IS NOT NULL
        GROUP BY approved_by
        ORDER BY count DESC`);
    const distinct = (r.rows ?? r) as Array<{ approvedBy: string | null; count: number }>;
    const plan = planBackfill(distinct);
    console.log(renderPlan(plan));
    if (!APPLY) {
        console.log('\nDry run only. Re-run with --apply to write.');
        process.exit(0);
    }
    const updates = plan.rows.filter((x) => x.to && x.to !== x.from);
    if (!updates.length) { console.log('\nNothing to update.'); process.exit(0); }
    let changed = 0;
    await db.transaction(async (tx) => {
        for (const u of updates) {
            const res: any = await tx.execute(sql`UPDATE message_drafts SET approved_by = ${u.to} WHERE approved_by = ${u.from}`);
            const n = Number(res.rowCount ?? res.affectedRows ?? u.count);
            changed += Number.isFinite(n) ? n : u.count;
            console.log(`  ${u.from} → ${u.to}: ${n} row(s)`);
        }
    });
    await logSystemEvent({
        kind: 'config_change', source: 'approver-backfill',
        summary: `approver backfill: ${changed} message_drafts.approved_by rows rewritten to enum values (${updates.length} distinct legacy values)`,
        detail: { mappings: updates.map((u) => ({ from: u.from, to: u.to, rule: u.rule, count: u.count })), totals: plan.totals, unmapped: plan.rows.filter((x) => x.rule === 'unmapped').map((x) => ({ value: x.from, count: x.count })) },
    });
    console.log(`\nDone: ${changed} rows updated in one transaction; system_events row written.`);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
