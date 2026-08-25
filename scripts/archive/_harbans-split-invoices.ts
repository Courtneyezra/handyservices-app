/**
 * Harbans — unwind the combined invoice (15 Aug 2026).
 *
 * Harbans asked specifically for the tap-and-trap breakdown and said they'd
 * pay shortly. Billing them £276 for two jobs when they asked about one risks
 * stalling a payment that's imminent, so INV-2026-0255 (combined) is voided
 * and replaced with two separate invoices:
 *
 *   tap & trap  ml8cyy2z  £302.00 − £135 deposit = £167.00  → SEND NOW
 *   flooring    quqmwfki  £198.00 −  £89 deposit = £109.00  → DRAFT, hold
 *
 * The tap-and-trap invoice is itemised line-by-line because that is literally
 * what the customer asked for. The £50 uplift over the £252 base is the
 * next-day (£25) + Saturday (£25) fees from server/scheduling-fees.ts — the
 * job was quoted Fri 14 Aug and booked for Sat 15 Aug, and those two stack.
 *
 * Both jobs also get completedAt set (owner confirmed both are done).
 *
 * Run:  npx tsx scripts/_harbans-split-invoices.ts          (dry run)
 *       npx tsx scripts/_harbans-split-invoices.ts --apply  (writes)
 */
