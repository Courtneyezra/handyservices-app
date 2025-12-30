# Lead State Machine

**Version:** 1.0  
**Date:** 2025-12-28

---

## Overview

Every lead transitions through a series of states from creation to completion. This state machine ensures:
- Clear visibility into lead status
- Valid transitions only (no skipping steps)
- Audit trail of state changes
- Automated actions on state transitions

---

## State Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              LEAD STATE MACHINE                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘

                                    ┌──────────┐
                                    │ CREATED  │
                                    └────┬─────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
            ┌──────────────┐    ┌───────────────┐    ┌────────────────┐
            │ SKU_DETECTED │    │VIDEO_REQUESTED│    │    EXPIRED     │
            └──────┬───────┘    └───────┬───────┘    │  (3 days idle) │
                   │                    │            └────────────────┘
                   │                    ▼
                   │            ┌───────────────┐
                   │            │VIDEO_RECEIVED │
                   │            └───────┬───────┘
                   │                    │
                   │                    ▼
                   │            ┌───────────────┐
                   │            │  AI_SCORING   │
                   │            └───────┬───────┘
                   │                    │
                   │         ┌──────────┴──────────┐
                   │         │                     │
                   │         ▼                     ▼
                   │  ┌──────────────┐    ┌─────────────────┐
                   │  │QUOTE_GENERATED│◄───│ESTIMATOR_QUEUED │
                   │  └──────┬───────┘    └────────┬────────┘
                   │         │                     │
                   └─────────┤                     ▼
                             │            ┌─────────────────────┐
                             │            │ESTIMATOR_REVIEWING  │
                             │            └────────┬────────────┘
                             │                     │
                             │         ┌───────────┴───────────┐
                             │         │                       │
                             │         ▼                       ▼
                             │  ┌──────────────┐    ┌───────────────────────┐
                             │  │QUOTE_GENERATED│◄───│AWAITING_CUSTOMER_RESP │
                             │  └──────┬───────┘    └───────────────────────┘
                             │         │
                             ▼         │
                      ┌──────────────┐ │
                      │  QUOTE_SENT  │◄┘
                      └──────┬───────┘
                             │
                             ▼
                      ┌──────────────┐
                      │ QUOTE_VIEWED │
                      └──────┬───────┘
                             │
                    ┌────────┴───────┐
                    │                │
                    ▼                ▼
          ┌─────────────────┐  ┌──────────────┐
          │BOOKING_IN_PROGRESS│  │QUOTE_EXPIRED │
          └────────┬────────┘  │  (3 days)    │
                   │            └──────────────┘
                   ▼
          ┌─────────────────┐
          │ PAYMENT_PENDING │
          └────────┬────────┘
                   │
          ┌────────┴───────┐
          │                │
          ▼                ▼
  ┌─────────────────┐  ┌──────────────┐
  │BOOKING_CONFIRMED│  │PAYMENT_FAILED│───┐
  └────────┬────────┘  └──────────────┘   │
           │                              │
           ▼                              │ (retry)
  ┌────────────────────┐                  │
  │CONTRACTOR_ASSIGNED │                  │
  └────────┬───────────┘                  │
           │                              │
           ▼                              │
  ┌─────────────────┐                     │
  │  JOB_SCHEDULED  │◄────────────────────┘
  └────────┬────────┘
           │
   ┌───────┴───────┐
   │               │
   ▼               ▼
┌─────────────┐  ┌──────────┐
│JOB_IN_PROGRESS│ │CANCELLED │
└──────┬──────┘  └──────────┘
       │
       ▼
