/**
 * One-off: create revised invoice for Raul (29 Lincoln Avenue, Derby)
 * superseding external PDF HS-RAUL-001 (11 May 2026).
 *
 * Direct DB insert because tsx-watch hot-reload is stuck on the old
 * generate-manual endpoint (won't accept depositPaid / customerNotes yet).
 *
 * Safe to delete after running.
 */
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { sql, like } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

async function nextInvoiceNumber(year: number): Promise<string> {
    const rows = await db.execute(sql`
        SELECT invoice_number FROM invoices
        WHERE invoice_number LIKE ${'INV-' + year + '-%'}
        ORDER BY invoice_number DESC
        LIMIT 1
    `);
    const last = (rows.rows?.[0] as any)?.invoice_number as string | undefined;
    const lastSeq = last ? parseInt(last.split('-')[2], 10) : 0;
    const next = (lastSeq + 1).toString().padStart(4, '0');
    return `INV-${year}-${next}`;
}

async function main() {
    const invoiceNumber = await nextInvoiceNumber(2026);
    console.log(`Next invoice number: ${invoiceNumber}`);

    const id = uuidv4();

    // All amounts in pence
    const lineItems = [
        {
            description: 'General repairs & maintenance at 29 Lincoln Avenue — stain block ceiling, supply & fit skirting + gloss, reseal shower tray, re-fix & re-seal guttering, patch wall cracks (works completed 27 Apr 2026, per HS-RAUL-001)',
            quantity: 1,
            unitPrice: 64179,
            total: 64179,
        },
        {
            description: 'Credit & refund: incomplete ceiling painting + customer-supplied skirting board materials + door stop refund',
            quantity: 1,
            unitPrice: -10000,
            total: -10000,
        },
    ];

    const totalAmount = lineItems.reduce((s, li) => s + li.total, 0); // 54179
    const depositPaid = 19254;                                          // £192.54 from PDF
    const balanceDue = totalAmount - depositPaid;                       // 34925 = £349.25

    const internalNotes =
        'Revised invoice superseding external PDF HS-RAUL-001 (11 May 2026). ' +
        'Original subtotal £641.79; £100 credit applied for incomplete ceiling painting ' +
        '+ customer-supplied skirting board materials + door stop refund. ' +
        'Deposit £192.54 received 27 Apr 2026.';

    const customerFacingNotes =
        'Property: 29 Lincoln Avenue, Littleover, Derby DE23 3AB. ' +
        'Revised against original invoice HS-RAUL-001 (11 May 2026). ' +
        '£100 total credit applied for incomplete ceiling painting, customer-supplied ' +
        'skirting board materials, and door stop refund. Deposit £192.54 already received.';

    const [inserted] = await db.insert(invoices).values({
        id,
        invoiceNumber,
        quoteId: null,
        customerId: null,
        contractorId: null,
        customerName: 'Raul',
        customerEmail: null,
        customerPhone: null,
        customerAddress: '29 Lincoln Avenue, Littleover, Derby DE23 3AB',
        totalAmount,
        depositPaid,
        balanceDue,
        lineItems: lineItems as any,
        status: 'draft' as const,
        dueDate: new Date(),    // same day (today)
        notes: internalNotes,
        paymentMethod: null,
        customerNotes: customerFacingNotes,
    }).returning();

    const baseUrl = process.env.BASE_URL || 'https://handyservices.uk';
    const invoiceLink = `${baseUrl}/invoice/${id}`;

    console.log('\n=== Created ===');
    console.log(JSON.stringify({
        invoiceNumber: inserted.invoiceNumber,
        customer: inserted.customerName,
        totalAmount_pence: inserted.totalAmount,
        depositPaid_pence: inserted.depositPaid,
        balanceDue_pence: inserted.balanceDue,
        status: inserted.status,
        invoiceLink,
    }, null, 2));

    console.log('\nReadable:');
    console.log(`  Subtotal     : £${(inserted.totalAmount / 100).toFixed(2)}`);
    console.log(`  Deposit paid : £${(inserted.depositPaid / 100).toFixed(2)}`);
    console.log(`  Balance due  : £${(inserted.balanceDue / 100).toFixed(2)}`);
    console.log(`  Link         : ${invoiceLink}`);

    process.exit(0);
}

main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
