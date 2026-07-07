# Phase 1 Spec — Make the Spine Unbroken

> **Status:** APPROVED — architecture + key decisions confirmed 2026-06-28. Ready to implement behind a flag.
> **Decisions locked:** (1) **Option A** — wire the existing assignment engine, no schema change. (2) Dated jobs **auto-commit** a contractor at payment. (3) Backfill is **report-only for old jobs**, auto-resolve recent only.
> **Date:** 2026-06-28
> **Parent:** `dispatch-source-of-truth.md` (read §3, §3a, §3b first)
> **Goal:** every paid deposit deterministically becomes either committed work (a `contractor_booking_requests` row with a contractor + date) or visible pending work on an SLA clock — never a silent void. Then one real job proven all the way to payout.

---

## 1. The reframe (don't fix the wrong thing)

The "86% leak" is **not** that 85 paid jobs are invisible. The dispatch pool is sourced as:

```
deposit_paid_at IS NOT NULL AND cbr.id IS NULL   (dispatch-sweep.ts:399/446)
```

i.e. **a paid quote with no booking row IS the pending record.** The 85 jobs are sitting in the pool, read from `personalized_quotes`. The absence of a CBR row is the *current, deliberate* signal for "not yet dispatched."

So the real defect is downstream: **the assignment step that turns a pending quote into a committed CBR row barely runs.** Today a CBR row is created on payment ONLY when the customer pre-reserved a slot-lock (`metadata.lockId` → `confirmBooking`). Without a lock the webhook logs *"goes to dispatch pool for manual assignment"* — and the manual path is unused (0 rows) and the auto path is unwired.

**Smoking gun:** `findBestContractorForJob()` in `server/auto-assignment-engine.ts` is a complete assignment engine (skills + availability + proximity scoring) with **zero callers.** The engine to drain the pool already exists; nothing invokes it.

---

## 2. Target state, per lane

| Lane | Today | Target |
|------|-------|--------|
| **Dated** (quote has `selected_date`) — 63 paid, only 14 booked | If a slot-lock exists → CBR. Else → silent pool (49 leaked). | On payment, if no lock, **auto-assign**: call `findBestContractorForJob` for the chosen date/slot → write CBR (committed). Falls back to pending+flag only if no contractor fits. |
| **Flexible** (no date) — 36 paid, 0 booked | Sits in quote-pool; no SLA surfaced. | Stays a pending quote (no date = nothing to commit yet) **but on an explicit SLA clock** (`flex_booking_within_days`). The dispatch cockpit/auto-planner proposes a date; human confirms → CBR. |
| **Any paid job past SLA & still unassigned** | Invisible failure. | Surfaced as an alert/agewall so nothing rots silently. |

Net invariant after Phase 1: **every paid job is either (a) a committed CBR row with contractor+date, or (b) a pending quote with a running SLA clock that is visibly aging.** No third "void" state.

---

## 3. Architecture decision (CONFIRM BEFORE CODE)

Two coherent models. We must pick one explicitly.

### Option A — Quote-is-pending, CBR-is-committed ✅ **CONFIRMED**
- Pending work lives in `personalized_quotes` (paid, no CBR). Committed work lives in `contractor_booking_requests` (has contractor + date). The pool reader already implements this.
- A CBR row always means "real, assigned, schedulable work" — exactly what completion/invoice/payout key off.
- **Fix = wire the assignment engine** (call `findBestContractorForJob` at payment for dated jobs; expose it to the cockpit/auto-planner for flexible jobs). No schema change.
- **Why recommended:** lowest risk; no migration; `contractor_id` stays `NOT NULL` and meaningful; matches the existing pool reader and the memory'd "automate assignment, seamless booking" intent; the metric becomes trustworthy because pending and committed each have exactly one home (union = all paid work).

### Option B — CBR-from-payment (every paid job gets a row immediately)
- Webhook writes a CBR row for every paid job, `assignmentStatus='unassigned'`, contractor/date filled later.
- Requires: make `contractor_id` **nullable** (migration on an FK column), rewrite the pool reader from "quotes without CBR" → "CBR where unassigned", migrate 85 historical rows, and re-test a money-adjacent path.
- **Why not now:** higher blast radius for the same outcome. Defer; revisit only if we later need lifecycle state on *un*assigned work.

> **CONFIRMED: Option A.** Everything below assumes A.

---

## 4. The changes (Option A)

