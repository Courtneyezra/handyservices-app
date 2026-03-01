# Admin Tools & Dashboard

**Status:** LIVING DOCUMENT
**Last Updated:** 2025-02-26
**Scope:** Admin dashboard pages and functionality

---

## Dashboard Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                      ADMIN DASHBOARD                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  CORE OPERATIONS                                                     │
│  ├── DashboardPage         - Overview & metrics                     │
│  ├── LeadsPage             - Lead management                        │
│  ├── QuotesPage            - Quote management                       │
│  └── InvoicesPage          - Invoice tracking                       │
│                                                                      │
│  PIPELINE VIEWS                                                      │
│  ├── LeadPipelinePage      - Kanban board view                      │
│  ├── LeadFunnelPage        - Funnel analytics                       │
│  ├── LeadTubeMapPage       - Tube Map visualization                 │
│  └── PipelineHomePage      - Unified pipeline                       │
│                                                                      │
│  LIVE CALL TOOLS                                                     │
│  ├── LiveCallPage          - Real-time call HUD                     │
│  ├── CallReviewPage        - Post-call analysis                     │
│  └── LiveCallTestPage      - Testing tools                          │
│                                                                      │
│  DISPATCH & SCHEDULING                                               │
│  ├── DispatchPage          - Job assignment                         │
│  ├── ContractorsPage       - Contractor management                  │
│  ├── MasterAvailabilityPage - Availability overview                 │
│  └── BookingVisitsPage     - Visit scheduling                       │
│                                                                      │
│  MARKETING                                                           │
│  ├── MarketingDashboard    - Campaign metrics                       │
│  ├── LandingPages          - Page management                        │
│  └── Banners               - Banner configuration                   │
│                                                                      │
│  SUPPORT                                                             │
│  ├── AdminInboxPage        - Support inbox                          │
│  ├── TenantIssuesPage      - Tenant issue tracking                  │
│  └── LeadReviewPage        - Lead qualification                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Operations

### Dashboard (`DashboardPage.tsx`)
**Route:** `/admin`

Overview metrics:
- Active calls count
- Leads today
- Quotes sent
- Conversion rate
- Revenue pipeline

### Leads (`LeadsPage.tsx`)
**Route:** `/admin/leads`

Lead management with:
- List view with filters
- Status updates
- Quick actions (call, quote, snooze)
- Lead scoring display
- Segment indicators

### Quotes (`QuotesPage.tsx`)
**Route:** `/admin/quotes`

Quote management:
- All quotes list
- Status tracking (sent/viewed/accepted/rejected)
- Quick edit dialog
- PDF download
- Regenerate quote

### Invoices (`InvoicesPage.tsx`)
**Route:** `/admin/invoices`

Invoice tracking:
- Outstanding invoices
- Payment status
- Send reminders
- Mark as paid

---

## Pipeline Views

### Lead Pipeline (`LeadPipelinePage.tsx`)
**Route:** `/admin/pipeline`

Kanban-style board:
- Columns: New → Contacted → Quoted → Booked → Completed
- Drag-and-drop status updates
- Quick action buttons
- Lead cards with key info

### Lead Funnel (`LeadFunnelPage.tsx`)
**Route:** `/admin/funnel`

Funnel analytics:
- Stage conversion rates
- Drop-off analysis
- Time in each stage
- Source attribution

### Tube Map (`LeadTubeMapPage.tsx`)
**Route:** `/admin/tube-map`

Visual journey tracker:
- London Tube Map style
- Real-time position updates
- Stage progression
- Bottleneck identification

### Pipeline Home (`PipelineHomePage.tsx`)
**Route:** `/admin/pipeline-home`

Unified pipeline view:
- Combined leads and quotes
- Priority sorting
- Action queue

---

## Live Call Tools

### Live Call HUD (`LiveCallPage.tsx`)
**Route:** `/admin/live-call`

Real-time call monitoring:
- Active call list
- Live transcript stream
- Detected SKUs with traffic lights
- Customer metadata extraction
- Segment classification
- Route recommendations

### Call Review (`CallReviewPage.tsx`)
**Route:** `/admin/calls/:id`

Post-call analysis:
- Full transcript
- Extracted metadata
- SKU detections
- Playback (if recorded)
- Lead association
- Quote generation

