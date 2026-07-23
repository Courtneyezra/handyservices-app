# Delivery & Job-Allocation Roadmap

_HandyServices · 21 Jul 2026 · builds on [CONTRACTOR_PAY_MODELS_RESEARCH_2026-07.md](CONTRACTOR_PAY_MODELS_RESEARCH_2026-07.md), the contractor-platform work, and the auto-assignment design._

## The problem, stated plainly

You own demand (marketing + AI quoting) but **cannot reliably deliver** the work you sell. Concretely, today:

- **No synced calendar with Craig** → allocation is blind and manual; the quote picker's availability is dry.
- **No pay agreement** → Craig is a handshake, not a committed node; can't build a system on it, and it's an employment-status risk.
- **No training / quality standard** → reliability-per-promise is unmanaged; can't safely add strangers.
- **Too few skilled handymen** → single point of failure; multi-person and multi-trade jobs are unbookable (your known "£1k+ closes at 14%" weak spot).

## Sequencing principle

**Terms → Visibility → Pool → Allocation → Scale.** You can't allocate what you can't see, to people who haven't agreed terms, at a quality you haven't defined. The auto-assign engine is Phase 3, not Phase 1 — it's worthless without committed nodes and live availability feeding it.

**Build the onboarding primitive once.** Every handyman (Craig included) needs the same three things: (1) signed terms, (2) captured availability, (3) a job standard to hit. Make each a reusable template in Phase 0 so every subsequent hire is a copy-paste, not a project.

---

## Phase 0 — Make Craig a solid node (THIS WEEK)

Nothing downstream works until your one real contractor is papered, visible, and to-standard. Three deliverables:

### 0.1 Pay agreement (unblocks the £-rate placeholder that's been blocking everything)
- **Model:** fixed **piece-rate on your AI-set prices** + a **weekly volume commitment** as his income floor (research option (a): priority subcontractor). This satisfies all three instincts and dodges every Aspect failure mode (no deductions, no overcharge incentive, no unpaid-travel trap — travel priced into the job).
- **Status fork (decision you owe):** Craig is your Core lead who will *manage others and order materials* — both employment-status flags. Two legitimate lanes:
  - **(a) Papered self-employed BFSC + volume commitment** — genuine substitution right, own tools, own insurance, invoices per job, no method control. Fastest, lowest commitment. **Recommended for MVP.**
  - **(b) Employed PAYE site-lead** — the honest home for managing + materials + full control. Higher cost/commitment; the right end-state for reliability-per-promise. Graduate to this once volume justifies fixed cost.
  - _Do not straddle_ (control like an employee, pay like a contractor = the Pimlico trap).
- **Set the actual £ numbers.** Nottingham/Midlands anchor: handyman £30–50/hr, day £180–280, region ~20–35% below London. Price per-job rates so a good handyman clears a competitive **effective** hourly after travel/deadtime. This one number has been the blocker on `/join` and the ad-hoc agreement too — set it once, reuse everywhere.

### 0.2 Calendar / availability sync
- **v1 (this week, lowest build):** put Craig's availability into the system via the existing **`/admin/availability-mobile`** tool (or a shared calendar he updates). The quote picker reads per-contractor overrides/weekly patterns — so give Craig a **weekly pattern + override capability**. This alone fixes the "calendar dry past hand-entered dates" problem.
- **v2 (Phase 3):** two-way Google Calendar sync so it's zero-effort for him.

### 0.3 Job standard (seed of the quality system — not a training program yet)
- One page: **"a Handy Services job done right"** + a **photo-proof checklist** (you already do photo reports). Craig confirms against it per job.
- This is the reusable quality primitive every future handyman inherits.

**Exit criteria:** Craig has signed terms, live availability the picker can read, and a job standard. He is now a real node.

---

## Phase 1 — Make allocation real for a roster of 1–3 (WEEKS 1–4)

Get the **manual** loop clean and logged before automating anything (manual-first, then tech).

