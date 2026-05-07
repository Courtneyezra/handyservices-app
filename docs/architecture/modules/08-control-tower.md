# Module 08: Control Tower (Dispatcher UI)

**Status:** Wave 4 — authoritative
**Phase:** 3
**Primary flag:** `FF_CONTROL_TOWER`
**Depends on:** Modules 01-04, 05, 06, 07, 10, 12, 13; `state-machine.md`; `api-surface.md` §2.2
**Consumed by:** Module 11 (migration retires legacy `DailyPlannerPage`)

---

## 1. Purpose

The Control Tower is the cross-cutting operations console for the human
dispatcher. It replaces the legacy `client/src/pages/admin/DailyPlannerPage.tsx`
(1,400+ lines of map + cluster + manual-dispatch UI) with a focused page
surfacing the inbound queue, day-pack assembler, Builder week view,
exceptions queue, and a top-of-page demand-health metric.

It is the only surface that subscribes to *every* booking-state transition
(`state-machine.md` §7) and is therefore the canonical place to override
automated decisions — all overrides audit-logged in `routing_decisions`
with `decided_by='admin:<user_id>'` and an `outputs.override_reason`.

The page lives at `/admin/dispatch` and uses the design system (Module 13)
so the admin surface matches the contractor surfaces that ship later.

---

## 2. The five views

Top-level tabs. The Demand Health card sits **above** the tabs and is visible
from every tab — the dispatcher's at-a-glance pulse.

### View 1 — Inbound Queue

Quotes in `booked_pending_routing` (`state-machine.md` §3) needing tagging
or dispatch. Sorted **age oldest-first** so nothing rots.

Columns: `ageMin` · `packRef` · `postcode` · job summary · `flex_tier` ·
suggested lane · actions.

Per-row actions: **Tag** (when `tagged_at IS NULL`) opens the Module 02
builder in a side drawer; **Manual route** POSTs
`/api/admin/dispatch/manual-route`; **Snooze 30 min** hides the chip until
TTL; **Open quote detail** → `/admin/quotes/:id`.

Filters: lane, age threshold (0 / 30 m / 2 h / 24 h), `flex_tier`,
postcode. Filter state URL-encoded so dispatchers can bookmark slices.

### View 2 — Day-Pack Assembler

Per Builder × per day commitment, the dispatcher reviews the pack Module 06
proposed and approves / edits / rejects.

Layout:
- **Left rail:** pending commitments (Builder + date + `target_pence`), one
  row per `day_commitments.status IN ('open','assembling')`.
- **Right pane:** candidate pack — sequenced job list with redacted addresses,
  per-job pay, route map (Leaflet), total £ vs target £, time budget vs slot.
- **Bottom action bar:** Approve · Reject · Manual edit (drag-and-drop
  reorder, swap candidates, drop a job back to inbound).

The pack recalculates **live**: proximity warnings flash on hub-and-chain
violations (Module 06 §4), time overruns highlight rows in `bg-yellow-light`,
gap-to-target delta updates in the footer. Approve fires
`POST /api/admin/day-packs/assemble` with `mode='manual'`.

### View 3 — Builder Week View

Calendar grid: rows = Builders, columns = next 7 days (rolling). Each cell
is a status pill: **green ✓** ≥ 100 % of `target_pence`; **yellow ⚠**
70 – 99 % (needs top-up or release); **red ✗** < 70 % (release recommended);
**gray —** no commitment. Per-cell click drills into View 2 for that
Builder × date. Colour mapping enforced in `BuilderWeekView.test.tsx`.

### View 4 — Exceptions Queue

Things that need a human **right now**. Sorted by severity (`crit` > `warn`
> `info` per `api-surface.md` §2.2), then age. Severity is owned upstream;
this view just renders.

Categories in priority order:

