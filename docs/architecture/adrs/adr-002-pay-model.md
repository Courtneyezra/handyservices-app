# ADR-002: Pay Model — Hidden Engine + Visible Promise

## Status
Accepted

## Context

Handy customers are quoted by the platform, not by the contractor — so the
contractor never priced the job. This forces a choice at the contractor-facing
surface: (a) be transparent about how the pay number is derived (formula,
tiers, modifiers), or (b) hide the derivation and back the number with
guarantees that make the contractor feel safe regardless of the math.

Most contractor-marketplaces pick (a) and end up haggling on every job. Gig
platforms like Uber pick (b) — but offer no recourse when reality diverges
from the offer (over-running jobs, no-access calls, cancellations).

The MVP day-pack page (`DispatchPreviewPage.tsx`) confirmed contractors do
not read formulas — they read **the number** plus **what happens if it goes
wrong**. The Handy answer is therefore (b) + recourse: hidden engine, backed
by a published seven-guarantee promise. This ADR locks that choice.

## Options considered

**Option A — Pure fixed SKU pricing.** Every SKU has a hardcoded contractor
pay. *Pros:* simple, predictable margin. *Cons:* most Handy jobs are custom
(carpenters, painters, multi-stop bespoke work) — fixed SKU prices cannot
cover the variance, and EVE already varies the customer rate by segment.
**Rejected.**

**Option B — Exposed rev-share with breakdown.** Contractor sees "55% of £200
= £110, + £15 specialist premium, + £8 distance bonus = £133." *Pros:* fully
transparent. *Cons:* invites haggling on every modifier, exposes pricing
logic to the supply side, surfaces customer-segment margin variance (BUSY_PRO
£74/hr vs RENTER £40/hr) which contractors will pattern-match against.
**Rejected.**

**Option C — Hidden engine + visible promise.** Server computes pay using
`revenue-share-tiers.ts` plus modifiers; contractor sees ONE number per job
or day-pack, backed by seven published guarantees. **Chosen.**

## Decision

**Option C.** The contractor-facing UI (Module 09 app, Module 15 day-pack
page) shows ONE number per job or day-pack — never a breakdown. Behind that
number sits the existing engine:

```
contractor_pay = MAX(
  customer_labour_price * rev_share_tier_pct,    // 45-55% by category tier
  hourly_floor * real_work_minutes / 60          // £16-£28/hr by tier
)
+ modifiers (specialist_premium, distance_bonus, stacking_discount)
- platform_fee_if_any
```

Tier mapping (locked, from `server/revenue-share-tiers.ts`):

| Tier | Share | Floor | Categories |
|---|---|---|---|
| Specialist | 55% | £28/hr | electrical_minor, plumbing_minor, bathroom_fitting, kitchen_fitting |
| Skilled | 50% | £22/hr | carpentry, tiling, plastering, lock_change, door_fitting |
| General | 45% | £18/hr | general_fixing, shelving, flat_pack, curtains, painting, sealant, TV mount, furniture |
| Outdoor | 45% | £16/hr | garden, waste, pressure_washing, guttering, fencing, flooring |

The seven guarantees back the trust (Module 07 owns implementation):

1. **Day-rate floor** — already implemented; protects on cheap jobs.
2. **Mis-scope auto-uplift** — ≤ £40 auto-approved with photo evidence; > £40 admin review.
3. **Call-out fee £45** — for no-access / customer-not-there scenarios.
4. **Cancellation comp** — 50–75% of pay if customer cancels < 24h.
5. **Materials reimbursement** — receipt + 10% handling.
6. **48-hour pay SLA** — payout within two working days of completion.
7. **Completion bonus** — per ADR-007, all-or-nothing on day-packs.

The day-pack surface is the strongest expression: contractor sees one day
rate plus one completion bonus — never the per-stop math.

## Consequences

**Positive**
- Contractor UX matches Uber-driver simplicity (one number) without Uber's lack of recourse.
- Server retains full margin control via tier and modifier logic — re-tunable without re-papering contractors.
- Differentiates from Checkatrade (lead-gen, no number) and gig platforms (number, no recourse).
- Day-pack format is only viable here — per-stop math would re-introduce haggling.

**Negative / accepted trade-offs**
- "What's my hourly?" complaints will happen — onboarding leans on the seven guarantees, not transparency.
- Mis-scope claims need a photo-evidence workflow; without Module 07, the promise is hollow.
- Margin variance per job is opaque to contractors — relies on aggregate satisfaction signals (acceptance, churn).
- Admins, legal, and contractor support still need full internal visibility for dispute resolution.

## Cross-references

- Module 07 (pay protection) — implements the seven guarantees.
- ADR-005 (real-work-time vs pricing-time) — pay calc uses `real_work_minutes`, not the inflated pricing-time figure.
- ADR-007 (bonus model) — completion bonus is mechanism #7.
- `server/revenue-share-tiers.ts` — tier + floor implementation.
- `client/src/pages/contractor/DispatchPreviewPage.tsx` — visible-promise UX reference.
