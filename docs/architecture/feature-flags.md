# Feature Flag Catalogue

**Status:** Wave 1 — authoritative
**Depends on:** `master-plan.md` (build phases)
**Last updated:** 2026-05-03

---

## 1. Overview & philosophy

Booking & Dispatch v2 is built behind feature flags so production runs as
today while the new system is assembled and gradually exposed.

- **Every new behaviour is flag-gated.** If a flag is OFF, the module is
  dormant and the system falls back to v1.
- **Defaults: OFF in production, ON in staging.** Staging exercises the v2
  pipeline continuously so regressions surface there first.
- **Configured via environment variables** (Railway env vars). Matches the
  existing `process.env` pattern in `server/index.ts`; no DB-backed flag
  store, so a DB outage cannot wedge feature state.
- **Central lookup** in `server/feature-flags.ts`. No scattered
  `process.env.FF_*` reads — flag list greppable in one place.
- **Frontend reads via `/api/feature-flags`**, cached 60s in client state.
  Only UI-affecting flags exposed.
- **Flipping a flag is the rollback for any phase.** Combined with
  additive-only schema migrations, flipping OFF mid-traffic is a safe,
  instantaneous revert.

## 2. Naming convention

- Prefix `FF_`. `UPPER_SNAKE_CASE`. Boolean-only.
- Read as `"1"` / `"0"` (preferred) or `"true"` / `"false"`, with **strict
  string comparison**. No truthy coercion — an unset or malformed value
  falls through to the default.

## 3. Flag catalogue

| Flag | Default | Module | What it gates | Rollback effect (flip OFF mid-traffic) |
|---|---|---|---|---|
| `FF_FLEX_TIER` | `0` | 01 | Flex tier selector (Fast/Flexible/Relaxed); flex_tier discount in EVE; flex_tier column written | Selector hidden; pricing ignores flex_tier; new quotes default `'fast'`. Already-priced quotes honour stored price. |
| `FF_JOB_TAGGING` | `0` | 02 | Tag panel on admin quote builder (crew_size, skills, certs, complexity, flexibility, real-work duration) | Admin sees current builder; new quotes save `tags = NULL`. Downstream consumers fall back to legacy assignment. |
| `FF_UNITS_BENCH` | `0` | 03 | Extended `handyman_profiles` fields in admin Units page (segment, area, day_rate_target, skills) | Admin uses legacy contractor list view. Extended columns remain on rows but unread. |
| `FF_AVAILABILITY_ENGINE` | `0` | 04 | Availability scheduler; `unit_availability` writes; eligible-dates query gating customer date picker | Date picker shows all dates, no supply gate. Existing `unit_availability` rows go inert. |
| `FF_CONTROL_TOWER` | `0` | 08 | Admin `/admin/dispatch` route + control-tower views (inbound queue, day-pack assembler, Builder week, exceptions) | Admin uses legacy `DailyPlannerPage`. New route 404s. |
| `FF_ROUTING_ENGINE` | `0` | 05 | Auto-routing on quote acceptance — Stages 1–3 (advisory) first, 4–5 (auto-dispatch) after soak | Acceptance does not trigger auto-routing; admin manually picks contractor. In-flight offers resolved from control tower. |
| `FF_DAY_PACK` | `0` | 06 | Day-pack solver; Builder day-pack offers in Tier 1; `day_packs` and `day_commitments` writes | Single-job routing only. Solver dormant; existing day-pack offers valid until expiry, no new ones produced. |
| `FF_PAY_PROTECTION` | `0` | 07 | Auto-approval rules for seven pay-adjustment guarantees; contractor adjustment UI; `pay_adjustments` writes | Adjustments revert to manual admin via existing `variation_orders`. Contractor app hides adjustment UI. |
| `FF_CONTRACTOR_APP_V2` | `0` | 09 | Segment-aware dashboard (Builder / Gap-Filler / Specialist views) | Old single contractor dashboard served to all segments. |
| `FF_DAY_PACK_PAGE_PROD` | `0` | 15 | Production `/dispatch/:packId` route promoted from MVP test page | Falls back to `/dispatch-preview` test page (always available behind admin auth). Production route 404s. |
| `FF_NOTIFICATIONS_V2` | `0` | 10 | Centralised notifications layer (templated SMS / WhatsApp / email via one dispatcher) | Direct Twilio / WhatsApp / email calls per code site (current). |
| `FF_LEGACY_BRIDGE` | `1` | 11 | Dual-write to legacy `contractorBookingRequests` **and** new `jobDispatches` | Legacy writes stop. **Toggle to 0 only after Phase 9 cutover verified** (ADR-001). Premature flip leaves legacy admin tools without new rows. |

`FF_LEGACY_BRIDGE` is the only flag that defaults ON — it is a compatibility
shim, not a feature, retired in Phase 9.

## 4. Dependencies between flags

A dependent flag may only be ON if its prerequisites are ON. The central
module logs a boot warning if a dependent flag is ON without prerequisites.