1. **No-shows** — `dispatched → offer_round_1` fired.
2. **Customer cancellations < 24 h** — Module 07 `cancellation_comp`.
3. **Mis-scope adjustments > £40** awaiting approval (Module 07 uplift).
4. **Materials reimbursements > £30** awaiting approval (Module 07).
5. **48 h pay SLA breaches** — `tickPayouts` flagged a stuck payout.
6. **Disputes opened** (`in_progress → disputed`).
7. **Cross-lane fallbacks expired** — `cross_lane_fallback →
   reschedule_required`; customer needs apology + reschedule.

Each row exposes the relevant action verb (Approve / Reject / Reroute /
Refund / Reschedule) wired to the matching API endpoint.

### View 5 — Demand Health (top-of-page card)

Widget above the tab strip, fed by `GET /api/admin/dispatch/demand-health`:
flex-tier quotes (Flexible + Relaxed, next 14 days); Builder commitments
next 7 days (count + total `target_pence`); ratio of candidate-job-days vs
commitment-days; single traffic-light — green `ratio ≥ 3.5`, yellow
`2 ≤ ratio < 3.5`, red `< 2`.

If red, the card surfaces one-click suggestions: "Release Builder commits"
(opens View 3 filtered to red cells) or "Push more flex marketing". Same
`capacity_pressure` signal the customer-side flex picker uses.

---

## 3. Files

```
NEW       client/src/pages/admin/ControlTower.tsx              top-level page + tab nav
NEW       client/src/pages/admin/control-tower/InboundQueue.tsx
NEW       client/src/pages/admin/control-tower/DayPackAssembler.tsx
NEW       client/src/pages/admin/control-tower/BuilderWeekView.tsx
NEW       client/src/pages/admin/control-tower/ExceptionsQueue.tsx
NEW       client/src/pages/admin/control-tower/DemandHealthCard.tsx
NEW       server/control-tower-routes.ts                       read endpoints
NEW       client/src/lib/control-tower-realtime.ts             WebSocket client
MODIFIED  client/src/components/layout/AdminSidebar.tsx        link to /admin/dispatch (FF-gated)
```

Legacy `DailyPlannerPage.tsx` is untouched while `FF_CONTROL_TOWER=0`;
Module 11 removes it during the Phase 9 cutover.

---

## 4. API

Per `api-surface.md` §2.2. Reads owned here; writes delegate to the owning
service so override audit lands in the right log.

| Method + path | Owner | Purpose |
|---|---|---|
| `GET /api/admin/dispatch/inbound?since=&age_threshold=&limit=&offset=` | this module | Inbound queue |
| `GET /api/admin/dispatch/builder-week?from=&to=&unit_id=` | this module | Week grid |
| `GET /api/admin/dispatch/exceptions?severity=&limit=&offset=` | this module | Exceptions feed |
| `GET /api/admin/dispatch/demand-health` | this module | Top-of-page metric |
| `POST /api/admin/dispatch/manual-route` | Module 05 service | Override routing |
| `POST /api/admin/day-packs/assemble` | Module 06 service | Manual pack assembly |
| `POST /api/admin/day-packs/:id/release` | Module 06 service | Force release |
| `POST /api/admin/pay-adjustments/:id/(approve\|reject)` | Module 07 service | Adjustment decisions |

All routes require `X-Admin-Token`. Read endpoints accept `since` so the
WebSocket bootstrap can replay anything missed on reconnect.

---

## 5. Real-time updates

Each dispatcher session opens a single WebSocket to `/ws/control-tower`,
extending the existing admin socket. The state machine's
`bookingStateMachine.transition()` (`state-machine.md` §6) fans out to a
per-dispatcher topic; the client patches React Query caches by row id.

Events: `inbound.added` (new quote in `booked_pending_routing`, row pushed
to View 1 with a navy-pulse); `daypack.assembled` (Module 06 produced a
pack, toast + View 2 refresh); `offer.expired` (offer aged out, row bumped
to top of View 4); `reliability.changed` (Module 03 cron delta, View 3 row
refresh); `exception.opened` / `exception.resolved` (View 4 patches).

