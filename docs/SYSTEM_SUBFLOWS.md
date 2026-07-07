# HANDY SERVICES — SYSTEM SUB-FLOWS & COMPONENTS

## Master Flow: Quote → Book → Dispatch → Complete → Pay

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ SF1       │    │ SF2       │    │ SF3       │    │ SF4       │    │ SF5       │    │ SF6       │    │ SF7       │
│ GENERATE  │ →  │ REVIEW &  │ →  │ DELIVER   │ →  │ BOOK &    │ →  │ DISPATCH  │ →  │ COMPLETE  │ →  │ PAYOUT    │
│ QUOTE     │    │ MARGIN    │    │ QUOTE     │    │ PAY       │    │ JOB       │    │ JOB       │    │           │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

Each sub-flow lists its components with build status:
- ✅ Built & working
- ⚠️ Exists but incomplete
- ❌ Not built yet

---

## SF1: GENERATE QUOTE

**Trigger:** VA/Ben receives customer enquiry (WhatsApp, call, web form)
**Output:** Priced multi-line quote with per-line time estimates

```
Customer enquiry (free text)
        ↓
[C1] Job Parser — AI extracts structured line items
        ↓
[C2] Reference Rate Lookup — market anchor per category
        ↓
[C3] LLM Contextual Pricer — prices all lines with signals
        ↓
[C4] Guardrails — floor/ceiling/margin checks per line
        ↓
[C5] Batch Discount — multi-job savings (capped 15%)
        ↓
[C6] Psychological Pricing — total ends in 9
        ↓
Priced quote ready for review
```

### Components

| # | Component | File(s) | Status |
|---|-----------|---------|--------|
| C1 | Job Parser (AI text → structured lines) | `server/contextual-pricing/job-parser.ts` | ✅ |
| C2 | Reference Rate Lookup | `server/contextual-pricing/reference-rates.ts` | ✅ |
| C3 | LLM Contextual Pricer (multi-line) | `server/contextual-pricing/multi-line-llm.ts` | ✅ |
| C4 | Price Guardrails | `server/contextual-pricing/guardrails.ts` | ✅ |
| C5 | Batch Discount Calculator | `server/contextual-pricing/multi-line-engine.ts` | ✅ |
| C6 | Psychological Pricing | `server/contextual-pricing/multi-line-engine.ts` | ✅ |
| C7 | Multi-line Orchestrator | `server/contextual-pricing/multi-line-engine.ts` | ✅ |
| C8 | Quote Generation UI (VA page) | `client/src/pages/admin/GenerateContextualQuote.tsx` | ✅ |
| C9 | Category Definitions | `shared/categories.ts`, `shared/contextual-pricing-types.ts` | ✅ |
| C10 | Single-line EVE Engine (legacy) | `server/eve-pricing-engine.ts` | ✅ |

**Gaps:** None — SF1 is complete.

---

## SF2: REVIEW & MARGIN PREVIEW

**Trigger:** Quote generated, Ben reviews before sending
**Output:** Ben sees margin breakdown, decides to send/adjust/flag

```
Generated quote
        ↓
[C11] WTBP Rate Lookup — contractor hourly rate per category
        ↓
[C12] Contractor Cost Calc — WTBP/hr × estimated hours per line
        ↓
[C13] Margin Calculator — customer price − contractor cost per line
        ↓
[C14] Margin Flags — warn if thin/negative (never block)
        ↓
[C15] Margin Preview Panel — Ben sees per-line + total margin
        ↓
Ben sends / adjusts / flags for Courtnee
```

### Components

| # | Component | File(s) | Status |
|---|-----------|---------|--------|
| C11 | WTBP Rate Card (DB + API) | `server/wtbp-routes.ts`, `shared/schema.ts` (wtbpRateCard) | ✅ |
| C12 | CVS Engine (rate calculation) | `server/contractor-value-score.ts` | ✅ |
| C13 | Margin Engine (cost vs price) | `server/margin-engine.ts` → `calculateCostFromWTBP()` | ✅ |
| C14 | Margin Flags (warn-only) | `server/margin-engine.ts` → flags array | ✅ |
| C15 | Margin Preview Panel (admin UI) | `client/src/pages/admin/GenerateContextualQuote.tsx` | ⚠️ |
| C16 | Margin data on quote API response | `server/contextual-pricing/routes.ts` → marginPreview | ✅ |
| C17 | WTBP Rate Card Admin Page | `client/src/pages/admin/WTBPRateCardPage.tsx` | ✅ |
| C18 | Low-margin quote audit log | — | ❌ |
| C19 | Price adjustment controls | — | ❌ |

**Gaps:**
- **C15 ⚠️** — Margin data is returned in the API but the GenerateContextualQuote UI doesn't render a full per-line margin panel yet (partial display only)
- **C18 ❌** — No audit log persisting quotes sent with margin < 25% for Courtnee review
- **C19 ❌** — No "adjust price" control before sending — Ben can only regenerate

