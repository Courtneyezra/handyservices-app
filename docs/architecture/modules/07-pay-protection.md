# Module 07: Pay Protection (Seven Guarantees)

**Status:** Wave 3 — authoritative
**Phase:** 6
**Primary flag:** `FF_PAY_PROTECTION` (with per-guarantee sub-flags)
**Depends on:** `adrs/adr-002-pay-model.md`, `adrs/adr-007-bonus-model.md`, `data-model.md` §3 (`pay_adjustments`), `state-machine.md` §3 (transition triggers)

---

## 1. Purpose

ADR-002 locks Handy's pay model as **hidden engine + visible promise**: the contractor sees one pay number per job or day-pack, never the formula. This module is the "promise" half — seven guarantees that backstop the number when reality diverges from the offer. Without Module 07 the promise is empty marketing; with it, it becomes a server-side rules engine that produces real money on a documented timeline.

Each guarantee is a server-side rule that materialises a row in `pay_adjustments`, plus a contractor UI affordance to surface, request, or track it. Six flow through one workflow (request → evidence → rule → optional admin → next payout); the seventh (day-rate floor) is already inside `revenue-share-tiers.ts` and stays unchanged.

This module owns `pay_adjustments`, the auto-approval engine, the 48h SLA monitor, the ADR-007 carve-out workflow, and the wrapping UIs.

## 2. The seven guarantees

| # | Guarantee | Behaviour |
|---|---|---|
| 1 | **Day-rate floor** | £16–£28/hr by tier; already in `revenue-share-tiers.ts` as `MAX(rev_share, floor × hours)`. Module 07 reads only. |
| 2 | **Mis-scope auto-uplift** | If `actual / baseline_minutes ≥ 1.20`, photo evidence + auto-approved up to £40; above → admin. |
| 3 | **Call-out fee** | £45 when customer-not-home / can't-start; photo + GPS + time-window check; auto-approved. |
| 4 | **Cancellation comp** | Customer cancel < 24h ⇒ 50% pay; < 4h or no-show ⇒ 75%. State-machine-driven; no evidence needed. |
| 5 | **Materials reimbursement** | Receipt photo + 10% handling; auto-approved up to £30 receipt value; above → admin. |
| 6 | **48h pay SLA** | 24h review window + 24h Stripe Connect transfer. Cron alerts on breach. |
| 7 | **Completion bonus** | All-or-nothing on day-pack per ADR-007; £30 typical for a Builder pack; three carve-outs auto-allow after 24h with admin objection window. |

## 3. Schema

`pay_adjustments` (authority: `data-model.md` §3) is the single artefact every guarantee writes to. The columns this module reads:

- `type` ∈ `misscope_uplift` / `callout_fee` / `cancellation_comp` / `materials_reimbursement` / `day_rate_topup` / `completion_bonus`
- `amount_pence`, `reason text`, `evidence_photos jsonb`, `variance_pct decimal(5,2)`
- `status` ∈ `auto_approved` / `pending_review` / `admin_approved` / `rejected`
- `dispatch_id`, `unit_id` (RESTRICT FKs), `resolved_at`, `resolved_by`, `created_at`

`completion_bonus` lives here for payout reconciliation, audit, and "recent adjustments" UI to read from one place. Carve-outs attach via `status='pending_review'` until the 24h timer expires (→ `auto_approved`) or admin objects (→ `rejected`).

## 4. Auto-approval rules

The orchestrator in `server/pay-protection/index.ts` routes each adjustment request to a type-specific handler. `auto_approved` is set synchronously; `pending_review` parks the row in the admin queue.

**`misscope_uplift`** (`uplift-handler.ts`)
- ≥ 1 photo required in `evidence_photos`.
- `variance_pct = actual_minutes / real_work_minutes_baseline` (baseline from `personalized_quotes.real_work_minutes`, per ADR-005).
- Threshold: `variance_pct ≥ 1.20`; below that, rejected as `under_threshold`.
- Auto-approve cap: £40. Above → `pending_review`.
- Amount: `(actual_minutes - baseline) × tier_hourly_floor / 60` (floor from `revenue-share-tiers.ts`).

**`callout_fee`** (`callout-handler.ts`)
- Photo evidence required (closed door, non-response, etc.).
- GPS check: contractor within 100m of dispatch address (from check-in geo on `job_dispatches`).
- Time check: arrived within ±15 minutes of slot start.
- All three pass → auto-approve £4500. Any fail → `pending_review`.