import { insertInvoiceWithRetry } from '../server/invoices';
import { db } from '../server/db';
import { invoices, personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

const APPLY = process.argv.includes('--apply');
const COMBINED = 'INV-2026-0255';

const TAP_QUOTE_ID = 'quote_94QVmIaEoY2r0DOJR63h6';   // ml8cyy2z
const FLOOR_QUOTE_ID = 'quote_2HoEcVnS390UDeMylOTO1'; // quqmwfki

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

/** Labour is shown net of the 10% multi-job discount so the invoice needs no
 *  negative line, while the discount still gets its own visible row. */
const TAP_LINES = [
    { description: 'Supply and install new kitchen tap', quantity: 1, unitPrice: 8500, total: 8500 },
    { description: 'Supply and install new sink trap', quantity: 1, unitPrice: 6500, total: 6500 },
    { description: 'Adjust copper pipework', quantity: 1, unitPrice: 6000, total: 6000 },
    { description: 'Multi-job discount (10% off labour)', quantity: 1, unitPrice: -2100, total: -2100 },
    { description: 'Materials — tap, trap and fittings', quantity: 1, unitPrice: 6300, total: 6300 },
    { description: 'Next-day booking', quantity: 1, unitPrice: 2500, total: 2500 },
    { description: 'Saturday booking', quantity: 1, unitPrice: 2500, total: 2500 },
];

const FLOOR_LINES = [
    { description: 'Lift and re-lay laminate flooring', quantity: 1, unitPrice: 19800, total: 19800 },
];

async function main() {
    const [combined] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, COMBINED));
    if (!combined) throw new Error(`ABORT: ${COMBINED} not found`);
    if (combined.voidedAt) throw new Error(`ABORT: ${COMBINED} already voided — split may already have run.`);
    if (combined.paidAt) throw new Error(`ABORT: ${COMBINED} is PAID — do not void.`);
    if (combined.sentAt) throw new Error(`ABORT: ${COMBINED} was actually sent — customer may hold this number. Resolve manually.`);

    const tapTotal = 30200, tapDeposit = 13500, tapBalance = 16700;
    const floorTotal = 19800, floorDeposit = 8900, floorBalance = 10900;

    // Itemised lines must reconcile to the invoice total, or the customer's
    // own arithmetic won't match the figure we're asking them to pay.
    const tapLineSum = TAP_LINES.reduce((s, l) => s + l.total, 0);
    if (tapLineSum !== tapTotal) throw new Error(`ABORT: tap lines sum to ${gbp(tapLineSum)}, expected ${gbp(tapTotal)}`);
    const floorLineSum = FLOOR_LINES.reduce((s, l) => s + l.total, 0);
    if (floorLineSum !== floorTotal) throw new Error(`ABORT: floor lines sum to ${gbp(floorLineSum)}, expected ${gbp(floorTotal)}`);

    console.log('TAP & TRAP (send now)');
    for (const l of TAP_LINES) console.log(`  ${l.description.padEnd(42)} ${gbp(l.total).padStart(10)}`);
    console.log(`  ${'TOTAL'.padEnd(42)} ${gbp(tapTotal).padStart(10)}`);
    console.log(`  ${'deposit paid 14 Aug'.padEnd(42)} ${('-' + gbp(tapDeposit)).padStart(10)}`);
    console.log(`  ${'BALANCE DUE'.padEnd(42)} ${gbp(tapBalance).padStart(10)}`);
    console.log(`\nFLOORING (draft, hold)  total ${gbp(floorTotal)} − ${gbp(floorDeposit)} = ${gbp(floorBalance)}`);
    console.log(`\nWill void: ${COMBINED}`);

    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }

    await db.update(invoices).set({
        status: 'void', voidedAt: new Date(),
        notes: `${combined.notes ? combined.notes + ' | ' : ''}Voided 15 Aug 2026 — split back into separate `
            + `per-job invoices after Harbans asked for the tap-and-trap breakdown specifically. Never sent.`,
        updatedAt: new Date(),
    }).where(eq(invoices.id, combined.id));
    console.log(`Voided ${COMBINED}`);

    const tap = await insertInvoiceWithRetry((invoiceNumber) => ({
        id: crypto.randomUUID(), invoiceNumber, quoteId: TAP_QUOTE_ID,
        customerId: combined.customerId ?? null, contractorId: null,
        customerName: combined.customerName, customerEmail: combined.customerEmail,
        customerPhone: combined.customerPhone, customerAddress: combined.customerAddress || 'Nottingham NG9 1BB',
        totalAmount: tapTotal, depositPaid: tapDeposit, balanceDue: tapBalance,
        lineItems: TAP_LINES as any,
        status: 'draft' as const,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        sentAt: null, paymentMethod: null,
        notes: `Tap & trap (ml8cyy2z). Replaces voided ${COMBINED}. £134.70 deposit actually captured; `
            + `shown as £135 to match the original invoice, 30p in the customer's favour. `
            + `£50 uplift = next-day £25 + Saturday £25 (quoted Fri 14 Aug, booked Sat 15 Aug).`,
        customerNotes: 'Breakdown for the kitchen tap, sink trap and pipework as requested. Deposit already '
            + 'received, thank you — balance of £167.00 payable by card or bank transfer.',
    }));
    console.log(`Created ${tap.invoiceNumber} — balance ${gbp(tap.balanceDue)} → https://www.handyservices.app/invoice/${tap.id}`);

    const floor = await insertInvoiceWithRetry((invoiceNumber) => ({
        id: crypto.randomUUID(), invoiceNumber, quoteId: FLOOR_QUOTE_ID,
        customerId: combined.customerId ?? null, contractorId: null,
        customerName: combined.customerName, customerEmail: combined.customerEmail,
        customerPhone: combined.customerPhone, customerAddress: combined.customerAddress || 'Nottingham NG9 1BB',
        totalAmount: floorTotal, depositPaid: floorDeposit, balanceDue: floorBalance,
        lineItems: FLOOR_LINES as any,
        status: 'draft' as const,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        sentAt: null, paymentMethod: null,
        notes: `Flooring/lights/hinge (quqmwfki). Replaces voided ${COMBINED}. HOLD — raise only after the `
            + `tap & trap balance is banked. £88.80 deposit actually captured, shown as £89 to match the original.`,
        customerNotes: null,
    }));
    console.log(`Created ${floor.invoiceNumber} — balance ${gbp(floor.balanceDue)} (DRAFT, hold)`);

    // Owner confirmed both jobs are done.
    for (const [qid, label] of [[TAP_QUOTE_ID, 'ml8cyy2z'], [FLOOR_QUOTE_ID, 'quqmwfki']] as const) {
        const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.id, qid));
        if (q?.completedAt) { console.log(`${label} already completed ${q.completedAt.toISOString()}`); continue; }
        await db.update(personalizedQuotes).set({ completedAt: new Date() }).where(eq(personalizedQuotes.id, qid));
        console.log(`Marked ${label} complete`);
    }

    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