---

## SF3: DELIVER QUOTE

**Trigger:** Ben approves quote and clicks send
**Output:** Customer receives quote via WhatsApp/email with booking link

```
Ben clicks "Send Quote"
        ↓
[C20] Quote Persisted — saved to DB with unique link
        ↓
[C21] WhatsApp Delivery — message with quote link
        ↓
[C22] Email Delivery — "Your quote is ready" email
        ↓
[C23] SMS Fallback — if customer has no WhatsApp
        ↓
Customer views quote page
        ↓
[C24] Quote View Tracking — log when customer opens
        ↓
[C25] Follow-up Reminders — auto-nudge if not viewed/booked
```

### Components

| # | Component | File(s) | Status |
|---|-----------|---------|--------|
| C20 | Quote Persistence (DB) | `server/contextual-pricing/routes.ts` → create-contextual-quote | ✅ |
| C21 | WhatsApp Quote Delivery | `server/whatsapp-api.ts`, GenerateContextualQuote.tsx preview | ✅ |
| C22 | Email Quote Delivery ("Your quote is ready") | — | ❌ |
| C23 | SMS Fallback Delivery | — | ❌ |
| C24 | Quote View Tracking (opened/viewed) | — | ❌ |
| C25 | Follow-up Reminders (auto-nudge) | — | ❌ |
| C26 | Quote Expiry (7-day default) | — | ❌ |
| C27 | Customer Quote Page | `client/src/pages/PersonalizedQuotePage.tsx` | ✅ |
| C28 | Quote PDF Generator | `client/src/lib/quote-pdf-generator.ts` | ✅ |

**Gaps:**
- **C22 ❌** — No "Your quote is ready" email — quotes only go via WhatsApp currently
- **C23 ❌** — No SMS delivery for non-WhatsApp customers
- **C24 ❌** — No tracking when the customer opens/views the quote link
- **C25 ❌** — No automated follow-up if customer hasn't booked within X days
- **C26 ❌** — No quote expiration enforcement

---

## SF4: BOOK & PAY

**Trigger:** Customer views quote page, selects date, pays
**Output:** Confirmed booking with payment (full or deposit)

```
Customer on quote page
        ↓
[C29] Date/Slot Picker — availability calendar
        ↓
[C30] Slot Reservation — 5-min atomic lock
        ↓
[C31] Payment Form — Stripe Elements
        ↓
[C32] Deposit Calculation — 100% materials + 30% labour
        ↓
[C33] Stripe Payment Intent — charge created
        ↓
[C34] Payment Webhook — confirms payment success
        ↓
[C35] Booking Confirmation Email — receipt + job details
        ↓
[C36] Booking Confirmed Page — success screen
        ↓
Quote status → "booked"
```

### Components

| # | Component | File(s) | Status |
|---|-----------|---------|--------|
| C29 | Availability Calendar | `client/src/hooks/useAvailability.ts`, `server/public-routes.ts` | ✅ |
| C30 | Slot Reservation (atomic lock) | `server/booking-engine.ts` → `reserveSlot()` | ✅ |
| C31 | Payment Form (Stripe Elements) | `client/src/pages/PersonalizedQuotePage.tsx` | ✅ |
| C32 | Deposit Calculation | `server/stripe-routes.ts` | ✅ |
| C33 | Stripe Payment Intent | `server/stripe-routes.ts` → create-payment-intent | ✅ |
| C34 | Stripe Webhook Handler | `server/stripe-routes.ts` → /stripe/webhook | ✅ |
| C35 | Booking Confirmation Email | `server/email-service.ts` → `sendBookingConfirmationEmail()` | ✅ |
| C36 | Booking Confirmed Page | `client/src/pages/BookingConfirmedPage.tsx` (if exists) | ✅ |
| C37 | Pay-in-Full Discount (3%) | `server/stripe-routes.ts` | ✅ |
| C38 | Payment Links (shareable) | `server/payment-links.ts` | ✅ |
| C39 | Balance Invoice (post-deposit) | `server/invoice-generator.ts`, `server/invoices.ts` | ✅ |
| C40 | Payment Reminders (balance due) | — | ❌ |

**Gaps:**
- **C40 ❌** — No automated reminder for outstanding balance before job date

---

## SF5: DISPATCH JOB

**Trigger:** Payment confirmed (Stripe webhook fires)
**Output:** Contractor assigned and notified

```
Payment confirmed
        ↓
[C41] Auto-Assignment Engine — find best contractor
        ↓                           ↓ (no match)
[C42] Contractor Match Scoring      [C43] Manual Assignment Queue
  - Skill match                          ↓
  - Distance/radius                  Ben assigns manually
  - Availability on date
  - Margin floor check
  - Round-robin fairness
        ↓
[C44] Contractor Notified — email with job details
        ↓
[C45] Contractor Accepts/Declines — in app or email
        ↓ (decline)
[C46] Re-assignment — next best contractor
        ↓ (accept)
Job status → "assigned"
```

