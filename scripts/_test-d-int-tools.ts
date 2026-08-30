/**
 * D-INT sanity: the four Track-D tools exist on the ops manager and behave at
 * their gates. Touches the live DB but leaves NOTHING behind: the only write
 * paths exercised are refusals (bad job id, completed job) which never insert.
 *
 * Run: npx tsx scripts/_test-d-int-tools.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../server/db';
import { buildTools } from '../server/agents/ops-manager';

let failures = 0;
function check(ok: boolean, label: string) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
    if (!ok) failures++;
}

async function main() {
    const tools = buildTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    console.log('tool count:', tools.length);
    for (const n of ['get_jobs', 'get_money_state', 'get_customer_dossier', 'propose_job_assignment']) {
        check(byName.has(n), `${n} present`);
    }

    // get_jobs — all three views run; bad view throws.
    const jobs = byName.get('get_jobs')!;
    const today: any = await jobs.run({ view: 'today' });
    check(Array.isArray(today.jobs), `get_jobs today → ${today.jobs.length} rows`);
    const unassigned: any = await jobs.run({ view: 'unassigned' });
    check(Array.isArray(unassigned.jobs), `get_jobs unassigned → ${unassigned.jobs.length} rows`);
    const badView = await jobs.run({ view: 'nope' }).then(() => false, () => true);
    check(badView, 'get_jobs unknown view throws');
    const noContractor = await jobs.run({ view: 'contractor_schedule' }).then(() => false, () => true);
    check(noContractor, 'get_jobs contractor_schedule without id throws');

    // get_money_state — summary + both lists in one shot.
    const money: any = await byName.get('get_money_state')!.run({});
    check(typeof money.summary?.overdue?.count === 'number', `get_money_state summary (overdue count ${money.summary?.overdue?.count})`);
    check(Array.isArray(money.overdueInvoices) && Array.isArray(money.unbilledCompletedJobs), 'get_money_state lists present');
    check(money.overdueInvoices.every((i: any) => typeof i.everSent === 'boolean'), 'overdue rows carry everSent');

    // get_customer_dossier — unknown number is empty-but-well-formed.
    const dossier: any = await byName.get('get_customer_dossier')!.run({ phone: '+447999999998' });
    check(dossier.summary?.counts && dossier.leads?.length === 0, 'dossier unknown number → empty well-formed');

    // propose_job_assignment — refusals only, nothing inserted.
    const propose = byName.get('propose_job_assignment')!;
    const badJob: any = await propose.run({ jobId: 'no-such-job', contractorId: 'no-such-contractor', note: 'test' });
    check(badJob.proposed === false && /not found/i.test(badJob.refusal), 'propose unknown job → refusal');
    const [completedJob] = (await db.execute(sql`select id from contractor_booking_requests where status = 'completed' limit 1`)).rows as any[];
    if (completedJob) {
        const done: any = await propose.run({ jobId: completedJob.id, contractorId: 'irrelevant', note: 'test' });
        check(done.proposed === false, `propose completed job → refusal (${done.refusal})`);
    }
    const [{ count }] = (await db.execute(sql`select count(*)::int as count from assignment_proposals`)).rows as any[];
    check(count === 0, `assignment_proposals still empty (${count} rows)`);

    console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
    process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
