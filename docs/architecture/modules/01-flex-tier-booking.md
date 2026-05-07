# Module 01: Flex Tier Booking

**Status:** Wave 3 — authoritative
**Phase:** 1 (Customer-side)
**Primary flag:** `FF_FLEX_TIER`
**Depends on:** Wave 1 (`data-model.md`, `api-surface.md`, `state-machine.md`, `feature-flags.md`), Wave 2 (`adrs/adr-004-flex-tier.md`), Module 13 (design system)
**Owner:** Wave 3 Agent 01

---

## 1. Purpose

A customer-facing three-tier flex selector — **Fast / Flexible / Relaxed** — surfaced above the date picker on the personalized quote page. It captures date-flexibility intent at quote time and applies a transparent EVE discount (−0% / −10% / −15%). The selected tier is persisted to `personalized_quotes.flex_tier` / `flex_window_days` and consumed downstream by the availability engine (Module 04), routing engine (Module 05), and day-pack solver (Module 06). Every customer who self-selects out of "Fast" enlarges the candidate-date pool the supply side gets to bin-pack — the demand-shaping lever locked in `adrs/adr-004-flex-tier.md`.

---

## 2. Files

```
NEW       client/src/components/quote/FlexTierSelector.tsx
NEW       client/src/components/quote/FlexTierSelector.spec.tsx
NEW       server/flex-tier-pricing.ts
NEW       server/flex-tier-pricing.spec.ts
NEW       server/routes/flex-tier.ts
NEW       e2e/quote-flex-tier.e2e.ts
MODIFIED  client/src/pages/PersonalizedQuotePage.tsx        (insert <FlexTierSelector/> above <DatePricingCalendar/>)
MODIFIED  client/src/components/DatePricingCalendar.tsx     (read flex_tier prop; constrain selection mode + window)
MODIFIED  server/eve-pricing-engine.ts                      (apply FLEX_DISCOUNTS multiplier after segment+EVE calc)
MODIFIED  server/quotes.ts                                  (mount /api/quotes/:id/flex-tier + /pricing routes)
MODIFIED  shared/schema.ts                                  (flex_tier_enum + flexTier/flexWindowDays per data-model.md §2)
MODIFIED  server/feature-flags.ts                           (FF_FLEX_TIER already declared — surface via /api/feature-flags)
```

No new UI deps — `FlexTierSelector` reuses `lucide-react` (`Zap`, `Calendar`, `Leaf`), Tailwind, and `framer-motion`, all already in the project.

---

## 3. Schema

Two columns on `personalized_quotes`, both additive and NULL-safe. Full DDL is in `data-model.md` §2 — not duplicated here.

- `flex_tier` — `flex_tier_enum` (`'fast' | 'flexible' | 'relaxed'`), nullable.
- `flex_window_days` — `integer`, nullable.

**Defaults at quote creation:** `flex_tier = 'flexible'`, `flex_window_days = 7`, written by `server/quotes.ts` when `FF_FLEX_TIER` is ON. Flag OFF → both columns stay NULL; downstream code treats NULL as `'fast' / 0` (§10).

Migration: `001_extend_pq_booking.sql` (data-model.md §6). Backfill (`scripts/backfill-booking-v2.ts`) sets pre-existing rows to `'fast' / 0` — zero discount, zero behaviour change.

---

## 4. Pricing logic

Flex discount applies as a **post-EVE multiplier**: after segment rate × duration produces the EVE base, before any pretty-pence rounding.

```ts
// server/flex-tier-pricing.ts
export const FLEX_DISCOUNTS = {
  fast:     0,
  flexible: 0.10,
  relaxed:  0.15,
} as const;

export type FlexTier = keyof typeof FLEX_DISCOUNTS;

export function applyFlexDiscount(basePencePostEve: number, tier: FlexTier): {
  finalPence: number;
  discountPence: number;
  discountPct: number;
} {
  const pct = FLEX_DISCOUNTS[tier];
  const finalPence = Math.round(basePencePostEve * (1 - pct));
  return {
    finalPence,
    discountPence: basePencePostEve - finalPence,
    discountPct: pct,
  };
}
```

