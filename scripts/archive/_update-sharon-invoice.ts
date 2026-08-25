/**
 * Quick fix: Sharon's deep clean is already completed, update line item
 * description + notes to reflect that. Safe to delete after running.
 */
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function main() {
    const newLineItems = [{
        description: 'Full deep clean — oven, fridge, freezer & washing machine all included (job completed)',
        quantity: 1,
        unitPrice: 18000,
        total: 18000,
    }];

    const [updated] = await db.update(invoices)
        .set({
            lineItems: newLineItems as any,
            customerNotes:
                'Property: Nottingham NG15. ' +
                'Service completed: full deep clean — oven, fridge, freezer & washing machine all included. ' +
                '£180 inclusive.',
            notes:
                'Standalone deep clean invoice for Sharon (returning happy customer, prior bathroom job via quote d2qis4m0). ' +
                '£180 flat, completed. Not linked to bathroom quote (separate scope).',
            updatedAt: new Date(),
        })
        .where(eq(invoices.invoiceNumber, 'INV-2026-0123'))
        .returning();

    console.log('Updated:', updated.invoiceNumber, '— total £' + (updated.totalAmount / 100).toFixed(2));
    process.exit(0);
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
