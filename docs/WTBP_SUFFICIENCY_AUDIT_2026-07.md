# WTBP Sufficiency Audit — Model C vs. the Pay-Model Research

_21 Jul 2026 · Audits `server/revenue-share-tiers.ts` (Model C tiered revenue share, the current WTBP leg) against [CONTRACTOR_PAY_MODELS_RESEARCH_2026-07.md](CONTRACTOR_PAY_MODELS_RESEARCH_2026-07.md), the Aspect failure modes, and [CRAIG_PAY_AGREEMENT_DRAFT.md](CRAIG_PAY_AGREEMENT_DRAFT.md)._

## Current model (as implemented)

`pay = MAX(share% × customer labour price, floor £/hr × estimated hours)` — computed at quote time, materials excluded.

| Tier | Share | Floor | Categories |
|---|---|---|---|
| Specialist | 55% | £28/hr | electrical, plumbing, bathroom, kitchen |
| Skilled | 50% | £22/hr | carpentry, tiling, plastering, locks, doors |
| General | 45% | £18/hr | fixing, shelving, flat pack, painting, TV… |
| Outdoor | 45% | £16/hr | garden, waste, pressure washing, fencing… |

## What's already RIGHT (keep)

1. **Fixed £ known before acceptance** — pay is deterministic at quote time. The #1 Aspect grievance (opaque pay, post-hoc deductions) is structurally absent. ✅
2. **Contractor can't inflate the job** — price and time estimate are engine-set; stretching the job doesn't raise pay. Kills Aspect's overcharge incentive; preserves the piece-work efficiency incentive. ✅
3. **Floor protection** — MAX(share, floor) is literally the "hybrid floor + performance" structure the 2026 technician-preference data favours (41–43% now prefer hybrid). ✅
4. **Materials excluded from share** — share is on labour only; consistent with company-funded materials (§10 of agreement). ✅
5. **Aligned upside** — premium-priced jobs pay the contractor more; "earn 45–55% of job value" is a clean recruiting pitch. ✅

## Realized effective hourly (engine sweep, 40-min round-trip travel assumed)

| Scenario | Pay | Method | £/hr on-site | **£/hr incl. travel** | Verdict vs. Nottingham bar* |
|---|---|---|---|---|---|
| TV mount 30m £45 | £20.25 | share | £41 | **£17** | ❌ travel-diluted |
| Flat pack 1.5h £75 | £33.75 | share | £23 | **£16** | ❌ |
| General fix 1h £85 | £38.25 | share | £38 | **£23** | ⚠️ borderline |
| General fix 2h £129 | £58.05 | share | £29 | **£22** | ⚠️ |
| Painting 4h £220 | £99.00 | share | £25 | **£21** | ⚠️ |
| Carpentry 3h £210 | £105.00 | share | £35 | **£29** | ✅ |
| Plumbing 1.5h £180 | £99.00 | share | £66 | **£46** | ✅ strong |
| Garden 6h £180 | £96.00 | **floor** | £16 | **£14** | ❌ |

_*Bar: research found Nottingham self-employed effective take-home equivalent ≈ £25–35/hr (charging £30–50). Platform contractors carry lower overheads (no marketing/quoting) so ~£25–30 general / £35+ specialist incl. travel is the competitive line._

**Pattern:** specialist/skilled = competitive. **General/outdoor short jobs are travel-diluted below the recruiting bar** — and short general jobs are the bulk of handyman volume (your £100–200 sweet spot converts at ~50%).

## Gaps → fixes (ranked)

### 1. Travel dilution on short jobs → add a per-tier minimum job payout ("call-out floor")
The agreement (§4.1) promises travel priced in; the engine doesn't do it. Simplest fix, standard across the industry: `minJobPence` per tier, e.g. **General/Outdoor £40, Skilled £50, Specialist £60** per visit. TV mount goes £20.25 → £40 = £34/hr incl. travel ✅. Platform absorbs it on small jobs or (better) the customer-side minimum call-out in WTP pricing rises to match — check WTP already charges a visit minimum ≥ ~£75–89 on tiny jobs (price-barrier research: sub-£100 converts *worse* than £100–200, so raising tiny-job prices to fund the floor is conversion-safe).

### 2. Overrun risk → verified-variation rule
Floor uses **estimated** minutes. If the AI under-estimates, effective hourly craters and you've recreated Aspect's "argue about pay on payday." Rule: if ops-verified actual time > estimate × 1.5 (photo/checklist evidence, scope unchanged), re-rate the floor leg on actuals via a variation (`variationAmountPence` already exists in `contractorPayouts`). Keeps efficiency incentive (no top-up inside 1.5×), removes catastrophic-miss risk. Pair with human-in-loop pricing on £1k+/complex quotes.

### 3. `floor_applied` should trigger re-pricing, not just cheaper pay
When the floor beats the share (garden 6h £180), the real problem is **the customer price is too low for the time** — paying the contractor £14/hr effective doesn't fix that, it just makes him quit. Treat `floor_applied` as a WTP-side red flag: re-price or decline the job. Floor should be a safety net, not a standing subsidy of underpriced quotes.

### 4. No lead uplift → add multi-person/managed-job multiplier
Complex jobs (Craig as site lead coordinating others) need the **lead uplift** from agreement §4.4 — e.g. +15% of job labour or flat £/day on `multi-managed` tagged jobs. Engine currently has no concept of job complexity or multi-contractor splits.

### 5. Weekly volume floor — not a pricing-engine job, but nothing tracks it
Agreement §5's "intention to offer £X/week" needs an ops report: offered vs. accepted £ per contractor per week. Without it the consistency promise (your #1 recruiting asset) is unverifiable.

### 6. Consolidation debt
- `wtbpRateCard` table + `WTBPRateCardPage` admin UI are the **deprecated cost-plus model** still live in the codebase; `calculateQuoteCost` (cheapest-contractor cost-plus) still exists alongside Model C. Pick Model C, mark the rest clearly legacy or remove, so quotes can't silently cost on two different models.
- Tier config is hard-coded in `TIER_CONFIG`; fine for now, but the admin rate-card page should edit *these* numbers, not the dead table.

## Answers for the pay agreement's `[£___]` fields

The agreement should **reference the rate card, not hard-code numbers**:
- §4.4 effective hourly target → "per the HandyServices rate card: 45–55% of job labour value, floors £16–28/hr by tier, minimum £[40–60] per visit."
- Lead uplift → the §4.4 multiplier from fix #4.
- §5 weekly intention → set from Craig's current actual run-rate (pull his last 8 weeks of job value; intention ≈ 80% of median).

## Bottom line

**Model C is the right chassis — it is the research's recommended design already in code.** It is *not yet sufficient* because of four things: no per-visit minimum (travel dilution), no overrun valve, no lead uplift, and floor-as-subsidy on underpriced jobs. Fixes #1–#3 are small, contained changes to `revenue-share-tiers.ts` + one WTP-side check. Do them before signing Craig, because §4.1's "travel priced in" promise is currently not true in code.
