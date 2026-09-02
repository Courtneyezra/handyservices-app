# P6 — client test harness + tests for the new admin UI (close-out pane B)

Branch `p6-client-tests` from `comms-v3` `dfa65aa`. Worktree `/Users/courtneebonnick/v6-wt-worker`.
Nothing here changes customer-facing behaviour: the only source edits are `export` keywords on
page-private components and a relative import in an archived script.

## What was built

**Harness**
- `vitest.config.ts` — two projects under `test.projects`: `server` (the previous config verbatim:
  node env, `server/__tests__/setup.ts`, `server/**/*.test.ts`) and `client` (jsdom,
  `client/test-setup.ts`, `client/src/**/*.test.{ts,tsx}`, `esbuild.jsx: 'automatic'`). Root
  `resolve.alias` now carries `@`, `@shared`, `@assets` and `@test-utils`.
- `client/test-setup.ts` — jest-dom matchers, `cleanup()` + `vi.restoreAllMocks()` + storage
  clear after each test, an unstubbed-`fetch` tripwire (throws with the URL), jsdom gaps
  (`matchMedia`, `ResizeObserver`, `scrollIntoView`, pointer-capture) and a `MockEventSource`
  stub (jsdom has no EventSource; `useCommsEvents` opens one at mount).
- `client/test-utils.tsx` (alias `@test-utils`) — `renderWithQuery()` (fresh React Query client,
  no retries/intervals) and `mockFetch(routes, { fallback })` (routed fetch stub recording
  `{url, method, body, headers}`; `of(method, urlPart)` filters calls).
- `npm run test:client` = `vitest run --project client`. `npx vitest run` runs both projects.
- `tsconfig.json` excludes `**/*.test.tsx` (mirrors the existing `**/*.test.ts` rule).
- devDependencies (versions installed): `jsdom@29.1.1`, `@testing-library/react@16.3.3`,
  `@testing-library/dom@10.4.1`, `@testing-library/jest-dom@7.0.1`,
  `@testing-library/user-event@14.6.7`. jsdom 30 was tried first and refused: its bundled undici 8
  needs Node ≥ 22.19 (`webidl.util.markAsUncloneable is not a function` on this machine's
  Node 20.20); 29.1.1 is the newest that supports Node ^20.19.
- `docs/RUNBOOK.md` "Verification rule" item 2 now describes the two projects and `test:client`.

**Tests (36, all green)** — `client/src/components/comms/__tests__/` and `client/src/pages/admin/__tests__/`
| File | Covers |
|---|---|
| `VerdictReasonChips.test.tsx` (5) | five chips with labels; tap submits the underscore key once; cancel; busy disables all; unsafe chip red in any tone |
| `CommsPage.draft-card.test.tsx` (7) | `DraftApprovalCard`: bubbles split on `---`, agent reason, due chip; approve-as-is = one tap, `POST /approve {reason:'fine'}`, no PATCH, no chips, Bearer header; edit → `Approve edit & send` → chips (nothing posted yet) → pick `tone` → `PATCH /api/drafts/d1 {body}` then `POST /approve {reason:'tone'}`; reject → chips, cancel restores, pick `unsafe` → `POST /reject {reason:'unsafe'}`; window shut disables approve unless `contentSid`; 409 message shown and `onDone` not called. `DueChip`: "due in 2h" / "overdue by 40m" (red) / nothing for null or garbage |
| `SampleReviewStrip.test.tsx` (5) | renders nothing when empty (after the fetch); lists questions with parsed SENT body + judge line (NOT fine in red); Fine posts `{answer:'fine', reason:'fine'}` and the row leaves; Not fine → chips → `{answer:'not fine', reason:'wrong_move'}`; body tap opens thread |
| `AgentRunsDrawer.test.tsx` (4) | count badge; empty state; `available:false` message; 3 runs newest-first with decision / guard count / cost, expand shows proposal body joined by `---`, guard chips, tokens, model, run id, rest-of-proposal JSON, error line; collapse; failed load message |
| `QuoteIntakeCard.test.tsx` (6) | 404 → nothing; missing-field chips + `Ask now` → `POST /api/spine/ask/c1 {kind:'ask_postcode'}` → "Not sent: answered"; typing clears chips, postcode upper-cases; media all ticked, untick/retick with `(n/2)` counter; save posts exact body (lines carry no price/pence/labour/materials keys, `mediaIds` = ticked only) → "Draft saved, not sent." + edit link + `onSaved`; save disabled with no titled line; 400 errors joined |
| `AgentStaffPage.test.tsx` (9) | `WorkerHeartbeatStrip` alive / stale (15 min, "stale after 3 min") / never / not reported; `SpineSwitchStrip` shadow pill + every chip on/off class + agent chips + legacy row, live/off pills, null; `PackTiersBlock` per-pack table (tier class, `earned`, `14 (1 rej)`, `pass 12/12`, `fail 7/9`, `1 · 1 esc`, last change vs `launch default`); full `AgentStaffPage` with mocked `/api/agents/staff`: strips render, badge opens the Radix sheet with the ladder (4 rows), older-server fallbacks, 401 → log-in prompt |

