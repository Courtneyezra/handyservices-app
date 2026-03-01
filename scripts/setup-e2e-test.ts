/**
 * E2E Test Setup Script
 * Creates all test data needed for full system testing
 *
 * Usage: npx tsx scripts/setup-e2e-test.ts
 */

import { db } from '../server/db';
import {
    personalizedQuotes,
    invoices,
    contractorBookingRequests,
    handymanProfiles,
    users,
    contractorSessions
} from '../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { sql, eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';

async function setupE2ETest() {
    console.log('\n🚀 Setting up E2E Test Data...\n');

    const now = new Date();
    const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // ============================================
    // 1. CREATE TEST CONTRACTOR (if not exists)
    // ============================================
    console.log('1️⃣  Creating test contractor...');

    let testContractor = await db.query.users.findFirst({
        where: eq(users.email, 'contractor@test.com'),
    });

    let contractorProfileId: string;

    if (!testContractor) {
        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash('test123', 10);

        await db.insert(users).values({
            id: userId,
            email: 'contractor@test.com',
            password: hashedPassword,
            firstName: 'Test',
            lastName: 'Contractor',
            role: 'contractor',
            isActive: true,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
        });

        const profileId = uuidv4();
        await db.insert(handymanProfiles).values({
            id: profileId,
            userId: userId,
            businessName: 'Test Handyman Services',
            publicProfileEnabled: true,
            latitude: '51.5074',
            longitude: '-0.1278',
            radiusMiles: 25,
            createdAt: now,
            updatedAt: now,
        });

        contractorProfileId = profileId;
        console.log('   ✅ Created contractor: contractor@test.com / test123');
    } else {
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, testContractor.id),
        });
        contractorProfileId = profile?.id || '';
        console.log('   ℹ️  Contractor already exists: contractor@test.com');
    }

    // ============================================
    // 2. CREATE TEST QUOTE (Deposit Paid)
    // ============================================
    console.log('\n2️⃣  Creating test quote with deposit paid...');

    const quoteId = uuidv4();
    const quoteSlug = `E2E${Date.now().toString(36).slice(-5).toUpperCase()}`;

    const [quote] = await db.insert(personalizedQuotes).values({
        id: quoteId,
        shortSlug: quoteSlug,
        customerName: 'E2E Test Customer',
        phone: '07700900456',
        email: 'customer@test.com',
        address: '456 Test Avenue, London',
        postcode: 'E1 6AN',
        jobDescription: 'Install new bathroom towel rail and fix squeaky door hinges',
        segment: 'BUSY_PRO',
        quoteMode: 'hhh',
        selectedPackage: 'enhanced',
        essentialPrice: 12000,
        enhancedPrice: 18000,
        elitePrice: 28000,
        basePrice: 18000,
        depositAmountPence: 3600,
        depositPaidAt: now,
        bookedAt: now,
        selectedDate: oneWeekFromNow,
        selectedTimeSlot: 'am',
        status: 'booked',
        stripePaymentIntentId: `pi_e2e_${Date.now()}`,
        contractorId: contractorProfileId,
        createdAt: now,
        updatedAt: now,
    }).returning();

    console.log(`   ✅ Quote created: ${quoteSlug}`);

    // ============================================
    // 3. CREATE INVOICE
    // ============================================
    console.log('\n3️⃣  Creating invoice...');

    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(invoices);
    const invoiceCount = Number(countResult?.count || 0);
    const invoiceNumber = `INV-2026-${String(invoiceCount + 1).padStart(4, '0')}`;

    const totalAmount = 18000;
    const depositPaid = 3600;
    const balanceDue = totalAmount - depositPaid;

    const [invoice] = await db.insert(invoices).values({
        id: uuidv4(),
        invoiceNumber,
        quoteId: quoteId,
        contractorId: contractorProfileId,
        customerName: 'E2E Test Customer',
        customerEmail: 'customer@test.com',
        customerPhone: '07700900456',
        customerAddress: '456 Test Avenue, London',
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
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
    }).returning();

    console.log(`   ✅ Invoice created: ${invoiceNumber}`);

    // ============================================
    // 4. CREATE JOB (Booking Request)
    // ============================================
    console.log('\n4️⃣  Creating job/booking request...');

    const [job] = await db.insert(contractorBookingRequests).values({
        id: uuidv4(),
        quoteId: quoteId,
        contractorId: contractorProfileId,
        assignedContractorId: contractorProfileId,
        customerName: 'E2E Test Customer',
        customerEmail: 'customer@test.com',
        customerPhone: '07700900456',
        description: 'Install new bathroom towel rail and fix squeaky door hinges',
        location: '456 Test Avenue, London, E1 6AN',
        requestedDate: oneWeekFromNow,
        scheduledDate: oneWeekFromNow,
        scheduledStartTime: '09:00',
        scheduledEndTime: '12:00',
        status: 'accepted',
        assignmentStatus: 'accepted',
        assignedAt: now,
        acceptedAt: now,
        invoiceId: invoice.id,
        createdAt: now,
        updatedAt: now,
    }).returning();

    console.log(`   ✅ Job created: ${job.id.slice(0, 8)}...`);

    // ============================================
    // SUMMARY
    // ============================================
    console.log('\n' + '═'.repeat(50));
    console.log('✅ E2E TEST DATA READY');
    console.log('═'.repeat(50));

    console.log('\n📋 TEST CREDENTIALS:');
    console.log('─'.repeat(50));
    console.log('  Contractor Login:');
    console.log('    Email: contractor@test.com');
    console.log('    Password: test123');

    console.log('\n📍 TEST URLS:');
    console.log('─'.repeat(50));
    console.log(`  Quote Page:        http://localhost:5173/q/${quoteSlug}`);
    console.log('  Admin Invoices:    http://localhost:5173/admin/invoices');
    console.log('  Admin Dispatch:    http://localhost:5173/admin/dispatch');
    console.log('  Contractor Login:  http://localhost:5173/contractor/login');
    console.log('  Contractor Jobs:   http://localhost:5173/contractor/dashboard');

    console.log('\n📊 TEST DATA CREATED:');
    console.log('─'.repeat(50));
    console.log(`  Quote Slug:     ${quoteSlug}`);
    console.log(`  Invoice Number: ${invoiceNumber}`);
    console.log(`  Job ID:         ${job.id.slice(0, 8)}...`);
    console.log(`  Customer:       E2E Test Customer`);
    console.log(`  Amount:         £${(totalAmount / 100).toFixed(2)}`);
    console.log(`  Deposit Paid:   £${(depositPaid / 100).toFixed(2)}`);
    console.log(`  Balance Due:    £${(balanceDue / 100).toFixed(2)}`);

    console.log('\n');
    process.exit(0);
}

setupE2ETest().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
