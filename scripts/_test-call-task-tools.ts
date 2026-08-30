/**
 * D-INT sanity: the four VA call-task tools exist on the ops manager and the
 * read tool runs clean against the live DB. READ-ONLY — no task is created,
 * completed, or dismissed here (create pings a real phone; complete/dismiss
 * mutate the audit trail).
 *
 * Run: npx tsx scripts/_test-call-task-tools.ts
 */
import { buildTools } from '../server/agents/ops-manager';

async function main() {
    const tools = buildTools();
    const names = tools.map((t) => t.name);
    console.log('tool count:', names.length);
    let ok = true;
    for (const n of ['get_call_tasks', 'create_va_call_task', 'complete_call_task', 'dismiss_call_task']) {
        const present = names.includes(n);
        console.log(`${present ? 'PASS' : 'FAIL'} ${n}`);
        if (!present) ok = false;
    }

    const read = tools.find((t) => t.name === 'get_call_tasks');
    const r: any = await read!.run({});
    console.log(`get_call_tasks → open=${r.open.length} recentlyResolved=${r.recentlyResolved.length}`);
    if (r.open[0]) {
        const s = r.open[0];
        console.log('sample open:', JSON.stringify({ taskId: s.taskId, contactName: s.contactName, dueAt: s.dueAt, contextMsgs: s.context.length }));
    }
    if (r.recentlyResolved[0]) console.log('sample resolved:', JSON.stringify(r.recentlyResolved[0]));

    // complete/dismiss on a nonsense id must be a soft no-op, not a throw.
    const complete: any = await tools.find((t) => t.name === 'complete_call_task')!.run({ taskId: 'no-such-task' });
    console.log(`${complete.completed === false ? 'PASS' : 'FAIL'} complete_call_task unknown id → soft no-op`);
    const dismiss: any = await tools.find((t) => t.name === 'dismiss_call_task')!.run({ taskId: 'no-such-task', reason: 'test' });
    console.log(`${dismiss.dismissed === false ? 'PASS' : 'FAIL'} dismiss_call_task unknown id → soft no-op`);

    process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