Wired into `server/eve-pricing-engine.ts` as the **last** step before pretty-pence rounding:

```
segment_rate × (duration_min / 60)            → base_eve_pence
base_eve_pence × (1 - FLEX_DISCOUNTS[tier])   → flex_adjusted_pence
roundToPretty(flex_adjusted_pence)            → final_customer_price_pence
```

When `FF_FLEX_TIER` is OFF, the flex step is skipped (treated as `'fast'`), preserving today's pricing exactly. Edge cases covered by spec: £0 base, sub-penny half-up rounding, unknown-tier throw, no re-price after payment (§8).

---

## 5. UI design

`FlexTierSelector` renders three radio-group cards inheriting Module 13 brand tokens (Navy `#1B2A4A`, Yellow `#F5A623`, Light bg `#F7F8FC`, Highlight bg `#FFF8EC`, Poppins).

| Tier | Icon | Label | Sub-label | Badge | Visual weight |
|---|---|---|---|---|---|
| Fast | `Zap` | "Fast" | "Pick the exact date" | `+0%` | small |
| **Flexible** | `Calendar` | "Flexible" | "Choose up to 3 dates within 7 days" | `−10%` | **large, MOST POPULAR ribbon (yellow)** |
| Relaxed | `Leaf` | "Relaxed" | "Any 14-day window — we pick" | `−15%` | small |

Layout: horizontal flex row on desktop (Flexible ~50% width; Fast/Relaxed ~25% each); stacked vertically on mobile. Flexible carries a yellow MOST POPULAR ribbon and thicker yellow border (`#F5A623`). Inspired by Grab/Uber tier-choice UX.

Accessibility: `role="radiogroup"` with three `role="radio"` cards, full keyboard navigation (Tab, Arrows, Space/Enter), aria-labels include tier name and discount.

The selector emits `onChange(tier, windowDays)` to the parent, which (1) optimistically updates the displayed price from cached `GET /pricing` data, (2) fires `PUT /flex-tier` to persist, (3) re-renders `<DatePricingCalendar/>` with the new props. Default tier on first paint: **`'flexible'`**.

---

## 6. Date picker integration

`DatePricingCalendar` already supports multi-date; the extension is additive — a new `flexTier` prop drives selection mode:

| Tier | Mode | Constraint | `availableDates` shape |
|---|---|---|---|
| `fast` | Single date | Exactly 1 future date | `[{date}]` |
| `flexible` | Multi-date | Up to 3 dates within a chosen 7-day rolling window | `[{date}, {date}, {date}]` |
| `relaxed` | Range | Any contiguous 14 days | `[{from, to}]` |

The existing `availableDates` jsonb on `personalized_quotes` carries the customer's chosen dates regardless of tier — schema unchanged. Consumers (Modules 04/05/06) treat it as "the set of acceptable dates for this booking."

A soft helper line under the grid restates the rule per tier ("Pick 1 date" / "Pick up to 3 dates within a 7-day window" / "Drag to select any 14 days").

---

## 7. API

This module owns two endpoints, both declared in `api-surface.md` §2.1.

### `PUT /api/quotes/:id/flex-tier`

Auth: slug + per-quote `tier_token`. Idempotent.

```ts
// Request
{ flex_tier: "fast" | "flexible" | "relaxed", tier_token: string }
// Response 200
{ id, flex_tier, flex_window_days: 1 | 7 | 14,
  price_pence, discount_pence, valid_until /* ISO-8601, +24h */ }
```

Errors: 403 (bad token), 404, 409 (`booking_state` past `quoted` — see §8), 422.

### `GET /api/quotes/:id/pricing`

Auth: slug. Returns all three tier prices in one shot so the selector renders live discount labels without re-fetching.

```ts
// Response 200
{ id, selected_tier,
  tiers: {
    fast:     { price_pence, discount_pct: 0  },
    flexible: { price_pence, discount_pct: 10 },
    relaxed:  { price_pence, discount_pct: 15 },
  } }
```

