/**
 * One-off fix for invoices INV-2026-0109 and INV-2026-0110 created via the
 * generate-manual endpoint BEFORE the tsx-watch hot-reload picked up the
 * depositPaid/customerNotes additions. Also voids the two canary invoices
 * (customerName '__canary__' and '__canary2__') used to diagnose the reload.
 *
 * Safe to delete this file after running. Run with: tsx scripts/_fix-invoices-tonight.ts
 */
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq, or } from 'drizzle-orm';

const INVOICE_A_NOTES = 'Works at 205 Grindon Crescent, Nottingham NG6 8BU. ' +
    'Quote refs HS-GC-205-MAR26 (remedial works) and HS-DOORS-LUK-MAR26 (doors). ' +
    '£1,718 deposit received — balance due £1,717.';

const INVOICE_B_NOTES = 'Property: 205 Grindon Crescent, Nottingham NG6 8BU. ' +
    'Electrical Installation Condition Report (EICR) carried out by NAPIT/NICEIC ' +
    'registered contractor. Certificate to be submitted to Nottingham City Council ' +
    'Safer Housing Team.';

async function main() {
    console.log('\n=== Fixing INV-2026-0109 (Peninsula + doors combined) ===');
    const aRes = await db.update(invoices)
        .set({
            depositPaid: 171800,           // £1,718.00 in pence
            balanceDue: 171700,            // £1,717.00 in pence
            customerNotes: INVOICE_A_NOTES,
            updatedAt: new Date(),
        })
        .where(eq(invoices.invoiceNumber, 'INV-2026-0109'))
        .returning({
            invoiceNumber: invoices.invoiceNumber,
            totalAmount: invoices.totalAmount,
            depositPaid: invoices.depositPaid,
            balanceDue: invoices.balanceDue,
            customerNotes: invoices.customerNotes,
        });
    console.log(JSON.stringify(aRes, null, 2));

    console.log('\n=== Fixing INV-2026-0110 (EICR pass-through) ===');
    const bRes = await db.update(invoices)
        .set({
            customerNotes: INVOICE_B_NOTES,
            updatedAt: new Date(),
        })
        .where(eq(invoices.invoiceNumber, 'INV-2026-0110'))
        .returning({
            invoiceNumber: invoices.invoiceNumber,
            totalAmount: invoices.totalAmount,
            depositPaid: invoices.depositPaid,
            balanceDue: invoices.balanceDue,
            customerNotes: invoices.customerNotes,
        });
    console.log(JSON.stringify(bRes, null, 2));

    console.log('\n=== Voiding canary invoices ===');
    const cRes = await db.update(invoices)
        .set({
            status: 'void',
            voidedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(or(
            eq(invoices.customerName, '__canary__'),
            eq(invoices.customerName, '__canary2__'),
        ))
        .returning({
            invoiceNumber: invoices.invoiceNumber,
            customerName: invoices.customerName,
            status: invoices.status,
        });
    console.log(JSON.stringify(cRes, null, 2));

    console.log('\nDone.');
    process.exit(0);
}

main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
