# Module 14: Test Page → Production Migration Path

**Status:** Wave 3 spec
**Depends on:** Module 13 (design system) — provides shared components
**Sister module:** Module 15 (day-pack page production) — Wave 4

---

## 1. Purpose

The hardcoded `/dispatch-preview` test page (`client/src/pages/contractor/DispatchPreviewPage.tsx`, ~921 lines) is the visual prototype of the Builder day-pack offer. Per Q3 (c), it stays live **forever** as a stable demo URL for sales, recruitment, and onboarding.

Production is built as a separate route — `/dispatch/:packId` — that reuses the same UI components but reads from the API. The two coexist permanently. This module documents what stays, what changes, and how drift is prevented.

---

## 2. The two pages — comparison

| Concern | `/dispatch-preview` (test) | `/dispatch/:packId` (production) |
|---|---|---|
| File | `DispatchPreviewPage.tsx` | `DayPackOfferPage.tsx` (new) |
| Data | Hardcoded `PACK` constant | `GET /api/day-packs/:packId/public` |
| Bond payment | UI mock — toast, no charge | Real Stripe Connect capture |
| State persistence | `useState` only, resets on reload | Server-persisted via API |
| Materials collection | Local toggle | `POST .../materials/collected` |
| Stop completion | Local toggle | `POST /api/contractor-job/:token/complete` |
| Photo upload | None | S3 presigned-URL upload |
| Confetti / dopamine | All present | All present (same components) |
| URL gating | Public, no auth | Per-contractor token gate |
| Lifecycle | Never deprecated | Flag-gated `FF_DAY_PACK_PAGE_PROD` |
| Audience | Sales, recruitment | Real Builder contractors |

---

## 3. What stays in the test page

- **Hardcoded `PACK` constant** — updated rarely; a known-good visual reference
- **All Module 13 components** — once Phase 7 ships them, the test page imports them like production does
- **Route stays at `/dispatch-preview`** — never deprecated, never flag-gated
- **Mock interactions** — Mark-complete / Mark-collected buttons fire toasts and flip local UI state only
- **"Accept day" button** — modal explaining "preview only — go to handyservices.app/contractor to see live offers"

The test page is a stable artefact. A recruiter, sales call, or partner pitch can always show this URL with confidence the visuals are intact.

---

## 4. What changes for production

The production page (`DayPackOfferPage.tsx`) has the **same visual design** — same Module 13 components, animations, copy — but every interaction is wired to a real backend:

- Real pack data from `GET /api/day-packs/:packId/public` (Module 06)
- Real Stripe bond capture on accept
- Real S3 photo upload on stop completion
- Real state persistence (refresh-safe, multi-device-safe)
- Real materials reimbursement upload (Module 12)
- Push notifications wired through (Module 10)
- Cancellation / reschedule handling
- Per-contractor token gating (URL valid only for the assigned Builder)
- **Server-side bonus calculation** — client sends "stop N complete" events; server decides if the all-or-nothing bonus has unlocked. Never trust the client.

Module 15 (Wave 4) specs the production page's full API contract and state machine. Module 14 is the migration plan only.

---

## 5. Files

```
NEW       client/src/pages/contractor/DayPackOfferPage.tsx (production — Module 15)
NEW       server/day-packs/public-routes.ts                (GET /api/day-packs/:packId/public)
MODIFIED  client/src/App.tsx                               (add /dispatch/:packId route)
KEEP      client/src/pages/contractor/DispatchPreviewPage.tsx (test — never deleted)
REFACTOR  same file in Phase 7 — swap inline JSX for Module 13 components
```

---

## 6. Component reuse from Module 13

Both pages import the same set:

- `<BrandNavBar />`, `<BrandFooter />`, `<BrandAccentStrip />` — chrome
- `<HeroNavyCard />` — £ headline card
- `<NumberedDot />`, `<TimelineConnector />`, `<MarkCompleteButton />` — stop timeline
- `<TrophyUnlockNode />` — all-or-nothing bonus reveal
- `<ToastStack />`, `<ConfettiBurst />`, `<CounterTicker />`, `<ProgressBar />` — dopamine
- `<MaterialChip />`, `<DetailsCollapsible />` — stop detail

