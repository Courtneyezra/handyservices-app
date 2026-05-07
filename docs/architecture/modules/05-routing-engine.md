# Module 05: Routing Engine

**Status:** Wave 4 — authoritative
**Phase:** 4
**Feature flag:** `FF_ROUTING_ENGINE` (depends on `FF_UNITS_BENCH`, `FF_AVAILABILITY_ENGINE`, `FF_JOB_TAGGING`)
**Depends on:** Modules 02, 03, 04, 07; ADR-002, ADR-003; `state-machine.md`; `data-model.md`
**Consumed by:** Module 06 (day-pack solver), Module 08 (control tower), Module 09

---

## 1. Purpose

The five-stage decision pipeline that walks a quote from
`booked_pending_routing` to `dispatched`. Owns the offer state machine —
three timed rounds plus cross-lane fallback — for Gap-Filler and Specialist
lanes, and hands Builder-eligible work to Module 06 via `reserved_for_pack`.

Replaces today's human picking — eligibility, ranking, offer fan-out,
timeouts, audit — with deterministic logic backed by a hot-tunable weight
table. Admin retains manual override (api-surface §2.2); the flag (§11)
drops the system back to today's behaviour without redeploy.

The engine never invents pay and never edits availability directly. It
computes pay via existing `revenue-share-tiers.ts` (ADR-002), holds slots
through Module 04, and writes transitions through
`bookingStateMachine.transition()`.

---

## 2. The 5 stages

### Stage 1 — Job characterisation

**Input:** `personalized_quotes` row + Module 02 tags. **Output:** `JobProfile`
(Module 02 §5).

Pure helper. Reads tagged fields; computes `area` (postcode prefix),
`is_outdoor` (`'external' ∈ complexity_flags`), `is_heavy_lift` (mirrors
`heavy_lifting`), `customer_flexibility` (from `flex_tier`), and `pay_pence`
(via `revenue-share-tiers.computePay`). Profile is recomputed on demand;
persisted columns stay source of truth.

### Stage 2 — Lane selection

**Input:** `JobProfile`. **Output:** `lane ∈ { 'builder', 'gap_filler',
'specialist', 'specialist_gap_filler' }`.

Rules in order:

1. `cert_required.length > 0` → **`specialist`**.
2. `customer_flexibility === 'fast'` AND no Builder coverage in area
   → **`gap_filler`**.
3. Builder-eligible — segment + skill + `area_catchment` covers postcode
   AND ≥1 Builder has an `open`/`assembling` `day_commitments` row in
   the customer's window — → **`builder`**.
4. Otherwise → **`gap_filler`**.

`specialist_gap_filler` is the cross-lane target when Specialist exhausts
(Stage 5) — widens to non-Specialist units holding the cert as a side-skill.

Lane drives the next transition: `'builder'` → `reserved_for_pack`;
everything else → `offer_round_1`.

### Stage 3 — Eligibility filter (hard checks)

**Input:** lane + `JobProfile`. **Output:** `EligibleUnit[]` (possibly empty).

Calls `getEligibleUnitsForJob(jobProfile)` from Module 03; rejects each unit
that fails any of:

- **Skill mismatch** — `unit.skills` doesn't cover `skills_needed`
- **Area mismatch** — `unit.area_catchment` doesn't include `area`
- **Cert mismatch** — cert required but unit doesn't hold it (or unverified)
- **Segment mismatch** — lane is `builder` and unit is not Builder; lane
  is `specialist` and unit is not Specialist (relaxed for
  `specialist_gap_filler`)
- **Availability mismatch** — Module 04 returns no slot for the window
- **Min job value** — `unit.min_job_value_pence > job.pay_pence`
- **Reliability floor** — `reliability_score < eligibility.reliability_floor`
  (default 0.70)
- **Capacity ceiling** — unit at `> eligibility.capacity_ceiling_pct`
  weekly slots (default 0.80) — overload protection
- **Recent decline** — unit declined this same `booking_id` in last 7 days
- **Crew size** — `unit.crew_max < jobProfile.crew_size`

Each rejection writes one `routing_decisions` row
(`decision_type='candidate_filter'`). Empty result is itself an output —
Stage 5 transitions straight to `cross_lane_fallback`.

### Stage 4 — Scoring & ranking

**Input:** `EligibleUnit[]` + current `routing_weights`. **Output:** ranked
array (highest first).

```
score =
  + W.proximity        × proximity_score(unit, job)        // 0..1, closer = higher
  + W.reliability      × unit.reliability_score            // 0..1
  + W.customer_rating  × customer_rating_score(unit)       // 30-day avg, 0..1
  + W.job_fit          × job_fit_score(unit, job)          // size band match
  + W.pipeline_balance × pipeline_balance_score(unit)      // under-utilised = boost
  + W.tenure           × tenure_score(unit)                // long-standing = lift
  + W.stacking         × stacking_bonus(unit, job)         // booked nearby same day
  - W.recent_decline   × recent_decline_penalty(unit)      // declined ≥1 in 30d
  - W.overload         × overload_penalty(unit)            // > 70% weekly capacity
```