Errors: 404. Cached client-side via TanStack Query (`staleTime: 60_000`); invalidated on every successful `PUT /flex-tier`.

---

## 8. State-machine integration

Flex-tier writes are valid only while `booking_state` is `draft` or `quoted` (see `state-machine.md`). Once Stripe `payment_succeeded` triggers `quoted → booked_pending_routing`, `flex_tier` is **locked** — subsequent `PUT /flex-tier` returns 409.

Downstream: at `booked_pending_routing → reserved_for_pack` the routing engine reads `flex_tier` + `flex_window_days` for Builder eligibility (Relaxed = highest-value for day-pack assembly per ADR-004). `availableDates` is the consumed date set; tier alone is metadata once dispatch begins.

This module writes `flex_tier` / `flex_window_days` and reads via `GET /pricing`. It does not transition `booking_state` — the existing Stripe webhook owns that.

---

## 9. Tests

| Test file | Type | Covers |
|---|---|---|
| `server/flex-tier-pricing.spec.ts` | Unit | All 3 multipliers; £0 base; round-half-up; unknown-tier throw; idempotency. |
| `client/src/components/quote/FlexTierSelector.spec.tsx` | Component (Vitest + RTL) | Default = `flexible` on mount; tier-switch fires `onChange`; aria-radiogroup + keyboard nav; MOST POPULAR ribbon on Flexible; flag-off returns `null`. |
| `e2e/quote-flex-tier.e2e.ts` | E2E (Playwright) | Create quote → Flexible default → switch Relaxed (−15%, 14-day mode) → switch Fast (single-date, +0%) → Stripe pay → subsequent `PUT /flex-tier` → 409. |

CI gating: all three required green on `dispatched` before flipping `FF_FLEX_TIER` ON in staging.

---

## 10. Rollback

Cold rollback is a single env-var flip: `FF_FLEX_TIER=0`.

Effects when OFF:
- `PersonalizedQuotePage` does not render `<FlexTierSelector/>`.
- `DatePricingCalendar` falls back to single-date mode (current behaviour).
- `eve-pricing-engine.ts` skips the flex multiplier — pricing matches today.
- `server/quotes.ts` writes `flex_tier = NULL`, `flex_window_days = NULL` for new quotes.
- `PUT /api/quotes/:id/flex-tier` returns 403 `feature_disabled`.
- `GET /api/quotes/:id/pricing` returns only `selected_tier: 'fast'` and a single price block.

The `flex_tier` and `flex_window_days` columns remain on the table (NULL-safe) — already-priced quotes keep their stored price; nothing in production breaks. See `feature-flags.md` §3 for the cross-flag effect summary.

---

## 11. Open questions / risks

- **Default-tier behaviour gap.** ADR-004 predicts ~50% accept Flexible by default; actuals unknown. Track in PostHog from launch (event `flex_tier_selected`, properties `{tier, segment, default_accepted}`). If `default_accepted` < ~40%, revisit Module 13 copy/hierarchy before amending ADR-004.
- **Post-payment tier change.** Locked at `booked_pending_routing`; CS requests route through the existing reschedule/refund flow (out of scope here).
- **Edge: Relaxed with a single date.** Legal — customer narrower than the tier permits. Solver still gets the full 14-day window for re-route attempts (Module 06).
- **Currency precision.** Discount applied in pence pre-rounding; sub-penny `Math.round` half-up. Spec'd to prevent regressions from a future banker's-rounding refactor.

---

## 12. Cross-references

- `adrs/adr-004-flex-tier.md` — locked decision (tiers, defaults, discounts, behavioural targets).
- `data-model.md` §2 — DDL for `flex_tier` / `flex_window_days`.
- `api-surface.md` §2.1 — endpoint contracts.
- `state-machine.md` — `booking_state` lifecycle and lock point.
- `feature-flags.md` §3 — `FF_FLEX_TIER` rollback semantics.
- `modules/04-availability-engine.md`, `modules/06-day-pack-solver.md` — downstream consumers.
- `modules/13-design-system.md` — brand tokens.
