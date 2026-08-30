/**
 * D-WP1 verification: run every server/pipeline/queries.ts helper, print
 * counts + 2 sample rows each, and cross-check one overdue invoice against
 * the raw invoices table. Read-only — zero writes.
 *
 * Run: npx tsx scripts/_verify-pipeline-queries.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import {
    listTodaysJobs,
    listUnassignedJobs,
    getContractorSchedule,
    listOverdueInvoices,
    listUnbilledCompletedJobs,
    getMoneySummary,
} from '../server/pipeline/queries';

function show(label: string, rows: unknown[]) {
    console.log(`\n=== ${label}: ${rows.length} row(s) ===`);
    for (const r of rows.slice(0, 2)) console.log(JSON.stringify(r));
}

async function main() {
    const todays = await listTodaysJobs();
    show('listTodaysJobs', todays);

    const unassigned = await listUnassignedJobs();
    show('listUnassignedJobs', unassigned);

    // Pick a contractor with jobs today (fall back to any assigned booking).
    let cid = todays.find((j) => j.contractorId)?.contractorId ?? null;
    if (!cid) {
        const r = await db.execute(sql`
            select coalesce(assigned_contractor_id, contractor_id) as cid
            from contractor_booking_requests
            where assignment_status in ('assigned','accepted','in_progress')
            order by scheduled_date desc nulls last limit 1`);
        cid = (r.rows[0] as any)?.cid ?? null;
    }
    if (cid) {
        const sched = await getContractorSchedule(cid);
        show(`getContractorSchedule(${cid}, today, 7d)`, sched);
    } else {
        console.log('\n=== getContractorSchedule: no assigned contractor found to test with ===');
    }

    const overdue = await listOverdueInvoices();
    show('listOverdueInvoices', overdue);

    // Cross-check the worst overdue invoice against the raw table.
    if (overdue.length > 0) {
        const raw = await db.execute(sql`
            select invoice_number, customer_name, status, balance_due,
                   to_char(due_date, 'YYYY-MM-DD') as due_date,
                   (sent_at is not null) as ever_sent
            from invoices where id = ${overdue[0].id}`);
        console.log('\n--- cross-check top overdue row vs raw invoices table ---');
        console.log('helper:', JSON.stringify(overdue[0]));
        console.log('raw   :', JSON.stringify(raw.rows[0]));
    }

    const unbilled = await listUnbilledCompletedJobs();
    show('listUnbilledCompletedJobs', unbilled);

    const summary = await getMoneySummary();
    console.log('\n=== getMoneySummary ===');
    console.log(JSON.stringify(summary, null, 2));

    process.exit(0);
}

main().catch((err) => {
    console.error('verify failed:', err);
    process.exit(1);
});