Defaults in §8. Weights read at scoring time from `routing_weights` filtered
by `effective_from <= now() < effective_to OR effective_to IS NULL`. Tuning
takes effect on the next round — no redeploy.

Sub-score formulas live in `server/routing/scoring-service.ts`,
deterministic and unit-tested. Ties broken by `priority_routing_score` then
`unit.id` lexicographic.

### Stage 5 — Offer & fallback

Per `state-machine.md` §3. All transitions via
`bookingStateMachine.transition()`.

- **Round 1** — offer rank 1 only. TTL 30 min. Module 04 hold acquired.
- **Round 2** — on round-1 expiry, fan to **ranks 2 and 3** simultaneously.
  TTL 30 min. First-to-accept wins; loser → `cancelled`, hold released.
- **Round 3** — broadcast to remaining eligible pool via existing
  public-link flow in `contractor-dispatch.ts`. TTL 60 min. First-to-claim
  locks via existing optimistic-lock-on-bond-capture.
- **Cross-lane fallback** — on round-3 expiry, flip lane (`builder ↔
  gap_filler`, or `specialist → specialist_gap_filler`) and re-run Stages
  3-5 from Round 1. Bounded by `offer.crosslane_ttl_minutes`.
- **Final fallback** — if cross-lane exhausts, transition to
  `reschedule_required`; customer gets a reschedule URL.

Every offer write, accept, decline, and timeout produces a
`routing_decisions` row; state transitions write `booking_state_log` in the
same transaction.

---

## 3. Files

```
NEW       server/routing/index.ts                 (orchestrator — exports dispatch())
NEW       server/routing/job-characterisation.ts  (Stage 1)
NEW       server/routing/lane-selector.ts         (Stage 2)
NEW       server/routing/eligibility-filter.ts    (Stage 3)
NEW       server/routing/scoring-service.ts       (Stage 4 + weight reader)
NEW       server/routing/offer-state-machine.ts   (Stage 5 — wraps state-machine intents)
NEW       server/jobs/routing-tick.ts             (cron — drives offer round timeouts)
NEW       server/__tests__/routing-*.test.ts      (one per stage + e2e)
MODIFIED  server/contractor-dispatch.ts           (claim/accept hooks emit transitions)
MODIFIED  server/index.ts                         (mount /api/routing/* router)
```

Stages 1-4 are pure functions; orchestrator + offer state machine are the
only stateful pieces.

---

## 4. Schema reuse

All persistence in tables already in `data-model.md` §3.

- **`routing_offers`** — one row per `(booking_id, unit_id, round)`. Status
  `pending → accepted | declined | expired | cancelled`. Cron sweeps
  `WHERE status='pending' AND expires_at < now()` every 5 min
  (`idx_ro_expires`).
- **`routing_decisions`** — append-only audit. `decision_type ∈
  {segment_select, candidate_filter, offer_dispatch, offer_accepted,
  offer_declined, offer_expired, crosslane_fallback, escalate_admin}`.
- **`routing_weights`** — hot-tunable config (§8). Engine reads via cached
  query refreshed every 60 seconds.

---

## 5. API

Per `api-surface.md` §2.5.

### `POST /api/routing/dispatch` (internal — kicks off pipeline)

Idempotent on `booking_id`. Re-running for an already-routed quote is a
no-op returning current state.

Request: `{ "booking_id": "pq_abc123" }`
Response:
```json
{ "booking_id": "pq_abc123", "decision": "single_offer",
  "offer_id": "ro_def456", "pack_id": null, "reasoning_id": "rd_ghi789" }
```
Errors: 404 (no quote), 409 (already in `dispatched` etc.).

### `POST /api/routing/offers/:id/accept` (contractor)

Auth: `X-Contractor-Token` matching `routing_offers.unit_id`. Body `{}`.
Response: `{ "dispatch_id": "jd_xyz", "status": "accepted", "booking_id": "pq_abc123" }`.

Side effects (one tx): offer → `accepted`, siblings → `cancelled`, Module 04
hold → `booked`, `job_dispatches` row created via existing
`contractor-dispatch.ts`, transition to `dispatched`. Errors: 403, 404, 409
(expired or sibling already accepted).

### `POST /api/routing/offers/:id/decline` (contractor)

Body: `{ "reason": "no_capacity" | "out_of_area" | "price" | "other", "note": "string?" }`
Response: `{ "status": "declined", "next_action": "advance_pipeline" | "escalate" }`

Hold released, decline recorded. The cron tick advances the round on its
next pass; the response field is informational — engine doesn't
short-circuit timeouts (concurrency simplicity).

### `GET /api/admin/routing/decisions/:bookingId`

Full audit trail powering Module 08's decision viewer.

---

## 6. Builder lane handoff

When Stage 2 = `'builder'`, the engine does **not** create a `routing_offers`
row. Instead:

1. `bookingStateMachine.transition(quoteId, 'booked_pending_routing',
   'reserved_for_pack')`.
2. Writes a `routing_decisions` row with `decision_type='segment_select'`,
   `outputs.lane='builder'`, plus shortlisted Builder unit ids for the
   solver.
