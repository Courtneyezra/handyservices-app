# Module 02: Job Tagging at Quote Creation

**Status:** Wave 3 — authoritative
**Phase:** 1 (customer-side + admin)
**Flag:** `FF_JOB_TAGGING`
**Depends on:** `data-model.md` §2 (extended `personalized_quotes`), ADR-005, ADR-008
**Owner:** Wave 3 Agent 02

---

## 1. Purpose

Manual structured tagging at quote-create time. The quoter (admin or VA) ticks a compact panel that drives **all** downstream routing decisions: contractor segment, crew size, day-pack fit, materials pickup, pay-protection variance baseline.

Replaces the current pattern of the system inferring attributes from free-text. Humans tag, machines route. Inference can return as an assistive layer (§9) but never as authoritative.

This is the upstream half of ADR-005: `pricing_time_minutes` and `real_work_minutes` are **both** captured at intake. ADR-008's per-line `supply_status` is also captured here via Module 12's editor.

---

## 2. Tag schema (the inputs)

All fields persist on `personalized_quotes` per `data-model.md` §2 unless noted.

| Field | Type | Default | Stored on |
|---|---|---|---|
| `crew_size_required` | `int` (1/2/3/4) | `1` | `personalized_quotes` |
| `skills_required` | `jsonb` (string[]) | `[]` | `personalized_quotes` |
| `cert_required` | `jsonb` (string[]) | `[]` | `personalized_quotes` — Gas Safe / Part P / structural / asbestos |
| `duration_estimate_minutes` | `int` | derived from SKU | `personalized_quotes` (pricing time, ADR-005) |
| `real_work_minutes` | `int` | from de-pad table | `personalized_quotes` (ops time, ADR-005) |
| `complexity_flags` | `jsonb` (string[]) | `[]` | `personalized_quotes` — `heavy_lifting`, `awkward_access`, `stairs`, `external`, `permits`, `old_property` |
| `customer_supplied_materials` | `bool` | `false` | per-line on `pricingLineItems[].materials[].supply_status` (ADR-008) |
| `materials_collection_minutes` | `int` | `0` | `personalized_quotes` (rolls up from line items) |
| `weather_dependent` | `bool` | `false` | `personalized_quotes` (also represented as a `complexity_flags` chip for UI) |
| `parking_difficulty` | `varchar` | `'free'` | `personalized_quotes` — `free` / `pay_and_display` / `permit_only` / `restricted` |

`heavy_lifting` is a denormalised top-level boolean on `personalized_quotes` (per `data-model.md` §2) so routing can filter without parsing `complexity_flags`. The panel keeps both in sync: the chip writes both fields.

---

## 3. Files

```
NEW       client/src/components/admin/JobTagPanel.tsx
NEW       server/job-profile.ts                              (computes JobProfile from tags + SKU)
MODIFIED  client/src/pages/admin/GenerateContextualQuote.tsx (insert tag panel)
MODIFIED  client/src/pages/admin/EditQuotePage.tsx           (edit tags)
MODIFIED  server/quotes.ts                                   (validate + persist tags)
MODIFIED  shared/schema.ts                                   (per data-model.md §2 additions)
```

Column shapes live in `data-model.md` §2; this module only adds them.

---

## 4. UI design

A compact panel mounted **below** the SKU line items in `GenerateContextualQuote.tsx` and surfaced again in `EditQuotePage.tsx`. Brand styling per Module 13 (navy header, yellow accent on active chip, Poppins). Sections:

**Crew & skills** — `crew_size_required` radio (1/2/3/4, default 1); `skills_required` multi-select chip cloud sourced from distinct `category` values in `productized_services`, pre-populated from the line-item SKU(s).

**Certifications** — four checkboxes (Gas Safe, Part P, Structural, Asbestos), mutually independent. Any tick gates the job to the Specialist segment in Module 05.

**Duration** — two editable side-by-side fields:
- **Pricing time (min)** — `duration_estimate_minutes`, pre-filled from EVE; editing re-prices via the existing engine.
- **Real work time (min)** — `real_work_minutes`, pre-filled from the de-pad table (§7) with hint text like "carpentry × 0.50 → 240 min suggested".

Inline validation: real ≤ pricing always (§8).

**Complexity flags** — toggleable chip row: `heavy_lifting`, `awkward_access`, `stairs`, `external`, `permits`, `old_property`, `weather_dependent`. Multi-select. Yellow-fill when active, hollow navy outline when inactive.

**Materials** — inline link "Edit materials per line →" opens the Module 12 editor. Each line gets a `supply_status` dropdown (`handy_supplied` / `customer_supplied` / `contractor_pickup` / `contractor_van_stock`) per ADR-008. `materials_collection_minutes` rolls up automatically from `contractor_pickup` lines (Module 12 owns the rollup).

**Parking** — single dropdown: `free` / `pay_and_display` / `permit_only` / `restricted`. Drives an ops-time buffer in Module 06.

Panel is collapsible (default expanded for new quotes, collapsed for already-tagged quotes in Edit). When `FF_JOB_TAGGING` is OFF the panel is not rendered (§11).

---

## 5. JobProfile object

After tagging, `server/job-profile.ts` exports a helper that computes the canonical shape consumed by the routing engine (Module 05) and the day-pack solver (Module 06):

