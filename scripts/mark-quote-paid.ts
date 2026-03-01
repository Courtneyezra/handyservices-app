/**
 * Mark a quote as paid and create job + invoice (mimics Stripe webhook flow)
 * Usage: npx tsx scripts/mark-quote-paid.ts <quote-slug> [tier] [deposit-pence]
 *
 * Examples:
 *   npx tsx scripts/mark-quote-paid.ts PeA07uEY essential 5609
 *   npx tsx scripts/mark-quote-paid.ts PeA07uEY  # Uses defaults
 */

import { db } from '../server/db';
import { personalizedQuotes, contractorJobs, invoices, leads } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

async function markQuotePaid(slug: string, tierOverride?: string, depositOverride?: number) {
    console.log(`Looking for quote with slug: ${slug}`);

    // Find the quote
    const quotes = await db.select()
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.shortSlug, slug))
        .limit(1);

    if (quotes.length === 0) {
        console.error('Quote not found with slug:', slug);
        process.exit(1);
    }

    const quote = quotes[0];
    console.log(`Found quote: ${quote.id}`);
    console.log(`  Customer: ${quote.customerName}`);
    console.log(`  Job: ${quote.jobDescription}`);
    console.log(`  Current bookedAt: ${quote.bookedAt}`);

    // Determine selected tier
    const selectedTier = tierOverride || quote.selectedPackage || 'essential';

    // Calculate total job price from tier
    let totalJobPrice = 0;
    if (quote.quoteMode === 'simple') {
        totalJobPrice = quote.basePrice || 0;
    } else {
        const tierPriceMap: Record<string, number | null | undefined> = {
            essential: quote.essentialPrice,
            enhanced: quote.enhancedPrice,
            elite: quote.elitePrice
        };
        totalJobPrice = tierPriceMap[selectedTier] || quote.essentialPrice || 0;
    }

    // Calculate deposit (30% of labour + 100% materials, or use override)
    const materialsCost = (quote.materialsCostWithMarkupPence as number) || 0;
    const labourCost = totalJobPrice - materialsCost;
    const calculatedDeposit = materialsCost + Math.round(labourCost * 0.30);
    const depositAmount = depositOverride || calculatedDeposit || Math.round(totalJobPrice * 0.30);

    console.log(`\n📊 Pricing:`);
    console.log(`  Selected Tier: ${selectedTier}`);
    console.log(`  Total Job Price: £${(totalJobPrice / 100).toFixed(2)}`);
    console.log(`  Deposit Amount: £${(depositAmount / 100).toFixed(2)}`);

    // 1. Update Quote
    await db.update(personalizedQuotes)
        .set({
            depositPaidAt: new Date(),
            depositAmountPence: depositAmount,
            bookedAt: new Date(),
            selectedPackage: selectedTier,
            stripePaymentIntentId: `pi_manual_${Date.now()}`,
        })
        .where(eq(personalizedQuotes.id, quote.id));

    console.log(`\n✅ Quote marked as paid`);

    // 2. Create Job for Dispatching (only if contractor assigned)
    let jobId: string | null = null;

    if (quote.contractorId) {
        jobId = `job_${uuidv4().slice(0, 8)}`;

        await db.insert(contractorJobs).values({
            id: jobId,
            contractorId: quote.contractorId,
            quoteId: quote.id,
            leadId: quote.leadId || null,
            customerName: quote.customerName,
            customerPhone: quote.phone,
            address: quote.address || '',
            postcode: quote.postcode || '',
            jobDescription: quote.jobDescription || '',
            status: 'pending',
            scheduledDate: quote.selectedDate || null,
            estimatedDuration: null,
            payoutPence: Math.round(totalJobPrice * 0.7),
            paymentStatus: 'unpaid',
            notes: `Deposit paid: £${(depositAmount / 100).toFixed(2)} | Package: ${selectedTier} | Manual entry`,
        });

        console.log(`✅ Job created: ${jobId}`);
    } else {
        console.log(`⚠️  No contractor assigned - job will be created during dispatch`);
    }

    // 3. Generate Invoice
    const year = new Date().getFullYear();
    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(invoices);
    const invoiceCount = Number(countResult?.count || 0);
    const invoiceNumber = `INV-${year}-${String(invoiceCount + 1).padStart(4, '0')}`;

    const balanceDue = totalJobPrice - depositAmount;

    const lineItems = [{
        description: quote.jobDescription || `${selectedTier} Service`,
        quantity: 1,
        unitPrice: totalJobPrice,
        total: totalJobPrice
    }];

    const invoiceId = uuidv4();
    await db.insert(invoices).values({
        id: invoiceId,
        invoiceNumber,
        quoteId: quote.id,
        contractorId: quote.contractorId || null,
        customerName: quote.customerName,
        customerEmail: quote.email || null,
        customerPhone: quote.phone,
        customerAddress: quote.address || '',
        totalAmount: totalJobPrice,
        depositPaid: depositAmount,
        balanceDue: balanceDue,
        lineItems: lineItems as any,
        status: balanceDue <= 0 ? 'paid' : 'sent',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        paidAt: balanceDue <= 0 ? new Date() : null,
        stripePaymentIntentId: `pi_manual_${Date.now()}`,
        paymentMethod: 'stripe',
        notes: jobId ? `Manual entry - Job ID: ${jobId}` : `Manual entry - Pending dispatch`,
    });

    console.log(`✅ Invoice created: ${invoiceNumber}`);

    // 4. Update Lead Status
    if (quote.leadId) {
        await db.update(leads)
            .set({
                status: 'converted',
                updatedAt: new Date(),
            })
            .where(eq(leads.id, quote.leadId));

        console.log(`✅ Lead ${quote.leadId} marked as converted`);
    }

    console.log(`\n🎉 COMPLETE:`);
    console.log(`  Quote: ${quote.shortSlug}`);
    console.log(`  Job ID: ${jobId || 'Pending dispatch'}`);
    console.log(`  Invoice: ${invoiceNumber}`);
    console.log(`  Total: £${(totalJobPrice / 100).toFixed(2)}`);
    console.log(`  Deposit: £${(depositAmount / 100).toFixed(2)}`);
    console.log(`  Balance Due: £${(balanceDue / 100).toFixed(2)}`);

    process.exit(0);
}

// Get args from command line
const slug = process.argv[2];
const tierOverride = process.argv[3]; // optional: essential, enhanced, elite
const depositOverride = process.argv[4] ? parseInt(process.argv[4], 10) : undefined;

if (!slug) {
    console.log('Usage: npx tsx scripts/mark-quote-paid.ts <quote-slug> [tier] [deposit-pence]');
    console.log('\nExamples:');
    console.log('  npx tsx scripts/mark-quote-paid.ts PeA07uEY');
    console.log('  npx tsx scripts/mark-quote-paid.ts PeA07uEY essential');
    console.log('  npx tsx scripts/mark-quote-paid.ts PeA07uEY essential 5609');
    process.exit(1);
}

markQuotePaid(slug, tierOverride, depositOverride).catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
