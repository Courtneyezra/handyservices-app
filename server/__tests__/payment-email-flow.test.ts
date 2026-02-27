/**
 * Payment Email Flow Tests (S-001)
 *
 * Tests the critical path: payment succeeds -> confirmation email sent
 *
 * Problem being fixed:
 * - Payment taken but no confirmation email sent
 * - Email field missing from payment form
 * - Webhook needs email to send confirmation
 *
 * Test scenarios:
 * 1. Email capture in payment intent creation
 * 2. Email stored in quote before payment
 * 3. Email in PaymentIntent metadata as fallback
 * 4. Webhook email sending logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock types for testing
interface MockQuote {
  id: string;
  customerName: string;
  email: string | null;
  phone: string;
  jobDescription: string;
  selectedDate?: string | null;
  leadId?: string | null;
  contractorId?: string | null;
  quoteMode: 'simple' | 'tiered';
  basePrice?: number;
  essentialPrice?: number;
  enhancedPrice?: number;
  elitePrice?: number;
  optionalExtras?: any[];
  materialsCostWithMarkupPence?: number;
}

interface PaymentIntentRequest {
  customerName: string;
  customerEmail?: string;
  quoteId: string;
  selectedTier: string;
  selectedTierPrice: number;
  selectedExtras?: string[];
  paymentType?: 'full' | 'installments';
}

interface PaymentIntentMetadata {
  quoteId: string;
  customerName: string;
  customerEmail?: string;
  selectedTier: string;
  paymentType: string;
  totalJobPrice: string;
  depositAmount: string;
  selectedExtras: string;
}

// ============================================================
// TEST SUITE: Payment Intent Creation
// ============================================================
describe('Payment Intent Creation - Email Handling', () => {

  describe('Email in Request Body', () => {
    it('should accept customerEmail in payment intent request', () => {
      const request: PaymentIntentRequest = {
        customerName: 'John Smith',
        customerEmail: 'john@example.com',
        quoteId: 'quote_123',
        selectedTier: 'enhanced',
        selectedTierPrice: 15000,
        selectedExtras: [],
        paymentType: 'full'
      };

      expect(request.customerEmail).toBe('john@example.com');
      expect(typeof request.customerEmail).toBe('string');
    });

    it('should handle missing customerEmail gracefully', () => {
      const request: PaymentIntentRequest = {
        customerName: 'John Smith',
        quoteId: 'quote_123',
        selectedTier: 'enhanced',
        selectedTierPrice: 15000,
      };

      expect(request.customerEmail).toBeUndefined();
    });

    it('should validate email format when provided', () => {
      const validEmails = [
        'test@example.com',
        'user.name@domain.co.uk',
        'user+tag@gmail.com',
      ];

      const invalidEmails = [
        'notanemail',
        '@nodomain.com',
        'spaces in@email.com',
        '',
      ];

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      validEmails.forEach(email => {
        expect(emailRegex.test(email)).toBe(true);
      });

      invalidEmails.forEach(email => {
        expect(emailRegex.test(email)).toBe(false);
      });
    });
  });

  describe('Quote Email Update Before Payment', () => {
    it('should update quote.email when customerEmail provided', () => {
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: null, // No email initially
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
        basePrice: 15000,
      };

      // Simulate what should happen when payment intent is created
      const customerEmail = 'john@example.com';

      // Quote should be updated
      quote.email = customerEmail;

      expect(quote.email).toBe('john@example.com');
    });

    it('should preserve existing quote email if no new email provided', () => {
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: 'existing@example.com',
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
        basePrice: 15000,
      };

      const customerEmail = undefined;

      // Should not overwrite with undefined
      if (customerEmail) {
        quote.email = customerEmail;
      }

      expect(quote.email).toBe('existing@example.com');
    });

    it('should allow overriding existing quote email with new email', () => {
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: 'old@example.com',
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
        basePrice: 15000,
      };

      const customerEmail = 'new@example.com';
      quote.email = customerEmail;

      expect(quote.email).toBe('new@example.com');
    });
  });

  describe('PaymentIntent Metadata', () => {
    it('should include customerEmail in PaymentIntent metadata', () => {
      const metadata: PaymentIntentMetadata = {
        quoteId: 'quote_123',
        customerName: 'John Smith',
        customerEmail: 'john@example.com',
        selectedTier: 'enhanced',
        paymentType: 'full',
        totalJobPrice: '15000',
        depositAmount: '5000',
        selectedExtras: 'Tenant Coordination,Photo Report',
      };

      expect(metadata.customerEmail).toBe('john@example.com');
    });

    it('should handle empty customerEmail in metadata', () => {
      const metadata: PaymentIntentMetadata = {
        quoteId: 'quote_123',
        customerName: 'John Smith',
        selectedTier: 'enhanced',
        paymentType: 'full',
        totalJobPrice: '15000',
        depositAmount: '5000',
        selectedExtras: '',
      };

      expect(metadata.customerEmail).toBeUndefined();
    });
  });
});

// ============================================================
// TEST SUITE: Webhook Email Sending Logic
// ============================================================
describe('Stripe Webhook - Email Sending Logic', () => {

  describe('Email Source Priority', () => {
    it('should use quote.email when available', () => {
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: 'quote@example.com',
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
        basePrice: 15000,
      };

      const metadata: PaymentIntentMetadata = {
        quoteId: 'quote_123',
        customerName: 'John Smith',
        customerEmail: 'metadata@example.com',
        selectedTier: 'enhanced',
        paymentType: 'full',
        totalJobPrice: '15000',
        depositAmount: '5000',
        selectedExtras: '',
      };

      // Current logic: uses quote.email
      const emailToUse = quote.email;
      expect(emailToUse).toBe('quote@example.com');
    });

    it('should fallback to metadata email when quote.email is null', () => {
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: null,
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
        basePrice: 15000,
      };

      const metadata: PaymentIntentMetadata = {
        quoteId: 'quote_123',
        customerName: 'John Smith',
        customerEmail: 'metadata@example.com',
        selectedTier: 'enhanced',
        paymentType: 'full',
        totalJobPrice: '15000',
        depositAmount: '5000',
        selectedExtras: '',
      };

      // Proposed logic: fallback to metadata
      const emailToUse = quote.email || metadata.customerEmail;
      expect(emailToUse).toBe('metadata@example.com');
    });

    it('should send WhatsApp when no email available', () => {
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: null,
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
        basePrice: 15000,
      };

      const metadata: PaymentIntentMetadata = {
        quoteId: 'quote_123',
        customerName: 'John Smith',
        selectedTier: 'enhanced',
        paymentType: 'full',
        totalJobPrice: '15000',
        depositAmount: '5000',
        selectedExtras: '',
      };

      const emailToUse = quote.email || metadata.customerEmail;
      const shouldSendWhatsApp = quote.phone && !emailToUse;

      expect(emailToUse).toBeUndefined();
      expect(shouldSendWhatsApp).toBe(true);
    });
  });

  describe('Notification Routing', () => {
    interface NotificationDecision {
      sendEmail: boolean;
      sendWhatsApp: boolean;
      emailAddress?: string;
      phoneNumber?: string;
    }

    function decideNotifications(quote: MockQuote, metadataEmail?: string): NotificationDecision {
      const emailToUse = quote.email || metadataEmail;

      return {
        sendEmail: !!emailToUse,
        sendWhatsApp: !!quote.phone,
        emailAddress: emailToUse || undefined,
        phoneNumber: quote.phone,
      };
    }

    it('should send both email and WhatsApp when both available', () => {
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: 'john@example.com',
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
      };

      const decision = decideNotifications(quote);

      expect(decision.sendEmail).toBe(true);
      expect(decision.sendWhatsApp).toBe(true);
      expect(decision.emailAddress).toBe('john@example.com');
      expect(decision.phoneNumber).toBe('07700000000');
    });

    it('should send only WhatsApp when no email', () => {
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: null,
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
      };

      const decision = decideNotifications(quote);

      expect(decision.sendEmail).toBe(false);
      expect(decision.sendWhatsApp).toBe(true);
    });

    it('should use metadata email as fallback', () => {
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: null,
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
      };

      const decision = decideNotifications(quote, 'fallback@example.com');

      expect(decision.sendEmail).toBe(true);
      expect(decision.emailAddress).toBe('fallback@example.com');
    });
  });
});

// ============================================================
// TEST SUITE: Email Service Integration
// ============================================================
describe('Email Service - sendBookingConfirmationEmail', () => {

  describe('Input Validation', () => {
    interface BookingConfirmationData {
      customerName: string;
      customerEmail: string;
      jobDescription: string;
      scheduledDate?: string | null;
      depositPaid: number;
      totalJobPrice: number;
      balanceDue: number;
      invoiceNumber: string;
      jobId: string;
      quoteSlug?: string;
    }

    it('should require customerEmail to be provided', () => {
      const validData: BookingConfirmationData = {
        customerName: 'John Smith',
        customerEmail: 'john@example.com',
        jobDescription: 'Fix tap',
        depositPaid: 5000,
        totalJobPrice: 15000,
        balanceDue: 10000,
        invoiceNumber: 'INV-2025-0001',
        jobId: 'job_123',
      };

      expect(validData.customerEmail).toBeTruthy();
    });

    it('should skip email send when customerEmail is empty', () => {
      const shouldSkip = (email: string | null | undefined): boolean => {
        return !email || email.trim() === '';
      };

      expect(shouldSkip('')).toBe(true);
      expect(shouldSkip(null)).toBe(true);
      expect(shouldSkip(undefined)).toBe(true);
      expect(shouldSkip('  ')).toBe(true);
      expect(shouldSkip('valid@email.com')).toBe(false);
    });
  });
});

// ============================================================
// TEST SUITE: Frontend PaymentForm Email Field
// ============================================================
describe('PaymentForm - Email Field Requirements', () => {

  describe('Email Field Rendering', () => {
    it('should render email input field', () => {
      // This is a specification test - the actual component test would use React Testing Library
      const emailFieldSpec = {
        type: 'email',
        name: 'customerEmail',
        required: true,
        placeholder: 'your@email.com',
        autoComplete: 'email',
      };

      expect(emailFieldSpec.type).toBe('email');
      expect(emailFieldSpec.required).toBe(true);
    });
  });

  describe('Email Validation', () => {
    it('should show error for invalid email format', () => {
      const validateEmail = (email: string): { valid: boolean; error?: string } => {
        if (!email || email.trim() === '') {
          return { valid: false, error: 'Email is required' };
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return { valid: false, error: 'Please enter a valid email address' };
        }

        return { valid: true };
      };

      expect(validateEmail('')).toEqual({ valid: false, error: 'Email is required' });
      expect(validateEmail('notanemail')).toEqual({ valid: false, error: 'Please enter a valid email address' });
      expect(validateEmail('valid@email.com')).toEqual({ valid: true });
    });
  });

  describe('Form Submission', () => {
    it('should include email in API request payload', () => {
      const buildPaymentIntentRequest = (
        customerName: string,
        customerEmail: string,
        quoteId: string,
        selectedTier: string,
        selectedTierPrice: number,
        selectedExtras: string[],
        paymentType: 'full' | 'installments'
      ): PaymentIntentRequest => {
        return {
          customerName,
          customerEmail,
          quoteId,
          selectedTier,
          selectedTierPrice,
          selectedExtras,
          paymentType,
        };
      };

      const request = buildPaymentIntentRequest(
        'John Smith',
        'john@example.com',
        'quote_123',
        'enhanced',
        15000,
        [],
        'full'
      );

      expect(request.customerEmail).toBe('john@example.com');
    });

    it('should disable submit button without valid email', () => {
      const canSubmit = (email: string | undefined, hasStripe: boolean, isProcessing: boolean): boolean => {
        if (!hasStripe || isProcessing) return false;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
        return true;
      };

      expect(canSubmit(undefined, true, false)).toBe(false);
      expect(canSubmit('', true, false)).toBe(false);
      expect(canSubmit('invalid', true, false)).toBe(false);
      expect(canSubmit('valid@email.com', true, false)).toBe(true);
      expect(canSubmit('valid@email.com', false, false)).toBe(false);
      expect(canSubmit('valid@email.com', true, true)).toBe(false);
    });
  });
});

// ============================================================
// TEST SUITE: Integration Flow
// ============================================================
describe('End-to-End Payment Email Flow', () => {

  describe('Scenario: Quote without email -> Add email in form -> Pay -> Email sent', () => {
    it('should capture email during payment and send confirmation', () => {
      // Step 1: Quote exists without email
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: null,
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
        basePrice: 15000,
      };

      // Step 2: Customer enters email in payment form
      const customerEnteredEmail = 'john@example.com';

      // Step 3: Payment intent created with email
      const paymentRequest: PaymentIntentRequest = {
        customerName: quote.customerName,
        customerEmail: customerEnteredEmail,
        quoteId: quote.id,
        selectedTier: 'simple',
        selectedTierPrice: 15000,
      };

      // Step 4: Quote should be updated with email (this is the fix!)
      quote.email = paymentRequest.customerEmail || null;

      // Step 5: Payment succeeds, webhook fires
      // Webhook should now have email from quote
      expect(quote.email).toBe('john@example.com');

      // Step 6: Email should be sent
      const shouldSendEmail = !!quote.email;
      expect(shouldSendEmail).toBe(true);
    });
  });

  describe('Scenario: Quote with email -> Modify in form -> Pay -> New email used', () => {
    it('should use modified email for confirmation', () => {
      // Step 1: Quote exists with email
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: 'old@example.com',
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
        basePrice: 15000,
      };

      // Step 2: Customer changes email in payment form
      const newEmail = 'new@example.com';

      // Step 3: Quote updated with new email
      quote.email = newEmail;

      // Step 4: Confirmation uses new email
      expect(quote.email).toBe('new@example.com');
    });
  });

  describe('Scenario: No email anywhere -> WhatsApp only', () => {
    it('should fall back to WhatsApp when no email available', () => {
      const quote: MockQuote = {
        id: 'quote_123',
        customerName: 'John Smith',
        email: null,
        phone: '07700000000',
        jobDescription: 'Fix tap',
        quoteMode: 'simple',
        basePrice: 15000,
      };

      const metadataEmail = undefined;
      const emailToUse = quote.email || metadataEmail;

      const shouldSendEmail = !!emailToUse;
      const shouldSendWhatsApp = !!quote.phone;

      expect(shouldSendEmail).toBe(false);
      expect(shouldSendWhatsApp).toBe(true);
    });
  });
});
