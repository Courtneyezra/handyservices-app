/**
 * One-off: amend INV-2026-0167 (Tam, DE73 8FN, quote 03r27ctu).
 *
 *  - Original job as invoiced (7% flex discount on £368 tier)   £342.24
 *  - Less porch cupboard not installed                          -£83.70
 *      (quoted £100 guarded; ×0.90 multi-job ×0.93 flex = £83.70 invoiced share)
 *  - Less £20 goodwill gesture on roller blind fitting          -£20.00
 *  Total £238.54 — deposit paid £103.00 — balance due £135.54
 *
 * Resets dunning clock (sentAt = now, log cleared) — day-21 reminder was
 * otherwise about to fire with the stale £239.24 balance.
 *
 * Safe to delete after running.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const TOTAL = 34224 - 8370 - 2000;   // 23854
const DEPOSIT = 10300;
const BALANCE = TOTAL - DEPOSIT;     // 13554

const lineItems = [
    {
        description: 'Install 3 kitchen cupboards, fit roller blind, install porch cupboard (quote 03r27ctu)',
        quantity: 1,
        unitPrice: 34224,
        total: 34224,
    },
    {
        description: 'Less: porch cupboard not installed (removed from the job)',
        quantity: 1,
        unitPrice: -8370,
        total: -8370,
    },
    {
        description: 'Goodwill gesture: £20 off roller blind fitting',
        quantity: 1,
        unitPrice: -2000,
        total: -2000,
    },
];

const now = new Date();
const dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

const internalNotes = JSON.stringify({
    dunningLog: [],   // reset — amended invoice re-sent 2026-07-06; old log: day_7, day_14 on the £342.24 version
    amendment:
        'Amended 2026-07-06: removed 1x porch cupboard (not installed) at £83.70 — its invoiced share ' +
        '(£100 guarded × 0.90 multi-job discount × 0.93 flex-booking discount). ' +
        'Applied £20 goodwill gesture on roller blind fitting. ' +
        'Previous totals: £342.24 total / £239.24 balance. Quote line said "curtain pole or rail"; ' +
        'roller blind fitted on the day.',
});

const customerNotes =
    'Property: 2 Windsor Ave, Melbourne, Derby DE73 8FN. Adjustments applied: porch cupboard removed ' +
    'from the job (-£83.70, with your multi-job and flexible-booking discounts carried through) and a ' +
    '£20 goodwill discount on the roller blind fitting. Deposit of £103.00 already received — thank you.';

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
    .where(eq(invoices.invoiceNumber, 'INV-2026-0167'))
    .returning();

console.log('Amended:', updated.invoiceNumber);
console.log('  Total       : £' + (updated.totalAmount / 100).toFixed(2));
console.log('  Deposit paid: £' + (updated.depositPaid / 100).toFixed(2));
console.log('  Balance due : £' + (updated.balanceDue / 100).toFixed(2));
console.log('  Due date    : ' + updated.dueDate);
console.log('  Link        : https://www.handyservices.app/invoice/' + updated.id);
process.exit(0);
