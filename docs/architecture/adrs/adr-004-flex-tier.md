# ADR-004: Flex Tier Customer Pricing

## Status

Accepted

## Context

Demand-side rigidity is the supply-side's biggest enemy. If every customer demands a specific Tuesday slot, contractors must individually match each demand, leaving the platform with thin, fragmented supply pools and a high rejection rate from the availability engine. Widening the customer's accepted date window by even one day quadruples the supply-matching options downstream.

Marketplace platforms like Grab and UberEats use similar tiering for delivery: contractors get clearer routing, customers get a discount, the platform aggregates demand into thicker pools. The Handy version applies this idea to handyman bookings: customers self-select date flexibility for a transparent discount, which feeds the availability engine and Builder day-pack solver with looser constraints. This unlocks tighter routing, fewer reschedules, and better same-day clustering — the supply-side gains compound with each percentage of customers who opt out of "Fast."

We need a discrete, customer-legible way to capture flexibility intent at quote-creation time, with a clear pricing signal attached.

## Options considered

**Option A: No tiers (current)** — customer picks one date, system scrambles. Pros: simple. Cons: rigid, no demand shaping, high rejection rate.

**Option B: Two tiers (rigid / flexible)** — pick a date OR pick a window. Pros: simpler than three. Cons: lumps too much together — "flexible" can mean 3 days or 14 days, with very different supply implications.

**Option C: Three tiers (Fast / Flexible / Relaxed)** — three explicit choices with three discounts. Chosen.

**Option D: Sliding-scale discount based on window width** — every extra day = 1% off, capped. Pros: continuous gradient. Cons: opaque to customer ("how much do I save if I add Tuesday too?"), harder to explain, harder to model demand pools.

## Decision

**Option C — three tiers.**

| Tier | Window | Discount | Default? |
|---|---|---|---|
| Fast | 1 specific date | 0% | No |
| Flexible | 3 customer-chosen dates within 7 days | -10% | Yes |
| Relaxed | Any date within 14 days | -15% | No |

Default is **Flexible** at quote-creation. Most customers don't need a specific date but think they do; the default normalises mental model toward flexibility and harvests the long tail of customers who would otherwise reflexively pick "Fast."

Tier is stored on `personalized_quotes.flex_tier`; window is on `personalized_quotes.flex_window_days` (1, 7, or 14 respectively).

The discount is applied in the EVE pricing engine (`server/eve-pricing-engine.ts`):

```
final_customer_price = base_price * (1 - flex_discount[tier])
```

## Consequences

Positive:
- Demand-side flexibility increases supply-matching success rate
- Customers self-segment by urgency need — no guesswork by ops
- Discount is transparent; customer sees exactly what they save by relaxing
- Supply-side benefits accrue: tighter routing, fewer reschedules, better Builder day-pack assembly
- Reduces FF_AVAILABILITY_ENGINE rejection rate (more eligible dates per quote)

Negative / accepted:
- 10–15% revenue sacrificed on Flex/Relaxed tier customers (modelling shows margin actually goes UP because routing efficiency compensates — see master plan economics section)
- "Why is mine more expensive?" customer questions on Fast tier — answer: "you get the date you want"
- Need T&C clarity for Relaxed tier (we pick a date, you confirm 24–48h ahead)

## Behavioural targets

Expected distribution after launch:
- Fast: 30% of quotes (urgent jobs, customer-rigid lifestyles)
- Flexible: 50% (default, broadest acceptance)
- Relaxed: 20% (genuinely chill customers, recurring landlord/property work)

Real distribution will be measured at 30/60/90 days; tier and discount values may be tuned in subsequent ADR amendments.

## Cross-references

- Module 01 (flex-tier-booking) — UI + pricing implementation
- Module 04 (availability engine) — eligible-dates query consumes `flex_window_days`
- Module 06 (day-pack solver) — Relaxed-tier quotes are highest-value for Builder packing (max date flexibility)
- ADR-002 (pay model) — customer pricing is independent of contractor pay calc
- `eve-pricing-engine.ts` — implements `flex_discount` multiplier
