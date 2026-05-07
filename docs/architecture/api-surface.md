# API Surface

**Status:** Wave 1 — locked. **Depends on:** `data-model.md`, `state-machine.md`. Module specs (04, 05, 07, 12, 15) own internals; this file enumerates routes.

---

## 1. Conventions

New routes domain-prefix: `/api/quotes`, `/api/units`, `/api/availability`, `/api/routing`, `/api/contractor`, `/api/admin`, `/api/day-packs`. Existing `/api/personalized-quotes/*`, `/api/admin/dispatch/*`, `/api/stripe/*` keep their paths; extended in place where noted.

JSON in/out, `snake_case`, ISO-8601 timestamps, integer **pence**, uuid v4 IDs (except existing slug/nano-id columns).

**Auth:** `X-Admin-Token` (existing `requireAdmin`), `X-Contractor-Token` (a `unit_id`), or none (slug + per-resource token).
**Envelopes:** error `{ error, code, details? }`; single = bare object; list `{ data: T[], meta: { total, limit, offset } }`.
**Pagination** `?limit=&offset=`, default 20, max 100 (server-clamped). **Idempotency:** retryable writes accept `Idempotency-Key`, cached 24h.

---

## 2. Endpoints

### 2.1 Customer-facing (public + slug-gated)

- `PUT /api/quotes/:id/flex-tier` — set tier; price recomputes. Auth: slug + `tier_token`. Body `{ flex_tier: "fast"|"flexible"|"relaxed", tier_token }` → `{ id, flex_tier, price_pence, discount_pence, valid_until }`. Errors: 403, 404, 409 (already booked), 422.
- `GET /api/quotes/:id/pricing` — three tier prices for picker. Auth: slug. → `{ id, tiers: { fast: {price_pence,discount_pct}, flexible:{...}, relaxed:{...} }, selected_tier }`. Errors: 404.
- `GET /api/availability/eligible-dates?slug=&postcode=&skills=&duration=&from=&to=&flex_tier=` — customer date picker. Auth: slug. → `{ data: { date, tier_capacity: "high"|"med"|"low", tentative }[], meta: { from, to, max_lead_days } }`. Errors: 422, 503.

> Existing `GET /api/personalized-quotes/:slug` and `PUT /api/personalized-quotes/:id/track-booking` are **unchanged**.

---

### 2.2 Admin — job tagging + dispatch (all `X-Admin-Token`)

- `PUT /api/admin/quotes/:id/tags` (module 02) — tag with routing-decisive fields. Body `{ crew_size: 1|2|3, skills: string[], certs: string[], duration_minutes, complexity: "trivial"|"low"|"medium"|"high", customer_flexibility: "fixed"|"flexible"|"very_flexible" }` → updated `Quote`. Errors: 404, 422.
- `GET /api/admin/quotes/:id/profile` — computed `JobProfile` (tags + hints). 200 `{ quote_id, tags, profile: { tier_eligible: ("builder"|"gap_filler"|"specialist")[], suggested_pack_role: "anchor"|"filler", est_travel_band_min } }`. Errors: 404.
- `GET /api/admin/dispatch/inbound?since=&age_threshold=&limit=&offset=` — booked-but-not-routed queue. → `{ data: InboundRow[], meta }`. Errors: 403.
- `GET /api/admin/dispatch/builder-week?from=&to=&unit_id=` — per-Builder grid. → `{ data: { unit_id, days: [{ date, commitment_id, pack_status, booked_pence, target_pence, jobs }] }[] }`.
- `GET /api/admin/dispatch/exceptions?severity=info|warn|crit&limit=&offset=` → `{ data: ExceptionRow[], meta }`.
- `GET /api/admin/dispatch/demand-health` → `{ window_days, flex, commit, ratio, capacity_pressure: "low"|"moderate"|"high" }`.
- `POST /api/admin/dispatch/manual-route` — override routing. Body `{ booking_id, target: { kind: "unit"|"pack", id }, reason }` → `{ booking_id, dispatched_to, dispatch_id, audit_id }`. Errors: 404, 409, 422.

> Existing `GET/POST /api/admin/dispatch` and `/api/admin/dispatch/:id*` from `server/contractor-dispatch.ts` are extended (not replaced) for pack-bundle support.

---

### 2.3 Units (admin) — module 03

