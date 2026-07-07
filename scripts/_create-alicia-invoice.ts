/**
 * One-off: invoice for Alicia Holod — door ironmongery refix
 * (quote shortSlug aHeTpR3u, completed at custom £120 flat).
 *
 * Direct DB insert because tsx-watch hot-reload is still stuck.
 * Linking to source quote for audit trail.
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
            description: 'Refix door ironmongery securely — ensure door closes correctly (per quote aHeTpR3u, job completed)',
            quantity: 1,
            unitPrice: 12000,    // £120.00 flat
            total: 12000,
        },
    ];

    const totalAmount = 12000;
    const depositPaid = 0;
    const balanceDue = totalAmount;

    const internalNotes =
        'Manual invoice for completed job. Source quote: aHeTpR3u (quote_rMkmVyP6GDiJhdv2NCXnJ). ' +
        'Custom flat price of £120 agreed (quoted tiers were £84.09 / £105.09 / £141.79). ' +
        'No deposit taken. Job: refix door ironmongery — door now closing correctly.';

    const customerFacingNotes =
        'Property: Nottingham NG8 3LL. ' +
        'Re: door ironmongery refix — job completed. Reference quote aHeTpR3u.';

    const [inserted] = await db.insert(invoices).values({
        id,
        invoiceNumber,
        quoteId: 'quote_rMkmVyP6GDiJhdv2NCXnJ',   // link back to source quote
        customerId: null,
        contractorId: null,
        customerName: 'Alicia Holod',
        customerEmail: null,
        customerPhone: '07999 059766',
        customerAddress: 'Nottingham NG8 3LL',
        totalAmount,
        depositPaid,
        balanceDue,
        lineItems: lineItems as any,
        status: 'draft' as const,
        dueDate: new Date(),    // same day
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
