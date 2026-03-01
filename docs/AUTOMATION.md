# Automation & Cron Jobs

**Status:** LIVING DOCUMENT
**Last Updated:** 2025-02-26
**Scope:** Scheduled tasks and automated workflows

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AUTOMATION                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  SCHEDULED (Cron)                                                   │
│  ├── Quote Reminders      - Hourly check                            │
│  └── Snooze Wake-up       - Every 15 minutes                        │
│                                                                      │
│  EVENT-DRIVEN                                                        │
│  ├── Call Complete        → Lead creation, metadata extraction      │
│  ├── Quote Sent           → Email/SMS delivery                      │
│  ├── Payment Received     → Job creation, invoice, notifications    │
│  └── Tenant Message       → AI triage, issue creation               │
│                                                                      │
│  WEBHOOKS                                                            │
│  ├── Twilio               → Call status updates                     │
│  ├── Stripe               → Payment confirmations                   │
│  └── WhatsApp             → Incoming messages                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Cron Jobs

### File: `server/cron.ts`

### 1. Quote Reminders
**Schedule:** Every hour (`0 * * * *`)

```typescript
// Purpose: Send reminders for unopened quotes
// Logic:
// - Find quotes > 24h old
// - Not booked, not rejected
// - No reminder sent yet
// - Send reminder via preferred channel
```

**Current Status:** Logs candidates, reminder sending not yet implemented

### 2. Snooze Wake-up
**Schedule:** Every 15 minutes (`*/15 * * * *`)

```typescript
// Purpose: Reactivate snoozed leads
// Logic:
// - Find leads where snoozedUntil <= now
// - Clear snoozedUntil field
// - Lead reappears in active queue
```

**Implementation:**
```typescript
const leadsToWake = await db.select()
  .from(leads)
  .where(and(
    isNotNull(leads.snoozedUntil),
    lte(leads.snoozedUntil, now),
    isNull(leads.mergedIntoId)
  ));

for (const lead of leadsToWake) {
  await db.update(leads)
    .set({ snoozedUntil: null, updatedAt: new Date() })
    .where(eq(leads.id, lead.id));
}
```

---

## Event-Driven Automation

### Call Complete Flow
**Trigger:** Twilio WebSocket close / call end

```
Call Ends
    │
    ▼
┌─────────────────────────────────────────────────┐
│  1. Finalize Transcription                      │
│     - Complete any pending chunks               │
│     - Close transcription connections           │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  2. Extract Final Metadata                      │
│     - Customer name (GPT-4o-mini)               │
│     - Address & postcode                        │
│     - Urgency level                             │
│     - Lead type classification                  │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  3. Create/Update Lead                          │
│     - Check for duplicates                      │
│     - Create new or update existing             │
│     - Attach call record                        │
│     - Set segment                               │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  4. Upload Recordings                           │
│     - Combine dual-track audio                  │
│     - Upload to S3                              │
│     - Update call record with URLs              │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  5. Broadcast Call Ended                        │
│     - Notify dashboard via WebSocket            │
│     - Include lead ID, metadata                 │
└─────────────────────────────────────────────────┘
```

### Quote Sent Flow
**Trigger:** Quote creation/share

```
Quote Created
    │
    ▼
┌─────────────────────────────────────────────────┐
│  1. Generate Quote URL                          │
│     - Create short slug                         │
│     - Build personalized URL                    │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  2. Send via Preferred Channel                  │
│     - WhatsApp (if available)                   │
│     - SMS (fallback)                            │
│     - Email (if requested)                      │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  3. Record Sent Timestamp                       │
│     - Update quote.sentAt                       │
│     - Log delivery channel                      │
└─────────────────────────────────────────────────┘
```

### Payment Received Flow
**Trigger:** Stripe webhook `checkout.session.completed`

