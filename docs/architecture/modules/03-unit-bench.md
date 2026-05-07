# Module 03: Unit Bench (Supply Data Model)

**Status:** Wave 3 — authoritative
**Phase:** 2
**Primary flag:** `FF_UNITS_BENCH`
**Depends on:** `data-model.md` §2 (handyman_profiles extensions), `adrs/adr-003-segmentation.md`

---

## 1. Purpose

The Unit Bench is the supply-side foundation of Booking & Dispatch v2. It
extends `handyman_profiles` — re-labelled "Units" in routing language but
keeping the table name for migration safety — with the structured fields
the rest of the system needs to make supply decisions: segment, geography,
capabilities, economic floor, reliability.

Without this module the routing engine has no segment to filter on, the
day-pack solver has no Builders to address, the contractor app has no
dashboard to specialise, and pay protection has no day-rate target. Everything
supply-side downstream consumes columns this module owns.

Deliverable: column extensions on `handyman_profiles` (per `data-model.md` §2)
plus a structured admin "Units" page. Self-service contractor editing of
these fields is deferred to Module 09.

## 2. Schema reference

The full DDL lives in `data-model.md` §2 under "`handyman_profiles` (the
Unit entity)". The new columns this module reads and writes are:

| Column | Purpose |
|---|---|
| `contractor_segment` | `builder` / `gap_filler` / `specialist`. Routing tier filter. |
| `unit_type` | `single` / `team`. Drives crew-size matching. |
| `crew_max` | Max simultaneous people the unit can field. |
| `home_postcode` | Travel anchor for distance pre-filter. |
| `area_catchment` | jsonb array of postcode prefixes (e.g. `["NG7","NG8","NG2"]`). |
| `skills` | jsonb array of skill slugs (mirrors `personalized_quotes.skills_required`). |
| `accepts_skus` | Optional explicit SKU allow-list overriding `skills`. |
| `certs` | jsonb array of cert slugs (`gas_safe`, `niceic`, `part_p`, `structural`). |
| `min_job_value_pence` | Below this, unit declines. Gap-Filler signal. |
| `day_rate_target_pence` | Builder-only — what the unit wants to earn for a full day. |
| `reliability_score` | decimal(3,2), 0.00–1.00, computed daily. |
| `priority_routing_score` | decimal(5,2), computed nightly, ranks units within segment. |

This module does not introduce new tables. All persistence is on the existing
`handyman_profiles` row.

## 3. Files

```
NEW       client/src/pages/admin/UnitsPage.tsx
NEW       client/src/pages/admin/UnitDetailPage.tsx
NEW       client/src/components/admin/SegmentBadge.tsx
NEW       client/src/components/admin/SkillsMultiselect.tsx
NEW       server/units-service.ts
MODIFIED  client/src/pages/admin/ContractorsPage.tsx   (redirects to /admin/units when FF_UNITS_BENCH)
MODIFIED  shared/schema.ts                              (per data-model.md §2)
MODIFIED  client/src/App.tsx                            (register /admin/units, /admin/units/:id)
NEW       scripts/seed-segments.ts                      (backfill — see §8)
NEW       server/cron/reliability-score.ts              (daily compute — see §9)
```

## 4. Admin UI — Units list

Route: `/admin/units` (gated on `FF_UNITS_BENCH`; otherwise renders
`<Redirect to="/admin/contractors"/>`).

Filter bar: segment pills (All · Builder · Gap-Filler · Specialist), area
postcode-prefix dropdown (derived from `DISTINCT area_catchment` unrolled),
skills multiselect (`SkillsMultiselect.tsx`, AND-match), free-text search
on name / business / email.

Table columns: Name · Segment (`<SegmentBadge>` — Builder navy, Gap-Filler
yellow, Specialist green outline) · Skills (first 3 chips + "+N" overflow) ·
Area (`home_postcode` + catchment chip count) · Day rate target (Builder only;
em-dash otherwise) · Reliability (decimal + traffic-light band ≥0.95 / 0.80 /
<0.80) · Last active (`lastAssignedAt` relative).

