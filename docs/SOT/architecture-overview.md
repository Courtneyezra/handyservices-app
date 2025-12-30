# System Architecture Overview

**Version:** 1.0  
**Date:** 2025-12-28

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              HANDY SERVICES ARCHITECTURE                                │
└─────────────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │   CUSTOMERS     │
                              │   (Phone/Web)   │
                              └────────┬────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
            ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
            │   Twilio    │    │  WhatsApp   │    │   Quote     │
            │   Voice     │    │  (Twilio)   │    │   Pages     │
            └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
                   │                  │                  │
                   └──────────────────┼──────────────────┘
                                      │
                              ┌───────▼───────┐
                              │   BACKEND     │
                              │   (Express)   │
                              └───────┬───────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │                         │                         │
            ▼                         ▼                         ▼
    ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
    │    SERVICES     │      │   DATABASE      │      │   EXTERNAL      │
    │                 │      │   (PostgreSQL)  │      │   SERVICES      │
    │ • State Machine │      │                 │      │                 │
    │ • Quote Gen     │      │ • Users         │      │ • Stripe        │
    │ • Availability  │      │ • Leads         │      │ • Google Maps   │
    │ • Matching      │      │ • Quotes        │      │ • OpenAI        │
    │ • Notifications │      │ • Bookings      │      │ • Twilio        │
    └─────────────────┘      │ • Contractors   │      └─────────────────┘
                             │ • Skills        │
                             └─────────────────┘


                              ┌─────────────────┐
                              │   FRONTEND      │
                              │   (React)       │
                              └────────┬────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
    ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
    │  Admin Portal   │      │ Contractor App  │      │  Quote Pages    │
    │                 │      │                 │      │  (Public)       │
    │ • VA Dashboard  │      │ • Skill Select  │      │                 │
    │ • Lead Pipeline │      │ • Calendar      │      │ • View Quote    │
    │ • Estimator Q   │      │ • My Jobs       │      │ • Book Slot     │
    │ • Analytics     │      │ • Profile       │      │ • Payment       │
    └─────────────────┘      └─────────────────┘      └─────────────────┘
```

---

## Technology Stack

### Frontend
| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | React 18 | UI components |
| Build | Vite | Fast dev/build |
| Styling | TailwindCSS | Utility-first CSS |
| State | TanStack Query | Server state |
| Router | Wouter | Lightweight routing |
| Forms | React Hook Form | Form validation |

### Backend
| Layer | Technology | Purpose |
|-------|------------|---------|
| Runtime | Node.js 20+ | Server runtime |
| Framework | Express | HTTP server |
| Language | TypeScript | Type safety |
| ORM | Drizzle | Database access |
| Validation | Zod | Schema validation |

### Database
| Component | Technology | Purpose |
|-----------|------------|---------|
| Primary DB | PostgreSQL (Neon) | Main data store |
| Migrations | Drizzle Kit | Schema changes |

### External Services
| Service | Provider | Purpose |
|---------|----------|---------|
| Payments | Stripe | Deposits, refunds |
| Voice | Twilio | Phone calls |
| Messaging | Twilio | WhatsApp |
| Address | Google Places | Validation |
| AI | OpenAI | SKU detection, video scoring |

---

## Folder Structure

```
v6-switchboard/
├── client/                      # Frontend React app
│   ├── src/
│   │   ├── components/          # Reusable components
│   │   │   ├── ui/              # Design system
│   │   │   └── ...
│   │   ├── contexts/            # React contexts
│   │   ├── hooks/               # Custom hooks
│   │   ├── lib/                 # Utilities
│   │   ├── pages/               # Route components
│   │   │   ├── AdminDashboard.tsx
│   │   │   ├── ContractorSkillSelection.tsx
│   │   │   ├── QuotePage.tsx
│   │   │   └── ...
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── index.html
│
├── server/                      # Backend Express app
│   ├── services/                # Business logic (NEW)
│   │   ├── state-machine.ts
│   │   ├── quote-generator.ts
│   │   ├── availability-engine.ts
│   │   ├── contractor-matcher.ts
│   │   ├── slot-holder.ts
│   │   └── notification.ts
│   ├── routes/                  # API routes
│   │   ├── contractor.ts
│   │   ├── quotes.ts
│   │   ├── bookings.ts
│   │   ├── admin.ts
│   │   └── webhooks.ts
│   ├── db.ts                    # Database connection
│   ├── index.ts                 # Entry point
│   └── ...
│
├── shared/                      # Shared between client/server
│   ├── schema.ts                # Drizzle schema
│   └── types.ts                 # Shared types
│
├── migrations/                  # Database migrations
│   └── 0004_unified_booking.sql
│
├── scripts/                     # Utility scripts
│   ├── seed-contractor-tasks.ts
│   └── ...
│
├── docs/                        # Documentation (NEW)
│   ├── prd-handy-services.md
│   ├── database-schema.md
│   ├── api-specification.md
│   ├── state-machine.md
│   ├── v1-implementation-guide.md
│   └── architecture-overview.md
│
└── package.json
```

---

## Service Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API ROUTES                               │
│   /api/quotes  |  /api/bookings  |  /api/contractor  |  /api/admin  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ calls
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SERVICE LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  State Machine   │  │  Quote Generator │  │ Availability  │ │
│  │                  │  │                  │  │   Engine      │ │
│  │ • Transition     │  │ • Generate       │  │               │ │
│  │ • Validate       │  │ • Calculate      │  │ • Get slots   │ │
│  │ • Emit events    │  │ • Apply mods     │  │ • Filter      │ │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬───────┘ │
│           │                     │                    │         │
│  ┌────────┴─────────┐  ┌────────┴─────────┐  ┌───────┴───────┐ │
│  │ Contractor       │  │  Slot Holder     │  │ Notification  │ │
│  │ Matcher          │  │                  │  │               │ │
│  │                  │  │ • Create hold    │  │ • WhatsApp    │ │
│  │ • Score          │  │ • Release        │  │ • Email       │ │
│  │ • Rank           │  │ • Cleanup        │  │ • Dashboard   │ │
│  │ • Select         │  │                  │  │               │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
│                                                                 │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 │ uses
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA LAYER                                 │
│                   (Drizzle ORM)                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  leads | quotes | bookings | slot_holds | contractor_skills    │
│  handyman_profiles | contractor_tasks | job_task_requirements  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Event-Driven Communication

```typescript
// Event types
type LeadEvent = 
  | { type: 'lead.created'; leadId: string }
  | { type: 'lead.stateChanged'; leadId: string; from: LeadState; to: LeadState }
  | { type: 'quote.generated'; quoteId: string; leadId: string }
  | { type: 'quote.sent'; quoteId: string }
  | { type: 'quote.viewed'; quoteId: string }
  | { type: 'booking.confirmed'; bookingId: string; contractorId: string }
  | { type: 'booking.cancelled'; bookingId: string }
  | { type: 'job.completed'; bookingId: string };