### Components

| # | Component | File(s) | Status |
|---|-----------|---------|--------|
| C41 | Auto-Assignment Engine | `server/auto-assignment-engine.ts` | ✅ |
| C42 | Contractor Match Scoring | `server/contractor-matcher.ts` | ✅ |
| C43 | Manual Assignment (admin) | `server/job-assignment.ts` | ✅ |
| C44 | Contractor Job Assignment Email | `server/email-service.ts` → `sendJobAssignmentEmail()` | ✅ |
| C45 | Contractor Accept/Decline (app) | `server/contractor-dashboard-routes.ts` → respond endpoint | ⚠️ |
| C46 | Re-assignment on Decline | — | ❌ |
| C47 | Contractor WhatsApp Notification | — | ❌ |
| C48 | Contractor Push Notification | — | ❌ |
| C49 | Assignment Timeout (auto-escalate) | — | ❌ |
| C50 | Day-Before Confirmation Reminder | `server/day-before-confirm.ts` | ✅ |

**Gaps:**
- **C45 ⚠️** — Accept/decline endpoint exists but logic is stubbed/incomplete
- **C46 ❌** — If a contractor declines, no automatic re-assignment to next candidate
- **C47 ❌** — Contractors only get email, not WhatsApp for new jobs
- **C48 ❌** — No push notifications to contractor app
- **C49 ❌** — No timeout that auto-escalates if contractor doesn't respond

---

## SF6: COMPLETE JOB

**Trigger:** Job date arrives, contractor performs work
**Output:** Job marked complete with evidence, customer notified

```
Day of job
        ↓
[C51] Pre-Job Confirmation — contractor confirms attendance
        ↓
[C52] En Route — contractor marks en route, customer notified
        ↓
[C53] Arrived — contractor marks arrived
        ↓
[C54] In Progress — work begins
        ↓
[C55] Completion — photos + signature uploaded
        ↓
[C56] Customer Notified — "Your job is complete"
        ↓
[C57] Variation Request — if extra work needed (optional)
        ↓
[C58] Incident Report — if access failed / issues (optional)
        ↓
Job status → "completed"
```

### Components

| # | Component | File(s) | Status |
|---|-----------|---------|--------|
| C51 | Pre-Job Confirmation | `server/job-lifecycle.ts` → confirm-attendance | ✅ |
| C52 | En Route Status + Customer Notify | `server/job-lifecycle.ts`, `server/customer-notifications.ts` | ✅ |
| C53 | Arrived Status | `server/job-lifecycle.ts` | ✅ |
| C54 | In Progress Status | `server/job-lifecycle.ts` | ✅ |
| C55 | Job Completion (photos + signature) | `server/job-lifecycle.ts` → complete | ✅ |
| C56 | Customer Completion Notification | `server/customer-notifications.ts` → job_completed | ✅ |
| C57 | Variation Request Flow | `server/job-lifecycle.ts` → variations | ✅ |
| C58 | Incident Reporting | `server/job-lifecycle.ts` → incidents | ✅ |
| C59 | Contractor Job Detail UI | `client/src/pages/contractor/dashboard/JobDetailsPage.tsx` | ✅ |
| C60 | Contractor Jobs List UI | `client/src/pages/contractor/dashboard/JobsPage.tsx` | ✅ |
| C61 | Customer Portal (view completed job) | — | ❌ |
| C62 | Review/Rating Request | — | ❌ |

**Gaps:**
- **C61 ❌** — No customer portal to view completed job, photos, invoice history
- **C62 ❌** — No automated review/rating request after job completion

---

## SF7: PAYOUT

**Trigger:** Job completed, payout becomes due
**Output:** Contractor paid, platform margin retained

```
Job completed
        ↓
[C63] Payout Calculation — WTBP/hr × actual hours
        ↓
[C64] Payout Queued — pending for next batch cycle
        ↓
[C65] Dispute Check — hold if dispute open
        ↓
[C66] Stripe Connect Transfer — funds sent to contractor
        ↓
[C67] Payout Notification — contractor notified
        ↓
[C68] Payout Ledger — recorded for tax/accounting
        ↓
Contractor paid, platform margin retained
```

### Components

