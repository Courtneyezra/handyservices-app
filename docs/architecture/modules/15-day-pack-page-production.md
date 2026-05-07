# Module 15: Day-Pack Page Production

**Status:** Wave 4 — authoritative
**Phase:** 7
**Primary flag:** `FF_DAY_PACK_PAGE_PROD` (defaults OFF)
**Depends on:** Modules 06, 07, 12, 13, 14; ADR-007; `state-machine.md`; `api-surface.md` §2.10
**Sister module:** Module 14 (test page → production migration plan)

---

## 1. Purpose

The hardcoded `/dispatch-preview` test page is a frozen visual prototype kept live forever (Module 14). This module specifies the **production** day-pack offer page — `DayPackOfferPage.tsx` at `/dispatch/:packId/:token` — that real Builders see after accepting a Builder day commitment. Visually identical to the test page (same Module 13 components, animations, copy); every interaction wired to a real backend: pack data fetched live, bond captured via Stripe Connect, photos uploaded to S3, materials state via Module 12, completion bonus computed server-side per ADR-007, state synced over WebSocket.

---

## 2. Visual parity with test page

Reproduces the MVP UX by importing Module 13 components, never reimplementing: `<BrandNavBar />`, `<BrandAccentStrip />`, `<HeroNavyCard />` (gold £ + glow), `<MaterialsPickupStep />` as Step 0, `<NumberedDot />` + `<TimelineConnector />` + `<MarkCompleteButton />` timeline, `<TrophyUnlockNode />`, pay-protection in `<DetailsCollapsible />`, `<ConfettiBurst />` + `<ToastStack />` + `<CounterTicker />` + `<ProgressBar />` + `<MaterialChip />` + `<BrandFooter />`. Static Google map (same builder as the test page). Chromatic enforces lockstep parity (Module 14 §10). Production-only components (§7) are additive.

---

## 3. Differences from the test page

Per Module 14 §2:

| Concern | `/dispatch-preview` (test) | `/dispatch/:packId/:token` (this) |
|---|---|---|
| Route | Always-public | Per-contractor token gate |
| Data | Hardcoded `PACK` | `GET /api/day-packs/:packId/public` |
| Bond | UI mock toast | Stripe Connect SetupIntent + capture |
| Photos | None | S3 presigned-URL upload |
| State | `useState`, resets | Server-persisted; refresh-safe |
| Bonus | Client-side, advisory | **Server-side, canonical** (ADR-007) |
| Materials | Local toggle | `POST …/materials/(collected\|skipped)` |
| Cancellation | "Preview only" modal | Real customer-cancel + carve-out attribution |
| Real-time | None | WebSocket + 30 s polling fallback |

---

## 4. API contract

One read endpoint plus the mutation endpoints in `api-surface.md` §2.6, §2.7. Read shape extends §2.10 with the live-state envelope:

```ts
// GET /api/day-packs/:packId/public?token=:contractorToken
interface DayPackPublic {
  packRef: string;
  date: string;                   // ISO-8601
  contractorName: string;
  area: string;

  // Same shape the test page renders today
  jobs: JobInPack[];
  dayRatePence: number;
  completionBonusPence: number;
  materialsPickup?: MaterialsPickup;
  totalWorkHours: number;
  totalTravelMinutes: number;
  totalDistanceMiles: number;

  // Live state — server is source of truth
  state: {
    bookingState:
      | 'reserved_for_pack' | 'dispatched' | 'in_progress'
      | 'completed_pending_review' | 'paid_out';
    completedStops: number[];     // job sequence numbers marked done
    cancelledStops: { sequence: number;
                      reason: 'customer_cancelled' | 'weather' | 'missing_materials';
                      carveoutHonoured: boolean }[];
    materialsCollected: boolean;
    bondCaptured: boolean;
    earnedBonusPence: number;     // server-calculated; never trust client
    canEarnBonus: boolean;
    photoRequirements: { sequence: number; minPhotos: number }[];
  };
}
```

`server/day-packs/state-bridge.ts` projects `personalizedQuotes.booking_state`, `dispatchCompletions`, `materials_pickups`, and carve-out rows on `pay_adjustments` into this envelope — one projection, so the page never touches the schema directly.

---

## 5. Server-side bonus calculation (ADR-007)