> **Implementation status (2026-06-28):** §4.1 + §4.2 **built behind `AUTO_ASSIGN_ON_PAYMENT` (default OFF)** and type-checked clean. **§4.3 (SLA surfacing) is already implemented** (was built with the Phase-2 cockpit work, predating this spec) — verified: the pending rail renders per-job overdue/age `SlaBadge`s (`client/src/components/dispatch/FlexibleQueuePanel.tsx` + `sla.tsx`, classifying through the shared `shared/dispatch-sla.ts` helpers), and `server/dispatch-cron.ts` (`runAutonomousSweep`, wired at `server/index.ts:1728`) broadcasts deduped, batch-collapsed `sla_breach` alerts every 30 min for any paid-but-unassigned job within/past its `flexDeadline`. Read-only; never books. §4.4 (backfill) not yet started. The §4.1/§4.2 webhook code is not yet enabled in any environment; not yet committed.

### 4.1 Extract a shared `createBookingFromAssignment` helper
`confirmBooking` (booking-engine.ts:534) already does the canonical CBR + job-sheet insert. Extract the insert half into one helper so the slot-lock path, the new auto-assign path, and manual dispatch all write **identical** rows. Single writer = no drift.

### 4.2 Webhook: auto-assign dated jobs (the 49 fix)
In `payment_intent.succeeded`, after `depositPaidAt` is set, replace the bare `else { log "goes to dispatch pool" }` with:
- If `lockId` present → `confirmBooking` (unchanged).
- Else if the quote has a usable date (`selected_date` + slot) → derive categories (`extractJobCategories`), call `findBestContractorForJob(categories, date, slot, price, lat, lng)`:
  - success → `createBookingFromAssignment(...)` → committed CBR row.
  - no-fit → leave as pending quote **and** set a `needs_dispatch` flag/log so it surfaces (don't fail the webhook).
- Else (no date = flexible) → pending pool (unchanged), but ensure `flex_booking_within_days` SLA is set.

All of this stays wrapped so a failure never 500s the webhook (Stripe retry safety), same as today.

### 4.3 SLA surfacing for the flexible pool
The pool query already computes a `flexDeadline` (dispatch-sweep.ts:192). Add an "overdue" / age indicator to the cockpit's pending rail and a daily alert for any paid-but-unassigned job past its `flexDeadline`. (Read-side only; no write.)

### 4.4 Backfill the 85 historical leaked jobs
One-off reconcile script (idempotent, dry-run first):
- **49 dated, unbooked** → run the same auto-assign as 4.2; create committed CBR rows where a contractor fits, else mark `needs_dispatch`.
- **36 flexible, unbooked** → leave as pending; attach/normalise their SLA clock so they appear in the aged-pool view.
- Output a report: how many auto-resolved vs need human dispatch. (Many of the oldest may be already-fulfilled-offline — script must classify, not blindly book. See open question §6.)

---

## 5. Rollout & safety
- **Flag:** `AUTO_ASSIGN_ON_PAYMENT` (default OFF). Ship the code dark; enable in staging; verify CBR rows appear for dated test payments; then enable in prod.
- **Webhook stays non-blocking:** assignment is best-effort; any throw is caught and the job falls to pending. Payment/invoice flow is never at risk.
- **Idempotency:** guard against double-booking on Stripe webhook retries (re-check `cbr.quote_id` existence before insert — confirmBooking already has a conflict check; the new path needs the same).
- **Test plan:** unit (findBestContractorForJob fit/no-fit), integration (dated payment → CBR row; flexible payment → pending+SLA; retry → no dupe), and the end-to-end proof: one job paid → assigned → lifecycle → balance invoice → payout (the §1.3 SOT goal).

---

## 6. Decisions & remaining questions

**Settled:**
1. ✅ **Backfill = report-only for old.** Auto-resolve only recent jobs; for older ones (likely already fulfilled offline) the script produces a classification report and does NOT auto-book. Concretely: define an age cutoff (proposed: jobs whose `deposit_paid_at` is older than ~3 weeks, or whose lead stage is already past `booked`) → report-only; newer + still-pending → eligible for auto-assign.
2. ✅ **Dated jobs auto-commit.** Customer already chose the date, so assigning the contractor is fulfilment, not a judgment call — write the committed CBR row at payment. (The "AI proposes, human confirms" model applies to the *flexible* lane and exceptions, not to dated fulfilment.)

**Still to settle (can be decided during implementation):**
3. **No-fit handling:** when `findBestContractorForJob` finds nobody (skills/availability), what's the ops signal — alert only, or also auto-notify the customer of a short delay? *(Proposed: alert ops + mark `needs_dispatch`; customer comms deferred to Phase 3.)*
4. **Flex promise dependency:** §4 flexible-lane SLA leans on `flex_booking_within_days`, which is barely populated (the flex-promise gap in SOT §4). This and Phase 2 (define + capture the flex promise) can proceed in parallel, but the flexible-lane SLA is only as good as that field.

---

## 7. What this explicitly does NOT do
- No optimiser / margin work (that's post-spine, SOT Phase 4).
- No cockpit redesign (SOT Phase 3).
- No schema migration (that's Option B, deferred).
- Does not touch the working invoice track beyond linking `invoiceId` onto the new CBR rows.
