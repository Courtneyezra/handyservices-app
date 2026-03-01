/**
 * Create a complete test quote with deposit paid for testing
 * Usage: npx tsx scripts/create-test-quote.ts
 */

import { db } from '../server/db';
import { personalizedQuotes, invoices } from '../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'drizzle-orm';

async function createTestQuote() {
    const quoteId = uuidv4();
    // Short slug max 8 chars
    const shortSlug = `T${Date.now().toString(36).slice(-7).toUpperCase()}`;
    const now = new Date();

    // Create the quote
    const [quote] = await db.insert(personalizedQuotes).values({
        id: quoteId,
        shortSlug,
        customerName: 'Test Customer',
        phone: '07700900123',
        email: 'test@example.com',
        address: '123 Test Street, London',
        postcode: 'SW1A 1AA',
        jobDescription: 'Fix leaking tap in kitchen and replace bathroom door handle',
        segment: 'BUSY_PRO',
        quoteMode: 'hhh',
        selectedPackage: 'enhanced',
        essentialPrice: 15000,  // £150
        enhancedPrice: 22500,   // £225
        elitePrice: 35000,      // £350
        basePrice: 22500,
        depositAmountPence: 4500, // £45 (20% of £225)
        depositPaidAt: now,
        bookedAt: now,
        selectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week from now
        selectedTimeSlot: 'am',
        status: 'booked',
        stripePaymentIntentId: `pi_test_${Date.now()}`,
        createdAt: now,
        updatedAt: now,
    }).returning();

    console.log('\n✅ Test Quote Created!');
    console.log('─'.repeat(40));
    console.log(`  Quote ID: ${quote.id}`);
    console.log(`  Slug: ${quote.shortSlug}`);
    console.log(`  Customer: ${quote.customerName}`);
    console.log(`  Package: ${quote.selectedPackage} (£${((quote.enhancedPrice || 0) / 100).toFixed(2)})`);
    console.log(`  Deposit Paid: £${((quote.depositAmountPence || 0) / 100).toFixed(2)}`);
    console.log(`  Status: ${quote.status}`);

    // Generate invoice number
    const year = new Date().getFullYear();
    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(invoices);
    const invoiceCount = Number(countResult?.count || 0);
    const invoiceNumber = `INV-${year}-${String(invoiceCount + 1).padStart(4, '0')}`;

    // Create matching invoice
    const totalAmount = quote.enhancedPrice || 22500;
    const depositPaid = quote.depositAmountPence || 4500;
    const balanceDue = totalAmount - depositPaid;

    const [invoice] = await db.insert(invoices).values({
        id: uuidv4(),
        invoiceNumber,
        quoteId: quote.id,
        customerName: quote.customerName,
        customerEmail: quote.email,
        customerPhone: quote.phone,
        customerAddress: quote.address,
        totalAmount,
        depositPaid,
        balanceDue,
        lineItems: [{
            description: 'Enhanced Package - Handyman Service',
            quantity: 1,
            unitPrice: totalAmount,
            total: totalAmount,
        }],
        status: 'sent',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        createdAt: now,
        updatedAt: now,
    }).returning();

    console.log('\n✅ Test Invoice Created!');
    console.log('─'.repeat(40));
    console.log(`  Invoice Number: ${invoice.invoiceNumber}`);
    console.log(`  Total: £${(totalAmount / 100).toFixed(2)}`);
    console.log(`  Deposit Paid: £${(depositPaid / 100).toFixed(2)}`);
    console.log(`  Balance Due: £${(balanceDue / 100).toFixed(2)}`);
    console.log(`  Status: ${invoice.status}`);

    console.log('\n📋 Test URLs:');
    console.log('─'.repeat(40));
    console.log(`  Quote Page: http://localhost:5173/q/${quote.shortSlug}`);
    console.log(`  Admin Invoices: http://localhost:5173/admin/invoices`);

    process.exit(0);
}

createTestQuote().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
