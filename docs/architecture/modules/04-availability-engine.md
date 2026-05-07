# Module 04: Availability Engine

**Status:** Wave 3 — written
**Depends on:** Module 03 (Unit Bench)
**Feature flag:** `FF_AVAILABILITY_ENGINE`

---

## 1. Purpose

The Availability Engine is the **supply-locked booking** backbone. Contractors
publish availability per `(unit, date, slot)`; the system gates the customer
date picker so customers can only choose dates the bench can cover. Routing
offers and the day-pack solver consume the same data — every read of "who
can do what when" funnels through this module.

It fixes today's biggest operational pain: admin scrambling to find a
contractor *after* a customer picks a date. Demand is now shaped by supply,
not the other way around.

---

## 2. Schema (recap from `data-model.md` §3)

Single new table: `unit_availability`.

```
id                       text PK (ua_<uuid>)
unit_id                  varchar FK → handyman_profiles(id) ON DELETE RESTRICT
date                     date
slot                     enum('am','pm','full')
status                   enum('available','held','booked','unavailable')
crew_available_count     integer NOT NULL DEFAULT 1
hold_expires_at          timestamptz NULL
hold_for_booking_id      varchar NULL
last_synced_at           timestamptz
created_at, updated_at   timestamptz

UNIQUE (unit_id, date, slot)
INDEX  (date, status)             -- solver scans
```

**Invariants enforced server-side:**

1. `(unit_id, date, slot)` is unique (DB constraint).
2. For a given `(unit_id, date)`: either `{am,pm}` rows OR a single `full` row,
   never both — validated in the service layer before insert/update.
3. For Teams (`unit.crew_max > 1`), `crew_available_count ≤ unit.crew_max`,
   and `crew_available_count ≥ 1` whenever `status = 'available'`.
4. `held` rows must carry both `hold_expires_at` and `hold_for_booking_id`.
5. After `hold_expires_at`, a `held` row reverts to `available` unless promoted
   to `booked`.

---

## 3. Files

```
NEW       server/availability-service.ts            CRUD + hold/release + queries
NEW       client/src/pages/contractor/dashboard/
            AvailabilityScheduler.tsx               replaces CalendarTab when FF on
NEW       client/src/components/contractor/
            SlotToggle.tsx                          per-slot AM/PM/Full cell
NEW       server/jobs/availability-tick.ts          cron — releases expired holds
MODIFIED  server/availability-routes.ts             new endpoints alongside legacy
MODIFIED  client/src/components/DatePricingCalendar.tsx
                                                    consumes /eligible-dates
```

Legacy `server/availability.ts` and `server/availability-engine.ts` stay in
place for the FF-off path. Module 11 (Migration) handles eventual deletion.

---

## 4. Slot model

Each calendar day has up to **3 logical slot states** per unit:

| Slot | Window |
|---|---|
| `am` | 08:00 – 12:00 |
| `pm` | 12:00 – 17:00 |
| `full` | both (logical merge — "any time that day") |

**Storage rule:** a day is represented as either two rows (`am` + `pm`) **or**
a single `full` row. Mixing is a constraint violation and rejected at the
service layer with `422 invalid_slot_combination`.

When a customer books a `full` slot but only the morning is needed, the engine
splits it: the `full` row is replaced with an `am` row (status `booked`) and a
`pm` row (status `available`) inside one transaction.

---

## 5. Status state machine

```
                  set by contractor scheduler
                  ┌──────────────────────────┐
                  ▼                          │
            ┌──────────┐                ┌────┴────────┐
   create → │available │ ←── tick ──── │   held      │
            └────┬─────┘                └──────┬──────┘
                 │                             │
                 │    routing /hold            │ offer accepted
                 └─────────────────────────────┤
                                               ▼
                                          ┌─────────┐
                                          │ booked  │
                                          └────┬────┘
                                               │ cancellation (audit)
                                               ▼
                                          available

   contractor "vacation" / explicit off:
            available  ←─────────►  unavailable
```

Allowed transitions (anything else is rejected):

| From | To | Trigger |
|---|---|---|
| `available` | `held` | `POST /api/availability/hold` |
| `available` | `unavailable` | contractor scheduler |
| `held` | `available` | `POST /api/availability/release` or cron tick |
| `held` | `booked` | offer accepted (routing → bookings) |
| `booked` | `available` | cancellation, with audit row |
| `unavailable` | `available` | contractor scheduler |

---

## 6. Contractor scheduler UI

`AvailabilityScheduler.tsx` is a 14-day rolling grid that mirrors the existing
`CalendarTab` rhythm so contractors don't have to relearn anything.

**Per day, three toggle cells** (rendered by `SlotToggle.tsx`):

```
Mon 12 May
┌──────┬──────┬──────────┐
│  AM  │  PM  │ Full Day │
└──────┴──────┴──────────┘
```

- **Tap** cycles `available → unavailable → available`.
- **Long-press** opens a menu: "Block this week", "Set vacation range",
  "Mark booked elsewhere".
- **Selecting `Full Day`** merges any existing `am`/`pm` rows into a single
  `full` row (transactional).
- **For Teams** (`crew_max > 1`): each cell shows a stepper —
  `3 / 4 crew` — so a Builder team-lead can mark "one mate off today".

Brand styling per Module 13 — Navy `#1B2A4A` for available cells, Yellow
`#F5A623` for held, muted grey for unavailable, Poppins throughout.

---

## 7. Customer-side: `eligible-dates` query

