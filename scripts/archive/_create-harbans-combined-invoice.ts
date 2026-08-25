/**
 * One-off: Harbans — combined invoice (15 Aug 2026).
 *
 * Voids the two never-sent invoices and replaces them with a single one so
 * there's one link and one balance to pay:
 *
 *   INV-2026-0251  quqmwfki  laminate re-lay, 2 lights, door hinge   £198.00  (dep £89)
 *   INV-2026-0254  ml8cyy2z  kitchen tap, sink trap, copper pipework £302.00  (dep £135)
 *                                                            total  £500.00  (dep £224)
 *                                                          balance  £276.00
 *
 * Deposit/balance figures are carried over from the existing invoices rather
 * than recomputed — £223.50 was actually captured (£88.80 + £134.70), and the
 * originals already rounded that to £224. Keeping their numbers means the
 * combined invoice reconciles against what Harbans has already been charged,
 * and the 50p sits in the customer's favour exactly as it already did.
 *
 * Run:  npx tsx scripts/_create-harbans-combined-invoice.ts          (dry run)
 *       npx tsx scripts/_create-harbans-combined-invoice.ts --apply  (writes)
 */
import { insertInvoiceWithRetry } from '../server/invoices';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq, inArray } from 'drizzle-orm';

const APPLY = process.argv.includes('--apply');

const OLD = ['INV-2026-0251', 'INV-2026-0254'];
/** ml8cyy2z — the later of the two jobs; holds the larger deposit. */
const ANCHOR_QUOTE_ID = 'quote_94QVmIaEoY2r0DOJR63h6';

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

async function main() {
    const existing = await db.select().from(invoices).where(inArray(invoices.invoiceNumber, OLD));

    // ── Guards ──────────────────────────────────────────────────────────────
    if (existing.length !== 2) throw new Error(`ABORT: expected 2 invoices, found ${existing.length}`);
    for (const inv of existing) {
        if (inv.voidedAt) throw new Error(`ABORT: ${inv.invoiceNumber} already voided — combined invoice may already exist.`);
        if (inv.paidAt) throw new Error(`ABORT: ${inv.invoiceNumber} is already PAID — do not void.`);
        if (inv.sentAt) console.warn(`  NOTE: ${inv.invoiceNumber} was actually sent at ${inv.sentAt.toISOString()} — customer may hold this number.`);
    }

    const totalAmount = existing.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const depositPaid = existing.reduce((s, i) => s + (i.depositPaid || 0), 0);
    const balanceDue = existing.reduce((s, i) => s + (i.balanceDue || 0), 0);

    if (totalAmount !== 50000 || depositPaid !== 22400 || balanceDue !== 27600) {
        throw new Error(`ABORT: unexpected totals — total ${gbp(totalAmount)}, deposit ${gbp(depositPaid)}, balance ${gbp(balanceDue)}`);
    }

    // One line per job, at the price already invoiced for it. Keeps the
    // combined invoice reconcilable line-for-line against the two originals.
    const lineItems = [
        {
            description: 'Lift and re-lay laminate flooring · remove and install 2 new lights · tighten loose door hinge',
            quantity: 1,
            unitPrice: 19800,
            total: 19800,
        },
        {
            description: 'Supply and install new kitchen tap · install new sink trap · adjust copper pipework',
            quantity: 1,
            unitPrice: 30200,
            total: 30200,
        },
    ];

    const src = existing.find((i) => i.invoiceNumber === 'INV-2026-0254')!;

    console.log('COMBINED INVOICE');
    for (const li of lineItems) console.log(`  ${li.description.slice(0, 60).padEnd(61)} ${gbp(li.total)}`);
    console.log(`  ${'total'.padEnd(61)} ${gbp(totalAmount)}`);
    console.log(`  ${'less deposits already paid'.padEnd(61)} ${'-' + gbp(depositPaid)}`);
    console.log(`  ${'BALANCE DUE'.padEnd(61)} ${gbp(balanceDue)}`);
    console.log(`\nWill void: ${OLD.join(', ')}`);
    console.log(`Customer : ${src.customerName} · ${src.customerEmail} · ${src.customerPhone}`);

    if (!APPLY) {
        console.log('\nDRY RUN — nothing written. Re-run with --apply.');
        process.exit(0);
    }

    // ── 1. Void the two originals ───────────────────────────────────────────
    for (const inv of existing) {
        await db.update(invoices)
            .set({
                status: 'void',
                voidedAt: new Date(),
                notes: `${inv.notes ? inv.notes + ' | ' : ''}Voided 15 Aug 2026 — merged into a single combined invoice for Harbans (${OLD.join(' + ')}). Never sent to the customer.`,
                updatedAt: new Date(),
            })
            .where(eq(invoices.id, inv.id));
        console.log(`Voided ${inv.invoiceNumber}`);
    }

    // ── 2. Create the combined replacement ──────────────────────────────────
    // status 'draft' + sentAt null deliberately: this must NOT look sent until
    // it actually is. The two it replaces both carried status 'sent' with a
    // null sentAt, which is precisely how the Moira final-notice went out on
    // an invoice nobody had ever received.
    const created = await insertInvoiceWithRetry((invoiceNumber) => ({
        id: crypto.randomUUID(),
        invoiceNumber,
        quoteId: ANCHOR_QUOTE_ID,
        customerId: src.customerId ?? null,
        contractorId: null,
        customerName: src.customerName,
        customerEmail: src.customerEmail,
        customerPhone: src.customerPhone,
        customerAddress: src.customerAddress || 'Nottingham NG9 1BB',
        totalAmount,
        depositPaid,
        balanceDue,
        lineItems: lineItems as any,
        status: 'draft' as const,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        sentAt: null,
        paymentMethod: null,
        notes: `Combined invoice for Harbans — replaces voided ${OLD.join(' + ')} (neither was ever sent). `
            + `Covers quqmwfki (£198, £89 deposit paid 12 Aug) and ml8cyy2z (£302, £135 deposit paid 14 Aug). `
            + `£223.50 actually captured; deposit shown as £224 to match the originals.`,
        customerNotes: 'Combined invoice for both jobs — the flooring, lights and door hinge, and the kitchen tap, '
            + 'sink trap and pipework. Deposits already received on both, thank you. Balance of £276.00 payable by '
            + 'card or bank transfer.',
    }));

    console.log(`\n✅ Created ${created.invoiceNumber} — total ${gbp(created.totalAmount)}, `
        + `deposit ${gbp(created.depositPaid)}, balance ${gbp(created.balanceDue)}`);
    console.log(`   status: ${created.status} (NOT sent — send explicitly when ready)`);
    console.log(`   link  : https://www.handyservices.app/invoice/${created.id}`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
