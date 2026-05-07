# Booking & Dispatch v2 — Master Plan

**Branch:** `dispatched`
**Status:** Architecture in progress
**Owner:** Courtnee
**Last updated:** 2026-05-07

---

## What this is

V6 Switchboard is the operational backbone for Handy Services — a multi-trade
home maintenance business operating in Nottingham + Derby. This document
describes the **Booking & Dispatch v2 architecture**: a complete redesign of
how customers book work, how jobs route to contractors, and how the day's
work is structured.

The redesign is driven by three problems with the current system:

1. **Demand-first booking with no supply lock-in** — admin scrambles to find
   a contractor after the customer picks a date. Doesn't scale.
2. **Pricing engine inflates time estimates** to justify customer £/hr —
   producing fake durations that break downstream operations (routing, packing,
   contractor pay).
3. **No segmentation of supply** — every contractor treated identically. Day-rate
   "Builders" who want their week filled get the same treatment as gap-fillers
   who plug their own diary holes.

The new architecture solves these with: supply-locked booking, three contractor
segments (Builder / Gap-Filler / Specialist), day-pack offers for Builders,
manual job tagging at quote time, and a dispatcher control tower.

---

## Brand identity

Pulled from the `handy-services-pdf` skill. All UI inherits this:

| Token | Value |
|---|---|
| Navy (primary) | `#1B2A4A` |
| Yellow (accent) | `#F5A623` |
| Light bg | `#F7F8FC` |
| Dark text | `#111827` |
| Muted text | `#6B7280` |
| Border | `#D0D5E3` |
| Highlight bg | `#FFF8EC` |
| Highlight text | `#92591E` |
| Font | Poppins (all weights) |

These are codified in `modules/13-design-system.md`.

---

## Branch + rollback strategy

All work lands on `dispatched`. Production never sees the new system until each
phase is flag-gated to ON.

**Three layers of safety:**
1. **Long-lived feature branch** — `dispatched`. Never merged until ready.
2. **Feature flags** — every new behaviour gated. Defaults OFF in prod.
3. **Additive-only schema migrations** — new columns NULL-default; new tables
   independent. `git revert` leaves the DB forward-compatible.

Worst-case cold rollback: flip every flag off → system runs as today. Schema
additions remain (harmless).

See `feature-flags.md` for the catalogue.

---

## System architecture (the big picture)

```
┌─ CUSTOMER ──────────────────────────────────────────────────────────┐
│  Quote builder → Flex tier picker → Date picker → Stripe payment   │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │
                                       ↓
┌─ JOB CHARACTERISATION (admin manual) ───────────────────────────────┐
│  crew_size · skills · certs · duration · complexity · flexibility   │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │
                                       ↓
┌─ PRICING ───────────────────────────────────────────────────────────┐
│  Customer: EVE + flex_tier discount                                 │
│  Contractor: hidden engine (rev-share + floor + modifiers) → £      │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │
                                       ↓
┌─ ROUTING ───────────────────────────────────────────────────────────┐
│  TIER 1: Builder day-pack — bin-pack jobs into committed days       │
│  TIER 2: Single-offer to Gap-Fillers (5-stage pipeline)             │
│  TIER 3: Specialist queue (cert-gated)                              │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │
                                       ↓
┌─ DISPATCH ──────────────────────────────────────────────────────────┐
│  jobDispatches + contractorJobLinks (existing) — new bundle support │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │
                                       ↓
┌─ CONTRACTOR EXPERIENCE ─────────────────────────────────────────────┐
│  Builder: day-pack offer (live test page model)                     │
│  Gap-Filler: single-job feed                                        │
│  Specialist: cert-gated queue                                       │
│  All: pay protection (7 guarantees)                                 │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │
                                       ↓
┌─ COMPLETION & PAYMENT ──────────────────────────────────────────────┐
│  Check-in · photos · materials reimbursement · 48h payout           │
└─────────────────────────────────────────────────────────────────────┘

Cross-cutting: CONTROL TOWER (admin)
  Inbound queue · Day-pack assembler · Builder week · Exceptions · Demand health
```

---

## Domain model

**Entities (new + extended):**

| Entity | Source | Key fields |
|---|---|---|
| Quote | `personalizedQuotes` (extend) | flex_tier, tagging fields, booking_state |
| Unit (formerly handyman_profiles) | `handyman_profiles` (extend) | contractor_segment, area, skills, day_rate_target |
| UnitAvailability | NEW | unit_id, date, slot, status, crew_available |
| DayCommitment | NEW | unit_id, date, area, target_pence |
| DayPack | NEW | commitment_id, job_ids[], total_pence, status |
| RoutingOffer | NEW | booking_id, unit_id, round, expires_at |
| PayAdjustment | NEW | dispatch_id, type, amount, evidence |
| MaterialsPickup | NEW (per pack/day) | supplier, items, status |

**Existing dispatch infrastructure reused:** `jobDispatches`, `contractorJobLinks`,
`dispatchCompletions`, `contractor_payouts`, `disputes`, `variation_orders`.

**Legacy table to consolidate:** `contractorBookingRequests` — see ADR-001.

---

## Booking state machine (high level)