Disconnect handling: exponential backoff (1 s → 30 s, capped); on reconnect
each list re-bootstraps with `since=<lastEventTs>`. Latency budget: < 2 s
transition-to-UI.

---

## 6. Workflow patterns

**A — Morning routine (08:30).** Demand Health check (green = good, red =
act) → Inbound Queue triage of anything > 2 h old → Builder Week View
review of next 3 days, releasing thin commits → Exceptions Queue,
pay-adjustment approvals before payout cutoff.

**B — Reactive dispatch.** WebSocket "new quote, no Builder coverage" toast
→ click toast → Inbound row highlighted → **Manual route** with contractor
from Module 05's suggested ranks → confirm → state machine fires
`offer_round_1`, row leaves the queue.

**C — Release a Builder commitment.** Builder Week View → red Tuesday cell
→ Day-Pack Assembler → **Release commitment** with confirmation. Builder
notified (Module 10); `day_commitments.status='released'`; reliability
unaffected if release ≥ 48 h ahead (Module 07 SLA).

---

## 7. Manual override

Every system decision can be overridden — the point of this surface. Each
override (a) POSTs to the owning service with a required `override_reason`,
(b) writes a `routing_decisions` row with `decision_type` per class
(`manual_route`, `pack_release`, `adjustment_approve`) and
`decided_by='admin:<user_id>'`, (c) fans out via WebSocket so co-dispatchers'
tabs converge. Override CTAs are yellow on navy, never grey, so they are
visibly distinct from system-driven auto-actions.

---

## 8. Tests

| # | Coverage | Lives in |
|---|---|---|
| 1 | Inbound queue ages correctly; oldest-first sort stable | `InboundQueue.test.tsx` |
| 2 | Builder week view: cell colour matches threshold (< 70 / 70 – 99 / ≥ 100) | `BuilderWeekView.test.tsx` |
| 3 | Exceptions queue priority: no-show > cancellation > misscope > dispute | `ExceptionsQueue.test.tsx` |
| 4 | Manual route writes `routing_decisions` with `decided_by` + `override_reason` | `control-tower-routes.test.ts` |
| 5 | Real-time: state-machine transition broadcasts; client patches list within 2 s | `control-tower-realtime.test.ts` |
| 6 | Demand-health thresholds (≥ 3.5 / 2 – 3.5 / < 2) | `DemandHealthCard.test.tsx` |
| 7 | Flag fallback: `FF_CONTROL_TOWER=0` → `/admin/dispatch` 404, sidebar link hidden, legacy planner intact | integration |

---

## 9. Rollback

`FF_CONTROL_TOWER=0`: `/admin/dispatch` 404s (or "coming soon" if
`FF_CONTROL_TOWER_PLACEHOLDER=1`), sidebar link hidden, the four read
endpoints return `404`, legacy `DailyPlannerPage` continues to work, and
the WebSocket topic is dormant. No schema additions are owned by this
module — pure read + override surface — so rollback is fully reversible.

---

## 10. Cross-references

- `state-machine.md` — subscribes to **all** transitions (§7).
- Module 03 — Builder list, segment, reliability feed View 3.
- Module 04 — availability holds visualised in View 2.
- Module 05 — manual route reuses the routing eligibility filter.
- Module 06 — owns the day-pack assemble / release endpoints View 2 wraps.
- Module 07 — pay-adjustment approve / reject endpoints power View 4.
- Module 11 — retires `DailyPlannerPage` after `FF_CONTROL_TOWER` 100 %.
- Module 12 — materials-skipped exceptions appear in View 4.
- Module 13 — `<HeroNavyCard>`, `<BrandAccentStrip>`,
  `<DetailsCollapsible>`, `<ProgressBar>` reused so admin matches contractor.
