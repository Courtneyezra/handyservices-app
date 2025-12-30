# Handy Services - Product Requirements Document (PRD)

**Version:** 1.0  
**Date:** 2025-12-28  
**Status:** Ready for Development

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Solution Overview](#3-solution-overview)
4. [User Personas](#4-user-personas)
5. [System Flows](#5-system-flows)
6. [V1 Scope Definition](#6-v1-scope-definition)
7. [Future Phases](#7-future-phases)
8. [Success Metrics](#8-success-metrics)
9. [Technical Constraints](#9-technical-constraints)
10. [Open Questions](#10-open-questions)

---

## 1. Executive Summary

Handy Services is a handyman booking platform that connects customers with qualified contractors. The system handles the entire journey from lead capture (phone/WhatsApp) through quote generation, booking, payment, and contractor assignment.

**Core Principle:** When a customer books, the job is **guaranteed** to be fulfilled - no back-and-forth with contractors needed.

**Key Innovation:** Availability-first booking - customers only see dates where qualified contractors are available, and contractors who mark availability are committed to accept any job in that window.

---

## 2. Problem Statement

### Current Pain Points
1. **Manual matching**: Admin manually finds contractors for each job
2. **Contractor declines**: Jobs tendered but contractors often decline
3. **Booking uncertainty**: Customer books but might not get a contractor
4. **Time-consuming quotes**: Video quotes require manual review for every job
5. **No unified system**: Separate processes for instant vs. complex quotes

### Target State
- **Autonomous matching**: System automatically selects best contractor
- **Guaranteed fulfillment**: Booking = confirmed contractor
- **AI-assisted quotes**: Reduce manual work for simple video quotes
- **Unified workflow**: Single system for all quote types

---

## 3. Solution Overview

### The 3 Quote Paths

| Path | Trigger | Automation Level | Pricing Model |
|------|---------|------------------|---------------|
| **1. Instant** | SKU detected on call | Fully automated | SKU price book |
| **2. Video (AI)** | AI scores video as quotable | Semi-automated | SKU or value-based |
| **3. Estimator** | Complex/low-score video | Manual | Value-based (HHH) |

### Contractor-First Availability Model

```
Traditional: Customer books → Find contractor → Hope they accept
Our Model:   Check contractor availability → Show only available slots → Customer books → Auto-assign
```

**Key benefit:** Booking = guaranteed contractor assignment (no declines)

---

## 4. User Personas

### 4.1 Customer Types

| Type | Pricing | Quote Style | Priority |
|------|---------|-------------|----------|
| **Homeowner** | Standard | HHH (Good/Better/Best) | Quality |
| **Landlord** | Standard | Fixed price | Speed |
| **Property Manager** | -15% trade rate | Fixed price | Volume |
| **Commercial** | +20% premium | Fixed price | Reliability |

### 4.2 Internal Users

| Role | Responsibilities |
|------|------------------|
| **VA (Virtual Assistant)** | Process calls, send quotes, manage WhatsApp |
| **Estimator** | Review complex videos, create manual quotes |
| **Admin** | Oversee system, handle exceptions, analytics |

### 4.3 Contractors

| State | Meaning |
|-------|---------|
| **Active** | Accepting jobs, calendar synced |
| **Reactive Mode** | Available for same-day urgent work |
| **Inactive** | Not accepting new jobs |

---

## 5. System Flows

### 5.1 Path 1: Instant Quote (SKU-Based)

```
┌─────────────────────────────────────────────────────────┐
│                    INSTANT QUOTE FLOW                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Customer Calls → VA Dashboard                          │
│       ↓                                                 │
│  SKU Detector runs (keywords + AI)                      │
│       ↓                                                 │
│  SKU(s) Detected? ──NO──→ Request Video (Path 2/3)     │
│       │                                                 │
│      YES                                                │
│       ↓                                                 │
│  Auto-generate Quote                                    │
│  - Lookup SKU prices                                    │
│  - Apply customer type modifier                         │
│  - Calculate deposit (20%)                              │
│       ↓                                                 │
│  VA Sends Quote Link                                    │
│       ↓                                                 │
│  Customer Views Quote                                   │
│  - Sees price breakdown                                 │
│  - Sees available dates (synced from contractors)       │
│       ↓                                                 │
│  Customer Selects Date + Pays Deposit                   │
│       ↓                                                 │
│  System Auto-Assigns Best Contractor                    │
│  - Based on skill match + proximity + availability      │
│       ↓                                                 │
│  Contractor Notified (WhatsApp)                         │
│  - "You have a new job on [date]"                       │
│  - No approval needed - committed by availability       │
│       ↓                                                 │
│  Job Added to Contractor Calendar                       │
│       ↓                                                 │
│  ✅ COMPLETE                                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Path 2: Video Quote (AI-Scored)

```
┌─────────────────────────────────────────────────────────┐
│                   VIDEO QUOTE FLOW                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  VA Requests Video (WhatsApp)                           │
│       ↓                                                 │
│  Customer Sends Video                                   │
│       ↓                                                 │
│  System Processes Video                                 │
│  - Extract key frames                                   │
│  - Transcribe audio                                     │
│  - Run AI scoring                                       │
│       ↓                                                 │
│  AI Score > Threshold (e.g., 70)?                       │
│       │                                                 │
│      YES                              NO                │
│       ↓                                ↓                │
│  AI Generates Quote              Route to Estimator     │
│  - Detect SKUs from video        (Path 3)               │
│  - Suggest price                                        │
│       ↓                                                 │
│  VA Reviews + Sends                                     │
│       ↓                                                 │
│  (Same as Path 1 from here)                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 5.3 Path 3: Estimator Quote (Complex)

```
┌─────────────────────────────────────────────────────────┐
│                  ESTIMATOR QUOTE FLOW                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Video Routed to Estimator Queue                        │
│  - Priority based on age + urgency                      │
│       ↓                                                 │
│  Estimator Claims Video                                 │
│       ↓                                                 │
│  Estimator Reviews                                      │
│  - Watch video                                          │
│  - Read transcript                                      │
│  - View WhatsApp thread                                 │
│       ↓                                                 │
│  Need More Info?                                        │
│      YES                              NO                │
│       ↓                                ↓                │
│  Ask Questions via WhatsApp      Create Quote           │
│       ↓                                                 │
│  (Wait for customer response)                           │
│       ↓                                                 │
│  Answers Received                                       │
│       ↓                                                 │
│  Create Quote                                           │
│  - Use value-based pricing (HHH)                        │
│  - Or fixed price + optionals                           │
│       ↓                                                 │
│  Flag as Complete                                       │
│       ↓                                                 │
│  VA Notified → Sends Quote                              │
│       ↓                                                 │
│  (Same as Path 1 from here)                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 5.4 Contractor Matching Algorithm

```
┌─────────────────────────────────────────────────────────┐
│              CONTRACTOR MATCHING ALGORITHM              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  INPUT: Job with tagged tasks + location + date/time   │
│                                                         │
│  STEP 1: HARD FILTERS (Must Pass All)                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ✓ Has required skill at required confidence     │   │
│  │ ✓ Within service radius                         │   │
│  │ ✓ Available on requested date/time              │   │
│  │ ✓ Below max concurrent jobs                     │   │
│  │ ✓ Account in good standing                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  STEP 2: SCORING (100 points max)                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Skill Match:        35 pts (expert=35, capable=20) │
│  │ Proximity:          20 pts (closer = better)    │   │
│  │ Past Performance:   15 pts (ratings + completion)│  │
│  │ Response Reliability: 10 pts                    │   │
│  │ Workload Balance:   10 pts (prefer less busy)   │   │
│  │ Recency:            5 pts (spread work fairly)  │   │
│  │ Specialization:     5 pts (frequent this type)  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  STEP 3: RANK + ASSIGN                                 │
│  - Sort by score descending                            │
│  - Assign to top scorer                                │
│  - Block their calendar slot                           │
│  - Send WhatsApp notification                          │
│                                                         │
│  NO TENDER NEEDED: Contractor committed by availability │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 6. V1 Scope Definition

### What's IN V1 (MVP)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Lead state machine** | Track leads through 18 states | P0 |
| **Contractor skills** | 70 tasks with 3-tier confidence | P0 |
| **Availability calendar** | Weekly patterns + date overrides | P0 |
| **Instant quote (SKU)** | Auto-generate quote from SKUs | P0 |
| **Quote page + booking** | Customer-facing quote + date selection | P0 |
| **Slot holds** | Prevent race conditions (5-min holds) | P0 |
| **Stripe payment** | Deposit collection | P0 |
| **Auto-assignment** | Post-payment contractor assignment | P0 |
| **WhatsApp notifications** | Job assigned notifications | P0 |
| **Admin dashboard** | Lead pipeline + booking view | P1 |
| **Estimator queue** | Video review queue (basic) | P1 |

### What's OUT of V1 (Future)

| Feature | Deferred To |
|---------|-------------|
| AI video scoring | V2 |
| AI-generated quotes from video | V2 |
| AI VA (virtual assistant) | V3 |
| Contractor quote marketplace | V3+ |
| Auto-learning skill adjustments | V2 |
| Multi-trade job splitting | V2 |
| Customer portal (view all jobs) | V2 |
| Mobile app for contractors | V3 |

### V1 Success Criteria

- [ ] Customer can receive instant quote and book in <2 minutes
- [ ] 100% of bookings have contractor auto-assigned
- [ ] Zero double-bookings (race condition prevention works)
- [ ] Contractors notified within 30 seconds of payment
- [ ] Estimator can review video and create quote in <5 minutes

---

## 7. Future Phases

### V1.1 (Fast Follow)
- Quote expiry handling (3-day auto-expire)
- 24hr follow-up reminders
- Estimator reminder system
- Basic analytics dashboard

### V2 (AI Augmentation)
- AI video scoring
- AI-suggested quotes for high-score videos
- Auto-learning skill adjustments
- Multi-trade job detection

### V3 (Scale)
- AI VA for routine tasks
- Contractor quoting marketplace
- Mobile apps
- Customer portal

---

## 8. Success Metrics

### Operational Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Quote-to-booking rate | >60% | Bookings / Quotes sent |
| Avg time-to-quote (instant) | <30 seconds | From SKU detection |
| Avg time-to-quote (estimator) | <4 hours | From video received |
| Booking completion rate | >90% | Payments completed / Slots held |
| Contractor assignment rate | 100% | Auto-assigned / Bookings |

### Quality Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Double-booking rate | 0% | Overlapping bookings |
| Customer satisfaction | >4.5/5 | Post-job survey |
| Contractor no-show rate | <2% | Cancelled by contractor |

---

## 9. Technical Constraints

### Existing Stack
- **Frontend:** React + Vite + TailwindCSS
- **Backend:** Express.js + TypeScript
- **Database:** PostgreSQL (Neon) + Drizzle ORM
- **Payments:** Stripe
- **Messaging:** Twilio WhatsApp
- **Hosting:** (TBD - likely Vercel/Railway)

### Integration Points
- **Twilio:** WhatsApp messaging
- **Stripe:** Payment processing
- **Google:** Address validation (existing)

### Performance Requirements
- Quote page load: <2 seconds
- Slot availability check: <500ms
- Payment processing: Standard Stripe latency

---

## 10. Open Questions

### Resolved
- ✅ Tender system → Removed (auto-assign instead)
- ✅ Contractor declines → Not allowed (committed by availability)
- ✅ Race conditions → 5-minute soft holds
- ✅ Pricing model → Customer type-based modifiers

### Still Open
- [ ] Emergency contractor cancellation policy (penalty amount?)
- [ ] Quote expiry notification (email? WhatsApp? both?)
- [ ] Estimator assignment logic (round-robin? specialty-based?)
- [ ] Customer cancellation refund policy (% retained?)

---

## Appendices

See additional documentation:
- [Database Schema (ERD)](./database-schema.md)
- [API Specification](./api-specification.md)
- [State Machine](./state-machine.md)
- [UI Wireframes](./ui-wireframes.md)