### Testing Tools
**Routes:**
- `/admin/live-call-test` - `LiveCallTestPage.tsx`
- `/admin/live-call-wizard` - `LiveCallTestWizard.tsx`
- `/admin/call-hud-test` - `CallHUDTestPage.tsx`
- `/admin/sku-simulator` - `SKUSimulatorPage.tsx`

---

## Dispatch & Scheduling

### Dispatch (`DispatchPage.tsx`)
**Route:** `/admin/dispatch`

Job assignment:
- Unassigned jobs list
- Contractor recommendation
- Availability checking
- Assignment with notification

### Contractors (`ContractorsPage.tsx`)
**Route:** `/admin/contractors`

Contractor management:
- Contractor list
- Skills and rates
- Availability status
- Performance metrics

### Master Availability (`MasterAvailabilityPage.tsx`)
**Route:** `/admin/availability`

Availability calendar:
- All contractors view
- Date-based filtering
- Quick availability updates
- Conflict detection

### Booking Visits (`BookingVisitsPage.tsx`)
**Route:** `/admin/visits`

Assessment visit scheduling:
- Pending assessments
- Calendar integration
- Contractor assignment
- Visit outcomes

---

## Marketing

### Marketing Dashboard (`MarketingDashboard.tsx`)
**Route:** `/admin/marketing`

Campaign metrics:
- Source tracking
- Conversion by channel
- Cost per lead
- ROI calculations

### Landing Pages (`LandingPages.tsx`, `LandingPageBuilder.tsx`)
**Routes:** `/admin/landing-pages`, `/admin/landing-pages/builder`

Page management:
- Live landing pages
- A/B testing
- Performance metrics
- Visual builder

### Banners (`Banners.tsx`)
**Route:** `/admin/banners`

Banner configuration:
- Active banners
- Scheduling
- Targeting rules

---

## Support

### Admin Inbox (`AdminInboxPage.tsx`)
**Route:** `/admin/inbox`

Unified inbox:
- WhatsApp messages
- SMS messages
- Email (if integrated)
- Quick reply actions

### Tenant Issues (`TenantIssuesPage.tsx`)
**Route:** `/admin/tenant-issues`

Tenant issue tracking:
- Issue list
- Photo/video attachments
- Chat history
- Job creation from issues

### Lead Review (`LeadReviewPage.tsx`)
**Route:** `/admin/lead-review`

Lead qualification:
- Review queue
- Qualification criteria
- Accept/reject actions
- Notes and history

---

## Shared Components

### Quote Components
**Location:** `client/src/pages/admin/components/`

```
components/
├── QuoteCard.tsx           - Individual quote display
├── QuotesList.tsx          - Quote list container
├── EditQuoteDialog.tsx     - Quote editing modal
└── RegenerateQuoteDialog.tsx - Regeneration options
```

---

## Client Portal Pages

### Client Dashboard (`ClientDashboard.tsx`)
**Route:** `/client/:token`

Customer-facing portal:
- Upcoming jobs
- Past jobs
- Outstanding invoices
- Quick actions

### Job History (`JobHistoryPage.tsx`)
**Route:** `/client/:token/jobs/:jobId`

Job detail view:
- Job status
- Photos (before/after)
- Invoice
- Leave review

### Invoice View (`InvoiceView.tsx`)
**Route:** `/client/:token/invoice/:invoiceId`

Invoice display:
- Line items
- Payment status
- Pay now button

### Payment (`PaymentPage.tsx`)
**Route:** `/client/:token/pay/:invoiceId`

Payment flow:
- Stripe integration
- Confirmation

### Leave Review (`LeaveReview.tsx`)
**Route:** `/client/:token/review/:jobId`

Review submission:
- Star rating
- Text review
- Photo upload

---

## Access Control

### Role-Based Access
```typescript
type UserRole = 'admin' | 'va' | 'contractor' | 'client';

// Admin routes require 'admin' or 'va' role
// Client routes use token-based auth
// Contractor routes require 'contractor' role
```

---

## Related Files

- `client/src/App.tsx` - Route definitions
- `server/routes/` - API endpoints
- `shared/schema.ts` - Data types