The page never computes bonus. It reads `state.earnedBonusPence` and renders `<TrophyUnlockNode allComplete={state.canEarnBonus} bonusPence={state.earnedBonusPence}>`. Shared `bonusEarned()` (ADR-007 §Implementation, also used by Module 07) recomputes after every state-changing mutation. Per ADR-007 + state-machine.md §3, bonus only **pays out** in `paid_out`; the page surfaces `earnedBonusPence > 0` as soon as eligibility locks and the guarantees row reads "released with payout in 48 h". `<ConfettiBurst />` fires only on the client-observed `canEarnBonus=false → true` transition and is idempotent (localStorage key `pack-{id}-confetti-fired`).

---

## 6. Real flows

### 6a. Bond payment on accept
`POST /api/contractor/day-packs/:packId/accept` (§2.6). Server validates caller is the assigned Builder, commitment not already accepted, no conflict that day. If `handyman_profiles.bond_required=true`, server returns `{ status: 'bond_required', stripeClientSecret }`; page mounts `<BondPaymentModal />` (Stripe Connect `confirmCardSetup`), client posts `setup_intent.id` back, server captures bond and re-runs accept. State machine: `reserved_for_pack → dispatched`; pack locked; siblings transition to `dispatched`. Bond capture failure → stays in `reserved_for_pack`, page renders `Payment failed — try again`, siblings remain unlocked.

### 6b. Stop completion
If `state.photoRequirements` covers the stop, `<PhotoUploadGate />` blocks submit until ≥ N photos uploaded via S3 presigned URL. Then `POST /api/contractor/stops/:dispatchId/complete` with `{ photos, note? }`. Server writes `dispatchCompletions`, transitions `in_progress → completed_pending_review`, recomputes `bonusEarned()`. WebSocket emits `pack.{packId}.state_changed`; client refetches. `<ToastStack />` shows `Stop {N} done · {remaining} to go`; `<NumberedDot complete>` flips; `<ProgressBar />` advances.

### 6c. Materials collection
`<MaterialsPickupStep />` calls `POST /api/contractor/day-packs/:packId/materials/collected` (§2.7). Server flips `materials_pickups.status='collected'`, recomputes bonus, emits WS. Skipped variant (`/materials/skipped`) writes `skip_reason`; `van_stock` still counts toward bonus per ADR-008.

### 6d. Mid-job customer cancellation
Customer cancels stop 3 of 4. State machine: `dispatched | in_progress → customer_cancelled` for that stop (state-machine.md §3). Module 07 `cancellation-comp.ts` writes the comp row. ADR-007 carve-out 1: stop 3 counts complete-for-bonus; `state.cancelledStops` flags `carveoutHonoured: true`. WS event reaches the page; stop 3 renders as `<CancellationBanner />` with comp amount and "Counts toward your bonus". Builder finishes the remaining 3 → `canEarnBonus=true` → `<ConfettiBurst />`. Same path for weather (carve-out 2) and missing customer-supplied materials (carve-out 3).

---

## 7. Files

```
NEW       client/src/pages/contractor/DayPackOfferPage.tsx        # the production page
NEW       client/src/components/contractor/BondPaymentModal.tsx   # Stripe SetupIntent UI
NEW       client/src/components/contractor/PhotoUploadGate.tsx    # required-photo blocker
NEW       client/src/components/contractor/CancellationBanner.tsx # carve-out attribution
NEW       client/src/lib/day-pack-realtime.ts                     # WS + polling fallback
NEW       server/day-packs/public-routes.ts                       # GET …/public
NEW       server/day-packs/state-bridge.ts                        # state projection
MODIFIED  client/src/App.tsx                                       # /dispatch/:packId/:token route
MODIFIED  server/index.ts                                          # mount router; pack.* WS events
```

Module 13 primitives are imported, never reimplemented (Module 14 lint rule).

---

## 8. Token gating

URL `/dispatch/:packId/:token`. The `token` is per-contractor per-pack, generated when `day_packs.status` transitions `proposed → accepted` (Module 06): 32-byte URL-safe base64, stored on `day_packs.public_token_hash` (sha-256, additive column) with `public_token_expires_at = pack.date + 7 days`. Read endpoint validates hash match + `now < expires_at`: mismatch → 403, expired → 401. Same token authorises mutations (server accepts contractor session OR URL token). Extends the existing `/contractor-job/:token` pattern — no new crypto primitives.

