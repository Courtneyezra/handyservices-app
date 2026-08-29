# Delivery Dispatch Engine — Build Plan

_Scope: turn today's blind, on-arrival `assignFromPool` into a server-side dispatch
engine that puts Craig first, guarantees flex, and packs days geographically —
monitorable and overridable, tuned by settings not code._

Grounded in the July 2026 simulation on 313 real jobs (see the "Density Crossover"
artifact). Companion to `OPERATING_MODEL_2026-07.md` and the contractor-platform PRD.

---

## Why (what the sim proved)

- **Definite (pick-a-day) bookings** are safe today — they hard-commit and pack around
  existing work. Keep that path; it becomes the "anchor" case.
- **Flex bookings** are where it breaks: `assignFromPool` picks blindly on arrival —
  no availability/capacity guard, and it flattens multi-day jobs to one day.
- **Cluster-first packing** roughly halves the days single-slot work needs (2.6 vs
  1.2 jobs/day in isolation) and gets *stronger* as volume grows.
- **Flex degrades at scale** — past ~60% roster utilisation, miss-rate spikes. The
  fix is admission control + ranked overflow, not more optimism.
- **The flex window is the Craig-maximisation dial** — stretching 14d→42d cuts the
  share Craig can't personally take from ~34% to ~11% at today's volume. Longer
  window = more work held on Craig before anyone else is touched.
- **£/day (~£190–245) is bounded by job value, not routing** — packing is a
  multiplier, not the lever that hits the day-rate promise.

**Operating principle: Craig first, across a dynamically-extendable window, everyone
else last.**

---

## Behavioural contract (decided with owner, 29 Jul 2026)

- **Autonomy — Hybrid.** Engine auto-commits jobs that fit Craig cleanly in the
  window; overflow, multi-day and conflicts pause on the Dispatch Board for approval.
- **Availability truth.** Craig maintains his weekly pattern + day-off overrides in
  the my-week app; the engine trusts it. _Prereq: Craig must actually enter it —
  today contractors have none, so the engine would schedule into a blank calendar._
- **Assignment timing.** Soft-assign at quote **generation** (presentational only —
  Craig's skin, NO capacity reserved). Hard-assign at **deposit** (Dispatch created,
  admission control runs, slot reserved, overflow decided).
- **Skin honesty — soft feasibility gate.** Craig's skin is applied at generation
  only if a quick check says he can plausibly fit a 2-week window at current load;
  else Handy-generic. Handy remains principal, so substitution stays legitimate.
- **Flex = the 2-week window IS the promise.** The customer books "within 2 weeks,"
  not a specific date; the engine uses that window to build day-packs; the exact day
  is firmed up and messaged as packing settles.
- **Overflow ladder (Craig-first, customer-consented extension):**
  1. Fits Craig in the window → auto-commit.
  2. Won't fit → flag admin on the board + compute Craig's earliest date *beyond* the window.
  3. **Ask the customer to choose:** wait a bit longer for Craig (new date), OR another
     Handy tech inside the original 2 weeks.
  4. Only if the extension is declined → cascade to core #2 (Bezent/Joe) → pool.

---

## Architecture

### 1. Server-side authoritative engine
All scheduling decisions live server-side. The engine owns capacity truth, runs
deterministically, and is the only writer of bookings. Craig's app and the admin
board render engine state; they never compute placement. Replaces the three
disagreeing capacity models with **one `dayCapacity()`** used by display, packer,
and booking gate alike.

### 2. The Dispatch — a first-class, monitorable, overridable record
One `dispatch` row per accepted job. It carries the job through a visible lifecycle:

```
RECEIVED ─▶ RESERVED ─▶ PACKED ─▶ COMMITTED ─▶ COMPLETED
(deposit)   (guaranteed  (geo    (locked on   (done → invoice
            fallback     day-pack contractor)  → prize → review)
            slot held)   formed)
                └─▶ OVERFLOWED (to ranked backup: core #2 → pool)
```

- **RESERVED** = admission control has secured a worst-case fallback slot on Craig
  inside the window — the booking is *guaranteed* the moment it's sold.
- **PACKED** = cluster-first has provisionally co-located it into a tighter day
  (reserve-then-repack: the fallback is only ever improved on, never gambled).
- **COMMITTED** = locked; pay snapshot written; appears in Craig's week.
- **OVERFLOWED** = only when the (extended) window can't fit Craig → ranked backup.

Every transition is logged; the whole board is human-in-the-loop.

### 3. Settings (DB-backed, admin-editable)
A `dispatch_settings` record, no deploy needed to change:

| Setting | Default | Purpose |
|---|---|---|
| `flexWindowDays` | 14 | Base window a flex job can wait |
| `flexWindowMaxDays` | 42 | Ceiling the engine may auto-extend to before overflowing |
| `commitBufferDays` | 2 | Force-commit when deadline this close |
| `craigFirst` | on | Rank Craig ahead of other core before pool |
| `dayCapacityMinutes` / `maxStopsPerDay` | 450 / 4 | Per-contractor day ceiling |
| `poolEnabled` | on | Allow ad-hoc overflow (off = core-only) |
| `contractorRank` | [Craig, Bezent, Joe] | Overflow order |

---

## Build phases (each independently shippable + testable)

### Phase 0 — Correct the foundation
- **Fix `assignFromPool`:** span-aware (write real `durationDays`/`scheduledDates`),
  add the availability + hours/itinerary guard it lacks today.
- **Unify the capacity model** into one `dayCapacity()`; delete the 480/4 vs 408/3
  vs reserveSlot divergence.
- _Acceptance: multi-day pool jobs reserve all their days; no silent overbook._

### Phase 1 — Real travel truth
- Geocoded **drive-time matrix** (cached), replacing flat 20/45-min hops.
- Travel-aware (endogenous) day capacity.
- _Acceptance: a day's fit reflects the actual route, not outcode labels._

### Phase 2 — The Dispatch entity + settings
- `dispatches` table + lifecycle state machine; `dispatch_settings` config.
- Engine service: accepted quote → dispatch → policy tick (rolling horizon).
- _Acceptance: every accepted job is a dispatch with a status and a reserved slot._

### Phase 3 — The scheduling brain
- **Admission control:** Craig-first across the window; reserve worst-case fallback
  (guarantee); auto-extend toward `flexWindowMaxDays` before overflow.
- **Cluster-first packing:** coalesce buffered flex into geo day-packs; reserve-then-repack.
- **Ranked overflow:** other core → pool, only when the extended window can't fit.
- _Acceptance: reproduces the sim — Craig absorbs the max, overflow is last resort._

### Phase 4 — Monitor & override (Dispatch Board)
- Admin view: every dispatch, its state, reserved slot, current placement, wait,
  overflow flag; the "approaching saturation / need core #2" alert from the sim.
- **Overrides:** pin to date/contractor, force to pool, extend this job's window,
  hold/release, manual place — all re-validated by the engine.
- _Acceptance: ops can watch and intervene on any job without touching code._

---

## Out of scope (later)
- Redemption engine for prize-wheel credits (currently a manual completion note).
- True MILP/OR-Tools optimiser — the greedy cluster is enough at this scale; revisit
  when a single city clears ~2× today's volume.
- Multi-trade team auto-splitting on the pool paths.

## The signal to add core #2
When Craig's utilisation holds ~80%+ and overflow stays high **even at the 42-day
window** — around ~1.5× today's volume. Until then, the window is the throttle that
keeps the work on Craig.