## Source changes outside tests
- `client/src/pages/admin/CommsPage.tsx` — `export` on `DraftApprovalCard`, `DueChip`, `PendingDraft` (were module-private). No logic change.
- `client/src/pages/admin/AgentStaffPage.tsx` — `export` on `WorkerHeartbeatStrip`, `SpineSwitchStrip`, `PackTiersBlock` and their four prop interfaces. No logic change.
- `scripts/archive/_quote-prep-intake-check.ts` — import of `server/agents/quote-prep` was an
  **absolute path into the main checkout** (`/Users/courtneebonnick/v6-switchboard/...`). In any
  worktree that pulls the main checkout's `server/` + `shared/schema.ts` into the tsc program
  (268 files), so every pane's "zero new errors" gate was measuring main's uncommitted state as
  well as its own (the +102 seen below). Now relative. Outside the brief's component list, but it
  is what makes rule 3 measurable; flagged here on purpose.

## Bugs found in the components
None. Every flow in the brief behaved as designed under the tests; no component fix was needed.
Two observations, not bugs: (a) `SampleReviewStrip.onSettled` clears the chip state even when the
POST fails, so a failed "not fine" silently returns to the Fine/Not fine buttons with no error
shown; (b) `QuoteIntakeCard` re-seeds its edits only on a new `runId`, as documented.

## Migrations
None.

## Verification
- **tsc**: baseline at `dfa65aa` = 1,876 errors (1,872 in worktree paths + 4 from the main
  checkout via the absolute import). Final tree = 1,873, 0 from the main checkout. The one
  extra line is `scripts/scrape-reddit-value-drivers.ts(470,16) TS2393` (duplicate global
  `main()`, a family of 9 untouched scripts). Proven pre-existing: `git stash -u` of all my
  changes and a rerun under the same cache reports the same line (and 1,978 total, because the
  main checkout moved to `861d8cf` between runs). Per-file × code diff between the stashed start
  commit and the final tree, worktree paths only: **empty**. Zero new errors.
- **vitest**: `DATABASE_URL=postgres://u:p@127.0.0.1:1/x PHASE0_MERGED=1 npx vitest run` →
  59 files, **42 failed** in the same 3 pre-existing files (eve-pricing-engine, segment-classifier,
  contractor-pay), 56 passed. `npm run test:client` → 6 files, 36 tests, all green (≈2 s).
- **esbuild**: `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external` → 3.8 MB, done.

## node_modules note (shared symlink)
`node_modules` in the worktree links to the main checkout's. Main has uncommitted deps
(`ai`, `@ai-sdk/*`, `zod-to-json-schema`) not in this branch's lockfile, so a plain
`npm install` from the worktree prunes them (it did once; restored). Procedure used:
`npm install -D --package-lock-only` in the worktree to update this branch's `package.json` +
lock, then `npm install --no-save <all extras pinned>` from the main checkout so nothing is
pruned. Main's `package.json` / `package-lock.json` verified byte-identical to their pre-session
copies. After merge to `comms-v3`/`main`, a normal `npm install` there makes this moot.

## Not done, and why
- No tests for the `ops/DraftApprovalCard` (Ops Manager transcript card) or the `FlagNoteCard`;
  not in the brief's list.
- No SSE-driven assertions (`draft_delta` settling the ops card); the `MockEventSource` stub is in
  place for whoever needs it.
- The `AgentOutcomesPanel` and `TemplateStatusPanel` on `/admin/staff` are answered with 404s in
  the page test (`fallback: 'notFound'`); they render their error states and are not asserted.
- Client test files are excluded from `tsc` like the server ones; vitest does not type-check, so a
  type slip in a test only shows at runtime.

## Decisions
- Testing Library + jsdom over happy-dom: Radix (Sheet) and dnd-kit imports ran first time under
  jsdom, so no reason to trade fidelity for speed.
- Exported the page-private components rather than moving them to files: smallest diff, and the
  brief asked for "flows in CommsPage / on AgentStaffPage". A later pane can lift them.
- The fetch tripwire in setup means a component that fetches something a test forgot to mock fails
  with the URL in the message instead of hanging on a pending query.
