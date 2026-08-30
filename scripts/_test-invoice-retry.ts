/**
 * Track A (A-WP2) — retryPendingBalanceInvoices state-transition test.
 *
 * Exercises, against the real DB with test fixtures (all cleaned up):
 *   1. 'failed' job with NO quote  → retried → 'skipped' (nothing to invoice), error cleared
 *   2. 'pending' job with deposit-paid quote → retried → 'generated', invoice row exists,
 *      invoiceId linked on the CBR (same generateBalanceInvoice path finalizeJobCompletion awaits)
 *   3. 'failed' job with attempts=5 → NOT retried (retry budget exhausted)
 *   4. 'failed' job completed 40 days ago → NOT retried (outside 30-day window)
 *
 * Alerts are suppressed (emitAlerts:false) so the script never imports
 * pipeline-events → server/index (which would boot the server).
 *
 * Run: npx tsx scripts/_test-invoice-retry.ts
 */
import { db } from '../server/db';
import { contractorBookingRequests, personalizedQuotes, invoices, handymanProfiles } from '../shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { retryPendingBalanceInvoices } from '../server/invoice-generator';

const TS = Date.now();
const CBR_A = `test_cbr_retry_${TS}_a`; // failed, no quote → skipped
const CBR_B = `test_cbr_retry_${TS}_b`; // pending, deposit-paid quote → generated
const CBR_C = `test_cbr_retry_${TS}_c`; // failed, attempts=5 → untouched
const CBR_D = `test_cbr_retry_${TS}_d`; // failed, 40 days old → untouched
const QUOTE_B = `test_quote_retry_${TS}_b`;

let pass = 0, fail = 0;
function check(cond: boolean, label: string) {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.error(`  FAIL  ${label}`); }
}

async function getCbr(id: string) {
    const [row] = await db.select().from(contractorBookingRequests).where(eq(contractorBookingRequests.id, id));
    return row;
}

async function cleanup() {
    // Invoice(s) generated for the test quote first (CBR references invoiceId).
    await db.update(contractorBookingRequests)
        .set({ invoiceId: null })
        .where(inArray(contractorBookingRequests.id, [CBR_A, CBR_B, CBR_C, CBR_D]));
    await db.delete(invoices).where(eq(invoices.quoteId, QUOTE_B));
    await db.delete(contractorBookingRequests)
        .where(inArray(contractorBookingRequests.id, [CBR_A, CBR_B, CBR_C, CBR_D]));
    await db.delete(personalizedQuotes).where(eq(personalizedQuotes.id, QUOTE_B));
}

async function main() {
    // Need a real contractor id for the notNull FK.
    const [contractor] = await db.select({ id: handymanProfiles.id }).from(handymanProfiles).limit(1);
    if (!contractor) throw new Error('No handyman_profiles row available for FK fixture');

    const now = new Date();
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    console.log('\n--- Setup fixtures ---');

    // Quote for fixture B: simple-mode £200 with £50 deposit paid → £150 balance due.
    await db.insert(personalizedQuotes).values({
        id: QUOTE_B,
        shortSlug: `t${TS.toString(36).slice(-7)}`,
        customerName: 'Test Retry Customer B',
        phone: '+447700900951', // Ofcom test range — house convention
        jobDescription: 'Test balance-invoice retry job (safe to delete)',
        quoteMode: 'simple',
        basePrice: 20000,
        depositAmountPence: 5000,
        depositPaidAt: now,
    } as any);

    const baseCbr = {
        contractorId: contractor.id,
        status: 'completed',
        assignmentStatus: 'completed',
        customerEmail: null,
        customerPhone: null,
    };

    await db.insert(contractorBookingRequests).values([
        {
            ...baseCbr,
            id: CBR_A,
            customerName: 'Test Retry A (failed, no quote)',
            completedAt: now,
            balanceInvoiceStatus: 'failed',
            balanceInvoiceAttempts: 1,
            balanceInvoiceLastError: 'seeded failure',
        },
        {
            ...baseCbr,
            id: CBR_B,
            customerName: 'Test Retry B (pending, deposit quote)',
            quoteId: QUOTE_B,
            completedAt: now,
            balanceInvoiceStatus: 'pending',
            balanceInvoiceAttempts: 0,
        },
        {
            ...baseCbr,
            id: CBR_C,
            customerName: 'Test Retry C (exhausted)',
            completedAt: now,
            balanceInvoiceStatus: 'failed',
            balanceInvoiceAttempts: 5,
            balanceInvoiceLastError: 'seeded failure',
        },
        {
            ...baseCbr,
            id: CBR_D,
            customerName: 'Test Retry D (too old)',
            completedAt: daysAgo(40),
            balanceInvoiceStatus: 'failed',
            balanceInvoiceAttempts: 1,
            balanceInvoiceLastError: 'seeded failure',
        },
    ] as any);
    console.log('  4 CBR fixtures + 1 quote inserted');

    console.log('\n--- Run retryPendingBalanceInvoices ---');
    const result = await retryPendingBalanceInvoices({ emitAlerts: false });
    console.log('  result:', JSON.stringify(result));

    console.log('\n--- Assertions ---');
    const a = await getCbr(CBR_A);
    check(a?.balanceInvoiceStatus === 'skipped', `A: failed + no quote → 'skipped' (got '${a?.balanceInvoiceStatus}')`);
    check(a?.balanceInvoiceLastError === null, `A: last error cleared (got '${a?.balanceInvoiceLastError}')`);

    const b = await getCbr(CBR_B);
    check(b?.balanceInvoiceStatus === 'generated', `B: pending + deposit quote → 'generated' (got '${b?.balanceInvoiceStatus}')`);
    check(!!b?.invoiceId, `B: invoiceId linked on CBR (got ${b?.invoiceId})`);
    const [invB] = await db.select().from(invoices).where(eq(invoices.quoteId, QUOTE_B));
    check(!!invB, `B: invoice row exists for quote (got ${invB?.invoiceNumber})`);
    check(invB?.totalAmount === 20000, `B: invoice total £200.00 (got ${invB?.totalAmount})`);
    check(invB?.depositPaid === 5000, `B: deposit £50.00 recorded (got ${invB?.depositPaid})`);
    check(invB?.balanceDue === 15000, `B: balance £150.00 (got ${invB?.balanceDue})`);

    const c = await getCbr(CBR_C);
    check(c?.balanceInvoiceStatus === 'failed' && c?.balanceInvoiceAttempts === 5,
        `C: attempts=5 untouched (got '${c?.balanceInvoiceStatus}'/${c?.balanceInvoiceAttempts})`);

    const d = await getCbr(CBR_D);
    check(d?.balanceInvoiceStatus === 'failed' && d?.balanceInvoiceAttempts === 1,
        `D: 40-day-old job untouched (got '${d?.balanceInvoiceStatus}'/${d?.balanceInvoiceAttempts})`);

    check(result.scanned >= 2, `retry scanned at least fixtures A+B (scanned=${result.scanned})`);
    check(result.generated >= 1, `at least one invoice generated (generated=${result.generated})`);
    check(result.skipped >= 1, `at least one skip recorded (skipped=${result.skipped})`);
}

main()
    .then(async () => {
        console.log('\n--- Cleanup ---');
        await cleanup();
        console.log('  fixtures removed');
        console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
        process.exit(fail > 0 ? 1 : 0);
    })
    .catch(async (err) => {
        console.error('\nTest run crashed:', err);
        try { await cleanup(); console.log('Cleanup completed after crash'); } catch (c) { console.error('Cleanup failed:', c); }
        process.exit(1);
    });
