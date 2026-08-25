/**
 * One-off: Roshan (quote 9weuajqj / quote_DQgwZAuFBdTNeyXkCySV0) — additional invoice.
 *
 * Original quote (grab rails to bath & shower + new light) had extra work on the
 * day: planing door edges so the doors close securely. £45.00, invoiced separately
 * from INV-2026-0264 (which already carries the quoted job's £115.10 balance).
 *
 * Creates the invoice, prints the payment link, generates the branded PDF.
 * Safe to delete after running.
 */
import { insertInvoiceWithRetry } from '../server/invoices';
import { generateInvoicePdf } from '../server/invoice-generator';
import { writeFileSync } from 'fs';

const QUOTE_ID = 'quote_DQgwZAuFBdTNeyXkCySV0';

async function main() {
    const lineItems = [
        {
            description: 'Additional works: plane and adjust door edges so doors close securely',
            quantity: 1,
            unitPrice: 4500,
            total: 4500,
        },
    ];

    const created = await insertInvoiceWithRetry((invoiceNumber) => ({
        id: crypto.randomUUID(),
        invoiceNumber,
        quoteId: QUOTE_ID,
        customerId: null,
        contractorId: null,
        customerName: 'Roshan',
        customerEmail: 'grapefruitmarket@proton.me',
        customerPhone: '+447552217846',
        customerAddress: '37 Burleigh Road, Nottingham, NG2 6FP',
        totalAmount: 4500,
        depositPaid: 0,
        balanceDue: 4500,
        lineItems: lineItems as any,
        status: 'sent' as const,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        sentAt: new Date(),
        paymentMethod: null,
        notes: 'Additional works beyond quote 9weuajqj (grab rails + light install): plane door edges to close securely. Separate from INV-2026-0264 which covers the quoted job balance.',
        customerNotes: 'This covers the additional work of planing the door edges so the doors close securely, which was extra to your original quote. Payable by card online or bank transfer (details below).',
    }));

    const link = `https://www.handyservices.app/invoice/${created.id}`;
    console.log(`Created ${created.invoiceNumber} — £${(created.totalAmount / 100).toFixed(2)}`);
    console.log(`Payment link: ${link}`);

    const pdf = await generateInvoicePdf(created.id);
    const outPath = `${created.invoiceNumber}-roshan-extra.pdf`;
    writeFileSync(outPath, pdf);
    console.log(`PDF written: ${outPath}`);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