Server-side sort on `business_name`, `reliability_score`, `lastAssignedAt`.
50 rows/page, cursor on `(reliability_score DESC, id ASC)`.

## 5. Admin UI — Unit detail

Route: `/admin/units/:id`. Collapsible brand-styled cards (Module 13 tokens —
navy headers on `bg-light`, yellow CTA accents).

- **Identity.** Avatar, name, contact, business_name, public profile link
  (`/p/:slug`), DBS / insurance / Stripe Connect status pills.
- **Segment & type.** `contractor_segment` dropdown; `unit_type` toggle;
  `crew_max` input (editable only when `unit_type='team'`). Dropdown changes
  trigger §6.
- **Capabilities.** `SkillsMultiselect` bound to `shared/categories.ts`; cert
  checkboxes with adjacent verification status (`unverified`/`pending`/
  `verified` — cert document verification stays with existing
  `verificationStatus` flow); optional `accepts_skus` SKU multiselect (empty
  = use skills filter only).
- **Geography.** `home_postcode` input; `area_catchment` as removable chips
  with autocomplete adder.
- **Economics.** `day_rate_target_pence` (Builder-only, helper "What this
  unit wants to earn for a full committed day"); `min_job_value_pence`
  (Gap-Filler / Specialist). Both £ inputs, stored as pence.
- **Performance.** Read-only. `reliability_score`, `priority_routing_score`,
  plus 30-day mini-table: jobs completed, avg rating, no-shows, late
  cancellations, declines (sourced from `dispatch_completions` and
  `routing_offers` joined on `unit_id`).

## 6. Re-segmentation flow

Per ADR-003, a unit holds one segment at a time. Three change paths:

1. **Self-request** — contractor app posts to a Module 09 endpoint; lands in
   an admin queue rendered on the Units page header.
2. **Admin override** — segment dropdown with confirmation modal.
3. **Auto-suggestion** (Phase 7+) — nightly job flags drifts (e.g.
   Gap-Filler taking 25+ jobs/month → suggests Builder) as a banner. No
   automatic write.

Hard guards on commit (server-side, in `units-service.updateSegment`):

- **Builder → Gap-Filler / Specialist:** block if any `day_commitments`
  row for this `unit_id` has `status IN ('open','assembling','offered','accepted')`.
  Admin must release the commitment first (Module 06).
- **Specialist → other:** block if any `routing_offers` for this unit has
  `status='pending'` on a cert-required job — wait for resolution.
- **Any → Specialist:** require at least one entry in `certs` whose
  verification status is `verified`; otherwise reject.

Every successful change writes a `routing_decisions` row with
`decision_type='segment_change'`: previous, new, trigger, any
blocked-then-overridden warnings.

## 7. API

Per `api-surface.md`. All routes admin-auth-gated and feature-flag-aware.

| Method + path | Purpose |
|---|---|
| `POST /api/admin/units` | Create a unit. Body: profile fields. Returns `{ id }`. |
| `GET /api/admin/units?segment=&area=&skills=&search=&cursor=` | List with filters. |
| `GET /api/admin/units/:id` | Single unit + nested perf metrics. |
| `PUT /api/admin/units/:id` | Patch any subset of editable columns. |
| `DELETE /api/admin/units/:id` | Soft delete — sets `deletedAt`; record kept for FK integrity. |
| `POST /api/admin/units/:id/segment-change` | Dedicated endpoint that runs the §6 guards. |
| `GET /api/admin/units/segment-change-requests` | Pending self-requests. |
| `POST /api/admin/units/segment-change-requests/:id/decision` | Approve or reject. |

Internal helpers (server-only):

- `getEligibleUnitsForJob(jobProfile)` — Module 05 eligibility filter.
  Inputs: skills_required, cert_required, crew_size_required, postcode,
  min_job_value. Returns ranked candidate units.
- `getUnitsCommittedToDate(date, area)` — Module 06 day-pack solver.
  Filters Builder units with an `open` / `assembling` `day_commitments` row.

Write paths emit an audit row to `routing_decisions`.

## 8. Data backfill

Per `data-model.md` §7, existing rows default to `contractor_segment=
'gap_filler'`. `scripts/seed-segments.ts` (idempotent, all updates
`WHERE col IS NULL`):

1. `contractor_segment='gap_filler'`
2. `unit_type='single'`, `crew_max=1`
3. `home_postcode` ← `postcode` when present
4. `skills` ← aggregated `DISTINCT handyman_skills.categorySlug`
5. `reliability_score=1.00`

Builders and Specialists are explicitly admin opt-in via the Units page —
the script never auto-promotes. Specialists additionally require the cert
verification step.

## 9. Reliability score computation

A daily cron (`server/cron/reliability-score.ts`, scheduled 03:00 UTC) walks
every active unit and recomputes:

```
reliability_score = clamp(
  1.00 - (
    no_shows_30d × 0.30 +
    late_cancellations_30d × 0.10 +
    declines_30d × 0.05
  ) / max(1, total_offers_30d),
  0.00, 1.00
)
```

Where `no_shows_30d` = `dispatch_completions` with `status='no_show'`;
`late_cancellations_30d` = offers declined inside 12h of `expires_at`;
`declines_30d` = offers declined at any time; `total_offers_30d` = all
`routing_offers` rows for this unit. `max(1, …)` keeps a brand-new
zero-offer unit at the default 1.00.

`priority_routing_score` is recomputed in the same job (combines reliability,
`lastAssignedAt` recency, day-rate-target proximity) — full weighting lives
with Module 05; this module just persists the field.

## 10. Tests

| Area | Coverage |
|---|---|
| CRUD | Create / list / get / update / soft-delete; auth gating. |
| Filters | Segment + area + skills compose with AND semantics; pagination cursor stable. |
| Re-segmentation guards | Builder→Gap-Filler blocked when `day_commitments` exist; Specialist→other blocked on pending cert offers; non-cert-verified unit cannot become Specialist. |
| Reliability score | Synthetic unit with 10 offers / 2 declines / 1 no-show produces the expected decimal; bound clamping at both ends; zero-offers unit stays at 1.00. |
| Backfill idempotence | Running `seed-segments.ts` twice changes nothing the second time. |
| Flag fallback | With `FF_UNITS_BENCH=0`, `/admin/units` redirects to `/admin/contractors`; the new server endpoints return 404. |

## 11. Rollback

`FF_UNITS_BENCH=0` — admin uses legacy `ContractorsPage`; new fields stay
on rows but no UI surfaces them and no server code reads them outside the
gated endpoints. The routing engine (`FF_ROUTING_ENGINE`) does not consult
`contractor_segment` while its own flag is OFF, so flipping `FF_UNITS_BENCH`
alone is reversible. Schema additions are additive-only per `data-model.md`
§8 — `git revert` leaves the DB forward-compatible.

## 12. Cross-references

- ADR-003 — segmentation strategy
- `data-model.md` §2 — `handyman_profiles` extensions (authoritative DDL)
- `feature-flags.md` — `FF_UNITS_BENCH`; prerequisite of
  `FF_AVAILABILITY_ENGINE`, `FF_ROUTING_ENGINE`, `FF_PAY_PROTECTION`,
  `FF_CONTRACTOR_APP_V2`
- Module 04 — Availability engine; units submit availability
- Module 05 — Routing engine; consumes segment, area, skills, certs, reliability
- Module 06 — Day-pack solver; Builder-only consumer of `day_rate_target_pence`
- Module 09 — Contractor app v2; segment determines dashboard
- Module 13 — Design system; cards, badges, multiselect inherit tokens
