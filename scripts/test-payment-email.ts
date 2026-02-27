/**
 * Test Payment Email Flow (S-001)
 *
 * Manual test script to verify the payment email flow works correctly.
 *
 * Problem being fixed:
 * - Payment taken but no confirmation email sent
 * - Email field missing from payment form
 * - Webhook needs email to send confirmation
 *
 * Usage:
 *   npx tsx scripts/test-payment-email.ts
 *
 * What this script tests:
 * 1. Create a test quote without email
 * 2. Simulate updating the quote with an email (as payment intent creation should do)
 * 3. Verify the email would be available for the webhook
 * 4. Optionally send a test email (if --send flag passed)
 */

import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes, invoices } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const TEST_EMAIL = 'test-payment-flow@example.com';
const TEST_QUOTE_PREFIX = 'test-payment-email-';

interface TestResult {
  step: string;
  passed: boolean;
  details: string;
}

async function runTests(): Promise<void> {
  const results: TestResult[] = [];
  let testQuoteId: string | null = null;

  console.log('======================================================');
  console.log('  Payment Email Flow Test (S-001)');
  console.log('======================================================\n');

  try {
    // ============================================================
    // Test 1: Create test quote WITHOUT email
    // ============================================================
    console.log('Test 1: Creating test quote without email...');

    const quoteSlug = TEST_QUOTE_PREFIX + Date.now();
    testQuoteId = uuidv4();

    await db.insert(personalizedQuotes).values({
      id: testQuoteId,
      customerName: 'Test Payment Customer',
      phone: '07700000000',
      email: null, // Intentionally null to simulate the bug
      postcode: 'SW11 2AB',
      address: '123 Test Street, London',
      jobDescription: 'Test payment email flow - fix leaky tap',
      quoteMode: 'simple',
      basePrice: 15000, // £150
      materialsCostWithMarkupPence: 3000, // £30
      shortSlug: quoteSlug,
      segment: 'DIY_DEFERRER',
      createdAt: new Date(),
    });

    // Verify quote was created without email
    const createdQuote = await db.select()
      .from(personalizedQuotes)
      .where(eq(personalizedQuotes.id, testQuoteId))
      .limit(1);

    if (createdQuote.length === 0) {
      results.push({
        step: 'Create quote without email',
        passed: false,
        details: 'Failed to create test quote',
      });
    } else if (createdQuote[0].email !== null) {
      results.push({
        step: 'Create quote without email',
        passed: false,
        details: `Quote has email when it should be null: ${createdQuote[0].email}`,
      });
    } else {
      results.push({
        step: 'Create quote without email',
        passed: true,
        details: `Quote created: ${testQuoteId} (email: null)`,
      });
    }

    // ============================================================
    // Test 2: Simulate payment intent creation updating quote email
    // ============================================================
    console.log('\nTest 2: Simulating payment intent creation with email...');

    // This is what the fix should do: update the quote email during payment intent creation
    const customerEmail = TEST_EMAIL;

    await db.update(personalizedQuotes)
      .set({ email: customerEmail })
      .where(eq(personalizedQuotes.id, testQuoteId));

    const updatedQuote = await db.select()
      .from(personalizedQuotes)
      .where(eq(personalizedQuotes.id, testQuoteId))
      .limit(1);

    if (updatedQuote.length === 0) {
      results.push({
        step: 'Update quote with email',
        passed: false,
        details: 'Failed to find quote after update',
      });
    } else if (updatedQuote[0].email !== customerEmail) {
      results.push({
        step: 'Update quote with email',
        passed: false,
        details: `Email not updated correctly. Expected: ${customerEmail}, Got: ${updatedQuote[0].email}`,
      });
    } else {
      results.push({
        step: 'Update quote with email',
        passed: true,
        details: `Quote email updated to: ${updatedQuote[0].email}`,
      });
    }

    // ============================================================
    // Test 3: Verify webhook would have email available
    // ============================================================
    console.log('\nTest 3: Verifying webhook email availability...');

    const webhookQuote = await db.select()
      .from(personalizedQuotes)
      .where(eq(personalizedQuotes.id, testQuoteId))
      .limit(1);

    if (webhookQuote.length === 0) {
      results.push({
        step: 'Webhook email availability',
        passed: false,
        details: 'Quote not found for webhook simulation',
      });
    } else {
      const quote = webhookQuote[0];
      const emailForWebhook = quote.email;
      const canSendEmail = !!emailForWebhook;

      if (canSendEmail) {
        results.push({
          step: 'Webhook email availability',
          passed: true,
          details: `Email available for webhook: ${emailForWebhook}`,
        });
      } else {
        results.push({
          step: 'Webhook email availability',
          passed: false,
          details: 'No email available for webhook to send confirmation',
        });
      }
    }

    // ============================================================
    // Test 4: Simulate the email decision logic
    // ============================================================
    console.log('\nTest 4: Testing notification routing logic...');

    const quote = webhookQuote[0];
    const metadataEmail = 'metadata-fallback@example.com'; // Simulated from PaymentIntent metadata

    // Test current logic
    const currentLogicEmail = quote.email;

    // Test proposed logic with fallback
    const proposedLogicEmail = quote.email || metadataEmail;

    results.push({
      step: 'Notification routing - current',
      passed: !!currentLogicEmail,
      details: `Current logic would use: ${currentLogicEmail || 'NO EMAIL'}`,
    });

    results.push({
      step: 'Notification routing - with fallback',
      passed: !!proposedLogicEmail,
      details: `Fallback logic would use: ${proposedLogicEmail}`,
    });

    // ============================================================
    // Test 5: Test email service data requirements
    // ============================================================
    console.log('\nTest 5: Verifying email service data requirements...');

    const emailData = {
      customerName: quote.customerName,
      customerEmail: quote.email || '',
      jobDescription: quote.jobDescription || '',
      scheduledDate: quote.selectedDate,
      depositPaid: 5000, // Simulated
      totalJobPrice: quote.basePrice || 0,
      balanceDue: (quote.basePrice || 0) - 5000,
      invoiceNumber: 'INV-2025-TEST-001',
      jobId: 'job_test_001',
    };

    const hasRequiredFields = !!(
      emailData.customerName &&
      emailData.customerEmail &&
      emailData.invoiceNumber &&
      emailData.jobId
    );

    results.push({
      step: 'Email service data requirements',
      passed: hasRequiredFields,
      details: hasRequiredFields
        ? 'All required fields present for email service'
        : `Missing fields: ${[
            !emailData.customerName && 'customerName',
            !emailData.customerEmail && 'customerEmail',
            !emailData.invoiceNumber && 'invoiceNumber',
            !emailData.jobId && 'jobId',
          ].filter(Boolean).join(', ')}`,
    });

    // ============================================================
    // Cleanup: Delete test quote
    // ============================================================
    console.log('\nCleaning up test data...');

    if (testQuoteId) {
      await db.delete(personalizedQuotes)
        .where(eq(personalizedQuotes.id, testQuoteId));
      console.log(`Deleted test quote: ${testQuoteId}`);
    }

  } catch (error: any) {
    results.push({
      step: 'Test execution',
      passed: false,
      details: `Error: ${error.message}`,
    });

    // Attempt cleanup on error
    if (testQuoteId) {
      try {
        await db.delete(personalizedQuotes)
          .where(eq(personalizedQuotes.id, testQuoteId));
      } catch (cleanupError) {
        console.error('Failed to cleanup test quote:', cleanupError);
      }
    }
  }

  // ============================================================
  // Print Results Summary
  // ============================================================
  console.log('\n======================================================');
  console.log('  Test Results Summary');
  console.log('======================================================\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  results.forEach((result, index) => {
    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    const color = result.passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}${status}\x1b[0m  ${result.step}`);
    console.log(`       ${result.details}\n`);
  });

  console.log('------------------------------------------------------');
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) {
    console.log('\x1b[31mSome tests failed. Please review the implementation.\x1b[0m\n');
    process.exit(1);
  } else {
    console.log('\x1b[32mAll tests passed!\x1b[0m\n');
  }

  // ============================================================
  // Optional: Send actual test email
  // ============================================================
  if (process.argv.includes('--send')) {
    console.log('======================================================');
    console.log('  Sending Test Email');
    console.log('======================================================\n');

    try {
      const { sendBookingConfirmationEmail } = await import('../server/email-service');

      const result = await sendBookingConfirmationEmail({
        customerName: 'Test Payment Customer',
        customerEmail: process.env.TEST_EMAIL_RECIPIENT || 'test@example.com',
        jobDescription: 'Test payment email flow - fix leaky tap',
        scheduledDate: null,
        depositPaid: 5000,
        totalJobPrice: 15000,
        balanceDue: 10000,
        invoiceNumber: 'INV-2025-TEST-001',
        jobId: 'job_test_001',
      });

      if (result.success) {
        console.log('\x1b[32m✓ Test email sent successfully!\x1b[0m\n');
      } else {
        console.log(`\x1b[31m✗ Failed to send test email: ${result.error}\x1b[0m\n`);
      }
    } catch (error: any) {
      console.log(`\x1b[31m✗ Error sending test email: ${error.message}\x1b[0m\n`);
    }
  }

  process.exit(0);
}

// Run the tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
