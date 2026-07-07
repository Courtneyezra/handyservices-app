# Allocation Layer — Bottleneck Diagnosis (verified in live code + data, Jun 2026)

## The bottleneck in one line
**Flexible ("I'm flexible") jobs — the majority, and the lane they're actively pushing — hit a manual dispatch pool with NO automated assignment wired in. The auto-assign engine is fully built but dormant, so ~90% of paid jobs are hand-assigned by Ben off-system.**

## The good news: the foundation is READY (memory was stale)
- **6 contractors, all skill-tagged** (61 skills by `category_slug`, proficiency set); 5/6 geocoded. The "only Craig has skills" gap is CLOSED.
- Matcher built: `contractor-matcher.ts → findCandidateContractors()` (259 lines, skill+location).
- Auto-assign brain built: `auto-assignment-engine.ts → findBestContractorForJob()` (576 lines).
- Planner built: `smart-planner-engine.ts` (513 lines).

## The actual break: the brain is never called
Two lanes at the Stripe webhook (`server/stripe-routes.ts`):
- **Lane B (pick-a-date, MINORITY):** payment → `lockId` → `confirmBooking()` → inserts a `contractor_booking_request` with the chosen contractor. The only automated path.
- **Lane A (flexible, DEFAULT-ON, MAJORITY):** payment → no `lockId` → line 507 literally logs *"goes to dispatch pool for manual assignment"* → line 639 fires an *"Ops notification — dispatch pool alert for Ben."* No booking request. No call to `findBestContractorForJob`.
- **`auto-assignment-engine` is imported NOWHERE** (dormant). `smart-planner-engine` only feeds a read-only daily-planner view.

## The proof in the data
- **83 paid jobs (Mar+) → only 7 `contractor_booking_requests`**, 1 v2-booking, 0 contractor_jobs, 31 `booked_at`.
- ~90% of paid jobs never enter the structured allocation pipeline → hand-assigned off-system.

## The strategic irony
The "I'm flexible" lever is **strategically correct** (it hands the optimiser batching time = slack). But they built the *demand* side (route jobs to the pool) without the *supply* side (auto-assign the pool). So **every flexible job floods a manual queue that pings Ben.** Pushing "I'm flexible" harder = flooding the bottleneck harder. The buffer was meant to enable smart batch-assignment; today it enables a manual scramble.

## The fix is WIRING, not building
Everything needed exists. Connect: **flexible payment → pending pool → `findBestContractorForJob` → either (a) auto-create the `contractor_booking_request` (filter+pick: least-loaded qualified+available — right-sized for a 6-person roster), or (b) fire a tap-to-accept offer to matching contractors.** That single wire is the highest-leverage move and is mostly plumbing existing pieces.

## Secondary issues (lower priority, but real)
1. **Thin availability:** `handyman_availability` (recurring) has 0 active contractors — all 6 use per-date entry, only 22 future date rows. Even auto-assign needs supply to assign to. Push recurring availability patterns.
2. **1/6 contractor not geocoded** → can't location-match.
3. **Tracking gap:** only 31/83 paid jobs have `booked_at` — job status is poorly tracked even before allocation.

## Recommended next step
Design the wiring: pending-dispatch pool → batch auto-assign sweep (calls the existing engine) → booking request or tap-to-accept offer. Right-size to filter+pick (not the optimiser) at 6 contractors. This is the concrete fix for the "massive bottleneck."