3. Returns `decision='pack'` and a `pack_eligible_at` timestamp.

Module 06 takes over. Reservation TTL is `offer.builder_reservation_ttl_hours`
(default 24). On expiry, `tickPackReservations` (Module 06 cron) emits
`reserved_for_pack → offer_round_1`; the engine re-enters at Stage 3 with
lane forced to `'gap_filler'`. Module 06 documents the inverse direction
(solver assembles → `dispatched`).

---

## 7. Concurrency

- **Same-booking double-dispatch.** `dispatch()` reads `booking_state` first;
  if not `booked_pending_routing`, returns existing decision without side
  effects.
- **Two units accepting same offer.** Optimistic lock on
  `routing_offers.status` — `UPDATE … WHERE id=$1 AND status='pending'`;
  second update affects 0 rows, returns 409.
- **Round 2 simultaneous siblings.** First accept's transition wins on
  `version`; second fails the optimistic check and returns 409.
- **Held slot, no accept.** Module 04's `availability-tick` releases expired
  holds; routing tick (separate cron) advances rounds. Independent and
  idempotent.

---

## 8. Tunable config (`routing_weights`)

All keys read at scoring time. Admin tuning UI deferred to Phase 4+.

| `weight_key` | Default |
|---|---|
| `score.proximity_weight` | `30` |
| `score.reliability_weight` | `20` |
| `score.customer_rating_weight` | `15` |
| `score.job_fit_weight` | `15` |
| `score.pipeline_balance_weight` | `10` |
| `score.tenure_weight` | `5` |
| `score.stacking_weight` | `5` |
| `score.recent_decline_penalty` | `25` |
| `score.overload_penalty` | `10` |
| `eligibility.reliability_floor` | `0.70` |
| `eligibility.capacity_ceiling_pct` | `0.80` |
| `offer.round1_ttl_minutes` | `30` |
| `offer.round2_ttl_minutes` | `30` |
| `offer.round3_ttl_minutes` | `60` |
| `offer.crosslane_ttl_minutes` | `30` |
| `offer.builder_reservation_ttl_hours` | `24` |

`010_create_routing_weights.sql` seeds these. Tuning is a single `INSERT`
with `effective_from=now()` and a closing `effective_to` on the previous
row — rolling back is the same operation in reverse.

## 9. A/B testing

Out of scope for v1. The `effective_from`/`effective_to` plus a future
`arm` discriminator make parallel weight sets possible later.

## 10. Tests

- **Stage 1:** tagged quote → `JobProfile` shape; missing tags fall back
  to SKU defaults.
- **Stage 2:** lane decision matrix — cert-only, Fast + no Builder,
  Builder-eligible, default Gap-Filler.
- **Stage 3:** each rejection reason fires; empty-set returns `[]`.
- **Stage 4:** formula deterministic; weight changes flow through; ties
  break stably.
- **Stage 5:** round progression via cron; accept short-circuits remaining
  rounds; sibling cancel on accept; cross-lane re-runs.
- **E2E:** paid quote → `dispatch()` → tick → contractor accept →
  `dispatched`; audit trail contains every step.

## 11. Rollback

`FF_ROUTING_ENGINE = 0` (production default at launch):

- `POST /api/routing/dispatch` and offer endpoints return `503`.
- Stripe webhook still fires `quoted → booked_pending_routing`; the booking
  waits for admin via `POST /api/admin/dispatch/manual-route`.
- `tickRoutingOffers` is a no-op.
- Existing `contractor-dispatch.ts` flow continues unchanged.

Two-step roll forward (per `feature-flags.md` Phase 4): Stages 1-3 advisory
first (engine logs decisions, admin still picks), then Stages 4-5 active.
Advisory mode = flag on with score weights at `0` — engine runs but produces
no offers, only `routing_decisions` rows.

## 12. Open questions

- **Per-segment weight sets.** Stage 4 uses one set today. Builder work might
  want higher `stacking_weight`; Specialist might want zero
  `pipeline_balance`. Deferred until v1 has data.
- **Decline as reliability signal.** Currently no — only no-shows and
  late-cancellations move `reliability_score` (Module 03 §9). The
  `recent_decline_penalty` already de-prioritises serial decliners without
  contaminating the long-run score.
- **Cross-lane direction.** `state-machine.md` calls out whether to split
  `builder→gap_filler` vs `gap_filler→builder` vs `specialist→
  specialist_gap_filler` into distinct states. Defer to Module 06 + prod
  data.

## 13. Cross-references

- `state-machine.md` §3, `data-model.md` §3, `api-surface.md` §2.5,
  `feature-flags.md` (`FF_ROUTING_ENGINE`)
- ADR-002 (pay model — engine reads, never edits), ADR-003 (segmentation —
  hard filter at Stage 3)
- Module 02 (`JobProfile` shape), Module 03 (`getEligibleUnitsForJob`),
  Module 04 (hold/release), Module 06 (`reserved_for_pack` handoff),
  Module 07 (pay-protection on no-show), Module 08 (audit + manual route),
  Module 10 (offer notifications)
