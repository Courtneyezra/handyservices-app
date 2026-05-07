# ADR-001: Legacy `contractorBookingRequests` Consolidation

## Status
Accepted

## Context

Two parallel job-assignment systems live in the codebase, both in
production, both tracking "this contractor is doing this job":

- **Legacy — `contractorBookingRequests`** (`shared/schema.ts:995`). Created
  when admin assigns a quote via the daily planner UI
  (`server/daily-planner-routes.ts`). Single contractor per row, with
  day-of-ops columns (en-route, timer, signature), decline reasons,
  evidence URLs, invoice link bolted on over time.
- **Current — `jobDispatches` + `contractorJobLinks`** (`shared/schema.ts:2709`,
  `:2762`). Created when admin builds a tokenised dispatch via
  `server/contractor-dispatch.ts`. Supports closed and broadcast offers,
  multi-contractor links, dispatch-level media, bonds, view-count scarcity,
  plus the richer `dispatchCompletions` and `dispatchVariations` children.

Having both is costly. Source-of-truth is split — a job can live in
either table depending on which UI created it. Every new feature
(routing, day-pack, control tower) faces "which do I write to?". Test
fixtures must seed both. "What is contractor X doing today?" needs a
UNION. Without consolidation, Booking & Dispatch v2 inherits this
permanently.

## Options considered

**Option A — Consolidate now.** Drop `contractorBookingRequests`, migrate
existing rows into `jobDispatches`, refactor `daily-planner-routes.ts` to
read from `jobDispatches`. Pros: single source of truth from day one,
simpler new-module code. Cons: 1-2 weeks of migration work before any v2
feature ships; real risk of regressing the daily planner UI ops currently
runs the business on.

**Option B — Compatibility shim.** New system writes to `jobDispatches` as
canonical; a bridge module also writes to `contractorBookingRequests` for
legacy compatibility. Decommission at Phase 9. Pros: zero rework upfront;
legacy daily planner keeps working unchanged; v2 code treats
`jobDispatches` as the only canonical store. Cons: dual-write adds
complexity per dispatch; the bridge is its own maintenance surface;
"decommission later" tends to slip.

**Option C — Decommission `daily-planner-routes.ts` entirely.** Replace
the daily planner UI with the new control tower (Phase 3). Skip both
migration and shim — old code goes when control tower lands. Pros: avoids
both shim and migration; forces clean cutover. Cons: gates all v2
progress on Phase 3 reaching parity with the existing planner.

## Decision

**Option B (compatibility shim) for Phases 1-8, then Option C (full
retirement) at Phase 9.**

Rationale: dual-write is cheap — one function call per dispatch event.
It lets every new module assume `jobDispatches` is canonical without
forcing changes to the daily planner UI. The control tower (Phase 3) is
the spiritual replacement, but we do not gate v2 delivery on its arrival.

The shim lives in `server/migration/legacy-bridge.ts` (Module 11). It
writes to `contractorBookingRequests` on every `jobDispatches` create or
status update. Reads come from `jobDispatches` only — no read-bridge, no
two-way sync.

Cutover at Phase 9: flip `FF_LEGACY_BRIDGE=0`, run the reconciliation
script, drop `contractorBookingRequests` after a 30-day grace period.

## Consequences

Positive:
- All new modules (routing, day-pack, control tower, contractor app v2)
  treat `jobDispatches` as the single canonical store.
- Legacy daily planner keeps working with no code changes.
- Cutover is one feature-flag flip plus one migration script.

Negative / accepted trade-offs:
- 8 phases of dual-write overhead — one extra DB write per dispatch event.
- Bridge code is its own maintenance burden until Phase 9.
- Daily planner read path bypasses the new state machine, so legacy-only
  edits can drift from canonical state.

Mitigation:
- Module 11 specifies the bridge, idempotency rules, and failure handling.
- Module 08 (control tower) replaces the daily planner functionally
  before cutover.
- Module 11 reconciliation script verifies row-level parity before the
  Phase 9 flag flip.
- `FF_CONTROL_TOWER` hides the daily planner menu link so legacy edits
  taper off naturally.

## Cross-references

- Module 11 (`modules/11-migration.md`) — implements the shim and
  reconciliation script.
- Module 08 (`modules/08-control-tower.md`) — replaces the legacy daily
  planner UI.
- `feature-flags.md` — `FF_LEGACY_BRIDGE` entry.
- `master-plan.md` Phase 9 — cutover steps.