| Flag | Requires |
|---|---|
| `FF_AVAILABILITY_ENGINE` | `FF_UNITS_BENCH` |
| `FF_ROUTING_ENGINE` | `FF_UNITS_BENCH`, `FF_AVAILABILITY_ENGINE`, `FF_JOB_TAGGING` |
| `FF_DAY_PACK` | `FF_UNITS_BENCH`, `FF_AVAILABILITY_ENGINE`, `FF_ROUTING_ENGINE` |
| `FF_PAY_PROTECTION` | `FF_UNITS_BENCH` |
| `FF_CONTROL_TOWER` | `FF_JOB_TAGGING` |
| `FF_CONTRACTOR_APP_V2` | `FF_UNITS_BENCH` |
| `FF_DAY_PACK_PAGE_PROD` | `FF_DAY_PACK`, `FF_CONTRACTOR_APP_V2` |
| `FF_NOTIFICATIONS_V2` | (none) |
| `FF_LEGACY_BRIDGE = 0` | All v2 flags ON in prod ≥14 days; ADR-001 checklist green |

**Deployment rule:** never flip a dependent flag ON before its prerequisites.
Flag-flip PR descriptions must state prerequisite state.

## 5. Rollout strategy

Phases map 1:1 to flags (see `master-plan.md` §"Build phases"). Each phase
ships staging-first, soaks ≥48h, then promotes to production.

- **Phase 1 — `FF_FLEX_TIER` + `FF_JOB_TAGGING`.** 100% of new quotes from
  launch day (low risk, additive). Tagging dogfood-tested before flip.
- **Phase 2 — `FF_UNITS_BENCH` + `FF_AVAILABILITY_ENGINE`.** Flip
  `FF_UNITS_BENCH` first; admins populate segments / capacities ≥1 week
  before flipping availability so eligible-dates has real data.
- **Phase 3 — `FF_CONTROL_TOWER`.** Internal only; 100% for admins day one.
- **Phase 4 — `FF_ROUTING_ENGINE`.** Two-step. Stages 1–3 (advisory: engine
  recommends, admin accepts) for ≥2 weeks. Stages 4–5 (auto-dispatch) flip
  on only when admin-approved decisions match engine predictions ≥80% over
  a rolling 7-day window.
- **Phase 5 — `FF_DAY_PACK`.** One Builder commitment per week, single
  area, hand-validated. Expand once solver holds >85% accept rate over 4
  weeks.
- **Phase 6 — `FF_PAY_PROTECTION`.** Per-guarantee sub-flags in module 07.
  Day-rate floor and 48h pay first; mis-scope uplift and call-out comp last.
- **Phase 7 — `FF_CONTRACTOR_APP_V2` + `FF_DAY_PACK_PAGE_PROD`.** Staged by
  segment: Specialists first, then Gap-Fillers, then Builders.
- **Phase 8 — `FF_NOTIFICATIONS_V2`.** Shadow-mode ≥1 week (new layer
  emits, legacy still sends; compare). Then cut over.
- **Phase 9 — `FF_LEGACY_BRIDGE = 0`.** Final phase; ADR-001 checklist
  green. Reversible — flipping back to `1` resumes dual-write.

## 6. Implementation pattern

```ts
// server/feature-flags.ts
function bool(key: string, fallback: '0' | '1' = '0'): boolean {
  const v = process.env[key] ?? fallback;
  return v === '1' || v === 'true';
}

export const FLAGS = {
  FLEX_TIER:           bool('FF_FLEX_TIER'),
  JOB_TAGGING:         bool('FF_JOB_TAGGING'),
  UNITS_BENCH:         bool('FF_UNITS_BENCH'),
  AVAILABILITY_ENGINE: bool('FF_AVAILABILITY_ENGINE'),
  CONTROL_TOWER:       bool('FF_CONTROL_TOWER'),
  ROUTING_ENGINE:      bool('FF_ROUTING_ENGINE'),
  DAY_PACK:            bool('FF_DAY_PACK'),
  PAY_PROTECTION:      bool('FF_PAY_PROTECTION'),
  CONTRACTOR_APP_V2:   bool('FF_CONTRACTOR_APP_V2'),
  DAY_PACK_PAGE_PROD:  bool('FF_DAY_PACK_PAGE_PROD'),
  NOTIFICATIONS_V2:    bool('FF_NOTIFICATIONS_V2'),
  LEGACY_BRIDGE:       bool('FF_LEGACY_BRIDGE', '1'),
} as const;
```

Frontend: `GET /api/feature-flags` returns UI-affecting flags only,
cached 60s via TanStack Query (`staleTime: 60_000`).
`LEGACY_BRIDGE` / `ROUTING_ENGINE` are server-internal and not exposed.

## 7. Cross-references

- `master-plan.md` §"Build phases" — phase → flag mapping.
- Each module spec (`modules/01-…` to `modules/15-…`) names its primary flag
  in the spec header.
- `adrs/adr-001-legacy-table.md` — `FF_LEGACY_BRIDGE` cutover checklist.
- `state-machine.md` — states gated by `FF_FLEX_TIER`, `FF_ROUTING_ENGINE`.
