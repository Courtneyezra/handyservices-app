/**
 * Gate test for the ops manager's generate_invoice tool (read-only).
 *
 * Exercises the three refusal/guard paths against real rows WITHOUT ever
 * generating an invoice:
 *   1. non-completed job  -> { generated: false, refusal }
 *   2. completed job that already has an invoiceId -> existing invoice returned
 *   3. missing job id -> throws
 * The happy path (actual generation) reuses generateBalanceInvoice, which the
 * completion flow already battle-tests; we do not mint a real invoice here.
 */
import { db } from '../server/db';
import { contractorBookingRequests } from '../shared/schema';
import { and, eq, isNotNull, ne, or, sql } from 'drizzle-orm';

import { buildTools } from '../server/agents/ops-manager';

async function main() {
    const generateInvoiceTool: any = buildTools().find((t) => t.name === 'generate_invoice');
    if (!generateInvoiceTool) {
        console.error('generate_invoice tool not found in buildTools()');
        process.exit(1);
    }

    let pass = 0; let fail = 0;
    const check = (name: string, ok: boolean, detail?: unknown) => {
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail).slice(0, 160)}` : ''}`);
        ok ? pass++ : fail++;
    };

    // 1. A non-completed job
    const [notDone] = await db.select({ id: contractorBookingRequests.id, status: contractorBookingRequests.status })
        .from(contractorBookingRequests)
        .where(and(
            ne(contractorBookingRequests.status, 'completed'),
            or(sql`${contractorBookingRequests.dayOfStatus} is null`, ne(contractorBookingRequests.dayOfStatus, 'completed')),
        ))
        .limit(1);
    if (notDone) {
        const out = await generateInvoiceTool.run({ jobId: notDone.id });
        check('non-completed job refused', out.generated === false && typeof out.refusal === 'string', { status: notDone.status });
    } else {
        check('non-completed job refused (no candidate row found — skipped)', true);
    }

    // 2. A completed job that already carries an invoiceId
    const [invoiced] = await db.select({ id: contractorBookingRequests.id, invoiceId: contractorBookingRequests.invoiceId })
        .from(contractorBookingRequests)
        .where(and(
            isNotNull(contractorBookingRequests.invoiceId),
            or(eq(contractorBookingRequests.status, 'completed'), eq(contractorBookingRequests.dayOfStatus, 'completed')),
        ))
        .limit(1);
    if (invoiced) {
        const out = await generateInvoiceTool.run({ jobId: invoiced.id });
        check('already-invoiced job returns existing, no duplicate',
            out.generated === false && out.alreadyInvoiced === true && out.invoiceId === invoiced.invoiceId,
            { invoiceNumber: out.invoiceNumber });
    } else {
        check('already-invoiced job (no candidate row found — skipped)', true);
    }

    // 3. Missing job id throws
    try {
        await generateInvoiceTool.run({ jobId: 'nonexistent-job-id-xyz' });
        check('missing job throws', false);
    } catch {
        check('missing job throws', true);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