**`cancellation_comp`** (`cancellation-comp.ts`)
- No contractor evidence — state-machine-driven by `dispatched → customer_cancelled` and `reserved_for_pack → customer_cancelled` (`state-machine.md` §3).
- `hours_until_slot = (slot_start_at - cancelled_at) / 3600`:
  - `< 4` or no-show → `amount = contractor_pay × 0.75`
  - `< 24` → `amount = contractor_pay × 0.50`
  - `≥ 24` → no adjustment.
- Always `auto_approved` (system-derived).

**`materials_reimbursement`** (`materials-reimbursement.ts`)
- Receipt photo required.
- `amount_pence = round(receipt_pence × 1.10)` (receipt + 10% handling).
- Auto-approve cap: receipt ≤ £30. Above → `pending_review`. No OCR in v1; receipt value comes from contractor form input.

**`day_rate_topup`** (`index.ts`)
- Server-driven; not contractor-requested. Module 06 flags thin packs (total contractor pay below `day_rate_target_pence`) and emits a topup. Always `pending_review` — admin reviews alongside the proposed pack.

**`completion_bonus`** (`index.ts`)
- Server-driven; not requested. State machine triggers calculation when a day-pack reaches `paid_out` and `bonusEarned()` (ADR-007 §Implementation) returns non-zero. Status set to `auto_approved` at write time (the row is for audit, not review). Carve-outs flow through §6.

## 5. Files

```
NEW    server/pay-protection/index.ts                    orchestrator + bonus + topup
NEW    server/pay-protection/auto-approval-rules.ts      shared threshold helpers
NEW    server/pay-protection/uplift-handler.ts
NEW    server/pay-protection/callout-handler.ts
NEW    server/pay-protection/cancellation-comp.ts
NEW    server/pay-protection/materials-reimbursement.ts
NEW    server/pay-protection/sla-monitor.ts              48h SLA + carve-out timer
NEW    client/src/pages/contractor/PayProtectionTab.tsx
NEW    client/src/components/contractor/UpliftRequestForm.tsx
NEW    client/src/components/contractor/MaterialsReceiptForm.tsx
NEW    client/src/components/contractor/CalloutFeeButton.tsx
NEW    client/src/pages/admin/PayAdjustmentsQueue.tsx
MOD    server/payout-engine.ts            sum approved adjustments into payout
MOD    server/dispute-routes.ts           pause adjustments on disputed
MOD    server/state-machine.ts            comp + bonus emit hooks
MOD    server/jobs/booking-state-tick.ts  register tickPayProtectionSla
```

## 6. Carve-out approval flow (ADR-007)

The all-or-nothing bonus admits three carve-outs that count a stop as complete-for-bonus when failure isn't the contractor's fault: `customer_cancelled`, `weather` (outdoor work flagged `weather_dependent=true` cannot proceed safely), `missing_materials` (customer-supplied material absent on arrival).

1. At pack completion, contractor flags carve-out reasons with photo evidence.
2. State machine writes `completion_bonus` row, `status='pending_review'`, carve-out tag in `reason`.
3. Row appears in `/admin/pay-adjustments?type=completion_bonus&filter=carveout`.
4. `tickPayProtectionSla` polls every 15 minutes: rows older than 24h still in `pending_review` flip to `auto_approved`. Admin reject within window → `rejected`.
5. Approved/auto-allowed bonuses fold into the next payout.

The 24h auto-allow is deliberately permissive — ADR-007 accepts a ~12-15% margin tax for fairness. Admin can retroactively reverse via a negative-amount adjustment.

## 7. Contractor UI

New **Pay Protection** tab in the contractor app (Module 09):

- **Active claims** — `pending_review` adjustments with status badges and ETA.
- **Recent adjustments** — last 30 days, grouped by dispatch.
- **Disputes log** — open disputes pausing pay (read from `disputes`).
- **48h pay tracker** — countdown to next payout from `contractor_payouts.scheduledPayoutAt`.

Inline triggers on job views:

- **"Mis-scope uplift"** on each completed dispatch (7-day window). `UpliftRequestForm` — minutes, photos, note.
- **"Couldn't start"** on each dispatched job once checked-in but unable to proceed. `CalloutFeeButton` — photo + auto-submit.
- **"Materials receipt"** from any active/recent dispatch. `MaterialsReceiptForm` — receipt photo, total, supplier.

