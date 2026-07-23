# Two-Sided Pricing Loop — Intro Boosts + Banded Optimisation

_22 Jul 2026 · The "Uber tactic" adapted for a 5-contractor, one-city marketplace. Builds on
[CONTRACTOR_PAY_MODELS_RESEARCH_2026-07.md](CONTRACTOR_PAY_MODELS_RESEARCH_2026-07.md),
the price-barrier analysis, and the live WTP/WTBP engines._

## The idea, and the one modification that makes it safe

**Uber's play:** subsidise both sides to build liquidity (pay drivers above-market, price riders
below-market), then optimise the spread once both sides are locked in.

**Uber's failure mode:** the squeeze. Drivers noticed pay quietly eroding and never trusted the
platform again. Uber survived it because drivers had nowhere to go. **We would not survive it** —
we have 5 contractors, a warm-referral recruiting engine where one burned tradesman poisons the
well (see Aspect's 2.5★), and an anti-Aspect brand promise of transparent pay.

**The modification: never silently cut. Make every subsidy an *explicit, expiring bonus*.**
- Contractor side: "+10% launch bonus on your first 10 jobs" — the later step-down is a
  promised expiry, not a betrayal. The rate card itself never moves down for an individual.
- Customer side: visible intro discounts that expire ("first job −£20"), not silent price rises.

The *optimisation* then happens where nobody experiences a cut: on **new** cohorts, **new**
bands, and the **spread between bands** — not on anyone's existing deal.

## The two dials per band (the closed loop)

For each band, two observable dials tell you which price is wrong:

| Dial | Source | Too hot | Too cold |
|---|---|---|---|
| **Customer conversion** (paid % of viewed) | `personalizedQuotes` funnel | ≫ band target → price low, raise WTP | ≪ target → price high or value case weak |
| **Contractor uptake** (claim rate, time-to-claim, declines) | `jobDispatches.createdAt→lockedAt`, CBR declines | instant claims, ~100% take → pay above clearing, shave share 1–2pts on *future* jobs | jobs sit unclaimed → boost band pay |

**Margin is the residual, not the target.** You steer the two dials into their target ranges;
what's left between them is take. Chasing take directly is how you end up optimising into
Aspect.

### Bands (granular, not global — per the instinct)

- **Demand side:** the price bands you already measure — sub-£100 / £100–200 (sweet spot ~50%) /
  £200–1k (plateau ~35%) / £1k+ (wall). Optionally × segment (BUSY_PRO, LANDLORD…).
- **Supply side:** the four WTBP tiers (specialist / skilled / general / outdoor) × job-size
  band. These are the knobs that exist in code today (`TIER_CONFIG` share % + floors + visit
  minimums).

### What your existing data already says (pre-loaded moves)

1. **£200–1k plateau is inelastic** (flat ~35% across the whole range, no round-number
   barriers) → this is where WTP optimisation pays first. Raise EVE-anchored prices inside the
   plateau; conversion data says you're leaving money on the table, not losing deals.
2. **Sub-£100 converts *worse* than £100–200** → intro-pricing small jobs DOWN is provably
   wrong. If anything, raise the small-job floor (also funds the £40 visit minimum).
3. **£1k+ is a decision-process wall, not a price wall** (0% above £2.5k) → don't discount it;
   fix delivery credibility (teams, staged payments, human-in-loop pricing).
4. **Supply side has almost no signal yet** — 36 open dispatches, ~0 claims (the open-link
   channel isn't converting). Until claims flow, contractor-side optimisation is blind; the
   loop's supply leg starts AFTER the warm-team sends produce accept/decline data.

## Guardrails (hard, never optimised through)

- **Pay floors are sacred:** £16–28/hr tier floors + £40–60 visit minimums never move down.
  The optimiser trims *share %* on over-subscribed bands, floor stays.
- **Take-rate ceiling:** platform labour take capped at ~55% (current specialist ceiling).
  Existing `thin_margin` / `below_target` / `reprice_needed` flags are the other side.
- **Hysteresis:** no band moves without ≥15 observations AND two consecutive review periods
  pointing the same way. At our volume, weekly noise looks like signal.
- **Step size:** ±1–2 share points or ±3–5% price per move, one move per band per fortnight.
- **Transparency line:** a contractor can always see the current rate card; changes announce
  ahead, apply to future offers only.

## Rollout phases

**Phase 1 — manual loop (now):** a fortnightly pricing review from a script that prints, per
band: volume, conversion, claim rate, median time-to-claim, realised margin, and a suggested
nudge (respecting hysteresis). Human approves each move. (Extend
`scripts/_pay-split-last10.ts` / `_contractor-weekly-volume.ts` patterns; build once claim
data exists.)

**Phase 2 — intro boosts as config:** `onboardingBoostPercent` + `boostJobsRemaining` per
contractor (first-N-jobs launch bonus, self-expiring, shown on the job offer as a separate
bonus line so the base rate is never confused with the boosted rate). Customer-side: coupon-style
intro discount for first-time customers in target bands/postcodes, rendered as a visible
discount line.

**Phase 3 — closed loop with human veto:** the review script computes suggested moves; approved
moves write to `pricing_settings` / `TIER_CONFIG`-backed storage; every move logged with its
justifying data so the history is auditable when a contractor asks why.

## Why this beats copying Uber directly

Uber optimised against anonymous crowds with no exit costs on either side. We optimise against
~5 named tradesmen recruited on trust and ~30 customers/month in one city. Same mathematics —
two dials, banded, closed loop — but subsidies are *promises with expiry dates* instead of
silent spreads, and every downward move lands on future cohorts, never on a person who can
feel it as a cut.