---

## 9. Real-time state sync

`day-pack-realtime.ts` subscribes to `wss://…/ws/day-packs/:packId?token=:t`. Server emits `pack.{packId}.state_changed` on stop completion, materials collected/skipped, customer cancellation, carve-out approval, bond capture, payout. On every event the client refetches the public envelope and merges into React state. Disconnect → 30 s polling fallback; reconnect uses exponential backoff capped at 60 s. `useDayPackRealtime(packId, token)` is the only hook the page consumes for live data.

---

## 10. Edge cases

- **Commitment released < 24 h before** — ADR-007 hard breach; page shows `Day-pack cancelled` + support link; reliability score drops; no bonus.
- **Photo upload retry** — exponential backoff, 3 attempts. Final failure: `Couldn't upload — saved locally`; photo sits in IndexedDB and re-attempts on next visibility change. Stop is **not** marked complete until upload succeeds.
- **Bond capture fails** — pack stays in `reserved_for_pack`; siblings not locked; Builder can retry.
- **App closed and reopened** — every interaction is server-persisted; refetch on mount renders current state. Confetti key prevents re-fire.
- **Two devices same Builder** — both subscribe to the same WS channel; reflect each completion within ~1 s.
- **Race on accept** — `Idempotency-Key` collapses duplicates (api-surface.md §1).
- **Token leaked / shared** — admin rotates via `POST /api/admin/day-packs/:id/rotate-token`.

---

## 11. Tests

Page renders against mocked `/public` responses per state. Mark stop complete → optimistic UI + server confirm + bonus recalc. Materials collected → bonus eligibility recomputed server-side. `<PhotoUploadGate />` blocks submit until ≥ N photos chosen. WS disconnect → polling fallback within 30 s; reconnect resumes WS. Token expired → 401; mismatch → 403. Customer cancel mid-job → carve-out applied, banner rendered, bonus still earnable. Bond failure → no transition; retry surface visible. Confetti idempotency on refresh. Visual parity with test page in not-yet-accepted state (Chromatic diff < 1 %, Module 14 §10). Devtools-mutated `earnedBonusPence` never grants payout (`server/pay-protection/__tests__/bonus.test.ts`).

---

## 12. Rollback

`FF_DAY_PACK_PAGE_PROD = 0`: `/dispatch/:packId/:token` returns 404 (route is flag-mounted in `App.tsx`); `GET /api/day-packs/:packId/public` returns 404 with `code: feature_disabled`; test page `/dispatch-preview` unaffected (no flag dependency, ever); affected day-packs fall back to the legacy `ContractorJobSheet` flow with one dispatch link per job; schema additions (`public_token_hash`, `public_token_expires_at`) are additive and harmless. Sub-flags (`_BOND`, `_PHOTOS`, `_REALTIME`) allow staged rollout: read-only first, then bond, then photo gating, then WS — each independently reversible.

---

## 13. Cutover from the test page (Phase 7)

Mirrors Module 14 §7: (1) Module 13 components ship; Storybook + Chromatic green. (2) Test page refactored onto Module 13 components; visual parity asserted. (3) This page ships behind `FF_DAY_PACK_PAGE_PROD = OFF`, importing the same components. (4) `public-routes.ts` + `state-bridge.ts` ship; WS emit hooks added. (5) Flag ON in staging; test contractors run live day-packs; validate persistence, bond, photos, bonus on real Stripe Connect. (6) Flag ON in production; first real Builder pack runs end-to-end. (7) Test page stays at `/dispatch-preview` forever.

---

## 14. Cross-references

ADR-007 (bonus + carve-outs); Module 06 (data source); Module 07 (bond, uplift, callout, materials reimbursement, cancellation comp surfaced in `<DetailsCollapsible />`); Module 12 (`<MaterialsPickupStep />` + materials routes); Module 13 (every visual primitive); Module 14 (comparison + drift prevention + cutover); `state-machine.md` §3 (transition triggers consumed by `state-bridge.ts`); `api-surface.md` §2.6/§2.7/§2.10 (endpoints); `client/src/pages/contractor/DispatchPreviewPage.tsx` (visual reference); `ContractorJobSheet.tsx` + `DispatchLinkPage.tsx` (legacy fallback when the flag is OFF).