┌──────────────┐
│JOB_COMPLETED │
└──────────────┘
```

---

## State Definitions

| State | Description | Next States |
|-------|-------------|-------------|
| `CREATED` | Lead just created | `SKU_DETECTED`, `VIDEO_REQUESTED`, `EXPIRED` |
| `SKU_DETECTED` | SKU(s) identified from call | `QUOTE_GENERATED` |
| `VIDEO_REQUESTED` | Asked customer for video | `VIDEO_RECEIVED`, `EXPIRED` |
| `VIDEO_RECEIVED` | Video received from customer | `AI_SCORING` |
| `AI_SCORING` | AI analyzing video | `QUOTE_GENERATED`, `ESTIMATOR_QUEUED` |
| `ESTIMATOR_QUEUED` | In queue for estimator | `ESTIMATOR_REVIEWING` |
| `ESTIMATOR_REVIEWING` | Estimator actively reviewing | `AWAITING_CUSTOMER_RESP`, `QUOTE_GENERATED` |
| `AWAITING_CUSTOMER_RESP` | Waiting for customer answer | `ESTIMATOR_REVIEWING`, `EXPIRED` |
| `QUOTE_GENERATED` | Quote ready (any path) | `QUOTE_SENT` |
| `QUOTE_SENT` | Quote sent to customer | `QUOTE_VIEWED`, `QUOTE_EXPIRED` |
| `QUOTE_VIEWED` | Customer opened quote | `BOOKING_IN_PROGRESS`, `QUOTE_EXPIRED` |
| `QUOTE_EXPIRED` | Quote not actioned in 3 days | Terminal |
| `BOOKING_IN_PROGRESS` | Customer selecting slot | `PAYMENT_PENDING`, `QUOTE_VIEWED` |
| `PAYMENT_PENDING` | Checkout in progress | `BOOKING_CONFIRMED`, `PAYMENT_FAILED` |
| `PAYMENT_FAILED` | Payment failed | `BOOKING_IN_PROGRESS` |
| `BOOKING_CONFIRMED` | Payment successful | `CONTRACTOR_ASSIGNED` |
| `CONTRACTOR_ASSIGNED` | Contractor auto-assigned | `JOB_SCHEDULED` |
| `JOB_SCHEDULED` | Job on calendar | `JOB_IN_PROGRESS`, `CANCELLED` |
| `JOB_IN_PROGRESS` | Contractor working | `JOB_COMPLETED` |
| `JOB_COMPLETED` | Job finished | Terminal |
| `CANCELLED` | Job cancelled | Terminal |
| `EXPIRED` | Lead inactive 3 days | Terminal |

---

## Transition Rules

```typescript
// Valid state transitions
const validTransitions: Record<LeadState, LeadState[]> = {
  CREATED: ['SKU_DETECTED', 'VIDEO_REQUESTED', 'EXPIRED'],
  SKU_DETECTED: ['QUOTE_GENERATED'],
  VIDEO_REQUESTED: ['VIDEO_RECEIVED', 'EXPIRED'],
  VIDEO_RECEIVED: ['AI_SCORING'],
  AI_SCORING: ['QUOTE_GENERATED', 'ESTIMATOR_QUEUED'],
  ESTIMATOR_QUEUED: ['ESTIMATOR_REVIEWING'],
  ESTIMATOR_REVIEWING: ['AWAITING_CUSTOMER_RESP', 'QUOTE_GENERATED'],
  AWAITING_CUSTOMER_RESP: ['ESTIMATOR_REVIEWING', 'EXPIRED'],
  QUOTE_GENERATED: ['QUOTE_SENT'],
  QUOTE_SENT: ['QUOTE_VIEWED', 'QUOTE_EXPIRED'],
  QUOTE_VIEWED: ['BOOKING_IN_PROGRESS', 'QUOTE_EXPIRED'],
  QUOTE_EXPIRED: [], // Terminal
  BOOKING_IN_PROGRESS: ['PAYMENT_PENDING', 'QUOTE_VIEWED'],
  PAYMENT_PENDING: ['BOOKING_CONFIRMED', 'PAYMENT_FAILED'],
  PAYMENT_FAILED: ['BOOKING_IN_PROGRESS'],
  BOOKING_CONFIRMED: ['CONTRACTOR_ASSIGNED'],
  CONTRACTOR_ASSIGNED: ['JOB_SCHEDULED'],
  JOB_SCHEDULED: ['JOB_IN_PROGRESS', 'CANCELLED'],
  JOB_IN_PROGRESS: ['JOB_COMPLETED'],
  JOB_COMPLETED: [], // Terminal
  CANCELLED: [], // Terminal
  EXPIRED: [], // Terminal
};

// Validate transition
function canTransition(from: LeadState, to: LeadState): boolean {
  return validTransitions[from]?.includes(to) ?? false;
}

