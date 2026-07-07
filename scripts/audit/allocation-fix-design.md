# Allocation Fix — Build-Ready Design (wire the flexible pool to the engine)

## Principle
**Wire, don't build.** The brain (`findBestContractorForJob`), matcher (`findCandidateContractors`), booking-write (`confirmBooking`), and tap-to-accept (contractor dashboard) all exist. The bottleneck is one missing connection: the flexible (Lane A) pool → the engine. Right-size to the 6-contractor roster: **filter + pick**, not an optimiser. Sequence: **Phase 1 automate (kill the bottleneck) → Phase 2 batch-optimise (reclaim the flywheel).**

## Target flow
```
Flexible payment (no lockId)
  → [POOL]  create pending contractor_booking_request (status=pending, no date/contractor yet,
            carries needed-by window + candidateContractorIds + categories + customer lat/lng)
  → [SWEEP] runDispatchSweep():
       for each pending job (urgent/needed-by first):
         for each candidate date in the needed-by window (skip slack-protected near-term):
            findBestContractorForJob(categories, date, slot, price, lat, lng)
         pick best (date, contractor) — clustering + earliness + least-loaded (lastAssignedAt)
         ├─ committed contractor  → assignFromPool() → booking status=accepted → CONFIRM customer + notify contractor
         ├─ only backups qualify   → tap-to-accept offer (first-tap-wins, ~5 min) → on accept → confirm
         └─ none / deadline hit    → escalate to ops (the residual reactive ~10%)
  → Customer: "Confirmed — [date] [AM/PM] with [named handyman]"
```

## Phase 1 — kill the bottleneck (the minimal wire)
The smallest change that removes Ben from manual assignment:

1. **Pool entry** — `server/stripe-routes.ts`, the `else` branch at **line ~506** (currently just `console.log("…goes to dispatch pool for manual assignment")`). Replace with: insert a `contractor_booking_request` with `status='pending'`, `assignmentStatus='unassigned'`, no `scheduledDate`/`assignedContractorId`, carrying `quoteId`, customer details, `candidateContractorIds`, categories, customer lat/lng, and the needed-by window. *(Bonus: this also fixes the tracking gap — every paid job now has a record, closing the 31/83 `booked_at` hole.)*
2. **The sweep** — new `server/dispatch-sweep.ts` → `runDispatchSweep()`. For each pending job, iterate candidate dates in the window, call `findBestContractorForJob` per date, pick the best (date, contractor). **Build detail:** ensure the **availability gate** is applied (per-date availability + existing-booking conflict — reuse `isContractorAvailableForSlot` from booking-engine; confirm whether `findBestContractorForJob` already checks availability or only skill+location).
3. **The assign-write** — `assignFromPool({quoteId, contractorId, date, slot})` in `booking-engine.ts`, mirroring `confirmBooking`'s insert (lines ~534–548) but **without the lock requirement** (flexible jobs have no lock). Keep the double-book conflict check.
4. **Trigger** — run the sweep on a schedule (2–3×/day) + a manual "Run dispatch" button on the daily-planner. At this volume a frequent sweep ≈ near-real-time. *(Use the existing scheduled-tasks/cron.)*

→ **Result:** flexible jobs auto-assign without Ben. Bottleneck gone.

## Phase 2 — reclaim the batching benefit (the flywheel)
Phase 1 is filter+pick (lightly greedy). Phase 2 makes the sweep **batch-aware** so the "I'm flexible" buffer earns its keep:
- Run the sweep **less often, on a fuller pool** (the buffer = lookahead → offline bin-packing beats greedy).
- **Date clustering:** prefer the date/contractor that sits next to an existing nearby job (density → higher £/hr → the flywheel). `smart-planner-engine.ts` already has haversine clustering to lift in.
- **Slack governor** as an offer-time filter: never assign into the protected near-term buffer (holds the speed/reliability moat).
- **Empty-day seeding:** route-pricing starves dead Mon/Tue — pair with off-peak/MOT seeding (already in your design notes).

## Assignment policy
- **Committed contractors → auto-assign** (`status=accepted`) + night-before "reply YES" confirm (keeps the promise).
- **Ad-hoc backups → tap-to-accept** offer (can't be auto-assigned; reuse the existing pending→accepted dashboard path).
- **Deadline backstop:** a job nearing needed-by with no assignment → escalate to ops. This is the only residual manual touch (the reactive ~10%).

## Secondary fixes (do alongside)
1. **Supply is thin** — `handyman_availability` (recurring) is empty; all 6 use per-date entry (22 future slots). Add recurring weekly patterns per contractor so the sweep has dates to assign to. *(Highest non-code leverage.)*
2. **Geocode the 1 missing contractor** (5/6 have lat/lng) — else they're invisible to location-matching.

## Effort & sequence
- **Phase 1 ≈ small:** 1 webhook branch + 1 sweep function + 1 write fn + a cron. Mostly plumbing existing primitives. This is the high-leverage bottleneck-killer — do first.
- **Phase 2 ≈ medium:** clustering + slack-as-filter; matters more as roster/volume grow.
- **Don't build the optimiser** (OR-Tools/cheapest-insertion) until days are routinely full.
