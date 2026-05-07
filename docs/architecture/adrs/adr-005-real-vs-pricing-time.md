# ADR-005: Decouple `pricing_time_minutes` from `real_work_minutes`

## Status

**Accepted** — first-class blocker for Phase 2 onward. No downstream module may ship reading the pricing-side time field.

## Context

The EVE pricing engine (`server/eve-pricing-engine.ts`) computes customer price as:

```
price = max(£35/hr floor, segment_rate × (timeEstimateMinutes / 60))
```

Time **is** the price lever — increase `timeEstimateMinutes` → increase price. Quote engineers have, for valid customer-facing reasons, padded `timeEstimateMinutes` to make customer £/hr appear competitive. Real example from production:

- Quote `zw2eqimg`: "Install 6x4 shed and level floor" → `timeEstimateMinutes: 480` (8 hours), priced at £320 (£40/hr customer-rate). Real time on site: ~4 hours. The honest customer rate would be £80/hr — too premium for a domestic customer to accept, so time was inflated to bring £/hr into the comfort zone.

This pattern recurs across categories (carpentry, plumbing minor, curtain & blinds, door fitting, tiling, shed install). Average inflation factor is in the 1.7×–2.2× range.

The new ops layer (Phases 4–6) currently reads `timeEstimateMinutes` for:

- **Day-pack solver** — packs 4 jobs of "8 hours each" into a 32-hour day; contractor finishes by lunch.
- **Contractor pay** — £-floor against inflated minutes; £/hr-on-paper looks fair, hours weren't real.
- **Routing** — over-allocates a single contractor on fake duration.
- **Pay-protection mis-scope check** — 1.20× variance trigger is meaningless against a 2×-inflated baseline.

If Phases 4–6 ship reading `timeEstimateMinutes`, the entire ops layer is built on quicksand. Surfaced during MVP test-page work: production has only the inflated field; demonstrating the day-pack accurately forced the issue.

## Options considered

**Option A — Fix the pricing engine to not use time as a multiplier.** Switch EVE to `reference_price + differentiator_value`. Clean, but requires re-modelling hundreds of SKUs with customer-side regression risk. **Rejected for now** — correct long-term direction, wrong scope.

**Option B — Accept inflation, deflate at consumption.** Apply a category factor in routing/pay. Minimal pricing change, but the factor is wrong half the time and ops still runs on guess data. **Rejected.**

**Option C — Decouple: store BOTH `pricing_time_minutes` and `real_work_minutes`.** Pricing reads pricing-time (unchanged); ops reads real-work. **Chosen.**

## Decision

**Option C.** Add a first-class `real_work_minutes` field at SKU and quote-line level. Pricing engine continues to read `timeEstimateMinutes` (no behavior change, no customer-side regression). Every ops-layer consumer reads `real_work_minutes`.

## Schema impact

```sql
-- productized_services (SKU-level real time)
ALTER TABLE productized_services
  ADD COLUMN real_work_minutes INT,
  ADD COLUMN pricing_time_padded_pct DECIMAL(4,2);  -- audit field: real / pricing ratio

-- personalized_quotes.pricingLineItems is JSONB; new line shape:
{
  "lineId": "...",
  "title": "...",
  "timeEstimateMinutes": 480,           -- existing, used by EVE pricing
  "real_work_minutes": 240,             -- NEW, used by ops
  "materials_collection_minutes": 30,   -- NEW, see Module 12 / ADR-008
  "setup_minutes": 12,                  -- NEW, default per category
  "cleanup_minutes": 15                 -- NEW, default per category
}
```

`real_work_minutes` is the SUM of on-site execution time only. Materials collection, setup, and cleanup are tracked as siblings (not nested) so the day-pack solver can bin-pack them independently and the travel-time engine (ADR-006) can attribute them correctly.

## Migration plan

1. **Add columns NULL-default** — no data loss, no behavior change. Deploy schema first, code second.
2. **Build per-category de-pad factor table** (admin-tunable). Defaults from current production sampling:

   | Category          | De-pad factor |
   |-------------------|---------------|
   | general_fixing    | 0.55          |
   | carpentry         | 0.50          |
   | plumbing_minor    | 0.60          |
   | tiling            | 0.50          |
   | curtain_blinds    | 0.40          |
   | door_fitting      | 0.40          |
   | shed_install      | 0.50          |
   | fencing           | 0.65          |

3. **Backfill `real_work_minutes`** on existing quotes via one-shot script: `real_work_minutes = round(timeEstimateMinutes × category_factor)`.
4. **Going-forward intake** — quote creation UI captures BOTH `pricing_time_minutes` (for EVE) AND `real_work_minutes` (for ops). See Module 02 (job-tagging).
5. **Dual-capture validation window — 30 days.** Compare captured `real_work_minutes` vs actual job-completion timestamps. Tune the de-pad factor table per category from observed data.
6. **Deprecate the de-pad factor** once 30 days of clean dual-capture is in. Rely on captured `real_work_minutes` only; the factor table becomes a fallback for legacy/imported quotes.

## Consequences

**Positive:**
- Routing, pay, and day-pack solver work on honest time data.
- Pricing engine unchanged — no customer-side regression risk.
- Audit field (`pricing_time_padded_pct`) makes inflation visible and trackable.
- Future migration to non-time-based EVE (Option A) is unblocked.

**Negative / accepted:**
- 30 days of de-pad-factor estimates (rough but better than 2×-inflated baseline).
- Quoter UX adds one field at creation (real_work_minutes alongside pricing_time).
- Two time fields per line is a permanent footprint until pricing migrates off time.

## Cross-references

- **ADR-006** — travel-time engine (companion ADR; together they form the day-time model)
- **ADR-008** — materials-collection time accounting
- **Module 02** — job-tagging at quote intake (captures `real_work_minutes`)
- **Module 06** — day-pack solver (reads `real_work_minutes` for bin-packing)
- **Module 07** — pay-protection (variance check uses `real_work_minutes` baseline)
- **`docs/architecture/data-model.md`** — full schema additions