- **Feed availability** from Craig (+ Bezent/Joe as they onboard) so the quote picker offers real slots, not guesses.
- **Soft-assign at quote generation, hard-assign at deposit** — a quote must never be generated into a contractor void. Apply the **steer-then-compose** fix so multi-trade quotes don't hit zero-pool and become unbookable.
- **Job-complexity routing** (from the complex-jobs design): tag each job `solo-light` / `solo-materials` / `multi-loose` / `multi-managed`. Solo/light → ad-hoc pool; complex/managed → Craig-led.
- **System of record:** run dispatch off the **`JOB-PLANNING-BOARD`** (already exists) — Ben/ops assigns manually, every job logged. No auto-assign yet.

**Exit criteria:** every sold job maps to a named contractor + a real slot, on a board, with complexity tagged.

---

## Phase 2 — Recruit the skilled pool (WEEKS 3–8, parallel to Phase 1)

You need 2–3 more Nottingham handymen. The onboarding primitive from Phase 0 makes each hire cheap.

- **Finalize `/join` + `CONTRACTOR_ADHOC_AGREEMENT.md`** with the £ rates set in 0.1 (same blocker, now cleared).
- **Onboard ad-hoc / per-job only** first; defer core day-rate until papered + costed (existing MVP decision).
- **Gate before job 1:** vetting + insurance-of-record (council verdict). Non-negotiable.
- **Sourcing:** warm referrals + **£100 bonus per 3 clean jobs**.
- **Payout leg is the #1 operational risk** → start with **manual same-day transfer**; don't block launch on automated payouts.
- Each new hire gets the Phase-0 triad: terms, availability capture, job standard.

**Exit criteria:** ≥3 active, vetted, insured, papered handymen with live availability.

---

## Phase 3 — Auto-assign + delivery OS (WEEKS 6–12, once pool ≥3 and data flowing)

Now the engine has something to work with. **Automate assignment, not availability.**

- **Deterministic auto-assign engine + slack governor** (hold slack before scoring); right-size to a small roster (filter + pick, not an optimizer).
- **Backups as a tap-to-accept pool** for declines/no-shows.
- **Consolidate booking flows** — make `contractorBookingRequests` the single source of truth; retire the parallel path.
- **Materials system:** company trade accounts (Screwfix/Toolstation/Travis Perkins) + capped company-card draw; materials + markup as a line in the AI quote. Handyman never fronts cash; you own spec + margin.
- **Human-in-loop pricing for £1k+ / complex jobs:** a Core lead validates the AI quote before commit (you eat overrun on a company-priced piece rate, so guard the big ones).

**Exit criteria:** a sold job auto-assigns to a live, available contractor without manual dispatch for standard jobs.

---

## Phase 4 — Scale & retention (ONGOING)

- **Graduate** proven ad-hoc → Core (volume commitment, then PAYE lead where warranted).
- **Retention = your anti-Aspect edge:** consistent work (your demand asset), fixed no-deduction pay, no quoting burden, self-scored promotion ladder. Every Aspect grievance (deductions, padding pressure, unpaid travel, feast/famine) is a thing your model structurally avoids — make that the recruiting pitch.
- **Partner tier / recurring** revenue once delivery is proven (behind the delivery gate).

---

## Critical path & dependencies

```
0.1 Pay agreement (£ rates) ──┬──> 2. Recruit (/join needs the rates)
                              └──> 0.2 Calendar ──> 1. Manual allocation ──> 3. Auto-assign ──> 4. Scale
0.3 Job standard ─────────────────────────────────> (inherited by every hire)
```

**The single unblock that moves everything: set the £ rates in 0.1.** It gates the pay agreement, the `/join` page, and the ad-hoc agreement simultaneously. It has been the standing blocker — clear it first.

## Decisions you owe (before Phase 0 ships)

1. **Craig: self-employed BFSC-with-volume-commitment (recommended MVP) or PAYE site-lead?**
2. **£ piece-rate + weekly floor numbers for Nottingham** — the master blocker.
3. **Calendar mechanism v1:** existing mobile availability tool (recommended, lowest build) vs. shared Google calendar.

## What to build vs. buy vs. do-by-hand (first 4 weeks)
- **By hand:** dispatch (JOB-PLANNING-BOARD), payouts (same-day transfer), availability entry.
- **Build (small):** Craig's weekly-pattern + override in availability tool; complexity tag on jobs; soft-assign-at-generation wiring.
- **Defer:** auto-assign engine, two-way calendar sync, materials automation, payout automation — all Phase 3+.
