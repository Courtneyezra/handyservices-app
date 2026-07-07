# Dispatch — Source of Truth

> **Status:** Source of truth, ratified after first-principles review + LLM Council
> **Date:** 2026-06-28
> **Decided by:** Courtney (operating-model + metric calls) · LLM Council (tweak-vs-rebuild verdict)
> **Supersedes informal understanding in:** `memory/project-scheduling-auto-assign.md`, `memory/project-booking-data-model.md`

This document exists because we went back to first principles on what the dispatch cockpit *is*, what it's *for*, and whether to tweak or rebuild it. It is the agreed reference everything downstream builds on. Read it before touching dispatch, the booking write-path, or the flex/scheduling tiers.

---

## 1. What dispatch actually is (and is not)

**What it is:** the operational layer that turns a *paid deposit* into a *contractor standing at the customer's door on the promised day*, profitably.

**What it is NOT:** a manual job-shuffling board. The product thesis (see `DISPATCH_SCALING_ROADMAP.md`) is that **routing and clustering IS the product** — we make per-task work feel like a planned full day. A human dragging every job around the grid does not scale and is not the goal.

### Operating model (decided)
**AI proposes, human confirms** — a co-pilot, not an autopilot, and not a manual board. The optimiser builds the plan; a human approves exceptions. At our scale the human's job is to handle the ~10% the machine shouldn't decide alone, not to place the 90% it can.

