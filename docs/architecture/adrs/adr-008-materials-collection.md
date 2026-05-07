# ADR-008: Materials Collection as a First-Class Step

## Status
Accepted

## Context

Real contractor days don't start at the first job — they start at the merchant. A handyman doing 4 jobs across NG2/NG5/NG9/NG14 typically loads up at Screwfix or Wickes first. This 30-60 minute slot is non-billable but real. The current system pretends it doesn't exist:

- "Materials supplied by Handy" hero claim implies delivery (sometimes true, often not)
- The routing solver assumes the contractor starts at job 1
- Day-pack assembly doesn't account for the merchant run

Result: contractors finish the day exhausted because the math didn't include the pickup. Or they refuse jobs requiring obscure materials they'd have to source themselves.

The MVP test page (`/dispatch-preview`) demonstrated a clean UX pattern: pickup as Step 0 in the timeline, with package icon, supplier address, items list, "Mark collected" button, and inclusion in the all-or-nothing bonus.

## Options considered

**Option A: Hide materials collection (status quo).** Contractor sorts it. Pros: less surface. Cons: dishonest about the day, breaks routing math.

**Option B: Per-item status, data-only.** Schema captures who-supplies-what; UI never surfaces it. Pros: smaller migration. Cons: contractor still sees nothing; doesn't solve the operational problem.

**Option C: Materials pickup as a first-class STEP in the timeline.** Visible alongside stops, with its own state, button, and bonus gating. **Chosen.**

## Decision

**Option C.**

### Per-item data model

Each material line item carries a `supply_status` field with one of four values:

- `handy_supplied` — Handy delivers to first stop or pre-stages on the van
- `customer_supplied` — customer has it on site (e.g. "I have the curtain track, just install")
- `contractor_pickup` — contractor goes to a merchant
- `contractor_van_stock` — already in contractor's van (drill bits, fixings, sealant)

Schema (per `data-model.md`):

```ts
// pricingLineItems[].materials[]
{
  name: "Lock set + strike plate",
  quantity: 1,
  supply_status: "contractor_pickup",
  supplier_id?: "screwfix-castle-blvd",  // null if van_stock or supplied
  estimated_cost_pence?: 800,
}
```

### Aggregation into pickup steps

A day-pack can have 0, 1, or N pickup runs. The Module 06 solver groups all `contractor_pickup` items by `supplier_id`. Each unique supplier becomes a `materials_pickups` row (Module 12 schema). For Mark's test pack — 5 items, all from Screwfix · Castle Boulevard — this collapses to ONE pickup step at the top of the timeline. If a pack needs Screwfix AND Wickes, two pickup steps appear, chained at the start of the day.

### UI integration

The pickup step renders identically to a stop step:
- Numbered-style dot (or package icon for visual differentiation)
- Title: supplier + branch name
- Address line: postcode
- Items list (chips, ≤ 8 visible, "+N more" if longer)
- "Mark collected" button (mirrors the "Mark complete" pattern)
- Counts toward the all-or-nothing bonus (per ADR-007)

### Pickup time integration

The solver budgets `materials_pickup.estimated_minutes` (default 30 min for one supplier; +15 min per additional supplier) into the day's total. Flow:

```
home → supplier(s) → stop 1 → ... → stop N → home
```

## Consequences

**Positive:**
- Honest about the day; routing math reflects reality
- Contractor sees what they're getting into before accepting
- Day-rate calc includes pickup time → fairer day rate
- Per-item status lets admin migrate pickup-needed items to van_stock as supply chain matures

**Negative / accepted:**
- New schema field on every material line — migration overhead
- Per-supplier aggregation logic in Module 06 (solver complexity)
- Contractor must mark pickup complete (extra tap) — small UX cost
- Forces honesty about which materials Handy actually delivers (may surface supply-chain gaps)

## Edge cases

- **Pickup skipped, van stock used:** contractor flags "skipped — van stock"; counts as complete for bonus; admin reviews for patterns
- **Supplier closed on arrival:** contractor flags "supplier closed"; reschedule logic kicks in (Module 07 pay-protection callout fee path)
- **Item out of stock:** contractor flags "out of stock"; alternative supplier search runs (Module 12 workflow)

## Cross-references
- Module 12 (materials-collection) — full implementation
- Module 06 (day-pack solver) — pickup time + aggregation
- Module 07 (pay-protection) — receipt reimbursement + skip handling
- ADR-007 (bonus model) — pickup gates the bonus
- `data-model.md` — schema additions
- The MVP test page (`/dispatch-preview`) — UX reference
