# Developer Handover Summary

**Version:** 1.0  
**Date:** 2025-12-28
**Prepared For:** External Development Team

---

## Quick Start

1. **Read the PRD first**: `docs/prd-handy-services.md`
2. **Understand the data**: `docs/database-schema.md`
3. **Review the APIs**: `docs/api-specification.md`
4. **Follow the guide**: `docs/v1-implementation-guide.md`

---

## Document Index

| Document | Purpose | Read When |
|----------|---------|-----------|
| [PRD](./prd-handy-services.md) | Business requirements, flows, V1 scope | First - understand the problem |
| [Database Schema](./database-schema.md) | Tables, ERD, relationships | Before any database work |
| [State Machine](./state-machine.md) | Lead lifecycle, transitions | Before lead management work |
| [API Specification](./api-specification.md) | All endpoints, request/response | Before API development |
| [Architecture Overview](./architecture-overview.md) | Tech stack, folder structure | Before starting development |
| [V1 Implementation Guide](./v1-implementation-guide.md) | Step-by-step code examples | During development |

---

## What We're Building

**Handy Services** is a handyman booking platform with one key innovation:

> **Guaranteed fulfillment**: When a customer books, they're guaranteed a contractor - no declines, no back-and-forth.

This works because:
1. We show customers **only dates where qualified contractors are available**
2. Contractors who mark availability are **committed** to accept jobs
3. Assignment happens **automatically** after payment

---

## The 3 Quote Paths

| Path | Trigger | Automation | Priority |
|------|---------|------------|----------|
| **Instant** | SKU detected on call | Full auto | V1 |
| **Video** | AI scores video | Semi-auto | V2 |
| **Estimator** | Complex job | Manual | V1 (basic) |

**V1 Focus:** Instant quotes + basic estimator queue

---

## V1 Scope (MVP)

### Must Have ✅
- [ ] Contractor skill selection (70 tasks, 3-tier confidence)
- [ ] Contractor availability calendar
- [ ] Quote generation from SKUs
- [ ] Quote page with available dates
- [ ] Slot holding (5-min race condition prevention)
- [ ] Stripe payment integration
- [ ] Auto contractor assignment
- [ ] WhatsApp notification to contractor
- [ ] Lead state machine (18 states)
- [ ] Basic admin dashboard

### Not in V1 ❌
- AI video scoring
- AI-generated quotes
- AI virtual assistant
- Contractor quoting marketplace
- Auto-learning skill adjustments
- Mobile apps

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite + TailwindCSS |
| Backend | Express + TypeScript |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Payments | Stripe |
| Messaging | Twilio (WhatsApp) |
| Voice | Twilio |

---

## New Database Tables

| Table | Purpose |
|-------|---------|
| `contractor_tasks` | 70 specific tasks (skill taxonomy) |
| `contractor_skills` | Contractor → Task mappings with confidence |
| `quotes` | Generated quotes with versioning |
| `bookings` | Confirmed bookings |
| `slot_holds` | Temporary holds (5-min TTL) |
| `job_task_requirements` | Job → Task requirements |
| `job_matching_history` | Matching audit trail |

---

## Key Algorithms

### 1. Availability Engine
Given a job's required tasks and location, return all available slots:
- Find contractors with matching skills
- Get their availability
- Exclude existing bookings
- Exclude active holds
- Return available slots with contractor counts

### 2. Contractor Matcher
Given a job, find and assign the best contractor:
- Filter: skills, location, availability, capacity
- Score (100 pts): skill match + proximity + performance + reliability
- Assign to top scorer

### 3. Slot Holder
Prevent race conditions during checkout:
- Customer selects slot → create 5-min hold
- Payment succeeds → convert to booking
- Payment fails → release hold
- Cron clears expired holds every minute

---

## Critical Flows

### Happy Path: Instant Quote
```
Customer calls → VA dashboard → SKU detected → Quote generated →
Quote sent (WhatsApp) → Customer opens link → Selects date →
Slot held (5 min) → Payment → Booking confirmed →
Contractor auto-assigned → WhatsApp notification → Job done
```

### Failure Points to Handle
1. **Slot taken during checkout**: Show "slot unavailable" + alternatives
2. **Payment fails**: Release hold, allow retry
3. **No contractors available**: Show next available dates
4. **Quote expires (3 days)**: Allow regenerate

---

## Questions for Team

Before starting, clarify:

1. **Deployment**: Where will this be hosted?
2. **Existing code**: Review current `shared/schema.ts` for conflicts
3. **Stripe setup**: Is the Stripe account ready? Keys available?
4. **Twilio templates**: WhatsApp message templates approved?
5. **Contractor data**: Do we have contractors to onboard?

---

## Estimated Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| 1. Foundation | 1 week | Database + state machine |
| 2. Core Services | 1 week | Availability + matching + slot holds |
| 3. Quote & Booking | 1 week | Quote gen + payment flow |
| 4. Frontend | 1 week | Contractor skills + quote page + booking |
| 5. Integration | 1 week | WhatsApp + Stripe webhooks |
| 6. Testing | 1 week | End-to-end testing |

**Total: 6 weeks to MVP**

---

## Success Criteria

V1 is complete when:
- [ ] Customer can receive instant quote and book in <2 minutes
- [ ] 100% of bookings have contractor auto-assigned
- [ ] Zero double-bookings (race condition prevention works)
- [ ] Contractors notified within 30 seconds of payment

---

## Contact

For questions about:
- **Business requirements**: [Courtney]
- **Technical decisions**: [Review documentation first, then ask Courtney]
- **Existing codebase**: See `docs/` folder for context

---

## Getting Started

```bash
# Clone and install
git clone <repo>
cd v6-switchboard
npm install

# Set up database
# (See migrations/0004_unified_booking.sql)

# Seed task taxonomy
npm run seed:tasks

# Run development
npm run dev
```

**Good luck!** 🚀