The single most important read endpoint — it powers the supply-locked promise.

```
GET /api/availability/eligible-dates
    ?postcode=NG7
    &skills=plumbing,tiling
    &duration=180          // minutes
    &from=2026-05-08
    &to=2026-05-22
    &flex_tier=fast        // optional, used by routing only

200 →
{
  data: {
    eligible:    ["2026-05-09","2026-05-12","2026-05-15"],
    constrained: { "2026-05-13": { units_left: 1, tier_capacity: "low" } },
    full:        ["2026-05-10","2026-05-11"]
  },
  meta: { from, to, max_lead_days: 14 }
}
```

**Logic:**

1. Resolve candidate units: skill-match + serves the postcode area + meets
   `min_job_value` (Module 03).
2. For each date in `[from, to]`, scan `unit_availability` for slots that fit
   `duration` (a 180-min job needs an `am`, `pm`, or `full` slot).
3. Bucket the date:
   - `eligible` — ≥ 2 units have free supply (or ≥ 1 unit for Specialist
     skills where the bench is always thin).
   - `constrained` — exactly 1 unit available; UI greys lightly with a
     "Limited" badge.
   - `full` — zero units; UI hard-disables the date.
4. Held slots count as "soft full" only if their `hold_expires_at` is later
   than the customer's expected pay deadline; otherwise they count as
   available.

`DatePricingCalendar.tsx` consumes `eligible` + `constrained` to render
selectable dates and disables `full` dates outright.

**Errors:** `422 invalid_postcode`, `422 invalid_skill`, `503 service_unavailable`
(engine offline → caller falls back to legacy "all dates open").

---

## 8. Hold mechanics

Used by Module 05 (routing) to soft-reserve supply during an offer round.

```
POST /api/availability/hold
{ unit_id, date, slot, ttl_minutes: 30, hold_for_booking_id }

200 → { hold_id, expires_at }
409 → { code: "slot_taken" }     // UNIQUE conflict — another hold/booking won
```

- Default TTL is **30 minutes** — matches offer round 1 in the routing
  pipeline. Longer holds (e.g. for day-pack assembly) pass `ttl_minutes: 120`.
- On offer **accept** → service promotes `held` → `booked` in the same
  transaction that flips the booking state.
- On offer **decline** → caller hits `/release`; status returns to
  `available` immediately.
- On **expire** → `availability-tick.ts` (cron, every 5 min) sweeps
  `WHERE status='held' AND hold_expires_at < now()`, sets back to `available`,
  logs `released_count` to telemetry.

Concurrency is enforced by the `(unit_id, date, slot)` UNIQUE index. Two
parallel routing tasks holding the same slot → second insert hits 23505 →
service returns 409, routing retries with the next-best unit.

---

## 9. Multi-day consecutive query

Singles can take multi-day jobs (kitchen refit, deep clean run). The
day-pack solver (Module 06) needs:

```ts
// server/availability-service.ts
export async function getConsecutiveAvailable(
  unitId: string,
  daysNeeded: number,
  fromDate: Date,
  horizonDays = 30,
): Promise<Date | null>
```

Returns the earliest start date for which `unit_availability` has
`status='available'` and `slot IN ('full','am','pm')` for `daysNeeded`
consecutive calendar days, or `null` if no run exists in the horizon.

Implemented as a SQL window query (`gaps-and-islands`) over
`unit_availability` filtered by `unit_id` and `date >= fromDate`, grouping
contiguous runs and returning the first run with `length >= daysNeeded`.

---

## 10. Tests

| # | Coverage | Lives in |
|---|---|---|
| 1 | CRUD: contractor sets slots, reads back match | `availability-service.test.ts` |
| 2 | Slot-combination invariant: `am+pm+full` rejected | service test |
| 3 | Hold lifecycle: hold → release timer → status flip | `availability-tick.test.ts` |
| 4 | Hold → booked promotion in single tx | service test |
| 5 | Eligible-dates: bucketed correctly across mixed supply | route test |
| 6 | Concurrency: two parallel holds → second 409 | service test |
| 7 | Multi-day query: returns earliest run, `null` if none | service test |
| 8 | Crew-stepper: `crew_available_count` honoured by router | integration |

---

## 11. Rollback

`FF_AVAILABILITY_ENGINE = 0`:

- `DatePricingCalendar.tsx` shows all dates (current behaviour, no greying).
- Contractor dashboard renders legacy `CalendarTab.tsx`, not
  `AvailabilityScheduler.tsx`.
- Routing engine (when on) falls back to "anyone any day" — pre-availability
  mode — using the legacy `handymanAvailability` weekly pattern.
- Existing `unit_availability` rows go inert; cron tick is a no-op.

Schema is additive; flipping the flag back on resumes the engine without
data loss.

---

## 12. Cross-references

- `modules/03-unit-bench.md` — availability is keyed off `handyman_profiles(id)`.
- `modules/05-routing-engine.md` — consumes `available` slots, issues holds.
- `modules/06-day-pack-solver.md` — uses `getConsecutiveAvailable` plus the
  `(date, status)` index.
- `modules/01-flex-tier-booking.md` — `DatePricingCalendar` consumes
  `eligible-dates`.
- `data-model.md` §3 — table definition.
- `api-surface.md` — endpoint contracts.
- `feature-flags.md` — `FF_AVAILABILITY_ENGINE`.
- `adrs/adr-006-travel-time-engine.md` — travel windows reduce effective
  crew capacity per slot.