// Execute transition with validation + logging
async function transitionLead(leadId: string, newState: LeadState): Promise<void> {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  
  if (!lead) throw new Error('Lead not found');
  if (!canTransition(lead.state, newState)) {
    throw new Error(`Invalid transition: ${lead.state} → ${newState}`);
  }
  
  await db.update(leads)
    .set({ 
      state: newState, 
      stateChangedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(leads.id, leadId));
  
  // Emit event for side effects
  eventBus.emit('lead.stateChanged', { leadId, from: lead.state, to: newState });
}
```

---

## Automated Transitions

| Trigger | From State | To State | Action |
|---------|------------|----------|--------|
| SKU detected on call | `CREATED` | `SKU_DETECTED` | Auto-generate quote |
| VA requests video | `CREATED` | `VIDEO_REQUESTED` | Send WhatsApp prompt |
| Video received | `VIDEO_REQUESTED` | `VIDEO_RECEIVED` | Start AI scoring |
| AI score > threshold | `AI_SCORING` | `QUOTE_GENERATED` | VA notification |
| AI score < threshold | `AI_SCORING` | `ESTIMATOR_QUEUED` | Add to queue |
| Estimator claims | `ESTIMATOR_QUEUED` | `ESTIMATOR_REVIEWING` | Start timer |
| Quote sent | `QUOTE_GENERATED` | `QUOTE_SENT` | Start 3-day expiry |
| Customer opens link | `QUOTE_SENT` | `QUOTE_VIEWED` | Track view time |
| Slot selected | `QUOTE_VIEWED` | `BOOKING_IN_PROGRESS` | Create slot hold |
| Payment submitted | `BOOKING_IN_PROGRESS` | `PAYMENT_PENDING` | Await Stripe |
| Payment success | `PAYMENT_PENDING` | `BOOKING_CONFIRMED` | Release hold → confirm |
| Payment fails | `PAYMENT_PENDING` | `PAYMENT_FAILED` | Notify customer |
| Post-payment | `BOOKING_CONFIRMED` | `CONTRACTOR_ASSIGNED` | Auto-match + assign |
| Job added to calendar | `CONTRACTOR_ASSIGNED` | `JOB_SCHEDULED` | Notify contractor |
| 3 days inactive | Various | `EXPIRED` | Cron job |

---

## Event-Driven Side Effects

```typescript
// Register event handlers
eventBus.on('lead.stateChanged', async ({ leadId, from, to }) => {
  switch (to) {
    case 'QUOTE_SENT':
      await scheduleQuoteExpiry(leadId, 3); // 3 days
      await sendQuoteNotification(leadId);
      break;
      
    case 'QUOTE_VIEWED':
      await trackQuoteView(leadId);
      break;
      
    case 'BOOKING_CONFIRMED':
      await autoAssignContractor(leadId);
      break;
      
    case 'CONTRACTOR_ASSIGNED':
      await notifyContractor(leadId);
      await updateContractorCalendar(leadId);
      break;
      
    case 'EXPIRED':
      await sendExpiryNotification(leadId);
      break;
  }
});
```

---

## State Queries

### Dashboard Views

```sql
-- Active leads by state
SELECT state, COUNT(*) 
FROM leads 
WHERE state NOT IN ('JOB_COMPLETED', 'CANCELLED', 'EXPIRED')
GROUP BY state;

-- Stale leads (need attention)
SELECT * FROM leads 
WHERE state = 'QUOTE_SENT' 
AND state_changed_at < NOW() - INTERVAL '24 hours';

-- Conversion funnel
SELECT 
  COUNT(*) FILTER (WHERE state IN ('CREATED', 'SKU_DETECTED', 'VIDEO_REQUESTED')) as leads,
  COUNT(*) FILTER (WHERE state IN ('QUOTE_SENT', 'QUOTE_VIEWED')) as quoted,
  COUNT(*) FILTER (WHERE state IN ('BOOKING_CONFIRMED', 'CONTRACTOR_ASSIGNED', 'JOB_SCHEDULED')) as booked,
  COUNT(*) FILTER (WHERE state = 'JOB_COMPLETED') as completed
FROM leads
WHERE created_at > NOW() - INTERVAL '30 days';
```

---

## State Machine Implementation

```typescript
// server/services/state-machine.ts

export enum LeadState {
  CREATED = 'created',
  SKU_DETECTED = 'sku_detected',
  VIDEO_REQUESTED = 'video_requested',
  VIDEO_RECEIVED = 'video_received',
  AI_SCORING = 'ai_scoring',
  ESTIMATOR_QUEUED = 'estimator_queued',
  ESTIMATOR_REVIEWING = 'estimator_reviewing',
  AWAITING_CUSTOMER_RESP = 'awaiting_customer_response',
  QUOTE_GENERATED = 'quote_generated',
  QUOTE_SENT = 'quote_sent',
  QUOTE_VIEWED = 'quote_viewed',
  QUOTE_EXPIRED = 'quote_expired',
  BOOKING_IN_PROGRESS = 'booking_in_progress',
  PAYMENT_PENDING = 'payment_pending',
  PAYMENT_FAILED = 'payment_failed',
  BOOKING_CONFIRMED = 'booking_confirmed',
  CONTRACTOR_ASSIGNED = 'contractor_assigned',
  JOB_SCHEDULED = 'job_scheduled',
  JOB_IN_PROGRESS = 'job_in_progress',
  JOB_COMPLETED = 'job_completed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export class LeadStateMachine {
  private leadId: string;
  private currentState: LeadState;

  constructor(leadId: string, currentState: LeadState) {
    this.leadId = leadId;
    this.currentState = currentState;
  }

  async transition(newState: LeadState): Promise<void> {
    if (!this.canTransition(newState)) {
      throw new InvalidTransitionError(this.currentState, newState);
    }

    const previousState = this.currentState;
    
    await db.update(leads)
      .set({ 
        state: newState,
        stateChangedAt: new Date(),
      })
      .where(eq(leads.id, this.leadId));

    this.currentState = newState;

    // Emit for side effects
    await this.handleTransition(previousState, newState);
  }

  private canTransition(to: LeadState): boolean {
    return validTransitions[this.currentState]?.includes(to) ?? false;
  }

  private async handleTransition(from: LeadState, to: LeadState): Promise<void> {
    // Handle side effects based on transition
    // (notification, scheduling, etc.)
  }
}
```
