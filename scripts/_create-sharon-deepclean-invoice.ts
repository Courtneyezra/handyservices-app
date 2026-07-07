/**
 * One-off: invoice for Sharon — deep clean (oven, fridge, freezer, washer)
 * scheduled today or tomorrow morning, £180 flat.
 *
 * NOTE: identified Sharon via quote shortSlug d2qis4m0, BUT that quote is for
 * bathroom repairs (deposit paid 15 Apr). This deep clean is a SEPARATE
 * service — invoice deliberately NOT linked to that quote.
 *
 * Safe to delete after running.
 */
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { sql } from 'drizzle-orm';
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
    return `INV-${year}-${(lastSeq + 1).toString().padStart(4, '0')}`;
}

async function main() {
    const invoiceNumber = await nextInvoiceNumber(2026);
    console.log(`Next invoice number: ${invoiceNumber}`);

    const id = uuidv4();

    const lineItems = [
        {
            description: 'Full deep clean — including oven, fridge, freezer & washing machine (scheduled today or tomorrow morning)',
            quantity: 1,
            unitPrice: 18000,    // £180.00 flat
            total: 18000,
        },
    ];

    const totalAmount = 18000;
    const depositPaid = 0;
    const balanceDue = totalAmount;

    const internalNotes =
        'Standalone deep clean invoice for Sharon. £180 flat, includes oven, fridge, freezer, washer. ' +
        'NOT linked to her bathroom quote d2qis4m0 (separate scope of work). Scheduled today or tomorrow AM.';

    const customerFacingNotes =
        'Property: Nottingham NG15. ' +
        'Service: full deep clean including oven, fridge, freezer & washing machine. ' +
        'Scheduled for today or tomorrow morning at £180 inclusive.';

    const [inserted] = await db.insert(invoices).values({
        id,
        invoiceNumber,
        quoteId: null,                // deliberately not linked to bathroom quote
        customerId: null,
        contractorId: null,
        customerName: 'Sharon',
        customerEmail: null,          // admin@handyservices.com on file was a placeholder
        customerPhone: '07717793139',
        customerAddress: 'Nottingham NG15',
        totalAmount,
        depositPaid,
        balanceDue,
        lineItems: lineItems as any,
        status: 'draft' as const,
        dueDate: new Date(),          // same day
        notes: internalNotes,
        paymentMethod: null,
        customerNotes: customerFacingNotes,
    }).returning();

    const baseUrl = process.env.BASE_URL || 'https://handyservices.uk';
    const invoiceLink = `${baseUrl}/invoice/${id}`;

    console.log('\n=== Created ===');
    console.log(`  Invoice      : ${inserted.invoiceNumber}`);
    console.log(`  Customer     : ${inserted.customerName}`);
    console.log(`  Total        : £${(inserted.totalAmount / 100).toFixed(2)}`);
    console.log(`  Deposit paid : £${(inserted.depositPaid / 100).toFixed(2)}`);
    console.log(`  Balance due  : £${(inserted.balanceDue / 100).toFixed(2)}`);
    console.log(`  Link         : ${invoiceLink}`);

    process.exit(0);
}

main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
