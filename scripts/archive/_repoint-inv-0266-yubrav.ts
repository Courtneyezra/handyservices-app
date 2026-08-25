/**
 * One-off: INV-2026-0266 (£45 door-edge planing extra) was created against the
 * wrong quote/customer (Roshan, 9weuajqj). The extra belongs to Yubrav's fire
 * door job (87yvxq0w / quote_mSNnGenIus_gmFpDOCyzp). Re-points the invoice and
 * regenerates the PDF. Safe to delete after running.
 */
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { generateInvoicePdf } from '../server/invoice-generator';
import { writeFileSync } from 'fs';

const INVOICE_ID = 'd556289f-1bc1-4f7b-b030-cf5ff335db08';

async function main() {
    const [updated] = await db.update(invoices)
        .set({
            quoteId: 'quote_mSNnGenIus_gmFpDOCyzp',
            customerName: 'Yubrav',
            customerEmail: 'yuvlanda01@gmail.com',
            customerPhone: '+447398111129',
            customerAddress: '27 Premier Road, Forest Fields, Nottingham, NG7 6NW',
            lineItems: [{
                description: 'Additional works: plane and adjust door edges so the door closes securely',
                quantity: 1,
                unitPrice: 4500,
                total: 4500,
            }] as any,
            notes: 'Additional works beyond quote 87yvxq0w (trim and rehang internal fire door): plane door edges to close securely. Original £80 job invoiced as INV-2026-0260. Re-pointed 22 Aug: was mistakenly created against Roshan / 9weuajqj.',
            customerNotes: 'This covers the additional work of planing the door edges so the door closes securely, which was extra to your original quote. Payable by card online or bank transfer (details below).',
            updatedAt: new Date(),
        })
        .where(eq(invoices.id, INVOICE_ID))
        .returning();
    console.log(`Updated ${updated.invoiceNumber}: ${updated.customerName}, quote ${updated.quoteId}, £${(updated.balanceDue / 100).toFixed(2)}`);

    const pdf = await generateInvoicePdf(INVOICE_ID);
    writeFileSync('INV-2026-0266-yubrav-extra.pdf', pdf);
    console.log('PDF written: INV-2026-0266-yubrav-extra.pdf');
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
