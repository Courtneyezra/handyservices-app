# Client Portal

**Status:** LIVING DOCUMENT
**Last Updated:** 2025-02-26
**Scope:** Customer-facing portal functionality

---

## Overview

The Client Portal provides customers with a secure, token-based interface to:
- View upcoming and past jobs
- Pay invoices
- Leave reviews
- Track job status

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       CLIENT PORTAL                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TOKEN-BASED ACCESS                                                  │
│  /client/:token                                                      │
│  └── No login required, secure unique URL                           │
│                                                                      │
│  PAGES                                                               │
│  ├── ClientDashboard     - Overview & job list                      │
│  ├── JobHistoryPage      - Individual job details                   │
│  ├── InvoiceView         - Invoice display                          │
│  ├── PaymentPage         - Stripe payment flow                      │
│  └── LeaveReview         - Review submission                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/client/:token` | `ClientDashboard` | Main portal view |
| `/client/:token/jobs/:jobId` | `JobHistoryPage` | Job details |
| `/client/:token/invoice/:invoiceId` | `InvoiceView` | Invoice view |
| `/client/:token/pay/:invoiceId` | `PaymentPage` | Payment |
| `/client/:token/review/:jobId` | `LeaveReview` | Submit review |

---

## Token System

### Token Generation
Tokens are generated when:
1. Quote is created → `quote.customerPortalToken`
2. Job is created → `job.customerPortalToken`
3. Customer requests portal access

```typescript
// Generate unique token
const token = crypto.randomUUID();

// Store with quote/job/customer
await db.update(personalizedQuotes)
  .set({ customerPortalToken: token })
  .where(eq(personalizedQuotes.id, quoteId));
```

### Token Validation
```typescript
// server/routes/client-portal.ts
app.get('/api/client/:token/dashboard', async (req, res) => {
  const { token } = req.params;

  // Find customer by token
  const customer = await findCustomerByToken(token);
  if (!customer) {
    return res.status(404).json({ error: 'Invalid token' });
  }

  // Return dashboard data
  return res.json({
    customer,
    jobs: await getCustomerJobs(customer.id),
    invoices: await getCustomerInvoices(customer.id)
  });
});
```

---

## Pages

### Client Dashboard (`ClientDashboard.tsx`)
**Route:** `/client/:token`

**Features:**
- Welcome message with customer name
- Stats overview (jobs completed, upcoming, outstanding balance)
- Upcoming jobs list
- Recent jobs with status
- Outstanding invoices with pay buttons

**Data Requirements:**
```typescript
interface DashboardData {
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  stats: {
    completedJobs: number;
    upcomingJobs: number;
    outstandingBalance: number;
  };
  upcomingJobs: Job[];
  recentJobs: Job[];
  outstandingInvoices: Invoice[];
}
```

### Job History (`JobHistoryPage.tsx`)
**Route:** `/client/:token/jobs/:jobId`

**Features:**
- Job details (description, date, contractor)
- Status timeline
- Before/after photos (if available)
- Associated invoice
- Leave review button

**Data Requirements:**
```typescript
interface JobDetail {
  id: string;
  description: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  scheduledDate: Date;
  completedDate?: Date;
  contractor: {
    name: string;
    photo?: string;
  };
  photos: {
    type: 'before' | 'after';
    url: string;
  }[];
  invoice?: Invoice;
  review?: Review;
}
```

### Invoice View (`InvoiceView.tsx`)
**Route:** `/client/:token/invoice/:invoiceId`

**Features:**
- Invoice header (number, date, status)
- Line items with prices
- Subtotal, VAT, total
- Payment status indicator
- Pay now button (if unpaid)
- Download PDF button

**Data Requirements:**
```typescript
interface InvoiceData {
  invoiceNumber: string;
  date: Date;
  dueDate: Date;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  lineItems: {
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
}
```

### Payment Page (`PaymentPage.tsx`)
**Route:** `/client/:token/pay/:invoiceId`

**Features:**
- Invoice summary
- Stripe Elements integration
- Payment form
- Success/error handling
- Redirect to confirmation

**Flow:**
```
1. Fetch invoice details
2. Create Stripe checkout session
3. Display Stripe payment form
4. On success → Redirect to confirmation
5. Webhook updates invoice status
```

### Leave Review (`LeaveReview.tsx`)
**Route:** `/client/:token/review/:jobId`

**Features:**
- Job summary
- Star rating (1-5)
- Text review input
- Photo upload (optional)
- Submit button
- Thank you message

**Data Submitted:**
```typescript
interface ReviewSubmission {
  jobId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
  photos?: File[];
}
```

---

## Booking Confirmation Page

### Post-Payment Flow
**Route:** `/booking-confirmed/:quoteId`
**File:** `client/src/pages/BookingConfirmedPage.tsx`

**Features:**
- Animated celebration header (confetti + checkmark)
- Booking summary card
- Segment-specific value card with CTA
- Portal introduction card
- Cross-sell suggestions ("While We're There")
- "What Happens Next" timeline

**Segment-Specific CTAs:**
| Segment | Primary CTA | Value Prop |
|---------|-------------|------------|
| PROP_MGR | Join Partner Program | Portfolio management |
| LANDLORD | Download Tax Invoice | Hassle-free, photo proof |
| BUSY_PRO | Add to Calendar | Time savings, SMS updates |
| SMALL_BIZ | Get Business Quote | Zero disruption |
| DIY_DEFERRER | What Else Needs Fixing? | Bundle & save |
| RENTER | Have Questions? | Fair prices, no hidden fees |

**Test Mode:**
- `/booking-confirmed/test` - Preview with mock data
- `/booking-confirmed/test?segment=PROP_MGR` - Test specific segment

---

## API Endpoints

### Client Portal API
**File:** `server/routes/client-portal.ts` (or within `server/quotes.ts`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/client/:token/dashboard` | GET | Dashboard data |
| `/api/client/:token/jobs` | GET | Customer jobs |
| `/api/client/:token/jobs/:id` | GET | Job details |
| `/api/client/:token/invoices` | GET | Customer invoices |
| `/api/client/:token/invoices/:id` | GET | Invoice details |
| `/api/client/:token/reviews` | POST | Submit review |
| `/api/personalized-quotes/:id/confirmation` | GET | Confirmation page data |

---

## Security

### Token Best Practices
1. Tokens are UUIDs (unguessable)
2. Tokens can be revoked
3. Tokens don't expire (for convenience)
4. Each action validates token

### Data Access
- Customers can only see their own data
- No authentication required (token = access)
- Sensitive data masked where appropriate

---

## Mobile Responsiveness

All portal pages are mobile-first:
- Touch-friendly buttons
- Readable on small screens
- Optimized images
- Fast loading

---

## Related Files

- `client/src/pages/client/ClientDashboard.tsx`
- `client/src/pages/client/JobHistoryPage.tsx`
- `client/src/pages/client/InvoiceView.tsx`
- `client/src/pages/client/PaymentPage.tsx`
- `client/src/pages/client/LeaveReview.tsx`
- `client/src/pages/BookingConfirmedPage.tsx`
- `client/src/config/segment-confirmation-content.ts`
- `client/src/lib/cross-sell-recommendations.ts`
