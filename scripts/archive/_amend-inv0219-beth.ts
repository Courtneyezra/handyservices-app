/**
 * One-off: amend INV-2026-0219 (Beth, 29 Arkle Green, Sinfin, DE24 9NW, quote gniokujo).
 *
 * Shower could not be fixed on the day, so the "Repair shower leak and secure to
 * wall" line (£129 quoted) is removed. A separate quote will follow to re-fit a new
 * shower. Re-itemised the 5 remaining jobs and carried the customer's original ~£67
 * goodwill discount so the headline lands on the agreed £450.00.
 *
 *   Outdoor tap repair            £65.00
 *   Back gate repair              £50.00
 *   Shed facia boards             £159.00
 *   Shed roof felt                £163.00
 *   Clear household waste         £80.00
 *   Subtotal                      £517.00
 *   Multi-job discount            -£67.00
 *   Total                         £450.00
 *   Deposit paid                  -£235.30
 *   Balance due                   £214.70
 *
 * Was: £579.00 total / £344.00 balance (single lumped line incl. shower).
 * Resets dunning log (day_7 already fired 2026-07-29 on the stale £344 balance)
 * and re-stamps sentAt so reminders track the corrected balance.
 *
 * Safe to delete after running.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const lineItems = [
    { description: 'Repair leaking outdoor tap', quantity: 1, unitPrice: 6500, total: 6500 },
    { description: 'Inspect and repair back gate', quantity: 1, unitPrice: 5000, total: 5000 },
    { description: 'Replace rotted shed facia boards', quantity: 1, unitPrice: 15900, total: 15900 },
    { description: 'Replace shed roof felt', quantity: 1, unitPrice: 16300, total: 16300 },
    { description: 'Clear household waste and rubbish', quantity: 1, unitPrice: 8000, total: 8000 },
    { description: 'Multi-job discount', quantity: 1, unitPrice: -6700, total: -6700 },
];

const TOTAL = lineItems.reduce((s, li) => s + li.total, 0); // 45000
const DEPOSIT = 23530;
const BALANCE = TOTAL - DEPOSIT; // 21470

if (TOTAL !== 45000 || BALANCE !== 21470) {
    throw new Error(`Sanity check failed: total ${TOTAL}, balance ${BALANCE}`);
}

const now = new Date();
const dueDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

const internalNotes = JSON.stringify({
    originalNote: 'Auto-generated from payment. Job ID: 55',
    dunningLog: [], // reset — amended & re-sent 2026-07-31; prior log: day_7 (2026-07-29) on the £344 balance
    amendment:
        'Amended 2026-07-31: removed "Repair shower leak and secure to wall" (£129 quoted) — shower could ' +
        'not be fixed on the day; a separate quote will follow to re-fit a new shower. Re-itemised the 5 ' +
        'remaining jobs (£517) and carried the original ~£67 goodwill discount to hold the agreed £450 ' +
        'headline. Previous totals: £579.00 total / £344.00 balance.',
});

const customerNotes =
    'Updated invoice — the shower repair has been removed as it could not be completed on the day; we’ll ' +
    'send you a separate quote to re-fit a new shower. Deposit of £235.30 already received, thank you. ' +
    'Remaining balance £214.70.';

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
    .where(eq(invoices.invoiceNumber, 'INV-2026-0219'))
    .returning();

if (!updated) throw new Error('INV-2026-0219 not found');

console.log('Amended:', updated.invoiceNumber);
console.log('  Total       : £' + (updated.totalAmount / 100).toFixed(2));
console.log('  Deposit paid: £' + (updated.depositPaid / 100).toFixed(2));
console.log('  Balance due : £' + (updated.balanceDue / 100).toFixed(2));
console.log('  Link        : https://www.handyservices.app/invoice/' + updated.id);
process.exit(0);