// Usage
eventBus.on('lead.stateChanged', async ({ leadId, from, to }) => {
  if (to === 'quote_sent') {
    await scheduleQuoteExpiry(leadId, 3); // 3 days
  }
  if (to === 'booking_confirmed') {
    await autoAssignContractor(leadId);
  }
});
```

---

## Database Relationships

```
users (1) ─────────────────────────────────── (1) handyman_profiles
                                                     │
                                                     │ 1:N
                                                     ▼
                                            contractor_skills ────── N:1 ── contractor_tasks
                                                     │
                                                     │ 1:N
                                                     ▼
leads (1) ───────── (N) quotes (1) ───────── (1) bookings
  │                                                  │
  │ 1:N                                              │
  ▼                                                  │
job_task_requirements ─────────── N:1 ── contractor_tasks
                                                     │
                                                     │ N:1
                                                     ▼
                                            job_matching_history
```

---

## Security Considerations

### Authentication
- Session-based auth (express-session)
- Role-based access control (admin, va, contractor, estimator)
- Contractor portal uses separate authentication

### Data Protection
- Customer data isolated from contractors until job assigned
- Slot holds use session IDs (not customer data)
- WhatsApp messages stored in own table (not exposed to contractors)

### API Security
- All routes require authentication (except public quote pages)
- Rate limiting on public endpoints
- Input validation with Zod schemas

---

## Scalability Considerations

### Current Design (V1)
- Single PostgreSQL database
- Synchronous request handling
- In-memory event bus

### Future Improvements (V2+)
- Read replicas for reporting queries
- Background job queue (BullMQ) for:
  - AI video scoring
  - Notification sending
  - Scheduled reminders
- Redis for:
  - Slot hold caching
  - Rate limiting
  - Real-time updates

---

## Monitoring & Observability

### Logging
- Structured JSON logs
- Request/response logging
- State transition logging

### Metrics (Future)
- Quote conversion rates
- Booking completion rates
- Contractor assignment times
- Error rates by endpoint

### Alerting (Future)
- Payment failures
- High error rates
- Slow availability queries
- Unassigned bookings

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         PRODUCTION                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │   Vercel    │     │   Railway   │     │    Neon     │       │
│  │  (Frontend) │ ──▶ │  (Backend)  │ ──▶ │ (PostgreSQL)│       │
│  └─────────────┘     └─────────────┘     └─────────────┘       │
│         │                   │                                   │
│         │                   │                                   │
│         └───────────────────┼───────────────────────────────┐  │
│                             │                               │  │
│                             ▼                               ▼  │
│                    ┌─────────────┐                 ┌────────┐  │
│                    │   Stripe    │                 │ Twilio │  │
│                    └─────────────┘                 └────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        DEVELOPMENT                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  localhost:5173 (Vite)  ──▶  localhost:5000 (Express)          │
│                                    │                            │
│                                    ▼                            │
│                            Neon (Dev Branch)                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **No tender system** | Auto-assign | Simpler, guaranteed fulfillment |
| **Slot holds** | 5-minute TTL | Prevent race conditions without long locks |
| **Task-based skills** | 70 tasks | Granular matching, not broad categories |
| **3-tier confidence** | Expert/Capable/None | Simple for contractors, useful for matching |
| **State machine** | 18 states | Clear lifecycle, easy debugging |
| **Customer type pricing** | Modifiers | Single price book, multiple customer types |
| **Event-driven** | Side effects | Decoupled, testable, extensible |
