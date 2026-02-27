# Payment Email Flow Test Guide (S-001)

## Problem Summary

**Issue:** Payment was being taken but no confirmation email was sent to customers.

**Root Cause:**
1. The payment form was using the existing `quote.email` (which was often null)
2. The form had no email input field for customers to enter/update their email
3. The webhook only checked `quote.email`, not the PaymentIntent metadata

## Files Involved

| File | Role |
|------|------|
| `client/src/components/PaymentForm.tsx` | Frontend payment form - needs email field |
| `server/stripe-routes.ts` | Payment intent creation - needs to store email |
| `server/email-service.ts` | Email sending logic - uses quote.email |

## Automated Tests

### Unit Tests

Run the unit tests:
```bash
npm run test:run -- server/__tests__/payment-email-flow.test.ts
```

These tests verify:
- Email validation logic
- Quote email update behavior
- PaymentIntent metadata handling
- Notification routing decisions
- Email service data requirements

### Manual Database Test

Run the manual test script:
```bash
npm run test:payment-email
```

This creates a test quote, simulates the email flow, and verifies:
1. Quote created without email
2. Quote updated with email (simulating fix)
3. Email available for webhook
4. Notification routing logic works

To also send a test email:
```bash
npm run test:payment-email -- --send
```

## Manual QA Test Scenarios

### Scenario 1: Quote Without Email -> Payment -> Email Sent

**Steps:**
1. Create a quote link without providing customer email
2. Open the quote page
3. Enter email in the payment form
4. Complete payment with test card
5. Check that confirmation email was sent

**Expected Result:** Customer receives confirmation email at the address they entered in the payment form.

### Scenario 2: Quote With Email -> Modify -> Payment

**Steps:**
1. Create a quote with customer email pre-populated
2. Open the quote page
3. Change the email in the payment form
4. Complete payment
5. Verify email was sent to the NEW address

**Expected Result:** Confirmation goes to the modified email address.

### Scenario 3: No Email Anywhere -> WhatsApp Fallback

**Steps:**
1. Create a quote without email
2. Open the quote page
3. Do NOT enter email (if form allows this)
4. Complete payment
5. Verify WhatsApp message was sent instead

**Expected Result:** WhatsApp confirmation sent to customer's phone.

### Scenario 4: Email Validation

**Steps:**
1. Open a quote page
2. Try to enter invalid emails:
   - `notanemail`
   - `@nodomain.com`
   - `spaces in@email.com`
   - Empty field
3. Verify form shows validation errors
4. Enter valid email
5. Verify form allows submission

**Expected Result:** Form rejects invalid emails and accepts valid ones.

## Test Data

### Test Card Numbers (Stripe Test Mode)

| Scenario | Card Number |
|----------|-------------|
| Successful payment | 4242 4242 4242 4242 |
| Card declined | 4000 0000 0000 0002 |
| Insufficient funds | 4000 0000 0000 9995 |

Use any future expiry date and any 3-digit CVC.

### Test Emails

For testing, use emails that Resend allows in test mode or configure a test domain.

## Verification Checklist

After the fix is implemented, verify:

- [ ] PaymentForm has email input field
- [ ] Email field has proper validation
- [ ] Submit button disabled without valid email
- [ ] API request includes customerEmail
- [ ] Backend updates quote.email when customerEmail provided
- [ ] PaymentIntent metadata includes customerEmail as fallback
- [ ] Webhook uses quote.email || metadata.customerEmail
- [ ] Email is sent on successful payment
- [ ] WhatsApp sent regardless of email presence (if phone exists)
- [ ] Internal ops notification includes correct email

## Implementation Notes

### Key Changes Required

1. **PaymentForm.tsx**
   - Add email input field (required)
   - Pre-populate with existing quote.email
   - Add email validation
   - Include in API request

2. **stripe-routes.ts** (`/api/create-payment-intent`)
   - Extract customerEmail from request
   - Update quote.email in database if provided
   - Include customerEmail in PaymentIntent metadata

3. **stripe-routes.ts** (webhook)
   - Check metadata.customerEmail as fallback
   - Use: `quote.email || metadata.customerEmail`

### Database Schema

The `personalized_quotes` table already has an `email` column (nullable varchar).

No schema changes required.

## Rollback Plan

If issues arise:
1. The fix only ADDS functionality (email field)
2. Existing payments still work (WhatsApp fallback)
3. Can revert by removing email field from form
4. No database migrations to rollback
