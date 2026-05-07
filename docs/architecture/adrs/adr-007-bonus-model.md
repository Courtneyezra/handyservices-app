# ADR-007: Day-Pack Completion Bonus Model

## Status
Accepted

## Context

The day-pack model offers a Builder N jobs as a single unit of work. The completion bonus exists to incentivise finishing all N stops — not stopping at 3-of-4 because the last one looks awkward, far away, or low-margin. Without a strong terminal incentive, the rational contractor cherry-picks the easy stops and bails on the hard one, leaving the customer (and our reliability promise) holding the bag.

Three approaches were considered during MVP iteration: per-stop bonuses, tiered/graduated bonuses, and all-or-nothing. The user explicitly chose all-or-nothing, accepting that this creates harsh edge cases when failure is not the contractor's fault. To address those, the rule is rigid for contractor-controlled outcomes but admits explicit carve-outs for customer-caused, weather-driven, and materials-missing failures.

## Options considered

**Option A: Per-stop bonus** — every stop earns +£X (with first stop as the warm-up earning nothing). Pros: frequent dopamine hits, partial credit for partial effort. Cons: weak pull to finish; contractor can rationally bail after job 3.

**Option B: Tiered (graduated)** — 50% of bonus at 75% complete, 100% bonus at 100% complete. Pros: gradual reward. Cons: complex to communicate, still doesn't pull as hard as all-or-nothing.

**Option C: All-or-nothing** — full bonus unlocks at the LAST tick (all stops + pickup if required). Pros: strongest pull to finish, simplest to explain ("complete the day, get +£30"). Cons: harsh edge cases (customer cancels stop 4 — contractor bails after doing 3 hard ones).

## Decision

**Option C — all-or-nothing — with edge-case carve-outs.**

Bonus eligibility = `completedStops.size === totalStops AND (pickupDone || !pickupRequired)`.

For Mark's test pack: bonus = £30 only when 4 stops + 1 pickup are all marked complete.

The bonus amount per pack is server-computed and stored on `day_packs.completion_bonus_pence` at offer time. Default for Builder day-packs: 15% of day rate (e.g. £200 day rate → £30 bonus). Tunable per-Builder via `handyman_profiles.day_rate_target_pence` and an admin config.

## Edge cases (carve-outs)

The all-or-nothing rule is rigid by design — but the system honours bonus when failure is NOT the contractor's fault. Three carve-outs:

**1. Customer-caused stop failure (`customer_cancelled` state for that stop):**
If one stop in the pack moves to `customer_cancelled` and the contractor was ready to attend (`dispatched` or earlier check-in event), that stop is treated as complete for bonus purposes. Cancellation comp (Module 07 pay protection) compensates the customer-side issue separately.

**2. Force-majeure / weather (outdoor jobs):**
Outdoor jobs flagged with `weather_dependent=true` (Module 02 job-tagging) that cannot proceed safely move to `reschedule_required`. If admin approves the rescheduling reason as weather-driven, the stop counts as complete for the day's bonus. Reschedule compensation handled separately.

**3. Materials missing on arrival (not pickup-related):**
If a customer-supplied material is missing on site (e.g. customer said they had the part, didn't), and the work cannot proceed, contractor flags `customer_supplied_missing` (Module 12 materials collection); admin reviews; if confirmed, stop counts complete.

In all three cases: contractor uploads photo evidence; admin can override; defaults to AUTO-ALLOW after 24h if no admin objection (per Module 07 auto-approval rules).

## Implementation

Bonus calculation lives server-side in a single function:
```ts
function bonusEarned(pack: DayPack, completed: CompletionState): number {
  const stopsAllDone = completed.stops.size === pack.jobs.length;
  const pickupOk = !pack.materials_pickup?.required || completed.materials_collected;
  const carveouts = completed.carveouts; // customer_cancelled, weather, missing_materials

  // A stop in carveouts is treated as complete for bonus purposes
  const effectiveStopsDone = completed.stops.size + carveouts.length;
  if (effectiveStopsDone < pack.jobs.length) return 0;
  if (!pickupOk) return 0;
  return pack.completion_bonus_pence;
}
```

Frontend (Modules 09 + 15) reads `bonusEarned` from server — never computes locally.

## Consequences

Positive:
- Strongest incentive to finish the day
- Simplest communication ("complete = +£30, anything less = £0")
- Carve-outs prevent unfair penalties on customer-caused failures
- Bonus economics are predictable (£30 per Builder day on average)

Negative / accepted:
- Edge case logic adds server-side complexity (carve-out approvals)
- 24h auto-allow for admin objection means some borderline cases get bonus when they shouldn't
- Bonus economics: ~12-15% of pack days will use auto-allow → small margin tax

## Cross-references
- Module 06 (day-pack solver) — sets `completion_bonus_pence` at pack creation
- Module 07 (pay-protection) — implements carve-out approval workflow + auto-allow timer
- Module 09 (contractor app) — Builder dashboard shows bonus state
- Module 15 (day-pack page) — visible-promise of bonus on offer
- ADR-008 (materials collection) — pickup requirement is the gate
