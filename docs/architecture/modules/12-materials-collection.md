# Module 12: Materials Collection

**Status:** Wave 3 — authoritative
**Phase:** 5 (intrinsic to day-packs; surfaces with `FF_DAY_PACK`)
**Flag:** none of its own — gated by `FF_DAY_PACK` and `FF_JOB_TAGGING`
**Depends on:** `data-model.md` §3 (`materials_pickups`), ADR-008, ADR-007, Module 02 (tag panel), Module 06 (solver), Module 07 (pay protection)
**Owner:** Wave 3 Agent 12

---

## 1. Purpose

Materials are a first-class step in the contractor's day. Per-line `supply_status` (one of four values) drives both the customer-facing UX and the day-pack solver's routing math. The solver aggregates all `contractor_pickup` items across the day's jobs by `supplier_id`, producing 0–N `materials_pickups` rows attached to the `day_pack`. Each pickup renders in the timeline as Step 0 (or chained between stops) with a "Mark collected" action that **gates the all-or-nothing completion bonus** per ADR-007.

The MVP test page (`/dispatch-preview`) demonstrates the UX. This module formalises that pattern into the production data model, server logic, admin authoring UI, and contractor execution UI.

---

## 2. Per-item `supply_status`

Each material line item carries a four-value enum:

```ts
type SupplyStatus =
  | 'handy_supplied'        // Handy delivers to first stop or pre-stages on the van
  | 'customer_supplied'     // customer has it on site
  | 'contractor_pickup'     // contractor goes to a merchant
  | 'contractor_van_stock'; // already in contractor's van (drill bits, sealant)

interface MaterialItem {
  name: string;                    // "Lock set + strike plate"
  quantity: number;
  supply_status: SupplyStatus;
  supplier_id?: string;            // required iff supply_status === 'contractor_pickup'
  estimated_cost_pence?: number;   // for reimbursement calc (Module 07)
  collected_at?: Date;             // populated when contractor marks pickup done
}
```

Stored under `personalized_quotes.pricingLineItems[].materials[]` (jsonb). Authoring happens in Module 02's tag panel via the per-line modal owned by this module (`MaterialsLineItemEditor.tsx`).

---

## 3. Aggregation into pickup steps

Module 06's solver invokes this module's aggregator after candidate jobs are bin-packed:

```
day_pack dp_42
  → materials_pickups [
      { supplier_id: 'screwfix-castle-blvd', items: [...5...], minutes: 30 },
      { supplier_id: 'wickes-lenton',        items: [...2...], minutes: 20 },
    ]
```

Rules: iterate every job → line item → material; filter `supply_status === 'contractor_pickup'`; group by `supplier_id`; each group becomes one `materials_pickups` row. Default minutes = 30 for the first supplier, +15 per additional (ADR-008). For Mark's MVP pack (5 items, all from Screwfix Castle Boulevard) → ONE pickup step.

---

## 4. Schema (cross-ref `data-model.md` §3)

`materials_pickups(id, day_pack_id FK, supplier varchar, branch_name varchar, postcode, open_from time, estimated_minutes int, items jsonb, status enum pending/collected/skipped, collected_at, collected_by_unit_id FK)`. Index: `idx_mp_day_pack` on `(day_pack_id)`.

The `items` jsonb is a snapshot at solver-time. If admin re-tags after the pack is offered, the pickup row is **not** mutated — re-aggregation requires releasing and re-solving the pack.

---

## 5. Files

```
NEW       server/materials/aggregator.ts          # group items by supplier from pack jobs
NEW       server/materials/suppliers.ts            # static supplier registry (Screwfix, Wickes, Toolstation branches)
NEW       server/materials/routes.ts               # mark-collected, mark-skipped, receipt upload
NEW       client/src/components/admin/MaterialsLineItemEditor.tsx   # per-line editor in admin quote builder
NEW       client/src/components/contractor/MaterialsPickupStep.tsx  # timeline step, mirrors DispatchPreviewPage pattern
MODIFIED  client/src/components/admin/JobTagPanel.tsx                # link to per-line editor
MODIFIED  shared/schema.ts                                            # materials_pickups table per data-model.md
```

Tests live alongside (`server/materials/__tests__/aggregator.test.ts` etc).

---

## 6. Supplier registry

Static list in `server/materials/suppliers.ts`:

```ts
export const SUPPLIERS = [
  { id: 'screwfix-castle-blvd', name: 'Screwfix',    branch: 'Castle Boulevard', postcode: 'NG7 1FR', opens: '07:00', closes: '20:00' },
  { id: 'wickes-lenton',        name: 'Wickes',      branch: 'Lenton',           postcode: 'NG7 2EH', opens: '07:00', closes: '21:00' },
  { id: 'toolstation-meadows',  name: 'Toolstation', branch: 'Meadows',          postcode: 'NG2 1AB', opens: '07:00', closes: '20:00' },
  // … extend as we onboard branches
];
```

Future: admin UI to CRUD branches with maps integration. For Phase 5 a static NG-postcode list is enough.

---

## 7. UX integration

### 7a. Admin (quote-create)

