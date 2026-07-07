/**
 * One-off v2: re-rate INV-2026-0162 (Rebecca) after on-the-day scope cuts.
 *
 * Customer reduced scope on the day (only 1 of 3 towel holders, 1 of 3 toilet
 * roll holders, 1 of 2 mirrors). Decision: remove the 12% multi-job discount
 * (earned by the full basket) and bill work done at the original quoted list
 * rates (quote vqb49nhc unit prices), plus the light job (depmildv) and the
 * upgraded toilet-holder fixing.
 *
 *  2 TVs £150 + towel rail £18.33 + toilet holder £18.33 + fixing £8
 *  + coat hooks £45 + towel hooks £42 + 1 mirror £45 + lights £120 = £446.66
 *  Deposit £123.32 → balance £323.34
 *
 * Safe to delete after running.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const lineItems = [
    { description: 'Wall-mount 2 televisions', quantity: 2, unitPrice: 7500, total: 15000 },
    { description: 'Fit towel rail', quantity: 1, unitPrice: 1833, total: 1833 },
    { description: 'Fit toilet roll holder', quantity: 1, unitPrice: 1833, total: 1833 },
    { description: 'Upgraded fixing for toilet roll holder', quantity: 1, unitPrice: 800, total: 800 },
    { description: 'Mount coat hooks', quantity: 1, unitPrice: 4500, total: 4500 },
    { description: 'Mount towel hooks (1 wall + 2 bathroom doors)', quantity: 3, unitPrice: 1400, total: 4200 },
    { description: 'Hang mirror', quantity: 1, unitPrice: 4500, total: 4500 },
    { description: 'Install light fittings (lounge + kitchen)', quantity: 2, unitPrice: 6000, total: 12000 },
];

const TOTAL = lineItems.reduce((s, i) => s + i.total, 0);   // 44666
const DEPOSIT = 12332;
const BALANCE = TOTAL - DEPOSIT;                            // 32334

const now = new Date();

const internalNotes = JSON.stringify({
    dunningLog: [],
    amendment:
        'Re-issued 2026-07-06 (v2) after customer sent completed-work list: only 1 of 3 towel holders, ' +
        '1 of 3 toilet roll holders and 1 of 2 mirrors were done (scope cut on the day by customer). ' +
        'Decision: 12% multi-job discount removed (was earned by full basket); work done billed at ' +
        'original quoted list unit rates (quote vqb49nhc: TVs £150/2, holders £55/3, coat hooks £45, ' +
        'towel hooks £42, mirrors £90/2). Includes light job (quote depmildv £120) and £8 upgraded fixing. ' +
        'Supersedes v1 amendment (£520.72) and original (£411.05).',
});

const customerNotes =
    'Property: Nottingham NG3 5TF. Fully itemised bill covering the work completed across both visits ' +
    '(quotes vqb49nhc and depmildv), at the per-item rates from your original quote. Please note: your ' +
    'original price included a multi-job discount for the full list of jobs — as several items were ' +
    'removed on the day, standard per-item rates now apply. Deposit of £123.32 already received — thank you.';

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
    .where(eq(invoices.invoiceNumber, 'INV-2026-0162'))
    .returning();

console.log('Amended (v2):', updated.invoiceNumber);
console.log('  Total       : £' + (updated.totalAmount / 100).toFixed(2));
console.log('  Deposit paid: £' + (updated.depositPaid / 100).toFixed(2));
console.log('  Balance due : £' + (updated.balanceDue / 100).toFixed(2));
console.log('  Link        : https://www.handyservices.app/invoice/' + updated.id);
process.exit(0);