```ts
interface JobProfile {
  quoteId: string;
  skills_needed: string[];
  cert_needed: string[];
  crew_size: number;
  real_work_minutes: number;        // for ops only
  pricing_time_minutes: number;     // for EVE only — never read by ops
  complexity_flags: string[];
  is_outdoor: boolean;              // derived: 'external' ∈ complexity_flags
  is_heavy_lift: boolean;           // mirrors personalized_quotes.heavy_lifting
  customer_flexibility: 'fast' | 'flexible' | 'relaxed';   // from flex_tier (Module 01)
  postcode: string;
  area: string;        // resolved from postcode (e.g. "NG2") for area_catchment matching
}
```

`JobProfile` is **derived, not stored** — recomputed on demand from the persisted columns. Source of truth stays in `personalized_quotes`, no stale-cache class of bugs. The shape is the contract Module 05 depends on; future fields (e.g. `customer_at_home`, `pet_present`) land here first, then in the panel.

---

## 6. API

Two endpoints added to `server/quotes.ts`, gated by `FF_JOB_TAGGING`:

- **`PUT /api/admin/quotes/:id/tags`** — accepts the §2 schema, validates per §8, persists to `personalized_quotes`. Returns `{ ok: true, profile: JobProfile }`. Tagging does not change `booking_state` (no `booking_state_log` row).
- **`GET /api/admin/quotes/:id/profile`** — returns the recomputed `JobProfile`. Consumed by Module 08 (control tower) and Module 05 (routing).

Both require admin auth (existing `/api/admin/*` middleware). When the flag is OFF both routes return `404`.

---

## 7. De-pad helper (real_work_minutes default)

When the quoter selects an SKU on a line item, the panel suggests a default `real_work_minutes` from the per-category de-pad factor table specified in **ADR-005 §migration plan**:

| Category | De-pad factor |
|---|---|
| general_fixing | 0.55 |
| carpentry | 0.50 |
| plumbing_minor | 0.60 |
| tiling | 0.50 |
| curtain_blinds | 0.40 |
| door_fitting | 0.40 |
| shed_install | 0.50 |
| fencing | 0.65 |

Computed as `round(timeEstimateMinutes × category_factor)`; multi-category quotes sum per-line factors. The quoter can override; both values persist; both validate independently. After ADR-005's 30-day dual-capture window, the factor table becomes a fallback for legacy/imported quotes only.

---

## 8. Validation

Server-side Zod schema on `PUT /api/admin/quotes/:id/tags`:

- `crew_size_required` ∈ `{1, 2, 3, 4}`.
- `skills_required[]`: each must be a valid skill slug (distinct `category` values in `productized_services`); unknowns rejected with the offending slug in the error.
- `cert_required[]`: subset of `{gas_safe, part_p, structural, asbestos}`.
- `duration_estimate_minutes` > 0.
- `real_work_minutes` > 0 **AND** `real_work_minutes ≤ duration_estimate_minutes`. Real > pricing means the line is under-priced — surface the error, never auto-fix.
- `complexity_flags[]`: subset of the seven known flags.
- `parking_difficulty`: subset of the four known values.

Client mirrors via the shared schema in `shared/schema.ts`; "Save" disabled until valid.

---

## 9. Auto-tag suggestions (Phase 4+)

Out of scope for v1. Once ≥30 completed jobs per SKU exist, an assistive layer can suggest tags from modal values across past quotes with the same SKU + postcode area. Quoter still confirms — never auto-applies. Mentioned here so the panel reserves space for a "Suggested" badge at launch rather than redesigning later.

---

## 10. Tests

- **Validator (`server/__tests__/job-profile.test.ts`):** unknown skills, off-list certs, real > pricing, crew_size out of range, missing fields — all rejected with field path in the error.
- **API (`server/__tests__/quote-tags-api.test.ts`):** `PUT` persists every column and is idempotent on retry; `GET /profile` returns the recomputed JobProfile reflecting same-cycle edits; both routes 404 when `FF_JOB_TAGGING` is off.
- **Component (`JobTagPanel.test.tsx`):** panel renders SKU defaults; overrides flow through to the request payload; de-pad hint updates with SKU change; `heavy_lifting` chip writes both the array and the top-level boolean.
- **Integration:** SKU pick in `GenerateContextualQuote.tsx` pre-fills the panel; save persists tags; reload in `EditQuotePage.tsx` rehydrates.

---

## 11. Rollback

`FF_JOB_TAGGING = 0` (production default at launch):

- Tag panel does not render in either admin page.
- `PUT /api/admin/quotes/:id/tags` and `GET /.../profile` return 404.
- New quotes save with new columns at their NULL/default values — additive-only schema makes this safe.
- Modules 05/06/07 detect missing tags and fall back to category defaults from `productized_services` — the same data the legacy v1 path uses.

Flipping back ON resumes tagging without a redeploy. No backfill needed; `data-model.md` §7 covers legacy rows.

---

## 12. Cross-references

- **ADR-005** — pricing-time vs real-work; this module is the intake surface for both.
- **ADR-008** — per-line `supply_status`; Module 12 owns the editor, Module 02 surfaces the link.
- **Module 01** — flex tier feeds `customer_flexibility` into JobProfile.
- **Module 05** — sole authoritative consumer of JobProfile.
- **Module 06** — reads `real_work_minutes`, `crew_size`, `complexity_flags`, `parking_difficulty`.
- **Module 07** — `real_work_minutes` is the mis-scope variance baseline.
- **Module 12** — per-line `supply_status` editor and `materials_collection_minutes` rollup.
- **Module 13** — chip, radio, panel-shell components.
- **`data-model.md` §2** — authoritative column definitions.
- **`feature-flags.md` §3** — `FF_JOB_TAGGING` semantics.