- `POST /api/admin/units` — body `{ user_id, contractor_segment: "builder"|"gap_filler"|"specialist", area, postcode_centroid?, skills: string[], certs: string[], day_rate_target_pence }` → new `Unit`. Errors: 409, 422.
- `GET /api/admin/units?segment=&area=&active=&limit=&offset=` → `{ data: Unit[], meta }`.
- `GET /api/admin/units/:id` → `Unit` w/ skills+certs. Errors: 404.
- `PUT /api/admin/units/:id` — subset of create body → updated `Unit`.
- `DELETE /api/admin/units/:id` — soft delete (sets `deleted_at`). 204. Existing dispatches keep working.

---

### 2.4 Availability — module 04

- `GET /api/units/:id/availability?from=&to=` (max 60-day window) — auth contractor (own unit) or admin. → `{ data: { date, slot: "am"|"pm"|"full", status: "open"|"held"|"booked"|"blocked", crew_available: 1|2|3 }[] }`.
- `POST /api/units/:id/availability` — same auth. Body `{ slots: { date, slot, status, crew_available }[] }` (max 90, upsert) → `{ updated: number }`. Errors: 403, 422.
- `POST /api/availability/hold` _(internal)_ — admin or routing token. Body `{ unit_id, date, slot, ttl_seconds, booking_id }` → `{ hold_id, expires_at }`. Errors: 409.
- `POST /api/availability/release` _(internal)_ — body `{ hold_id }` or `{ unit_id, date, slot }` → `{ released: true }`.

---

### 2.5 Routing — module 05