Forms POST to `/api/contractor/pay-adjustments` and return the resulting status (`auto_approved` / `pending_review`) so the contractor sees instant resolution where the rules allow it.

## 8. Admin UI

`PayAdjustmentsQueue` at `/admin/pay-adjustments`:

- Tabs: **Pending review** / **Auto-approved** (audit) / **Rejected**.
- Filters: type, contractor, amount range, date range, dispatch ID.
- Per-row: contractor, dispatch link, type, amount, age, evidence photo strip (S3 signed URLs), reason, variance.
- Actions: Approve / Reject / Edit amount with required admin note (lands in `resolved_by` + audit metadata).
- Bulk-approve for low-risk types (e.g. callouts < £45 with green geo + time checks).
- Sub-view `/admin/pay-adjustments/sla-breaches` for 48h breaches.

## 9. SLA monitor

`tickPayProtectionSla` (registered in `server/jobs/booking-state-tick.ts`, runs every 5 minutes alongside other state-machine ticks):

1. `contractor_payouts` with `paidAt IS NULL` AND `scheduledPayoutAt < now - 48h` AND `status NOT IN ('held','failed')` → post to `#ops-alerts`, set `pay_protection_sla_breach=true`.
2. `pay_adjustments` with `type='completion_bonus'` AND `status='pending_review'` AND `created_at < now - 24h` → flip to `auto_approved`, notify contractor.
3. `pay_adjustments` with `status='pending_review'` AND `created_at < now - 72h` → Slack-escalate with stale-review tag.

Three indexed queries; runs even with `FF_PAY_PROTECTION` off so legacy pay-path visibility is preserved.

> Migration note: `contractor_payouts.pay_protection_sla_breach boolean DEFAULT false` is an additive column added alongside `011_create_pay_adjustments.sql` (`data-model.md` §6).

## 10. Tests

- **Mis-scope thresholds:** variance 1.19 rejected; 1.20 ≤ £40 auto-approved; £45 → pending_review.
- **Callout checks:** GPS ≤ 100m + time ±15min auto-approves; either fail parks for review.
- **Cancellation boundaries:** 24h-1min ⇒ 50%; 24h+1min ⇒ 0%; 4h-1min ⇒ 75%; no-show always 75%.
- **Materials:** £30.00 receipt → £33 auto-approved; £30.01 → pending_review.
- **SLA monitor:** 47h59m payout no alert; 48h01m alert + flag.
- **Carve-out auto-allow:** 23h59m pending_review no flip; 24h01m flips to auto_approved; admin reject at 23h sticks.
- **Idempotency:** duplicate cron tick is a no-op.
- **Disputed pause:** `in_progress → disputed` blocks new auto-approvals on that dispatch until resolved.
- **Payout integration:** approved adjustments sum into `contractor_payouts.netPayoutPence` with adjustment-ID audit metadata.

## 11. Rollback

`FF_PAY_PROTECTION = 0`:
- Day-rate floor stays (orthogonal — `revenue-share-tiers.ts`).
- Auto-approval rules don't fire — contractor API writes `pending_review` rows so admin can still process via `variation_orders`.
- Contractor UI tabs and inline buttons hidden via `/api/feature-flags`.
- Admin queue stays accessible regardless.
- 48h SLA monitor stays enabled (cheap and useful on legacy pay path).
- State-machine hooks for `cancellation_comp` / `completion_bonus` become no-ops; admin handles via `variation_orders` as today.

Per-guarantee sub-flags (`FF_PAY_PROTECTION_UPLIFT`, `_CALLOUT`, `_CANCELLATION`, `_MATERIALS`, `_BONUS`) enable staged rollout per Phase 6: floor + 48h pay first, mis-scope and call-out last.

## 12. Cross-references

- **ADR-002** — guarantees back the hidden engine.
- **ADR-007** — completion bonus + carve-outs.
- **ADR-005** — variance baseline uses `real_work_minutes`.
- **Module 06** — emits `day_rate_topup` requests.
- **Module 09** — hosts the Pay Protection tab.
- **Module 13** — status badges, photo strip, countdown widget.
- **`state-machine.md`** — transition triggers (`customer_cancelled`, no-show, `disputed`, `paid_out`).
- **`data-model.md`** §3 — `pay_adjustments` authority.
- **`revenue-share-tiers.ts`** — floor, unchanged.
- **`payout-engine.ts`** — modified to fold in adjustments.
- **`dispute-routes.ts`** — pauses adjustments on `disputed`.
