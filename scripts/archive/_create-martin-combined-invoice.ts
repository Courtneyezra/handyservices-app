/**
 * One-off: Martin (Fifield Glyn) — combined invoice.
 *
 * Voids INV-2026-0053 (the old bundled slabbing+sign invoice, overdue) and
 * replaces it with a fresh combined invoice covering:
 *   - Slabbing work  (quote rwbi8o4g / quote_5eyceCUrGZZObzeUXwtfY)  £230.00
 *   - Street sign    (quote pk01b3gd / quote_EXaFoNmYA6VHcUYee0T_O)  £318.18
 * Total £548.18, less £69 deposit already paid (15 Apr) = £479.18 balance.
 *
 * Then generates the branded PDF (BACS details are baked into the template).
 * Safe to delete after running.
 */
import { insertInvoiceWithRetry } from '../server/invoices';
import { generateInvoicePdf } from '../server/invoice-generator';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'fs';

const OLD_INVOICE_NUMBER = 'INV-2026-0053';
const SLAB_QUOTE_ID = 'quote_5eyceCUrGZZObzeUXwtfY'; // rwbi8o4g (holds the £69 deposit)

async function main() {
    // 1. Void the old bundled invoice
    const [voided] = await db.update(invoices)
        .set({
            status: 'void',
            voidedAt: new Date(),
            notes: 'Voided & replaced by combined slabbing + street-sign invoice (see replacement). Was overdue.',
            updatedAt: new Date(),
        })
        .where(eq(invoices.invoiceNumber, OLD_INVOICE_NUMBER))
        .returning();
    console.log(`Voided ${voided?.invoiceNumber ?? OLD_INVOICE_NUMBER}`);

    // 2. Create the combined replacement
    const lineItems = [
        {
            description: 'Supply & install 3 new pavement slabs — bedded in level',
            quantity: 1,
            unitPrice: 23000,
            total: 23000,
        },
        {
            description: 'Supply & install street sign',
            quantity: 1,
            unitPrice: 31818,
            total: 31818,
        },
    ];

    const totalAmount = 54818; // £548.18
    const depositPaid = 6900;  // £69.00 paid 15 Apr
    const balanceDue = totalAmount - depositPaid; // £479.18

    const created = await insertInvoiceWithRetry((invoiceNumber) => ({
        id: crypto.randomUUID(),
        invoiceNumber,
        quoteId: SLAB_QUOTE_ID,
        customerId: null,
        contractorId: null,
        customerName: 'Martin',
        customerEmail: 'martin.keddy@fifieldglyn.com',
        customerPhone: '07535309052',
        customerAddress: 'Nottingham NG6 8EP',
        totalAmount,
        depositPaid,
        balanceDue,
        lineItems: lineItems as any,
        status: 'sent' as const,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        sentAt: new Date(),
        paymentMethod: null,
        notes: `Combined invoice: slabbing (rwbi8o4g) £230 + street sign (pk01b3gd) £318.18. Replaces voided ${OLD_INVOICE_NUMBER}. £69 deposit paid 15 Apr against slabbing.`,
        customerNotes: 'Combined invoice for the completed slabbing work and the street sign supply & install. £69 deposit already received — thank you. Balance of £479.18 payable by card or bank transfer (details below).',
    }));

    console.log(`Created ${created.invoiceNumber} — total £${(created.totalAmount/100).toFixed(2)}, deposit £${(created.depositPaid/100).toFixed(2)}, balance £${(created.balanceDue/100).toFixed(2)}`);

    // 3. Generate the PDF
    const pdf = await generateInvoicePdf(created.id);
    const outPath = `${process.cwd()}/${created.invoiceNumber}-martin.pdf`;
    writeFileSync(outPath, pdf);
    console.log(`PDF written: ${outPath}`);

    const baseUrl = process.env.BASE_URL || 'https://handyservices.uk';
    console.log(`Invoice link: ${baseUrl}/invoice/${created.id}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
