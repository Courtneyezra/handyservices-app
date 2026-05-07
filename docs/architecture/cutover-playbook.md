# Cutover Playbook — Booking & Dispatch v2

**Status:** Wave 5 — authoritative (Phase 9 build)
**Owner:** Module 11 — Migration & Compatibility Shim
**Depends on:** All Phase 0-8 modules deployed; `feature-flags.md`; ADR-001

---

## Purpose

Step-by-step deployment guide for moving Booking & Dispatch v2 from
"shipped, all flags off" to "fully cutover, legacy table dropped." The
rollout is intentionally slow: 14 weeks. Each phase has metrics, a
rollback plan, and a hold-point before the next flag flip.

The legacy `contractorBookingRequests` table is shimmed by
`server/migration/legacy-bridge.ts` (Module 11) until Phase I. After
Phase I, flipping `FF_LEGACY_BRIDGE` back on is **irreversible** — the
sync gap cannot be cheaply recovered.

---

## Pre-cutover (T-30 days)

- All Phase 0-8 modules deployed with their flags **OFF** in production.
- `npm run db:push` has applied the v2 schema (Wave 1 + Wave 4 columns).
- Run the backfills once, in this order:
  ```
  npx tsx scripts/run-backfill.ts segments
  npx tsx scripts/run-backfill.ts real-work
  npx tsx scripts/run-backfill.ts booking-state-log
  npx tsx scripts/run-backfill.ts route-cache    # optional
  ```
- Begin observing routing in advisory mode: turn `FF_ROUTING_ENGINE` on
  with all weights at zero. Routing decisions get logged but no
  contractor actually sees an offer change.

Hold here for **at least 7 days** to confirm the routing engine doesn't
log errors and the audit ledger is healthy.

---

## Phase A — Customer-side flags ON (Week 1)

1. Flip `FF_FLEX_TIER` and `FF_JOB_TAGGING` to `1`.
2. Quote creation UI now captures the flex tier + job tag; quote
   pages show the flex tier selector.

**Watch:**
- Tag completion rate (% of quotes with non-null `categories`).
- Flex tier distribution (Fast / Normal / Flex split).
- EVE pricing accuracy (compare quoted vs settled price).

**Rollback:** flip both flags back to `0`. Existing tags remain on
quotes; nothing else changes.

---

## Phase B — Supply-side flags ON (Week 2-3)

1. Flip `FF_UNITS_BENCH`. Admin-only UI shows unit roster, segments,
   home-postcode, catchment.
2. Flip `FF_AVAILABILITY_ENGINE`. Eligible-dates query goes live.
3. Recruit 4-6 contractors to set their availability over the next 7
   days.

**Watch:**
- Eligible-dates query latency (p95 should stay under 200ms).
- % of contractors with non-empty availability windows.

**Rollback:** flip both off. Customer-side flags can stay on.

---

## Phase C — Control Tower (Week 4)

1. Flip `FF_CONTROL_TOWER`. Daily-planner menu link is hidden;
   dispatchers move to the new tower.
2. Manual day-pack assembly only — no auto-routing yet.
3. Run for 1 full week before next phase. Take dispatcher feedback,
   patch any UX gaps.

**Watch:**
- Time-to-assign-job (median should drop vs daily planner baseline).
- Hand-edit volume on legacy daily planner (should approach zero).

**Rollback:** flip off; daily planner re-appears.

---

## Phase D — Routing engine (Week 5-6)

1. Flip `FF_ROUTING_ENGINE` in real mode (weights from default routing
   weights table; not zero).
2. Compare advisory-mode logs vs auto-dispatch decisions over 14 days.
3. If drift > 20% on top-ranked-unit selection, tune `routing_weights`
   row-by-row until in line.

**Watch:**
- Top-rank acceptance rate (target ≥ 75%).
- Round-2/3 escalation rate (target ≤ 25%).
- Cross-lane fallback rate (target < 5%).

**Rollback:** flip off; admin manually dispatches via control tower.

---

## Phase E — Day-pack solver (Week 7-8)

1. Flip `FF_DAY_PACK`.
2. Bring 2-3 Builders in for the first real day-pack offers. Hand-walk
   them through accept/decline so they trust the flow.
3. Validate end-to-end: pack assembly, accept, materials collection,
   per-stop completion, all-or-nothing bonus eligibility.

**Watch:**
- Pack accept rate (target ≥ 60% by Week 8).
- Travel-time vs estimate variance (target ±15%).
- Bonus eligibility hit rate.

**Rollback:** flip off; routing engine reverts to single-job offers.

---

## Phase F — Pay protection (Week 9-10)

1. Flip `FF_PAY_PROTECTION`.
2. Educate contractors about the seven guarantees (callout, materials,
   day-rate floor, completion bonus, mis-scope uplift, cancellation
   comp, 48h payout).
3. Monitor auto-approval rate and auto-uplift rate. If either drifts
   outside expected band, adjust thresholds in
   `pay-protection/auto-approval-rules.ts`.

