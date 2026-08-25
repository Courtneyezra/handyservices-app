/**
 * One-off: amend INV-2026-0209 (Craig, DE1 2RF, quote xx3diece).
 *
 * Job completed. Additional costs agreed on the phone / via video
 * (split & damaged door frame found under one door):
 *  - Disposal costs                                        +£50.00
 *  - Finished door upgrade (agreed on the phone)           +£45.00
 *  - Splice repair to damaged frame section                +£95.00
 *
 *  Original total £744.00 + £190.00 = £934.00
 *  Deposit paid £454.00 — balance due £480.00
 *
 * Safe to delete after running.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const TOTAL = 74400 + 5000 + 4500 + 9500;   // 93400
const DEPOSIT = 45400;
const BALANCE = TOTAL - DEPOSIT;            // 48000

const lineItems = [
    {
        description: 'Supply and fit new fire door, install new sink waste kit, patch and skim-repair wall hole, repaint wall, prep and repaint skirting (quote xx3diece)',
        quantity: 1,
        unitPrice: 74400,
        total: 74400,
    },
    {
        description: 'Disposal costs',
        quantity: 1,
        unitPrice: 5000,
        total: 5000,
    },
    {
        description: 'Finished door upgrade (as agreed on the phone)',
        quantity: 1,
        unitPrice: 4500,
        total: 4500,
    },
    {
        description: 'Splice repair to damaged door frame section (frame found split at the bottom — repaired before fitting the new fire door)',
        quantity: 1,
        unitPrice: 9500,
        total: 9500,
    },
];

const now = new Date();

const internalNotes = JSON.stringify({
    dunningLog: [],
    previousNotes: 'Auto-generated from payment. Pending dispatch.',
    amendment:
        'Amended 2026-07-16: added £190 of extras agreed with Craig on the phone and via video — ' +
        'disposal £50, finished door upgrade £45, splice repair to split/damaged frame section £95. ' +
        'Frame bottom found split and damaged; repair required before the new fire door could be fitted. ' +
        'Previous totals: £744.00 total / £290.00 balance.',
});

const customerNotes =
    'As discussed on the phone and in the video sent, the bottom of one door frame was found split and ' +
    'damaged and needed repairing before the new fire door could be fitted. Additional costs agreed: ' +
    'disposal costs £50, finished door upgrade £45, splice repair to the damaged frame section £95 — ' +
    '£190 total. Deposit of £454.00 already received — thank you.';

const [updated] = await db.update(invoices)
    .set({
        lineItems: lineItems as any,
        totalAmount: TOTAL,
        depositPaid: DEPOSIT,
        balanceDue: BALANCE,
        notes: internalNotes,
        customerNotes,
        updatedAt: now,
    })
    .where(eq(invoices.invoiceNumber, 'INV-2026-0209'))
    .returning();

console.log('Amended:', updated.invoiceNumber);
console.log('  Total       : £' + (updated.totalAmount / 100).toFixed(2));
console.log('  Deposit paid: £' + ((updated.depositPaid ?? 0) / 100).toFixed(2));
console.log('  Balance due : £' + ((updated.balanceDue ?? 0) / 100).toFixed(2));
console.log('  Due date    : ' + updated.dueDate);
console.log('  Link        : https://www.handyservices.app/invoice/' + updated.id);
process.exit(0);
