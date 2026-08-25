/**
 * One-off: invoice for Sharon (First FM) — supply & install COSHH cupboard
 * + remove waste. Quote eti41euq (quote_jXAMf7HACPLGtR-HoNQ7j), base £647.
 *
 * Customer couldn't pay online, so paid the £534 deposit by BANK TRANSFER.
 * Remaining £113 due on completion. Deposit recorded here (not on the quote's
 * depositPaidAt, which only tracks Stripe), so we insert directly rather than
 * via /api/invoices/generate (that path reads deposit from Stripe fields only).
 *
 * Safe to delete after running.
 */
import { insertInvoiceWithRetry } from '../server/invoices';

async function main() {
    const totalAmount = 64700; // £647.00 (quote base price)
    const depositPaid = 53400; // £534.00 received by bank transfer
    const balanceDue = totalAmount - depositPaid; // £113.00 on completion

    const lineItems = [
        {
            description: 'Supply & install COSHH storage cupboard, including removal & disposal of waste',
            quantity: 1,
            unitPrice: 64700,
            total: 64700,
        },
    ];

    const customerFacingNotes =
        'Deposit of £534.00 received by bank transfer — thank you. ' +
        'Remaining balance of £113.00 due on completion. ' +
        'Your booking date will be confirmed now the deposit has landed.';

    const internalNotes =
        'Quote eti41euq. Customer could not pay online; £534 deposit paid by bank ' +
        'transfer to HANDY NETWORK LTD (ref eti41euq). £113 balance on completion. ' +
        'Full-payment option was £627.59 (pay-in-full discount) but customer chose ' +
        'deposit + balance = £647 total.';

    const created = await insertInvoiceWithRetry((invoiceNumber) => ({
        id: crypto.randomUUID(),
        invoiceNumber,
        quoteId: 'quote_jXAMf7HACPLGtR-HoNQ7j',
        customerId: null,
        contractorId: null,
        customerName: 'Sharon',
        customerEmail: 'sd@firstfm.co.uk',
        customerPhone: '+447944722350',
        customerAddress: 'Nottingham NG2 3AQ',
        totalAmount,
        depositPaid,
        balanceDue,
        lineItems: lineItems as any,
        status: 'draft' as const,
        dueDate: new Date(),
        paymentMethod: 'bank_transfer',
        notes: internalNotes,
        customerNotes: customerFacingNotes,
    }));

    const baseUrl = process.env.BASE_URL || 'https://handyservices.uk';
    console.log('\n=== Created ===');
    console.log(JSON.stringify({
        invoiceNumber: created.invoiceNumber,
        customer: created.customerName,
        totalAmount_pence: created.totalAmount,
        depositPaid_pence: created.depositPaid,
        balanceDue_pence: created.balanceDue,
        status: created.status,
        paymentMethod: created.paymentMethod,
        link: `${baseUrl}/invoice/${created.id}`,
    }, null, 2));
    console.log('\nReadable:');
    console.log(`  Invoice #    : ${created.invoiceNumber}`);
    console.log(`  Total        : £${(created.totalAmount / 100).toFixed(2)}`);
    console.log(`  Deposit paid : £${(created.depositPaid / 100).toFixed(2)} (bank transfer)`);
    console.log(`  Balance due  : £${(created.balanceDue / 100).toFixed(2)} (on completion)`);
    console.log(`  Link         : ${baseUrl}/invoice/${created.id}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