| # | Component | File(s) | Status |
|---|-----------|---------|--------|
| C63 | Payout Calculation | `server/payout-engine.ts` | ✅ |
| C64 | Payout Queue (cron batch) | `server/payout-engine.ts` → `processPayouts()`, `server/cron.ts` | ✅ |
| C65 | Dispute Hold Check | `server/payout-engine.ts` | ✅ |
| C66 | Stripe Connect Transfer | `server/payout-engine.ts` | ✅ |
| C67 | Payout Notification (email) | `server/email-service.ts` → payout notification | ✅ |
| C68 | Payout Ledger / Earnings | `server/payout-routes.ts` → earnings-summary | ✅ |
| C69 | Contractor Earnings UI | `client/src/pages/contractor/dashboard/EarningsPage.tsx` | ✅ |
| C70 | Tax Summary + CSV Export | `server/payout-routes.ts` → tax-summary | ✅ |
| C71 | Stripe Connect Onboarding | `server/stripe-routes.ts` → connect endpoints | ✅ |
| C72 | Balance Invoice (remaining due) | `server/invoice-generator.ts` | ✅ |
| C73 | Contractor Payout Display on Job | — | ❌ |

**Gaps:**
- **C73 ❌** — Contractor doesn't see their payout amount on the job card (e.g. "£46 for this job") — they currently only see job details, not what they'll earn

---

## CROSS-CUTTING: INFRASTRUCTURE COMPONENTS

| # | Component | File(s) | Status |
|---|-----------|---------|--------|
| C74 | LLM Client (OpenAI) | `server/openai.ts` | ✅ (needs migration to Anthropic) |
| C75 | LLM Client (Anthropic) | — | ❌ |
| C76 | WhatsApp Integration | `server/whatsapp-api.ts`, `server/meta-whatsapp.ts` | ✅ |
| C77 | Email Service | `server/email-service.ts` | ✅ |
| C78 | Stripe Integration | `server/stripe-routes.ts` | ✅ |
| C79 | Cron Scheduler | `server/cron.ts` | ✅ |
| C80 | PostHog Analytics | `server/posthog.ts` | ✅ |
| C81 | Content Library (quote framing) | `server/content-library/selector.ts` | ✅ |
| C82 | Phone Normalisation | `server/phone-utils.ts` | ✅ |

---

## GAP SUMMARY — WHAT TO BUILD

### Priority 1: Core Flow Completion

| Gap | Sub-Flow | Component | Impact |
|-----|----------|-----------|--------|
| C15 | SF2 | Margin Preview Panel (full per-line UI) | Ben can't see margin clearly before sending |
| C45 | SF5 | Contractor Accept/Decline (complete logic) | Contractors can't formally accept jobs in-app |
| C73 | SF7 | Contractor Payout Display on Job | Contractors don't know what they'll earn |
| C75 | Infra | Anthropic LLM Client (replace OpenAI) | Currently using wrong provider |

### Priority 2: Delivery & Communication

| Gap | Sub-Flow | Component | Impact |
|-----|----------|-----------|--------|
| C22 | SF3 | Email Quote Delivery | Non-WhatsApp customers can't receive quotes |
| C47 | SF5 | Contractor WhatsApp Notification | Contractors miss jobs (email-only) |
| C46 | SF5 | Re-assignment on Decline | Declined jobs get stuck with no contractor |
| C62 | SF6 | Review/Rating Request | No social proof collection after jobs |

### Priority 3: Automation & Polish

| Gap | Sub-Flow | Component | Impact |
|-----|----------|-----------|--------|
| C18 | SF2 | Low-margin Audit Log | Courtnee can't review thin-margin sends |
| C19 | SF2 | Price Adjustment Controls | Ben can't tweak price before sending |
| C24 | SF3 | Quote View Tracking | No visibility into customer engagement |
| C25 | SF3 | Follow-up Reminders | Lost revenue from unbooked quotes |
| C26 | SF3 | Quote Expiry | Stale quotes never expire |
| C40 | SF4 | Payment Reminders (balance due) | Outstanding balances not chased |
| C49 | SF5 | Assignment Timeout | Unresponsive contractors block jobs |
| C61 | SF6 | Customer Portal | Customers can't view job history |

---

## COMPONENT COUNT

| Sub-Flow | Total | ✅ Built | ⚠️ Partial | ❌ Missing |
|----------|-------|----------|------------|-----------|
| SF1: Generate Quote | 10 | 10 | 0 | 0 |
| SF2: Review & Margin | 9 | 6 | 1 | 2 |
| SF3: Deliver Quote | 9 | 3 | 0 | 5 (+ 1 partial) |
| SF4: Book & Pay | 12 | 11 | 0 | 1 |
| SF5: Dispatch Job | 10 | 5 | 1 | 4 |
| SF6: Complete Job | 12 | 10 | 0 | 2 |
| SF7: Payout | 11 | 10 | 0 | 1 |
| Infrastructure | 9 | 8 | 0 | 1 |
| **TOTAL** | **82** | **63** | **2** | **16** (+ 1 partial) |

**77% complete.** The core happy path works end-to-end. The 16 missing components are delivery channels, automation, and polish — not blockers for the primary flow.
