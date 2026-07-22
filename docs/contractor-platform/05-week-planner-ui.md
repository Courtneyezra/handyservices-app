# Week Planner — mobile UI design plan

> The contractor app's next evolution: the day builder harvested inside a
> **week planner**, designed mobile-first for Craig's phone (375px, dark).
> Builds on the shipped surfaces (04-contractor-app.md). Status: DESIGN —
> build starts after the span-reconciliation task lands.

## Design principles (locked by what's already working)

1. **One screen, one question.** Week tab asks *"what is my week?"* — supply
   AND plan on one surface. Jobs tab stays the queue/detail view. Never mix
   questions on a screen.
2. **Bold states, no subtle tints.** Solid colour blocks carry meaning:
   **blue = booked** (immovable promise), **emerald = open/money**,
   **amber = needs a decision**, **red = deadline risk**, near-black = off.
   Ghost (dashed emerald) = proposed-not-committed. (Founder taste:
   bold over subtle — no washed-out callouts.)
3. **Money-forward.** Every card leads with £. The week reads like a payslip.
4. **Two-tap commit, everywhere.** Tap → button becomes the confirmation →
   tap again. No modals for money actions. (Already the app's signature.)
5. **Reasons in words, never scores.** "pairs with your NG16 job that day",
   "backs onto booked work" — the optimiser explains itself in one clause.
6. **Thumb zone.** Primary actions in the bottom half; nav at bottom; sheets
   slide up; sticky lock bar sits above the nav.

## Information architecture (nav unchanged: Week · Quotes · Jobs · Profile)

| Surface | Question it answers | Content |
|---|---|---|
| **Week tab** | What is my week? | Payslip header + grid (now with GHOST proposals) + usual-week pattern |
| **Plan sheet** (full-screen takeover from Week) | What *should* my week be? | Goal pills → 7 day-rows → sticky "Lock my week" |
| **Jobs tab** | What's in my queue? | Needs-a-day cards (chips + block starts) + booked list — the existing day builder detail |
| Quotes / Profile | unchanged | |

## Screen specs

### 1. Week tab — payslip header (new)
Directly under Craig's name:

```
This week   £1,479 booked  ·  £710 ready to add     [ Plan my week → ]
```
- Booked £ solid white; "ready to add" emerald; counts up on change.
- The CTA appears only when the pool has ≥1 placeable job. Tapping it —
  or tapping any ghost cell — opens the Plan sheet.

### 2. Week tab — grid gains a GHOST state
Day cells today: open / booked(×N) / off / past. Add:
- **Ghost** — dashed emerald border, faint `+£710` under the date. Means
  "the planner proposes work here; nothing committed."
- Tap a ghost → mini bottom sheet: job line (£, area, one-line desc, slot)
  with **[ Add to my day ]** (two-tap) and *"see the full plan →"*.
- Locked proposals fill solid blue with a spring animation — the moment of
  "my open day became money" is the emotional core of the app; spend the
  animation budget there.

### 3. Plan sheet — the Week Planner (new, full-screen)
Slide-up takeover, own scroll, X to dismiss.

- **Header:** week switcher (`This week · Next week`) + goal pills:
  **Best week £** · **Fewest days** · **Done soonest** (week-level goals —
  replaces the day-level pills; same engine presets underneath).
- **Body: 7 day-rows, Mon→Sun.** Each row = date chip (reuses grid cell
  colours) + content:
  - *Booked anchor:* solid blue card — `Beth · 9–6 · £579` (+ `Day 1 of 2`
    tag on spans).
  - *Proposed pack:* stacked ghost cards — `AM · door lock · NG8 · £60`,
    each with its reason clause. Row footer: `[ Lock this day · £258 ]`.
  - *Block segment:* ONE tall card visually bracketing its rows —
    `Nasreen · £1,903 · runs Mon→Wed`, single lock for the whole span,
    `needs a start by Tue 4 Aug` in amber.
  - *Open-empty:* quiet prompt — `open · nothing fits yet`.
  - *Off:* dim row with **[ Open this day ]** inline — HARVEST INSIDE THE
    PLANNER. This is the coaching moment: `Open Thu to fit the £381
    extractor job before Sat` (residual report as one amber line, only when
    true, max one per week).
- **Sticky bottom bar** (above nav): `[ Lock my week · £2,613 · 4 days ]` —
  primary emerald, two-tap, walks every placement through the existing
  place paths sequentially (all guardrails re-run; partial failures report
  per job, plan re-ranks).

### 4. Jobs tab — unchanged role, two adjustments
- The "Build my days" panel is REPLACED by the payslip CTA (planner owns
  composition now); needs-a-day cards + block-start chips stay as the
  per-job manual path.
- Overdue jobs get a pinned red edge-strip at the top of the tab.

## States & edge cases

| State | Treatment |
|---|---|
| Empty pool | No CTA, no ghosts — Week tab is pure harvest (today's app) |
| Pool but zero open days | Payslip: `£710 waiting — open days to take it` (amber) |
| Overdue job | Red strip on Jobs + red deadline line in planner rows |
| Engine rejects a lock | Inline red clause on the card + automatic re-rank (existing pattern) |
| Multi-day job, no run of open days | Block card shows `needs N days in a row` + which days would complete a run |
| Team provider (future) | Same layouts; capacity numbers read from `providerCapacity(profile)` — day-rows show `2-person day · 16h` |

## Component inventory

**Reuse:** day cell, bottom sheet, two-tap chip, count badge, nav, framer
spring. **New:** payslip header, ghost cell state, plan day-row, block span
bracket, sticky lock bar, coaching line.

## Build phases (each = verify-in-preview + commit)

- **P0 — week-plan endpoint** (after the span task lands): blocks-first →
  fillers → residual report + payslip numbers. One response feeds header,
  ghosts and sheet. Fold in the `providerCapacity(profile)` helper so the
  planner is born team-ready.
- **P1 — Plan sheet:** day-rows, goal pills, per-day + per-block locks.
- **P2 — Week-tab integration:** payslip header, ghost cells, lock-my-week.
- **P3 — Coaching:** open-this-day prompts from the residual report;
  "lock now vs wait" line when the pool is thickening.

Verification per phase: mobile preview at 375px, screenshot every state
(empty / pool-no-days / ghosts / confirm / locked / overdue), real-pool dry
run read-only, synthetic lock test scrubbed after.