```
Payment Success
    │
    ▼
┌─────────────────────────────────────────────────┐
│  1. Verify Webhook Signature                    │
│     - Validate Stripe signature                 │
│     - Extract session data                      │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  2. Update Quote Status                         │
│     - Set bookedAt timestamp                    │
│     - Record payment details                    │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  3. Create Job Record                           │
│     - Copy details from quote                   │
│     - Set status to 'scheduled'                 │
│     - Assign contractor (if pre-selected)       │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  4. Generate Invoice                            │
│     - Create invoice record                     │
│     - Mark as paid                              │
│     - Generate PDF (optional)                   │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  5. Update Lead Status                          │
│     - Move to 'booked' stage                    │
│     - Log conversion event                      │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  6. Send Notifications                          │
│     - Customer: Booking confirmation            │
│     - Admin: New booking alert                  │
│     - Contractor: Job assignment (if auto)      │
└─────────────────────────────────────────────────┘
```

### Tenant Message Flow
**Trigger:** WhatsApp webhook (incoming message)

```
Message Received
    │
    ▼
┌─────────────────────────────────────────────────┐
│  1. Identify Tenant                             │
│     - Match phone number to tenant record       │
│     - Find associated property/landlord         │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  2. Process Media (if present)                  │
│     - Download images/videos/voice notes        │
│     - Transcribe voice notes (Whisper)          │
│     - Store in S3                               │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  3. AI Triage                                   │
│     - Classify urgency                          │
│     - Identify issue type                       │
│     - Determine if DIY-solvable                 │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  4. Create/Update Issue                         │
│     - Add to tenant's issue record              │
│     - Attach media                              │
│     - Log message in chat history               │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  5. Auto-Response (if enabled)                  │
│     - Send acknowledgment                       │
│     - Provide DIY tip (if applicable)           │
│     - Request more info (if needed)             │
└─────────────────────────────────────────────────┘
```

---

## Webhook Handlers

### Twilio Webhooks
**File:** `server/routes/twilio.ts`

| Endpoint | Event | Action |
|----------|-------|--------|
| `/api/twilio/voice` | Incoming call | Route to media stream |
| `/api/twilio/status` | Status change | Log call outcome |
| `/api/twilio/recording` | Recording ready | Download & upload to S3 |

### Stripe Webhooks
**File:** `server/stripe-routes.ts`

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Create job, invoice |
| `payment_intent.succeeded` | Confirm payment |
| `invoice.paid` | Mark invoice paid |

### WhatsApp Webhooks
**File:** `server/meta-whatsapp.ts`

| Event | Action |
|-------|--------|
| `messages` | Process incoming message |
| `statuses` | Track message delivery |

---

## Future Automation (Planned)

### Quote Follow-up Sequence
```
Day 0: Quote sent
Day 1: If not viewed → Send reminder
Day 3: If viewed but not booked → Send "Questions?" message
Day 7: If no action → Final nudge with discount offer
```

### Lead Scoring Auto-Update
```
Every 6 hours:
- Recalculate lead scores
- Update priority queue
- Trigger alerts for hot leads
```

### Contractor Auto-Assignment
```
When job created:
- Score available contractors
- Auto-assign if confidence > threshold
- Otherwise, add to dispatch queue
```

---

## Configuration

### Enabling/Disabling Cron
```typescript
// server/index.ts
import { setupCronJobs } from './cron';

// Only run in production or when explicitly enabled
if (process.env.ENABLE_CRON === 'true') {
  setupCronJobs();
}
```

### Monitoring
```
[Cron] Initializing scheduler...
[Cron] Checking for quote reminders...
[Cron] Found 3 pending quotes potentially needing reminders.
[Cron] Waking 2 snoozed leads...
[Cron] Successfully woke 2 snoozed leads
```

---

## Related Files

- `server/cron.ts` - Scheduled tasks
- `server/stripe-routes.ts` - Payment webhooks
- `server/meta-whatsapp.ts` - WhatsApp webhooks
- `server/twilio-realtime.ts` - Call processing
- `server/quotes.ts` - Quote automation
