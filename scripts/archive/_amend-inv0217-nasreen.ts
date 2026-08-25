/**
 * One-off: amend INV-2026-0217 (Nasreen, 24 Buzzard Road, Burton Joyce, NG14 5LB,
 * quote qpfw2jcs). Deduct £66 for paint supplied by the customer.
 *
 *   Original job as invoiced        £1,903.00
 *   Less: paint supplied by customer  -£66.00
 *   Total                           £1,837.00
 *   Deposit paid                     -£993.00
 *   Balance due                       £844.00
 *
 * Was: £1,903.00 total / £910.00 balance.
 * Resets dunning log (day_7 fired 2026-07-28 on the stale £910 balance) and
 * re-stamps sentAt so reminders track the corrected balance.
 *
 * Safe to delete after running.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const JOB_DESC =
    'Wall-mount TV, Install socket behind TV with cables hidden in wall, Install 3 flat back units and fit to wall, ' +
    'Wire LED lights into shelving, Supply and Install wall moulding, Install mirror, Install bathroom cabinet, ' +
    'Paint wall moulding and wall, Install 2 wall-mounted battery lamps';

const lineItems = [
    { description: JOB_DESC, quantity: 1, unitPrice: 190300, total: 190300 },
    { description: 'Less: paint supplied by customer', quantity: 1, unitPrice: -6600, total: -6600 },
];

const TOTAL = lineItems.reduce((s, li) => s + li.total, 0); // 183700
const DEPOSIT = 99300;
const BALANCE = TOTAL - DEPOSIT; // 84400

if (TOTAL !== 183700 || BALANCE !== 84400) {
    throw new Error(`Sanity check failed: total ${TOTAL}, balance ${BALANCE}`);
}

const now = new Date();
const dueDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

const internalNotes = JSON.stringify({
    originalNote: 'Auto-generated from payment. Pending dispatch.',
    dunningLog: [], // reset — amended & re-sent 2026-08-01; prior log: day_7 (2026-07-28) on the £910 balance
    amendment:
        'Amended 2026-08-01: deducted £66 for paint supplied by the customer. ' +
        'Previous totals: £1,903.00 total / £910.00 balance.',
});

const customerNotes =
    'Updated invoice — £66 credited for the paint you supplied. Deposit of £993.00 already received, thank you. ' +
    'Remaining balance £844.00.';

const [updated] = await db.update(invoices)
    .set({
        lineItems: lineItems as any,
        totalAmount: TOTAL,
        depositPaid: DEPOSIT,
        balanceDue: BALANCE,
        status: 'sent' as const,
        sentAt: now,
        dueDate,
        notes: internalNotes,
        customerNotes,
        updatedAt: now,
    })
    .where(eq(invoices.invoiceNumber, 'INV-2026-0217'))
    .returning();

if (!updated) throw new Error('INV-2026-0217 not found');

console.log('Amended:', updated.invoiceNumber);
console.log('  Total       : £' + (updated.totalAmount / 100).toFixed(2));
console.log('  Deposit paid: £' + (updated.depositPaid / 100).toFixed(2));
console.log('  Balance due : £' + (updated.balanceDue / 100).toFixed(2));
console.log('  Link        : https://www.handyservices.app/invoice/' + updated.id);
process.exit(0);