When Module 13 ships in Phase 7, the test page is refactored to import these components (today it inlines all styling, ~921 lines), and the production page imports the same set. The refactor removes ~400 lines of inline styling and turns the test page into a Storybook-style live preview. Brand-token changes then propagate to both pages automatically.

---

## 7. Cutover plan (Phase 7)

Sequential — each step independently reversible:

1. **Module 13 ships components** (Phase 7 start); Storybook covers each in isolation.
2. **Test page refactored** to use Module 13 components. Chromatic confirms pixel parity with the pre-refactor screenshot.
3. **Production page (`DayPackOfferPage.tsx`) shipped** behind `FF_DAY_PACK_PAGE_PROD` (default OFF), importing the same components.
4. **Backend route shipped** — `GET /api/day-packs/:packId/public` plus mutation endpoints wired to dispatch lifecycle.
5. **Staging rollout** — flag enabled in staging, routed to test contractors. Validate: state persists, bond captures, photos upload, bonus unlocks server-side.
6. **Production rollout** — flag flipped on. Real Builders see the live page.
7. **Test page stays at `/dispatch-preview`** — no deprecation, ever.

---

## 8. Marketing / sales implications

The test page becomes a sales asset:

- "See what a contractor sees: `handyservices.app/dispatch-preview`"
- Featured in pitch decks (Module 09 pitch dashboard)
- Used in contractor recruitment ads ("here's what your day looks like")
- A/B sandbox — alternative bonus framings, copy, animation variants tested without touching production
- Stable URL means external links (LinkedIn posts, recruiter emails, investor decks) never 404

---

## 9. Drift prevention

**Risk:** production diverges from the test page as production-only requirements (auth states, error UI, retry flows) creep in.

**Prevention:**

- **Shared component import** — both pages must import from `client/src/components/dispatch/` (Module 13). Lint rule forbids inline duplicates.
- **Visual regression (Chromatic)** — both routes have screenshot tests on every PR; significant diffs block merge.
- **Quarterly drift review** — confirm the test page still matches production's primary states. If production adds a state (e.g. "bond pending"), the test page gets a toggle to demo it or explicitly opts out.
- **Single source of truth for tokens** — brand colors / spacing / type live in Module 13 token files only.

---

## 10. Tests

- **Test page** renders without any API (no fetch calls in JSDOM).
- **Production page** renders against mocked API responses for each major state: not-accepted, bond-captured, materials-en-route, in-progress, complete-bonus-unlocked.
- **Visual parity** — both pages produce identical screenshots in "not yet accepted" (Chromatic diff < 1%).
- **Module 13 components** covered in isolation (Storybook + visual regression).
- **Server-side bonus rule** — unit-tested independently; client cannot grant the bonus.

---

## 11. Rollback

- **Test page:** never rolled back. No flag — always on.
- **Production page:** `FF_DAY_PACK_PAGE_PROD` off → `/dispatch/:packId` returns a "coming soon" placeholder (or 404 in early phases). Builders fall back to the legacy contractor flow until the flag flips back on.
- **Schema:** Module 06 day-pack tables are additive; rolling back the production page leaves the DB forward-compatible.

---

## 12. Cross-references

- **Module 13** (design system) — shared components both pages consume
- **Module 15** (day-pack page production) — full spec for `DayPackOfferPage.tsx`
- **Module 06** (day-pack solver) — produces the data the production page reads
- **Module 09** (contractor app v2) — production page integrated into the segment-aware contractor flow
- **Module 12** (materials collection) — backs the materials reimbursement step
- **The MVP test page** — `client/src/pages/contractor/DispatchPreviewPage.tsx` at `/dispatch-preview`, lives forever
