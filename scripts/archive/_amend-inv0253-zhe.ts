/**
 * One-off: amend INV-2026-0253 (Zhe). Stripe pi_3TqAok4p9GekG4mY0mrP4nRi was a
 * FULL payment with 3% pay-in-full discount (£229 → £222.13), so the original
 * job is settled — balance is ONLY the £45 additional works.
 * Total £267.13, paid £222.13, balance £45.00. Regenerates the PDF.
 * Safe to delete after running.
 */
import { generateInvoicePdf } from '../server/invoice-generator';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'fs';

const INVOICE_ID = '51bc6598-9574-4134-8438-bf2ddbd84a3c'; // INV-2026-0253

const lineItems = [
    {
        description: 'Install integrated cupboard door, install standard cupboard door, supply & fit new toilet seat (paid in full — 3% pay-in-full discount applied)',
        quantity: 1,
        unitPrice: 22213,
        total: 22213,
    },
    {
        description: 'Additional works: integrated fridge brackets & base unit hinges',
        quantity: 1,
        unitPrice: 4500,
        total: 4500,
    },
];

const [updated] = await db.update(invoices)
    .set({
        lineItems: lineItems as any,
        totalAmount: 26713, // £267.13
        depositPaid: 22213, // £222.13 full payment 6 Jul (3% discount off £229)
        balanceDue: 4500,   // £45.00 — the additional works only
        notes: 'Replaces voided INV-2026-0196 (auto-gen). Original £229 job settled IN FULL 6 Jul via Stripe pi_3TqAok4p9GekG4mY0mrP4nRi (£222.13, 3% pay-in-full discount). Balance = £45 additional works only (integrated fridge brackets + base unit hinges). Amended 14 Aug: earlier version wrongly chased £6.87 discount gap.',
        customerNotes: 'Your original job was paid in full on 6 July (£222.13 with the pay-in-full discount) — thank you. This invoice just covers the additional £45 for the integrated fridge brackets and base unit hinges, payable by card or bank transfer (details below).',
        updatedAt: new Date(),
    })
    .where(eq(invoices.id, INVOICE_ID))
    .returning();

console.log(`Amended ${updated.invoiceNumber} — total £${(updated.totalAmount / 100).toFixed(2)}, paid £${(updated.depositPaid / 100).toFixed(2)}, balance £${(updated.balanceDue / 100).toFixed(2)}`);

const pdf = await generateInvoicePdf(INVOICE_ID);
const outPath = `${process.cwd()}/${updated.invoiceNumber}-zhe.pdf`;
writeFileSync(outPath, pdf);
console.log(`PDF written: ${outPath}`);
process.exit(0);
