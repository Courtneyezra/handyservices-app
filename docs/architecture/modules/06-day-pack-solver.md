# Module 06: Day-Pack Solver

**Status:** Wave 4 — authoritative
**Phase:** 5
**Primary flag:** `FF_DAY_PACK`
**Depends on:** Modules 03, 04, 05, 07, 12; ADR-005, ADR-006, ADR-007, ADR-008
**Owns:** `day_commitments`, `day_packs` lifecycle; the
`reserved_for_pack ↔ offer_round_1` transitions in `state-machine.md` §3.

> Updated 2026-05-09 to align with built code (FlexTierSelector.tsx). Original spec said 0/3/7; corrected to 1/7/14.

---

## 1. Purpose

The Builder-lane bin-packer. Given a Builder's day commitment (date, area
filter, day-rate target, working hours) and a pool of candidate jobs in
`reserved_for_pack`, assemble a day-pack hitting the target under proximity,
time, skill, customer-window, and value constraints. Output one `day_packs`
row in `proposed`, ready for offer.

The algorithmically heaviest module: greedy solver, hub + chain proximity
on ADR-006's Distance Matrix cache, materials-pickup integration (ADR-008),
completion-bonus on the offered pack (ADR-007), top-up budget for thin
days, release-SLA penalties when Builders pull commitments.

---

## 2. Inputs and outputs

**Inputs:** `day_commitments` row (date, `area_filter`, `target_pence`,
`start_time`, `end_time`); candidate `personalized_quotes` in
`booking_state='reserved_for_pack'`, area-overlapping, skill-matched; unit
row (`home_postcode`, `skills`, `area_catchment`, `crew_max`,
`reliability_score`, `day_rate_target_pence`); `unit_availability` for the
date (solver issues a 120-min hold via Module 04 on commit); travel matrix
(ADR-006; Haversine fallback in dev); materials aggregator (Module 12).

**Output:** one `day_packs` row in `status='proposed'` with `job_ids[]`,
`total_contractor_pay_pence`, `total_customer_pay_pence`,
`estimated_hours`, `travel_minutes`, optional `top_up_pence` and
`route_summary`. Sibling `materials_pickups` rows write in the same
transaction.

---

## 3. The greedy bin-packer

```ts
function assemblePack(commitment, candidates) {
  candidates.sort(byBestFitFirst);                     // §4

  const pack = new Pack(commitment);
  const remaining = [...candidates];

  // Step 1: greedy-best-fit add jobs
  while (remaining.length > 0 && !pack.isFull()) {
    const next = remaining.shift();
    if (pack.canAdd(next)) pack.add(next);             // §5
    // else skip; try next
  }

  // Step 2: aggregate pickups against the final job set
  pack.pickups = aggregateMaterialsPickups(pack.jobs);  // Module 12

  // Step 3: validate pack quality
  if (pack.totalContractorPay() < commitment.target_pence * 0.7) {
    return runTopUpPath(pack, commitment);             // §6
  }

  pack.completion_bonus_pence = round(commitment.target_pence * 0.15);  // ADR-007
  return pack;
}
```

`pack.isFull()` = pack value ≥ 110% of target OR next add would bust the
working-hours envelope. `pack.canAdd()` runs the five constraints in §5.

---

## 4. "Best fit first" ordering

Candidates pre-sorted by:

1. **Already-claimed area first.** Postcode in `area_filter` ranks above
   stretches into `area_catchment`.
2. **Highest `contractor_pay_pence` first.** Denser pack value early.
3. **Lower complexity first.** `complexity_flags.length` ascending.
4. **Customer flexibility ascending.** `relaxed → flexible → fast`. Keep
   fast-tier freedom for last; don't waste their single date.

Ties broken on `personalized_quotes.id` ASC for deterministic replay.

---

## 5. Pack constraints (`canAdd()`)

Five checks. ANY failing → skip the candidate.

### Constraint 1 — Skill fit

```ts
job.skills_required.every(s => unit.skills.includes(s))
  && job.cert_required.every(c => unit.certs.includes(c))
```

Certs are enforced upstream by Module 05; the solver double-checks for safety.

### Constraint 2 — Time fit

```
proposed_total_time =
    Σ(packed_jobs.real_work_minutes)                    // ADR-005
  + new_job.real_work_minutes
  + Σ(setup_minutes + cleanup_minutes per job)          // 12 + 15 default
  + estimated_travel_minutes_between_all_stops          // ADR-006
  + materials_pickup_minutes                            // 30 first + 15 each extra (ADR-008)
  + mobilisation + return-to-base                       // ADR-006

proposed_total_time ≤ (commitment.end_time − commitment.start_time) − 30
```

