/**
 * One-off: amend INV-2026-0162 (Rebecca, NG3 5TF) to cover both jobs with adjustments.
 *
 *  - Original mounting job (quote vqb49nhc, selected tier)     £411.05
 *  - Less 1x towel hanger not fitted (customer preference)     -£18.33  (quoted £55 for 3 → £18.33/unit)
 *  - New toilet roll holder fitted with upgraded fixing         +£8.00
 *  - Install 2 light fittings (quote depmildv)                 +£120.00
 *  Total £520.72 — deposit paid £123.32 — balance due £397.40
 *
 * Also resets the dunning clock (sentAt = now, log cleared) so reminders
 * restart from the amended invoice, not the stale £287.73 balance.
 *
 * Safe to delete after running.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const TOTAL = 41105 - 1833 + 800 + 12000;   // 52072
const DEPOSIT = 12332;
const BALANCE = TOTAL - DEPOSIT;            // 39740

const lineItems = [
    {
        description: 'Wall-mount 2 TVs, towel holders, toilet roll holders, coat & towel hooks, hang 2 mirrors (quote vqb49nhc)',
        quantity: 1,
        unitPrice: 41105,
        total: 41105,
    },
    {
        description: 'Less: 1x towel hanger not fitted (removed at your request)',
        quantity: 1,
        unitPrice: -1833,
        total: -1833,
    },
    {
        description: 'New toilet roll holder fitted with upgraded fixing',
        quantity: 1,
        unitPrice: 800,
        total: 800,
    },
    {
        description: 'Install 2 light fittings (quote depmildv)',
        quantity: 1,
        unitPrice: 12000,
        total: 12000,
    },
];

const now = new Date();
const dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

const internalNotes = JSON.stringify({
    dunningLog: [],   // reset — amended invoice re-sent 2026-07-06; old log: day_7, day_14 on the £411.05 version
    amendment:
        'Amended 2026-07-06: combined with light-fitting job (quote depmildv, quote_v5DBJ9acoh_AvnWIjfaVU, £120). ' +
        'Deducted 1x towel hanger not fitted (customer said it did not look right) at £18.33 (quoted £55 for 3). ' +
        'Added 1x new toilet roll holder fitted with better fixing at £8. ' +
        'Previous totals: £411.05 total / £287.73 balance.',
});

const customerNotes =
    'Property: Nottingham NG3 5TF. Covers both visits: wall-mounting & hanging job (quote vqb49nhc) ' +
    'and light fitting installation (quote depmildv). Adjustments applied: 1x towel hanger removed ' +
    '(not fitted at your request, -£18.33) and 1x new toilet roll holder fitted with an upgraded fixing (£8.00). ' +
    'Deposit of £123.32 already received — thank you.';

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
    .where(eq(invoices.invoiceNumber, 'INV-2026-0162'))
    .returning();

console.log('Amended:', updated.invoiceNumber);
console.log('  Total       : £' + (updated.totalAmount / 100).toFixed(2));
console.log('  Deposit paid: £' + (updated.depositPaid / 100).toFixed(2));
console.log('  Balance due : £' + (updated.balanceDue / 100).toFixed(2));
console.log('  Due date    : ' + updated.dueDate);
console.log('  Status      : ' + updated.status);
console.log('  Link        : https://www.handyservices.app/invoice/' + updated.id);
process.exit(0);