**Watch:**
- Auto-approval rate (target ≥ 70% across all guarantee types).
- Auto-uplift rate (target ≤ 15%).
- Time-to-resolve disputed adjustments.

**Rollback:** flip off; manual ops handles all comps.

---

## Phase G — Contractor app v2 + production day-pack page (Week 11)

1. Flip `FF_CONTRACTOR_APP_V2` for 10% of contractors (manual
   allow-list).
2. Flip `FF_DAY_PACK_PAGE_PROD` so day-pack offers route to the new UI.
3. Roll to 100% over 7 days, watching error rate.

**Watch:**
- Crash rate on the v2 dashboard (target near zero).
- Time-to-accept on day-pack offers (should drop vs test page).

**Rollback:** flip both off; contractors return to v1 dashboard.

---

## Phase H — Notifications (Week 12)

1. Flip `FF_NOTIFICATIONS_V2`.
2. Reduce manual ops messaging gradually — over 3 days, ops stops
   hand-sending the day-prior reminder, the offer-routed nudge, the
   pickup-confirmation.

**Watch:**
- Delivery success rate per channel.
- Quiet-hours violations (target zero).

**Rollback:** flip off; ops resumes manual sends.

---

## Phase I — Legacy cutover (Week 13-14)

1. Run the validator:
   ```
   npx tsx scripts/run-backfill.ts validate-cutover
   ```
   Every check must `[PASS]` (warns are tolerable). Resolve fails
   before proceeding.
2. Hold 7 more days with the bridge ON, advisory only. Confirm parity
   between canonical and legacy tables.
3. Flip `FF_LEGACY_BRIDGE` to `0`. From this moment, no new dispatches
   appear in `contractor_booking_requests`. **This step is one-way.**
4. Watch for 7 days of stability. Define stability as:
   - No `[FAIL]` from the validator.
   - No customer escalations referencing the daily planner.
   - All in-flight bookings reach a terminal state.
5. After 30 more days of stability:
   ```
   DROP TABLE contractor_booking_requests CASCADE;
   ```
6. Delete `server/migration/legacy-bridge.ts`; archive
   `data-backfill.ts` and `cutover-validator.ts` under
   `docs/archive/migration/`. Remove all bridge call-sites from
   `server/contractor-dispatch.ts`.

---

## Rollback procedures

| Flag | Off-state | Reversible? |
|---|---|---|
| `FF_FLEX_TIER` | quote pages hide tier selector | yes |
| `FF_JOB_TAGGING` | quote intake skips tag capture | yes |
| `FF_UNITS_BENCH` | unit-bench admin UI hidden | yes |
| `FF_AVAILABILITY_ENGINE` | eligible-dates query disabled | yes |
| `FF_CONTROL_TOWER` | daily-planner re-shown | yes |
| `FF_ROUTING_ENGINE` | manual dispatch only | yes |
| `FF_DAY_PACK` | single-job offers only | yes |
| `FF_PAY_PROTECTION` | manual ops handles comps | yes |
| `FF_CONTRACTOR_APP_V2` | contractors revert to v1 dashboard | yes |
| `FF_DAY_PACK_PAGE_PROD` | day-pack offers route to test UI | yes |
| `FF_NOTIFICATIONS_V2` | ops resumes manual sends | yes |
| `FF_LEGACY_BRIDGE` | no more dual-write to legacy | **NO — one-way** |

The only irreversible flip is `FF_LEGACY_BRIDGE` → off. Reverting it
back on after the cutover does not retro-fill the off-window. The
reconcile script (`cutover-reconcile.ts`) can populate gaps by
re-bridging recent dispatches manually, but only within the canonical
retention window.

---

## Smoke checklist post-cutover

After Phase I has held for 7 days:

- [ ] `/api/feature-flags` reflects all desired flag states.
- [ ] No `contractor_booking_requests` inserts in the last 24h.
- [ ] All payouts in the last 7 days completed within the 48h SLA.
- [ ] No bond capture failures (`dispatch_bonds.status='failed'` count
      flat or shrinking).
- [ ] Day-pack accept-rate ≥ 60% over the last 7 days.
- [ ] Mis-scope auto-uplift rate < 15% over the last 7 days.
- [ ] Cutover validator returns `ready=true` on every assertion.
- [ ] No customer escalations referencing the legacy daily planner.

When all checks pass, file the Phase 9 closure note in
`docs/architecture/master-plan.md` §Phase 9 and schedule the legacy
table drop.

---

## Cross-references

- `modules/11-migration.md` — bridge implementation + reconcile spec.
- `adrs/adr-001-legacy-table.md` — the consolidate-now vs shim decision.
- `feature-flags.md` — flag definitions, defaults, dependency rules.
- `state-machine.md` — booking-state transitions exercised by every
  phase.
- `master-plan.md` Phase 9 — the highest-level cutover summary.
