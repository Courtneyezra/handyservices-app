/**
 * One-off: Zhe (quote 9hjo8bmx / quote_pm2HAWF7SYXcfwY5xcMd_) — final invoice.
 *
 * Voids INV-2026-0196 (auto-generated at deposit payment, never sent, stale
 * £0 balance) and replaces it with a proper invoice covering:
 *   - Original job (integrated + standard cupboard doors, toilet seat)  £229.00
 *   - Additional: integrated fridge brackets + base unit hinges          £45.00
 * Total £274.00, less £222.13 deposit paid 6 Jul = £51.87 balance.
 *
 * Then generates the branded PDF. Safe to delete after running.
 */
import { insertInvoiceWithRetry } from '../server/invoices';
import { generateInvoicePdf } from '../server/invoice-generator';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'fs';

const OLD_INVOICE_ID = '4a480a97-b340-4ddc-a2b4-5f1e3b9cdaf1'; // INV-2026-0196 (Zhe)
const QUOTE_ID = 'quote_pm2HAWF7SYXcfwY5xcMd_';

async function main() {
    // 1. Void the stale auto-generated invoice
    const [voided] = await db.update(invoices)
        .set({
            status: 'void',
            voidedAt: new Date(),
            notes: 'Voided & replaced: auto-generated at deposit payment, never sent. Replacement adds £45 fridge brackets + base unit hinges extra.',
            updatedAt: new Date(),
        })
        .where(eq(invoices.id, OLD_INVOICE_ID))
        .returning();
    console.log(`Voided ${voided?.invoiceNumber}`);

    // 2. Create the replacement with the £45 addition
    const lineItems = [
        {
            description: 'Install integrated cupboard door, install standard cupboard door, supply & fit new toilet seat',
            quantity: 1,
            unitPrice: 22900,
            total: 22900,
        },
        {
            description: 'Additional works: integrated fridge brackets & base unit hinges',
            quantity: 1,
            unitPrice: 4500,
            total: 4500,
        },
    ];

    const totalAmount = 27400; // £274.00
    const depositPaid = 22213; // £222.13 paid 6 Jul
    const balanceDue = totalAmount - depositPaid; // £51.87

    const created = await insertInvoiceWithRetry((invoiceNumber) => ({
        id: crypto.randomUUID(),
        invoiceNumber,
        quoteId: QUOTE_ID,
        customerId: null,
        contractorId: null,
        customerName: 'Zhe',
        customerEmail: 'zhe.wang000@outlook.com',
        customerPhone: '+44 7912 888586',
        customerAddress: '520 Nottingham One, Canal Street, Nottingham NG1 7HT',
        totalAmount,
        depositPaid,
        balanceDue,
        lineItems: lineItems as any,
        status: 'sent' as const,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        sentAt: new Date(),
        paymentMethod: null,
        notes: `Replaces voided INV-2026-0196 (auto-gen). Adds £45 additional works (integrated fridge brackets + base unit hinges) on top of £229 agreed quote (9hjo8bmx). Stripe deposit pi_3TqAok4p9GekG4mY0mrP4nRi.`,
        customerNotes: 'Thanks for your deposit of £222.13 — already received. This invoice includes the additional £45 for the integrated fridge brackets and base unit hinges. Balance of £51.87 payable by card or bank transfer (details below).',
    }));

    console.log(`Created ${created.invoiceNumber} — total £${(created.totalAmount / 100).toFixed(2)}, deposit £${(created.depositPaid / 100).toFixed(2)}, balance £${(created.balanceDue / 100).toFixed(2)}`);

    // 3. Generate the PDF
    const pdf = await generateInvoicePdf(created.id);
    const outPath = `${process.cwd()}/${created.invoiceNumber}-zhe.pdf`;
    writeFileSync(outPath, pdf);
    console.log(`PDF written: ${outPath}`);
    console.log(`Invoice link: https://www.handyservices.app/invoice/${created.id}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