`MaterialsLineItemEditor.tsx` is opened from `JobTagPanel.tsx` (Module 02) — a "Materials" button per `pricingLineItem` opens a modal listing each material with: name, quantity, `supply_status` dropdown (default `handy_supplied`), `supplier_id` searchable select (required when `contractor_pickup`), `estimated_cost_pence`. Quick presets: "Common fixings → van stock", "All customer-supplied". Validation blocks save if any `contractor_pickup` row lacks `supplier_id`.

### 7b. Contractor (day-pack offer page)

`MaterialsPickupStep.tsx` renders as the FIRST timeline step on the offer / accepted-pack page (Module 15), mirroring the MVP: package icon, title `"{supplier} · {branch_name}"`, postcode, items as chips (≤ 8 inline; "+N more"), `estimated_minutes`, "Mark collected" CTA. If the pack has two pickups the second renders as a chained step inserted before stop 1 (or mid-day, per solver placement).

### 7c. Contractor (post-pickup)

Optional photo-of-receipt upload on the same step → Module 07 materials reimbursement workflow on the contractor's payout.

---

## 8. Solver integration (Module 06)

1. Solver bin-packs candidate jobs into a tentative pack.
2. Calls `aggregator.aggregateByPickup(jobs)` → returns `MaterialsPickupRun[]`.
3. Budgets total pickup minutes into the day's time envelope; if it doesn't fit, drops the lowest-priority job and re-aggregates.
4. Places the first pickup as Step 0 (before stop 1). With two pickups the second is also typically at the start; routing engine (Module 05) may insert mid-day if a supplier is closer to stop K than to home.
5. Pickup minutes count in `day_packs.travel_minutes` for the day-rate calc (ADR-008).
6. Writes `materials_pickups` rows in the same transaction as `day_packs`.

---

## 9. Edge cases (per ADR-008)

**Van stock skip.** Contractor flags "skipped — van stock". Status `skipped`; pack still counts complete for bonus (ADR-007). Admin reviews patterns — repeat skippers get those items re-tagged as `contractor_van_stock` by default.

**Supplier closed.** Contractor flags "supplier closed"; triggers Module 07 callout-fee path; affected stops move to `reschedule_required`; bonus honoured under ADR-007 force-majeure carve-out.

**Item out of stock.** Contractor flags "out of stock"; system auto-suggests nearest alternative from the registry; if none, escalates via Module 08 control tower.

**Customer-supplied missing on arrival.** Not a pickup-step issue — flagged at job arrival (`customer_supplied_missing`). ADR-007 carve-out 3 honours bonus once admin confirms.

---

## 10. Mark-collected flow

```
POST /api/contractor/day-packs/:packId/materials/collected
Body: { materials_pickup_id, photo_url? }

Server (server/materials/routes.ts):
  1. Verify auth.unit_id is the accepted contractor on packId.
  2. SELECT … WHERE id=:id AND day_pack_id=:packId AND status='pending' FOR UPDATE.
  3. UPDATE status='collected', collected_at=now(), collected_by_unit_id.
  4. Append booking_state_log entry (informational).
  5. Fire notification: "Pickup confirmed at {supplier}".
  6. Re-evaluate bonus eligibility (ADR-007); return updated bonusEarned.
  7. If photo_url present, enqueue Module 07 reimbursement intake.

Returns: { pickup, bonusState: { earned, amount_pence } }
```

Mirror `POST …/materials/skipped` writes `status='skipped'` + `skip_reason` (van_stock / supplier_closed / out_of_stock).

---

## 11. Tests

| Area | Cases |
|---|---|
| Aggregator | 4 jobs with mixed `supply_status` → expected pickup count + items per pickup; van-stock-only pack → 0 pickups; two-supplier pack → 2 rows; missing `supplier_id` on `contractor_pickup` → throws. |
| Mark-collected | Happy path → status flip, timestamp, bonus eligibility recalculated; non-assigned contractor → 403; already-collected → 409; non-pending → no-op. |
| Skipped | Each skip reason path; van_stock counts toward bonus; supplier_closed triggers Module 07 callout entry. |
| Out-of-stock alternative | Registry returns nearest alternative; empty alternatives → escalation event. |
| Per-line editor | Persists `supply_status` correctly per line; validation blocks `contractor_pickup` without `supplier_id`; bulk-preset apply. |

---

## 12. Rollback

No dedicated flag. With `FF_DAY_PACK = 0` the solver doesn't run, no `materials_pickups` rows are written, and the aggregator + routes are dormant. The per-line `supply_status` field is still captured under `FF_JOB_TAGGING` — harmless when day-packs are off, and ready when they flip on.

---

## 13. Cross-references

- `adrs/adr-008-materials-collection.md` — the decision (per-item supply_status, pickup as first-class step).
- `adrs/adr-007-bonus-model.md` — pickup gates the all-or-nothing bonus.
- `data-model.md` §3 — `materials_pickups` table schema.
- `modules/02-job-tagging.md` — captures `supply_status` per line via the editor owned here.
- `modules/06-day-pack-solver.md` — consumes aggregator + budgets pickup minutes.
- `modules/07-pay-protection.md` — receipt reimbursement + skip handling (callout fee, materials missing).
- `modules/15-day-pack-page-production.md` — renders `MaterialsPickupStep` as Step 0.
- `client/src/pages/contractor/DispatchPreviewPage.tsx` — UX reference (the MVP test page).
