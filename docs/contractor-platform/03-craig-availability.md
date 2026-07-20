# Contractor Hub — Craig's availability + flex (build spec)

> Start with Craig. The hub needs to: plot his available days, set his weekly
> recurring pattern, and show + place his pending flex jobs. This is the shared
> understanding before building. Decisions confirmed with the founder 20 Jul.

## The model — one grid, one queue

Craig's hub view is a **week grid** (his supply) plus a **flex queue** (demand
waiting to be slotted in).

### Availability sources → bookable days
1. **Weekly recurring pattern** — `handyman_availability` (dayOfWeek, start/end,
   isActive). His standing supply (e.g. Wed/Thu/Fri AM). This is what lights up
   the customer quote calendar going forward — the fix for the dry calendar.
2. **Date overrides** — `contractor_availability_dates` (date, isAvailable,
   start/end). One-off exceptions.
3. **Resolution (existing engine rule):** for any date, **override wins → else
   weekly pattern → else Off**. No master fallback.

### Demand lands on the grid two ways
- **Dated (Lane B):** customer picks a day → `reserveSlot` → `confirmBooking` →
  hard booking that **consumes** the cell. No queue.
- **Flex (Lane A):** customer pays "I'm flexible" (`flexBookingWithinDays = N`) →
  **no fixed date** → the job enters the **pending flex queue**. Movable inventory.
  Ben **places** it onto an open day within its N-day window → it becomes a dated
  booking.

## Decisions (locked)

1. **Granularity = AM / PM / full-day** (`@shared/slot-times.ts`: am 09–13,
   pm 14–18, full 09–18). Matches the booking engine + quote picker exactly.
2. **A flex job is "Craig's" when `leadContractorId = Craig`** (the soft lead set
   at quote generation by steer-then-compose). His queue = his pipeline.
3. **Placing a flex job = Ben assigns → hard book** (reuse `confirmBooking`).
   Manual-first. (Tap-to-accept offers stay a post-v1 enhancement.)

## Build inventory — reuse vs new

| Piece | Status |
|---|---|
| Write weekly pattern | **Reuse** `availability-routes.ts` (upserts `handyman_availability` from `{patterns:[{dayOfWeek,startTime,endTime,isActive}]}`). It's self-serve (`getContractorId(userId)`) — add an **admin-by-contractorId** variant so Ben edits Craig's. |
| Write date overrides | **Reuse** `PUT /api/admin/contractors/:id/availability` (Ben's mobile tool → `contractor_availability_dates`). |
| Read the resolved week | **New** hub endpoint: given Craig + a week, return each day's AM/PM/full state = resolve(pattern, overrides) minus existing bookings. Mirror `isContractorAvailableForSlot` / `buildAvailabilityResponse`. |
| Read the flex queue | **New** query: quotes/bookings where `deposit_paid_at` set, `flexBookingWithinDays` set, no `scheduled_date`, `leadContractorId = Craig`. |
| Place a flex job on a day | **New** action: reserve + `confirmBooking` a flex job onto a chosen date+slot for Craig (confirmBooking currently needs a lock — add a path that books a flex job directly, writing the `booking_assignments` lead row we already added). |
| Grid + queue UI | **New** — Craig's workspace in the Contractor Hub drawer/panel: editable pattern, override toggles, week grid, flex queue with "place" action. |

## Build order (when we start)

1. **Read endpoint** — `GET /api/admin/contractor-hub/:id/week?week=…` → resolved
   AM/PM/full grid + this-week bookings. (Unlocks the grid; pure resolver is
   unit-testable.)
2. **Flex queue endpoint** — `GET /api/admin/contractor-hub/:id/flex` → his
   pending flex jobs with deadlines.
3. **Write endpoints** — admin weekly-pattern (by contractorId) + reuse override PUT.
4. **Place action** — `POST …/:id/flex/:jobId/place {date, slot}` → dated booking.
5. **UI** — Craig's grid + queue in the hub.

## Open (smaller) questions for build time
- Weekly pattern currently stores one row per day with a single start/end — to
  express AM **and** PM we either store two rows/day or map slot→time. Recommend
  slot-typed rows (reuse `slotFromWindow`).
- Flex "within N days" deadline: measured from payment date; surface the hard
  deadline in the queue so Ben places before it lapses.