30-min trailing margin protects against last-job overrun. ADR-005 forbids
reading `pricing_time_minutes`; the solver reads `real_work_minutes` only.

### Constraint 3 — Proximity fit

Two sub-checks via the ADR-006 Distance Matrix cache:

- **Hub check:** drive distance from `unit.home_postcode` to `job.postcode`
  ≤ **8 miles**.
- **Chain check:** drive minutes from previous stop to new stop ≤ **25 min**
  (with the 10–20% parking buffer per ADR-006).

If hub fails → reject (hub rule is hard). If hub passes and chain fails →
accept with `stretch=true`; offer page renders a "long drive" warning.

### Constraint 4 — Time-window fit

Customer window from `flex_tier` and `dateTimePreferences`:

- **Fast** (`flex_window_days=1`) — single chosen date.
- **Flexible** (`flex_window_days=7`) — pack date must be one of the seven
  days in the chosen window.
- **Relaxed** (`flex_window_days=14`) — any date in the 14-day relaxed window.

If `commitment.date` is outside the job's window → reject.

### Constraint 5 — Pack value (running)

After tentative add, compare `pack.totalContractorPay()` to `commitment.target_pence`:

- **≥ 110%** → STOP adding; pack full at value.
- **70–109%** → keep adding.
- **< 70%** AND no candidates remain → top-up (§6).

---

## 6. Top-up logic (when pack < 70% target)

Three options; first to succeed wins.

### Option A — Pull from neighbouring days

Inspect the unit's commitments on `date − 1` and `date + 1`. If either has
surplus candidates AND the customer's `flex_tier` allows shifting (relaxed
always; flexible if the alternate is within their 7-day pick window), swap a
candidate into THIS pack and re-validate.

### Option B — Pull from neighbouring areas

Re-run candidate search with the unit's full `area_catchment` instead of
just `area_filter`. A Builder anchored in NG7 with catchment
`["NG7","NG2","NG8"]` may surface a fitting NG2 job the narrower filter
excluded.

### Option C — Day-rate top-up (admin-approved)

```
top_up_pence = commitment.target_pence − pack.totalContractorPay()
day_packs.top_up_pence = top_up_pence
day_packs.status = 'proposed'  (admin review required)
```

Admin reviews `/admin/day-packs?status=top_up_pending`. Approve → `offered`
with the top-up in the pay promise. Reject → commitment released
(`status='released'`, `released_reason='insufficient_demand'`).

**Top-up budget:** per-Builder monthly cap, default **£200**, tracked as
`pay_adjustments` rows of `type='day_rate_topup'` (Module 07). Once the
running monthly total would breach the cap, Option C is unavailable and
the solver releases the commitment.

---

## 7. Pack offering and lifecycle

Aligned with `state-machine.md` §3 and `day_pack_status_enum`:

```
proposed   → offered    (admin approves OR auto-offer when value ≥ 110%)
offered    → accepted   (Builder taps Accept; jobs lock to the unit)
offered    → declined   (Builder declines OR 30-min TTL expires)
offered    → cancelled  (admin manual; jobs release to single-offer)
accepted   → completed  (state machine drives jobs to paid_out)
```

**On `accepted`** (one transaction): each packed job
`reserved_for_pack → dispatched`; a `job_dispatches` row per job with
`bundle_id = day_pack.id`; `materials_pickups.collected_by_unit_id` set;
bond capture fires if the unit has a bond requirement; `unit_availability`
rows flip `held → booked`; customer notifications fire (Module 10);
`routing_decisions` appended (`decision_type='pack_accepted'`).