```
draft → quoted → booked_pending_routing → reserved_for_pack | offer_round_1
       → dispatched → in_progress → completed_pending_review (24h hold) → paid_out

Exit states: customer_cancelled | reschedule_required | disputed | refunded
```

Full state-machine.md spec to follow in Wave 1.

---

## Modules — what gets built

15 modules total. Each gets its own spec doc in `docs/architecture/modules/`.

**Independent modules** (no inter-deps beyond Wave 1 outputs):
- 01 — Flex Tier Booking
- 02 — Job Tagging
- 03 — Unit Bench
- 04 — Availability Engine
- 07 — Pay Protection (seven guarantees including day-rate floor, mis-scope uplift, call-out, cancellation comp, materials reimbursement, 48h pay)
- 10 — Notifications
- 11 — Migration & Compatibility Shim
- 12 — Materials Collection (NEW — surfaced from MVP test page)
- 13 — Design System (NEW — brand tokens + reusable components extracted from MVP)
- 14 — Test Page → Production Migration (NEW)

**Dependent modules** (need 01-04, 07 to be defined):
- 05 — Routing Engine
- 06 — Day-Pack Solver
- 08 — Control Tower
- 09 — Contractor App v2
- 15 — Day-Pack Page Production (NEW — promotes test page UX into the contractor portal)

---

## ADRs — locked decisions

8 architecture decision records to write in Wave 2:

- ADR-001 — Legacy `contractorBookingRequests` consolidation
- ADR-002 — Pay model: hidden engine + visible promise
- ADR-003 — Supply segmentation strategy (Builder primary, 50-60%)
- ADR-004 — Flex tier pricing (Fast 0% / Flexible -10% / Relaxed -15%)
- ADR-005 — Real-work-time vs pricing-time separation **(NEW from MVP)**
- ADR-006 — Travel time engine (Static Maps + Distance Matrix) **(NEW)**
- ADR-007 — All-or-nothing completion bonus model **(NEW from MVP)**
- ADR-008 — Materials collection as first-class step **(NEW from MVP)**

---

## Build phases — sequenced for value delivery

Each phase is independently shippable, flag-gated, reversible.

| Phase | Goal | Effort | Flag(s) |
|---|---|---|---|
| 0 | Foundation: branch + flags + initial schema | 2-3 days | — |
| 1 | Customer-side: flex tier + job tagging (admin) | 1 week | FF_FLEX_TIER, FF_JOB_TAGGING |
| 2 | Supply: unit bench + availability | 2 weeks | FF_UNITS_BENCH, FF_AVAILABILITY |
| 3 | Manual control tower (incl. day-pack assembler) | 1 week | FF_CONTROL_TOWER |
| 4 | Routing engine (semi-auto) | 2 weeks | FF_ROUTING_ENGINE |
| 5 | Day-pack solver | 2 weeks | FF_DAY_PACK |
| 6 | Pay protection (7 guarantees) | 2 weeks | FF_PAY_PROTECTION |
| 7 | Contractor app v2 (segment-aware + production day-pack page) | 1-2 weeks | FF_CONTRACTOR_APP_V2 |
| 8 | Notifications layer | 1 week | FF_NOTIFICATIONS_V2 |
| 9 | Legacy cutover | 2 weeks | FF_LEGACY_BRIDGE → off |

**Roughly 14-15 weeks for one dev. Faster with parallel devs on independent modules.**

---

## What this doc references

```
docs/architecture/
├── master-plan.md                    ← THIS FILE
├── data-model.md                     ← Wave 1
├── state-machine.md                  ← Wave 1
├── api-surface.md                    ← Wave 1
├── feature-flags.md                  ← Wave 1
├── adrs/
│   ├── adr-001-legacy-table.md       ← Wave 2
│   ├── adr-002-pay-model.md          ← Wave 2
│   ├── adr-003-segmentation.md      ← Wave 2
│   ├── adr-004-flex-tier.md          ← Wave 2
│   ├── adr-005-real-vs-pricing-time.md ← Wave 2
│   ├── adr-006-travel-time-engine.md   ← Wave 2
│   ├── adr-007-bonus-model.md        ← Wave 2
│   └── adr-008-materials-collection.md ← Wave 2
├── modules/
│   ├── 01-flex-tier-booking.md       ← Wave 3
│   ├── 02-job-tagging.md             ← Wave 3
│   ├── 03-unit-bench.md              ← Wave 3
│   ├── 04-availability-engine.md     ← Wave 3
│   ├── 05-routing-engine.md          ← Wave 4
│   ├── 06-day-pack-solver.md         ← Wave 4
│   ├── 07-pay-protection.md          ← Wave 3
│   ├── 08-control-tower.md           ← Wave 4
│   ├── 09-contractor-app-v2.md       ← Wave 4
│   ├── 10-notifications.md           ← Wave 3
│   ├── 11-migration.md               ← Wave 3
│   ├── 12-materials-collection.md    ← Wave 3
│   ├── 13-design-system.md           ← Wave 3
│   ├── 14-test-page-to-production.md ← Wave 3
│   └── 15-day-pack-page-production.md ← Wave 4
└── ui/  (reserved for future UX/design artefacts produced from module 13)
```

---

## North-star metric

**% of bookings dispatched without admin manual intervention.**
Target: ≥80% within 60 days of Phase 5 launch.
