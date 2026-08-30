/**
 * A-WP4 verification: pipeline sweeper SLA alert + 24h dedup.
 *
 * 1. Insert a test lead in 'quote_sent' with stageUpdatedAt backdated 48h
 *    (quote_sent SLA is 12h ⇒ ~36h overdue).
 * 2. runPipelineSweep scoped to that lead ⇒ expect exactly ONE sla alert
 *    captured and leads.lastSlaAlertAt stamped.
 * 3. Re-run immediately ⇒ expect ZERO alerts (24h dedup window).
 * 4. Clean up the test row.
 *
 * The alert emitter is swapped for a capture function so nothing is
 * broadcast and ./index (the server bootstrap) is never imported.
 */
import { db } from '../server/db';
import { leads } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { runPipelineSweep, __setAlertEmitterForTest } from '../server/pipeline-sweeper';

const LEAD_ID = `sweeptest_${Date.now()}`;
// Unique fake phone that matches no calls/quotes/conversations, and does NOT
// hit the %7700900% test-quote exclusion (irrelevant for leads, but keep clean).
const PHONE = `+4477981${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;

let failures = 0;
function assert(cond: boolean, label: string) {
    if (cond) {
        console.log(`  PASS: ${label}`);
    } else {
        console.error(`  FAIL: ${label}`);
        failures++;
    }
}

async function main() {
    const captured: any[] = [];
    __setAlertEmitterForTest((alert) => { captured.push(alert); });

    console.log(`[1] Inserting test lead ${LEAD_ID} (${PHONE}) in quote_sent, stageUpdatedAt = -48h`);
    await db.insert(leads).values({
        id: LEAD_ID,
        customerName: 'Sweeper Probe (auto-test)',
        phone: PHONE,
        stage: 'quote_sent',
        stageUpdatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    try {
        console.log('[2] First sweep (scoped to test lead) — expect 1 SLA alert + stamp');
        const first = await runPipelineSweep('test-run-1', { onlyLeadIds: [LEAD_ID] });
        assert(first !== null, 'sweep 1 returned a summary');
        assert(first?.leadsScanned === 1, `scanned exactly the test lead (got ${first?.leadsScanned})`);
        assert(first?.stageUpdates === 0, `no stage change for the test lead (got ${first?.stageUpdates})`);
        assert(first?.slaAlertsSent === 1, `slaAlertsSent === 1 (got ${first?.slaAlertsSent})`);
        const slaAlerts = captured.filter((a) => a.type === 'sla_breach' && a.leadId === LEAD_ID);
        assert(slaAlerts.length === 1, `exactly 1 sla_breach alert captured for the lead (got ${slaAlerts.length})`);
        if (slaAlerts[0]) console.log(`      alert: [${slaAlerts[0].severity}] ${slaAlerts[0].message}`);

        const [afterFirst] = await db.select().from(leads).where(eq(leads.id, LEAD_ID));
        assert(!!afterFirst?.lastSlaAlertAt, 'lastSlaAlertAt stamped on the lead');
        assert(afterFirst?.stage === 'quote_sent', `stage untouched (got ${afterFirst?.stage})`);

        console.log('[3] Second sweep immediately — expect NO duplicate alert (24h dedup)');
        captured.length = 0;
        const second = await runPipelineSweep('test-run-2', { onlyLeadIds: [LEAD_ID] });
        assert(second !== null, 'sweep 2 returned a summary');
        assert(second?.slaAlertsSent === 0, `slaAlertsSent === 0 on re-run (got ${second?.slaAlertsSent})`);
        assert(captured.length === 0, `no alerts captured on re-run (got ${captured.length})`);

        const [afterSecond] = await db.select().from(leads).where(eq(leads.id, LEAD_ID));
        assert(
            afterSecond?.lastSlaAlertAt?.getTime() === afterFirst?.lastSlaAlertAt?.getTime(),
            'lastSlaAlertAt NOT re-stamped on deduped run',
        );
    } finally {
        console.log('[4] Cleaning up test lead');
        await db.delete(leads).where(eq(leads.id, LEAD_ID));
    }

    console.log(failures === 0 ? '\nALL ASSERTIONS PASSED' : `\n${failures} ASSERTION(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
    console.error('Test crashed:', e);
    try { await db.delete(leads).where(eq(leads.id, LEAD_ID)); } catch { /* best effort */ }
    process.exit(1);
});