**On `declined` / `cancelled` / `expired`:** each packed job
`reserved_for_pack → offer_round_1` (state-machine.md row 90); 120-min
hold released through Module 04; reliability adjustment — explicit
decline = no penalty, TTL expiry = `−0.05` (recorded in
`routing_decisions` for Module 03's nightly recompute);
`day_commitments.status` returns to `open` if there's still time to
re-assemble, otherwise `released`.

---

## 8. Multi-Builder coordination

A single job can match more than one Builder's commitment. Solver runs are
serialised per-day via `SELECT … FOR UPDATE` on the commitment row, but
the candidate pool is shared. Tiebreakers, in order, when two solver runs
both want the same job:

1. **Pack-fit score.** Marginal value = (job pay) − (added travel cost) ×
   urgency factor (1.0 relaxed, 1.2 flexible, 1.5 fast). Higher wins.
2. **Reliability score.** Higher `reliability_score` wins.
3. **Tenure.** Earlier `handyman_profiles.created_at` wins.

---

## 9. Release SLAs (codified per ADR-007 spirit)

Builders can release a commitment, but lateness costs them.

| Lead time vs commit date | Outcome | Reliability delta |
|---|---|---|
| **> 48h** | Free release; pack aborts; siblings → `offer_round_1`. | 0.00 |
| **24–48h** | Soft strike; one free strike per Builder per calendar month. | −0.05 |
| **< 24h** | Hard breach; admin alert (Module 08); jobs → `offer_round_1` priority. | −0.20 |

`day_commitments.released_at` + `released_reason` capture the event;
`routing_decisions` records the reliability hit. Any in-flight `day_pack`
referencing the commitment auto-cancels via §7's expired path. Thresholds
match Module 07's cancellation comp — one consistent rule.

---

## 10. Files

```
NEW       server/day-pack/index.ts                  # orchestrator
NEW       server/day-pack/commitment-service.ts     # CRUD + release SLA
NEW       server/day-pack/solver.ts                 # the bin-packer (§3)
NEW       server/day-pack/proximity.ts              # postcode + Distance Matrix wrapper
NEW       server/day-pack/top-up-calculator.ts      # §6 options A/B/C
NEW       server/day-pack/aggregator-bridge.ts      # calls Module 12 aggregateByPickup
NEW       server/day-pack/route-summary.ts          # Static Maps polyline + deep link
NEW       server/jobs/day-pack-tick.ts              # cron — nightly + on-demand
MODIFIED  server/availability-routes.ts             # solver hits /availability/hold (TTL=120)
MODIFIED  shared/schema.ts                          # day_commitments, day_packs types
```

Tests live alongside (`server/day-pack/__tests__/*.test.ts`).

---

## 11. Tests

| # | Coverage |
|---|---|
| 1 | Solver happy path: 4 in-area skill-matched candidates → 4-stop pack ≥ 100% target. |
| 2 | Top-up A: 60% on D; surplus on D+1 → swap, hit target. |
| 3 | Top-up B: `area_filter` exhausted → broaden to `area_catchment`. |
| 4 | Top-up C: A+B fail → `top_up_pence > 0`; admin approval → `offered`. |
| 5 | Top-up cap: monthly C at £180; new £40 → cap blocks; commitment released. |
| 6 | Proximity: 12mi candidate → hub fails → rejected. 28-min chain hub-OK → accepted `stretch=true`. |
| 7 | Skill mismatch: Builder without `tiling` rejects tile-required job. |
| 8 | Pickup: 2 Screwfix + 1 Wickes → 2 `materials_pickups`; minutes = 30 + 15. |
| 9 | Window: relaxed slottable across 14-day horizon; fast rejected when `commitment.date ≠ chosen_date`. |
| 10 | Multi-Builder tiebreaker: A's pack-fit higher → A wins. |
| 11 | Release > 48h: no penalty. |
| 12 | Release < 24h: `−0.20` reliability; admin alert; jobs → `offer_round_1` priority. |
| 13 | Value cap: candidate pool over-rich; pack stops at 110%. |
| 14 | Concurrency: parallel solver runs serialised by `FOR UPDATE`. |
| 15 | Time envelope: 5 fit by value but bust 30-min margin → 5th rejected. |

---

## 12. Rollback

`FF_DAY_PACK = 0`: `day-pack-tick.ts` is a no-op; all Builder-eligible jobs
route via Module 05's single-offer flow (`reserved_for_pack` is never
written, state flows straight to `offer_round_1`); `day_commitments` and
`day_packs` tables stay inert; per-line `supply_status` is still captured
(Module 12 / 02), so flipping the flag back on requires no backfill. Schema
is additive per `data-model.md` §8.

---

## 13. Cross-references

- **ADR-005** — `real_work_minutes` is the only time field the solver reads.
- **ADR-006** — Distance Matrix cache; mobilisation + return-to-base every pack.
- **ADR-007** — `completion_bonus_pence = round(0.15 × target_pence)` set at
  offer time; carve-outs honoured by Module 07.
- **ADR-008** — pickup is a first-class step; aggregator from Module 12.
- **`data-model.md` §3** — `day_commitments`, `day_packs`, `materials_pickups`.
- **`state-machine.md` §3** — `reserved_for_pack ↔ offer_round_1`;
  `reserved_for_pack → dispatched` on accept.
- **Module 03** — Builder filter, `day_rate_target_pence`, `reliability_score`.
- **Module 04** — `getConsecutiveAvailable`; 120-min hold; `held → booked`.
- **Module 05** — failed pack assembly returns to `offer_round_1`.
- **Module 07** — `pay_adjustments` for `day_rate_topup`, `completion_bonus`,
  `cancellation_comp` triggered by events here.
- **Module 12** — pickup aggregation (`aggregateByPickup`).
- **Module 15** — renders the proposed pack as the contractor offer page.