- `POST /api/routing/dispatch` _(internal — admin / routing token)_. **Idempotent by `booking_id`**. Body `{ booking_id }` → `{ booking_id, decision: "pack"|"single_offer"|"specialist_queue"|"manual_required", offer_id?, pack_id?, reasoning_id }`. Errors: 404, 409.
- `POST /api/routing/offers/:id/accept` — contractor (token = offer's unit). Body `{}` → `{ dispatch_id, status: "accepted", booking_id }`. Errors: 403, 404, 409 (expired/taken).
- `POST /api/routing/offers/:id/decline` — body `{ reason?: "no_capacity"|"out_of_area"|"price"|"other", note? }` → `{ status: "declined", next_action: "advance_pipeline"|"escalate" }`. Errors: 403, 404.
- `GET /api/admin/routing/decisions/:bookingId` — audit trail (offer rounds, declines, final dispatch). → `{ booking_id, decisions: RoutingDecision[], current_state }`. Errors: 404.

---

### 2.6 Day commitments + day-packs (Builder)

- `POST /api/contractor/day-commitments` — Builder declares a day. Body `{ date, area, target_pence, notes? }` → `{ id, date, status: "open" }`. Errors: 403 (not Builder), 409 (already committed).
- `GET /api/contractor/day-commitments?from=&to=` → `{ data: DayCommitment[] }`.
- `DELETE /api/contractor/day-commitments/:id` — honours ADR-007 SLA: ≥48h free, <48h = 409 `release_sla_breach` + auto exception. 204 on success.
- `GET /api/admin/day-packs?date=&unit_id=&status=` → `{ data: DayPack[], meta }`.
- `POST /api/admin/day-packs/assemble` — body `{ commitment_id, mode: "manual"|"solver", job_ids?: string[] }` → `{ pack_id, jobs: JobInPack[], total_pence, target_pence, gap_pence }`. Errors: 404, 422.
- `POST /api/contractor/day-packs/:id/accept` (own commitment) → `{ pack_id, status: "accepted", dispatch_ids: string[] }`. Errors: 409.
- `POST /api/contractor/day-packs/:id/decline` — body `{ reason? }` → `{ status: "declined" }`.
- `POST /api/admin/day-packs/:id/release` — admin force-release. → `{ released: true, freed_jobs }`.

---

### 2.7 Materials pickup — module 12

- `POST /api/contractor/day-packs/:packId/materials/collected` — body `{ items_confirmed: string[], collected_at?, notes? }` → `{ pack_id, materials_status: "collected" }`.
- `POST /api/contractor/day-packs/:packId/materials/skipped` — body `{ reason: "supplier_closed"|"missing_items"|"contractor_issue"|"other", note? }` → `{ pack_id, materials_status: "skipped", exception_id }` (auto-creates control-tower exception).

---

### 2.8 Pay protection — module 07

All carry `dispatch_id`; photos via existing S3-signed upload flow. All adjustment writes return `{ id, type, status: "pending_review" }`. Errors: 404, 422.

- `POST /api/contractor/pay-adjustments/uplift` — body `{ dispatch_id, photos: string[], reason, requested_pence? }` (type `mis_scope_uplift`).
- `POST /api/contractor/pay-adjustments/callout` — body `{ dispatch_id, reason: "no_access"|"customer_no_show"|"unsafe", photos: string[] }` (type `callout`).
- `POST /api/contractor/pay-adjustments/materials` — body `{ dispatch_id, receipt_photo_url, amount_pence, supplier? }` (type `materials`).
- `GET /api/contractor/pay-adjustments/mine?status=&limit=&offset=` → `{ data: PayAdjustment[], meta }`.
- `POST /api/admin/pay-adjustments/:id/approve` — body `{ approved_pence, note? }` → updated row.
- `POST /api/admin/pay-adjustments/:id/reject` — body `{ reason }` → row with `status: "rejected"`.

---

### 2.9 Contractor earnings

- `GET /api/contractor/earnings?period=week|month|30d` → `{ period, gross_pence, net_pence, jobs_completed, by_segment, breakdown: { base, bonus, callout, uplift, materials } }`.
- `GET /api/contractor/payouts/history?limit=&offset=` → `{ data: Payout[], meta }`.

> Existing admin `/api/payouts/*` is unchanged; the new `/api/contractor/payouts/*` is the contractor-facing slice.

---

### 2.10 Day-pack page production — module 15

- `GET /api/day-packs/:packId/public?token=` — one-shot, expiring token. Powers the production day-pack contractor page promoted from the test page; returns the `JobInPack[]`-shaped payload the test page consumes. → `{ pack_id, date, unit: { id, name }, jobs: { id, sequence, address_redacted, duration_minutes, skills, materials, pay_pence, scope_summary }[], totals: { pay_pence, duration_minutes }, materials: { supplier, items, status } }`. Errors: 403 (bad/expired token), 404.

---

### 2.11 Webhooks (incoming) — unchanged

- `POST /api/stripe/webhook` — now triggers `quoted → booked_pending_routing` (see `state-machine.md`).
- `POST /api/voice/twilio-status` — no shape change.

---

## 3. Auth + permissions matrix

C=Customer, K=Contractor, A=Admin, I=Internal-only. `–` = not allowed.

| Endpoint group | C | K | A | I |
|---|---|---|---|---|
| `/api/quotes/:id/(flex-tier\|pricing)`, `/availability/eligible-dates` | slug+token | – | yes | – |
| `/api/admin/(quotes\|dispatch\|units)/*` | – | – | yes | – |
| `/api/units/:id/availability` | – | own | yes | – |
| `/api/availability/(hold\|release)`, `/api/routing/dispatch` | – | – | yes | yes |
| `/api/routing/offers/:id/(accept\|decline)` | – | offer's unit | – | – |
| `/api/admin/routing/decisions/:bookingId` | – | – | yes | – |
| `/api/contractor/(day-commitments\|day-packs\|pay-adjustments\|earnings\|payouts/history)/*` | – | own | – | – |
| `/api/admin/(day-packs\|pay-adjustments)/*` | – | – | yes | – |
| `/api/contractor/day-packs/:id/materials/*` | – | yes | – | – |
| `/api/day-packs/:packId/public` | token | yes | yes | – |
| `/api/stripe/webhook`, `/api/voice/twilio-status` | – | – | – | yes (signed) |

---

## 4. Error codes

| HTTP | `code` | When |
|---|---|---|
| 400 | `validation_failed` | Body/query failed schema; `details` = issues. |
| 401 | `unauthenticated` | Missing/invalid token header. |
| 402 | `payment_required` | Bond/subscription enforcement. |
| 403 | `forbidden` | Authenticated but wrong unit/role. |
| 404 | `not_found` | Resource doesn't exist. |
| 409 | `conflict` | State-machine violation (booked, slot taken, SLA breach, double-accept). |
| 422 | `validation_failed` | Semantic validation past schema. |
| 429 | `rate_limited` | Offer accept/decline storms. |
| 500 | `internal_error` | Unhandled; logged, traced. |
| 503 | `service_unavailable` | Routing/availability engine offline; retry. |

---

## 5. Cross-references

- Routing internals → `modules/05-routing-engine.md`. Availability → `modules/04-availability-engine.md`. Pay-adjustments → `modules/07-pay-protection.md` (seven guarantees). Materials → `modules/12-materials-collection.md`. Public day-pack page → `modules/15-day-pack-page-production.md`.
- State transitions per write → `state-machine.md` (this file omits diagrams). Endpoint exposure flags → `feature-flags.md`.
