# ADR-003: Contractor Segmentation

## Status
Accepted

## Context

Contractors are not homogeneous. A 55-year-old retired sparky moonlighting for beer money wants a fundamentally different product than a 28-year-old generalist trying to grow their book and fill a five-day week. Today's model treats them identically — one feed, one pay model, one UX — which wastes supply economics and degrades both contractor experience and dispatcher leverage.

Three behavioural archetypes emerged from market research interviews and dispatcher observation:

- The contractor who wants steady, predictable work and would commit days in advance for a guaranteed pipeline
- The contractor who already has their own book of work and takes occasional jobs to plug diary holes
- The certified specialist (Gas Safe, Part P, structural) who only does cert-gated work, at premium rates, and rejects general handyman jobs

These map cleanly onto three distinct products: a day-pack offer, a single-job offer, and a cert-queue. Each has different routing logic, different pay psychology, and different UX. Forcing them through one funnel collapses signal that's worth preserving.

## Options Considered

**Option A: No segmentation.** One feed, contractor self-selects. Status quo.
- Pros: Simple, no migration, no onboarding friction.
- Cons: Misses optimisation. Builders get spammed with Gap-Filler scraps and lose interest. Specialists waste time filtering generalist work. No way to calibrate pay protection per supply type.

**Option B: Self-declared at signup, behaviour validated over time.** Contractor picks their type during onboarding; system reclassifies after 30 days based on actual activity.
- Pros: Respects contractor identity (most have a clear self-image), self-corrects when behaviour diverges, transparent.
- Cons: Adds an onboarding step. Re-segmentation logic needs ops support.

**Option C: Pure behavioural classification.** Algorithm assigns segment from past activity.
- Pros: Honest — reflects what they actually do.
- Cons: Cold-start problem (new contractors have no history), opaque to contractor, feels paternalistic.

## Decision

**Option B.** Self-declared at signup, behaviour validated every 30 days.

Target supply mix:

- **Builder: 50–60% of supply.** Creates supply stability and geographic depth.
- **Gap-Filler: 25–35%.** Overflow capacity, niche skills, geographic edges.
- **Specialist: 10–15%.** Cert-gated work — Gas Safe, Part P, structural.

A single contractor holds **one** segment at a time. Re-segmentation triggers:

- After 30 days, if behaviour suggests a different segment (e.g. a Gap-Filler taking >25 jobs/month gets prompted to upgrade to Builder)
- Manual admin override (rare — for edge cases)
- Self-request via the contractor app

## Routing Implications Per Segment

**Builder:**
- Commits days in advance via Module 06 (day-pack solver)
- Receives day-pack offers (one offer = N jobs bundled for the day)
- All-or-nothing completion bonus (see ADR-007)
- Prioritised in routing — Builder day-pack queue is checked before single-offer routing runs

**Gap-Filler:**
- Submits weekly availability (slots, not whole days)
- Receives single-job offers via the 5-stage routing pipeline (Module 05)
- No day commitment, no day-rate guarantee
- Standard pay-protection guarantees only (no day-rate floor)

**Specialist:**
- Cert-verified at onboarding (Gas Safe / Part P / structural credentials checked and stored)
- Cert-gated jobs only — never receives non-cert-required work
- Premium rates (Gas: 55% margin, £28/hr floor)
- Smaller pool — admin manually escalates when none available in catchment

## Consequences

**Positive:**
- Each segment has product-market fit; recruitment marketing can target each with a different pitch
- Routing rules are clearer — segment is a hard filter, not a soft signal
- Pay protection can be calibrated per segment (Builder day-rate floor, Specialist premium floor)
- Contractor app dashboards become segment-aware and dramatically less cluttered

**Negative / accepted:**
- Three product paths to maintain — more code surface, more test combinations
- Re-segmentation logic adds ops complexity (review queue, contractor-facing prompts)
- Existing contractor base needs a backfill — default to Gap-Filler (most permissive) and let the 30-day check reclassify

## Cross-references

- Module 03 (unit bench) — schema field `contractor_segment`
- Module 05 (routing engine) — segment is a hard filter in the eligibility stage
- Module 06 (day-pack solver) — Builder-only
- Module 09 (contractor app v2) — segment-aware dashboard
- Master plan Phase 7 — Contractor app v2 ships segment dashboards