### North-star metric (decided, with a caveat)
- **Product goal:** **promise-kept rate** — did the customer get what they were promised, on the day they were promised it. This is the "anti-handyman" brand made measurable.
- **Business constraint:** **margin per contractor-day** — promise-kept is worthless if every kept promise loses money.
- **CAVEAT (Courtney's first-principles correction):** *We cannot make either metric load-bearing until the **flex promise** is precisely defined and the customer understands exactly what they're buying.* See §4. **This is the gate on everything else.**

### Scale we are building for
~5 active contractors now, scaling to 10–20+ within 12 months. **Right-size to a small roster:** filter-and-pick, not a fleet optimiser. Don't build for 200 contractors we don't have.

---

## 2. The canonical booking table

There are four booking-related tables. They are **not** equal. Decided:

| Table | Status | Evidence | Verdict |
|-------|--------|----------|---------|
| `contractor_booking_requests` | **CANONICAL / LIVE** | 14 rows, written as recently as yesterday | **Single source of truth for "who is doing what, when."** |
| `contractorJobs` | Legacy | older flow | Read-only / migrate off |
| `v2Bookings` | **DEAD** | 1 row, never paid, untouched ~6 weeks | Do not build on. Quarantine. |
| `bookingSlotLocks` | Active (transient) | reservation locks during checkout | Keep — race-condition guard only |

**Rule:** if a job is not in `contractor_booking_requests`, it does not exist as far as dispatch and availability are concerned.

---

## 3. The headline finding — the metric is not yet trustworthy

We pulled the live (test-scrubbed) data. The funnel does not reconcile:

| Milestone | Count (non-test, since Feb 2026) |
|-----------|-----------------------------------|
| **Paid deposits** (real `pi_` Stripe intents) | **99** |
| Rows in canonical `contractor_booking_requests` | **14** |

**85 of 99 paid jobs (≈86%) never landed in the canonical booking table.**
> (The corrected scrub query counts 99 paid; an earlier pass undercounted at 95 due to a column-name error. Use 99.)

### What this means
- The booking **write-path captures only ~15% of paid jobs.** The other 85% were fulfilled (or dropped) *outside* the system of record — by hand, over WhatsApp, in someone's head.
- **Any margin-per-day or promise-kept number computed today is built on 15% of reality.** The council's "the metric isn't measurable yet" warning is confirmed by the data, not just theory.
- **First job is not a dashboard. It is closing the write-path leak** so that paying = a canonical booking row, every time.

### Paid-by-month (for context on trend reliability)
2026-02: 4 · 2026-03: 6 · 2026-04: 43 · 2026-05: 22 · 2026-06: 24
Real volume only starts ~April. Treat anything before then as noise.

---

## 3a. Where exactly the booking row leaks (code + data traced)

We traced the spine from the Stripe webhook down. The leak is not random — it has **one precise cause.**

### The mechanism (code: `server/stripe-routes.ts` `payment_intent.succeeded`)
On every paid deposit the webhook **unconditionally**: marks the quote `depositPaidAt`, **creates an invoice**, and sets the lead to `booked`. That is why invoices and "paid" counts are healthy.

But it **only creates a `contractor_booking_requests` row when the payment carries a `metadata.lockId`** — a slot-lock the customer reserved *before* paying (`confirmBooking()` in `booking-engine.ts`, gated on a `booking_slot_locks` row). No lock → the code logs *"goes to dispatch pool for manual assignment"* and **no booking row is ever written.** The "dispatch pool" then depends on either manual dispatch or the dormant auto-assign engine — neither of which is filling it.

### The data confirms it, precisely
Of **99** paid jobs:

| Lane | Paid | Got a booking row | Leak |
|------|------|-------------------|------|
| Picked a date (Lane B) | 63 | **14** | **49 dated jobs paid and still produced no booking row (78% of the "happy path")** |
| Flexible / no date (Lane A) | 36 | **0** | by design — no lock; waits on the dormant engine |
| **Total** | **99** | **14** | **85 leaked (86%)** |

Three hard facts from the data:
1. **`booking_slot_locks` currently holds 0 rows** — the gate the whole booking path depends on is transient and presently empty.
2. **All 14 booking rows came from the `confirmBooking` (slot-lock) path** (14/14 have a job sheet). **Manual dispatch has created 0 rows** — the human fallback is effectively unused.
3. **The earliest booking row is dated 2026-05-25**, but paid jobs go back to **2026-02-03**. So the slot-lock→booking path only began working ~late May; every paid job before then leaked 100%.

### One-sentence cause
> A paid deposit becomes a booking **only if the customer reserved a slot-lock at checkout**; that lock-reserve flow went live ~25 May, covers only one quote path, never fires for the flexible lane, and the manual/auto fallbacks that should catch the rest are unused or dormant — so 86% of paid jobs never enter the system of record.

### Backfill reconciliation (2026-06-28) — the 85 are NOT live pending work
Running the §4.4 reconcile (`scripts/dispatch-backfill.ts`, dry-run) over the 85 leaked jobs reclassified them precisely. **They are mostly already-closed work, not a pending backlog:**

| Reclassified state | Count | Meaning |
|--------------------|-------|---------|
| **Completed without a CBR** | **74** | `completed_at` set via the manual admin button `POST /api/quotes/mark-complete` (`invoices.ts:787`) — the **only** writer of that column. It does NOT advance lead stage, write a CBR, or create a payout. So these jobs were **fulfilled and closed by hand, entirely outside the pipeline.** Includes **all 49 "dated leaks"** + 25 flexible. Never auto-book (would book a done job). |
| Active flexible — true pending pool | **11** | 4 need an SLA clock persisted (display already defaults to 7d), 4 already have it, 3 mid slot-offer. |
| Active dated — true pending | **0** | There is **no** dated pending backlog to auto-assign. |

**Implications:**
- The "86% leak" is real as a *system-of-record* gap, but it is dominated by **manual close-out** (74 jobs done off-pipeline), not unbooked pending demand. The live pending pool is **11 flexible jobs**.
- This sharpens line 59 from inference to measured fact: jobs really were "fulfilled outside the system of record — by hand." The 74 are a **payout-reconciliation** question (done, but no `contractor_payouts` row — contractors likely paid offline too), *not* dispatch work.
- The §4.1/§4.2 auto-assign wiring still matters — it stops **future** dated payments from needing manual close-out — but there is no historical dated backlog for it to drain.

---

## 3b. There is no end-to-end pipeline as a connected thread

We asked: before optimising dispatch, do we have an end-to-end pipeline from quote to invoice? We checked the code **and** the live data. Answer: **every stage exists in code, but production runs them as three disconnected islands — the continuous spine has never carried a single job from quote to paid-off invoice.**

| Stage | Built in code? | Live reality (data) |
|-------|----------------|---------------------|
| Quote → deposit → **invoice** | Yes — `invoices.quote_id`, tracks `deposit_paid` / `balance_due` | **Alive on its own track:** 176 invoices (51 paid · 76 overdue · 33 draft · 13 sent · 3 void). Generated off the *quote*, not the job. |
| **Booking → dispatch** | Yes — `contractor_booking_requests` canonical | **14 rows, ALL `scheduled`. 0 completed.** (the 85% leak) |
| Job-lifecycle → **balance invoice → payout** | Yes — `server/job-lifecycle.ts`: en_route→arrived→in_progress→complete→`generateBalanceInvoice`→`contractor_payouts` | **Never fired once:** 0 completed jobs, **0 payouts**, 0 variation orders. |

### What this means
- The 176 invoices come from a **separate quote-based invoice track**, NOT from job completion. So "we have invoicing" is true — but it's not connected to dispatch or job delivery.
- The job-lifecycle spine (the part that turns a *scheduled* job into a *finished, fully-invoiced, contractor-paid* job) **has zero throughput in production.** Not one job has travelled it.
- **Dispatch is the middle link of a chain whose two ends don't connect.** Optimising it now polishes the centre of a broken thread.
- The 85% booking leak is therefore not only a "dispatch can't see jobs" problem — it starves the **entire downstream half of the business** (completion, balance invoicing, contractor payout), all of which is anchored on the booking table 85% of paid jobs never reach.

### Decision
**Before any dispatch optimisation, prove ONE real job travels the full spine end-to-end:** quote → deposit → canonical booking row → lifecycle (en_route…complete) → balance invoice → contractor payout. We are not building a new pipeline (the parts exist); we are connecting and proving the one we have. This **subsumes and replaces** the earlier "close the write-path leak" framing of Phase 1 — same fix, bigger lens.

---

## 4. The flex promise — undefined, uncaptured, and gating everything

This is the part Courtney flagged as the precondition: *"we need to be sure on the flex promise and ensure users know exactly what this is before we build around it."* The data proves the concern.

### The two lanes (as built)
- **Lane A — Flexible / no date chosen** → drops into a "pending dispatch" pool. The optimiser is *supposed* to harvest this flexibility for routing density and margin.
- **Lane B — Customer picks a date** → atomic slot reservation → instant auto-assigned booking → writes `contractor_booking_requests`. **This lane is wired end-to-end.**

### What the customers actually did
Of the 95 paid jobs:
- **63 picked a date** (Lane B)
- **32 went flexible / no-date** (Lane A — the pool the whole optimiser thesis depends on)

### The problem
- Only **2 of 95** carry a structured `flex_tier`. Only 7 carry a flex window.
- `scheduling_tier` is **null on 99 of 99** sampled.
- The Priority / Flex / Relax structure exists in code and is **essentially unused and uncaptured in production.**

**So:** the flexibility we plan to monetise (density flywheel, "when we're passing" discounts, route-impact pricing) is **not being recorded**, and the customer is **not being shown a clear, distinct promise** for choosing it. We would be building an optimiser on top of a promise that neither the system nor the customer has actually agreed to.

### Decision
**Define the flex promise as a product before building the engine that depends on it.** Concretely, before any optimiser work:
1. Write the customer-facing definition of each flex option in plain words ("what you give up, what you get, by when").
2. Make the booking flow *capture* the chosen tier on every booking (kill the null).
3. Only then point the optimiser at the flexible pool.

The flex promise is the **load-bearing wall**. The optimiser is the roof. We are not putting the roof on first.

---

## 5. Tweak vs rebuild — the council verdict

The council (Contrarian, First Principles, Expansionist, Outsider, Executor → peer review → chairman) converged on:

**Partial rebuild, framed as consolidation — not a from-scratch rewrite, not a cosmetic tweak.**

Specifically:
1. **Settle the source of truth first** (this document + the write-path fix). Nothing else is trustworthy until then.
2. **Narrow the cockpit to exceptions.** The human-facing board should surface only: (a) reactive same-day exceptions (~10%), and (b) the flexible pool awaiting placement. Not every job. Stop building a manual board for the 90% the machine should own.
3. **Wire the dormant engine to *propose*.** `smart-planner-engine.ts` is currently a read-only daily-planner view. Promote it to generate placements the human confirms (co-pilot model).
4. **Re-aim the optimiser forward — to offer/quote time, not dispatch time.** The leverage is in shaping the *offer* (which dates/tiers we present and price), not in re-sorting jobs after they're sold.
5. **Keep promise-kept as the product goal, margin-per-day as the constraint** — but treat both as *not yet measurable* until §3 is fixed.

---

## 6. Sequenced roadmap

Ordered so each step de-risks the next. **Do not skip ahead — every later step assumes the earlier ones are true.**

### Phase 0 — Lock the foundation (no customer-visible change)
- **0.1** Ratify this document (done by writing it).
- **0.2** Commit the uncommitted cockpit code (Phase-2 `BundledJobCard` + drag-drop) **behind an off-by-default flag.** Zero-risk: gets work-in-progress safely into version control without changing live behaviour.
- **0.3** Quarantine `v2Bookings` (mark dead in code + schema notes) so nobody builds on it by accident.

### Phase 1 — Prove the end-to-end spine (the real first job)
The goal is one real job carried the whole way, then made automatic. Optimisation is meaningless until this thread is unbroken.
- **1.1** Instrument: log every paid deposit and assert a `contractor_booking_requests` row is created. Alert on the gap.
- **1.2** Fix the path so **paid ⇒ canonical booking row, always** (target the 85% leak). This is what makes any metric trustworthy.
- **1.3** Drive **one** real job through the full lifecycle in production: en_route → arrived → in_progress → complete → `generateBalanceInvoice` → `contractor_payouts`. Confirm each row lands. Today this has fired **zero** times.
- **1.4** Reconcile the two invoice tracks: the quote-based invoice (176 rows) vs the lifecycle balance invoice. Decide which is canonical for which stage (deposit vs balance) so they stop being independent islands.
- **1.5** Backfill / reconcile the historical 81 missing paid jobs where data allows.

### Phase 2 — Define & capture the flex promise (the gate)
- **2.1** Write the plain-words customer definition of each flex option (Priority / Flex / Relax — or whatever survives this exercise).
- **2.2** Make the booking flow capture `flex_tier` + `scheduling_tier` on every booking (kill the nulls).
- **2.3** Show the customer exactly what each option means at the moment they choose.

### Phase 3 — Co-pilot the dispatch
- **3.1** Narrow the cockpit UI to exceptions + flexible pool only.
- **3.2** Promote `smart-planner-engine.ts` from read-only view to proposer (AI proposes, human confirms).

### Phase 4 — Re-aim the optimiser forward
- **4.1** Move optimisation to offer/quote time (which dates + tiers we present and price), powered by the now-captured flex data.
- **4.2** Turn on margin-per-day and promise-kept dashboards — now trustworthy because Phases 1–2 are done.

---

## 7. Open questions / what this doc does NOT yet decide
- Exact names and SLAs of the flex tiers (Phase 2.1 output).
- Whether `contractorJobs` legacy data is migrated or just frozen.
- Pricing mechanics of "when we're passing" / route-impact discounts (depends on Phase 4 data).

---

## 8. One-line summary
> Dispatch's job is paid-deposit → contractor-at-the-door, profitably. Today only ~15% of paid jobs reach the canonical booking table and the flex promise is undefined and uncaptured — so **fix the write-path and define the flex promise before building any optimiser or metric on top of them.**
