# Business Roadmap — H2 2026

**Written:** 2 July 2026
**Status:** Active — supersedes strategic direction in ROADMAP_STRATEGY.md where they conflict.

---

## The Fundamental Decisions (locked 2 July 2026)

| Decision | Choice |
|---|---|
| End goal | **Prove one city, then replicate.** Nottingham becomes a systems-run, owner-optional operation with strong margins; city two only after that's demonstrated. |
| Delivery model | **Hybrid.** 1–2 core trained techs (employed or exclusive subcontract) for the bulk of work + a smaller, vetted overflow contractor pool, paid through the platform with performance-gated rates. |
| Recurring revenue | **Deferred.** No care plans / subscriptions until delivery can reliably keep the promise. Gated behind delivery metrics (see Phase 2 gate). |
| Productization | **Stay bespoke.** Contextual AI quoting remains the core motion. SKU catalog is a pricing reference, not the funnel. Revisit at the Phase 2 gate. |

### The one tension to manage
Replication is easiest with productized delivery; we chose bespoke. The mitigation is to
proceduralize at the **visit level** (how every job is arrived at, documented, signed off,
and escalated) rather than the job level, and to run a **quote-vs-actual feedback loop**
so bespoke quoting gets more accurate over time. If visit-level procedures prove
insufficient to train delivery, the productization decision gets reopened at the
Phase 2 gate — not silently, explicitly.

### Operating principle
The demand machine (calls → AI quotes → conversion) is already top-1% for the trade.
Every phase below is about making the **delivery side** worthy of it. We beat the
industry where it fails hardest: showing up, finishing, communicating.

---

## Phase 0 — Stop the Bleeding (now → mid-July)

Small, fast, data-first. No structural change yet.

1. **Ben conversion study.** Pull viewed→paid conversion by week (test data scrubbed),
   segmented by lead source and response time. Overlay the dates of (a) the UI changes
   and (b) Ben settling in. Output: which variable moved, with evidence.
2. **Ben metrics regime.** Instrument in the switchboard: first-response time,
   follow-up cadence per lead, quote-sent-within-X-minutes, personal conversion rate.
   Weekly one-pager, reviewed together. Targets agreed with Ben, not imposed silently.
3. **Revert/fix any UI change the study convicts.** Conversion regressions are P0.
4. **Job failure audit.** List the last ~20 jobs that "didn't go to plan." Tag each:
   quote inaccuracy / contractor no-show or quality / overrun / communication.
   This is the baseline the delivery fix is measured against.

**Exit criteria:** Ben dashboard live; conversion regression explained and addressed;
failure baseline documented.

---

## Phase 1 — Fix Delivery (mid-July → end September)

The structural quarter. Everything else is subordinate.

### 1.1 Core techs
- Define the core-tech deal: guaranteed weekly volume, platform payment, uniform,
  standards — in exchange for training, procedures, and exclusivity on our jobs.
- Recruit or convert from the current pool: **1 core tech by mid-August, a second by
  end September** (second gated on demand supporting it).

### 1.2 Contractor pool restructure
- Score the current pool on the failure audit. Cut to the best 3–5.
- **All payment moves through the platform.** No more ad-hoc bank transfers.
  (Stripe rails already exist; add contractor payout flow.)
- Performance-gated rates: reliability tier determines rate and job priority.
  We stop paying premium rates for zero commitment.

### 1.3 Visit-level procedures (the training layer)
One-page standard for every visit, regardless of job type:
- Before: job sheet reviewed, materials confirmed, ETA sent to customer automatically.
- On site: arrival photo, scope confirmation against the quote, overrun protocol
  (flag before exceeding, never after), completion photos, customer sign-off.
- After: photos + notes into the system same day; triggers invoice.
Build the lightweight tooling for this into the contractor flow (job sheets exist;
add the checklist + photo capture + overrun flag).

### 1.4 Kill the human comms layer
- Automated customer status updates at each visit stage (booked → ETA → on site →
  complete) so Courtnee is no longer the switchboard between customer and contractor.
- Escalations only reach a human when the protocol flags them.

**Exit criteria:** ≥70% of job volume delivered by core techs or top-tier pool;
100% platform payments; visit procedure followed on >90% of jobs;
owner comms time measurably down.

---

## Phase 2 — Margin & Repeatability (October → December)

### 2.1 Quote-accuracy loop
- Log actual time/materials against every quote. Weekly report: quoted vs actual
  by job category. Feed corrections back into the contextual pricing engine.
- Target: overrun-driven margin leakage cut by half vs the Phase 0 baseline.

### 2.2 Operating manual
- Document how the business runs: lead → quote → book → deliver → invoice → review,
  with the metrics that govern each stage. This is the replication asset —
  city two runs on this document plus the software.

### 2.3 Owner-optional test
- One full week where Courtnee touches nothing operational. Everything that breaks
  goes on the Phase 3 fix list.

### 2.4 THE GATE (end of Q4)
Reopen the two deferred decisions with data:
- **Recurring revenue:** if ≥90% of jobs completed on-time/on-quote for 8 consecutive
  weeks → green-light landlord/PM care plans (segments and marketing already built).
- **Productization:** if visit-level procedures + quote-accuracy loop have NOT fixed
  delivery consistency → commit to the top-10 SKU rebuild from the productization
  research (87% of line items / 89% of revenue cluster into ~50 SKUs).

**Exit criteria:** quote-vs-actual loop running; operating manual v1; gate decisions
made and recorded here.

---

## Phase 3 — Recurring Revenue & Replication Prep (2027 H1)

Shape depends on the Phase 2 gate, but the default plan:

1. Launch landlord/PM care plans (priority response, photo reports, tax-ready
   invoicing) to the existing customer base first. Target: 100 properties under
   plan by mid-2027.
2. Second owner-optional test — two weeks.
3. City-two criteria: demand test (run the demand machine against a candidate city's
   search volume before committing anything), core-tech-first hiring, operating
   manual as the onboarding.

---

## What we are explicitly NOT doing (until the gate says otherwise)

- Selling subscriptions or care plans before delivery earns it.
- Rebuilding the SKU catalog.
- Opening city two.
- Adding new demand channels — the constraint is delivery, not leads.

---

## Scoreboard (reviewed weekly)

| Metric | Baseline (Phase 0) | Target |
|---|---|---|
| Viewed→paid conversion | from Ben study | recover to prior peak |
| Ben first-response time | from instrumentation | agreed SLA |
| Jobs on-time & on-quote | from failure audit | ≥90% |
| % volume via core techs / top tier | 0% | ≥70% |
| % contractor payments via platform | ~0% | 100% |
| Owner operational hours/week | honest estimate | trending to 0 |
| Quoted-vs-actual variance | from loop | −50% leakage |
