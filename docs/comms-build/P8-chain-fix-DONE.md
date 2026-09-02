# P8 / A-fix — estimator ran twice and overran its output budget

Branch `p8-chain-fix` from `comms-v3` at `c7ed005` (all of P8 merged), worktree
`/Users/courtneebonnick/v6-wt-exit`. Brief: `docs/comms-build/BRIEF-P8-chain-fix.md`.
Incident: first live Route A pass (Gemma, 396cc967…, 2 Sep 17:18 UTC): two `estimator` runs one
second apart, both `hit max_tokens (8000) on turn 4`, the estimate row `failed`, no draft, no ping.

## Why two estimators started (found)

`runDue` (server/spine/request-run.ts) gated on `isSpineEnabled()` only. In **shadow** mode the
spine is enabled, so the worker's `runDue` executed a LIVE `runOnce` on every due row while the
legacy fast tick ran the shadow pass (`runShadow` → `runOnce({ shadow: true })`) on the same rows.
Two passes per thread ~1 s apart, two Quote clerk runs, two inline chains, two estimators. (The
brief's other candidate — the registry picking the estimator up via `accepts` — was not it: the
runner dispatches by lane only.) A second, cosmetic double: the spine's own `estimator` row and the
model-call row the runner writes were both named `estimator`.

## Fix

1. **Output budget** (`server/spine/agents/estimator.ts`)
   - `ESTIMATOR_MAX_TOKENS = 16000` on the runner call (was the runner default 8,000).
   - Compact shape, enforced by the belt: `compactBuildInput` trims every submission to ≤ 4
     one-sentence procedure steps, ≤ 8 materials and ≤ 4 assumptions per line, `time.note`
     (the reasoning) ≤ 200 chars, before the price check and the legacy normaliser. The
     `submit_build` description and a `COMPACT_RULES` block appended to the system prompt tell the
     model so.
   - **One retry** on `max_tokens` (`isMaxTokensError` matches the runner's wording): a fresh belt
     and a goal that repeats the lines with "Do NOT research any further. Call submit_build NOW
     with what you already have, compactly…". A second truncation fails the row; any other error is
     not retried.
   - The runner's own row is now named `quote-estimator` (child of the spine's `estimator` row via
     `parentRunId`), so the drawer shows one spine run with one model-call child.

2. **Single flight** (`server/spine/estimate-store.ts`, `request-run.ts`, migration)
   - `claimEstimate` replaces the plain insert: read the live estimate for the intake run and the
     `running` rows on the thread, decide with the pure `canClaim`, then insert `running`. Refused
     when a live estimate (running, complete **or failed**) exists for that intake, or another
     estimator on the thread is < 10 min old. A lost race on insert (23505) is also a refusal.
   - `migrations/20260904_quote_estimates_single_flight.sql`: partial unique index
     `(intake_run_id) WHERE superseded_at IS NULL AND intake_run_id IS NOT NULL` — the refusal is a
     database guarantee across processes. **Apply before deploy** (idempotent; the applier).
   - `runEstimateForIntake` throws `EstimateClaimRefused` before any model call; Route A returns
     `{ ran: false, reason }` for it — no draft, no ping (the holder's run makes them).
   - **The other path is a no-op:** `runDue` now returns `[]` unless the mode is `live`. Shadow =
     the legacy tick's `runShadow` is the one pass; live = `runDue` is the one pass.

3. **Failure still produces the draft** (`server/spine/route-a.ts`)
   - The estimator step is wrapped: on any failure other than a refused claim, `fallbackEstimate`
     builds an estimate from the clerk's intake lines (every line `timeSource 'fallback'`, no
     minutes, no materials, confidence low, reasoning `estimator failed: <err>`), keyed on the
     failed `quote_estimates` row's id when the error carries one (`EstimateFailure.estimateId`).
   - The pricing bridge prices those lines from the reference rate (category hourly × 60 min,
     floored at the minimum charge), `checkThis: true`, reason `estimator failed: <err>; priced at
     the <category> reference rate for 60 min — check this` (`ESTIMATOR_FAILED_PREFIX`).
   - The draft is created as usual; the estimate row stays `failed` with its error (and gets
     `draft_quote_id`); the `system_events` summary says "from reference rates (estimator
     failed)"; the Pushover carries `estimatorFailed` and reads "⚠️ Priced from reference rates,
     estimator failed (…). Every line needs a check." `RouteAOutcome.fallback = true`.

4. **Tests (fakes, no DB)**: `agents/estimator.test.ts` (+6: compact shape, belt stores compact,
   max_tokens detection, retry once with the submit-now goal and 16k cap, second truncation fails /
   other errors not retried, refused claim throws before the model and writes nothing; the run test
   now asserts the runner name, the cap and the prompt block, and that a failure carries the row
   id); `estimate-store.test.ts` (+3: `canClaim` refusal by status, in-flight vs stale, fresh);
   `route-a.test.ts` (new, 5: failure → fallback draft with every line check_this and the failed
   row's id, engine never called, Pushover says estimator failed; "returned nothing" the same way;
   refused claim → nothing; happy path unchanged with three engine runs; `fallbackEstimate` pure).

## Files

New: `migrations/20260904_quote_estimates_single_flight.sql`, `server/spine/route-a.test.ts`, `P8FIX-DONE.md`.
Changed: `server/spine/agents/estimator.ts`, `server/spine/agents/estimator.test.ts`,
`server/spine/estimate-store.ts`, `server/spine/estimate-store.test.ts`, `server/spine/route-a.ts`,
`server/spine/pricing-bridge.ts`, `server/spine/request-run.ts`, `server/pushover.ts`.

## Verification

| Gate | Result |
|---|---|
| tsc vs `c7ed005` | 1,871 → 1,868; the (file, error code) multiset differs only by three pre-existing errors in `server/spine/agents/estimator.ts` that this fix cleared (a null run id from the merged intake card). Zero new. |
| server vitest | baseline 42 failed / 987 passed (68 files); after 42 failed / 1001 passed (69 files); failing set identical |
| `npm run test:client` | 60 passed, unchanged |
| esbuild `server/index.ts` | bundles |

No dev server, no database, no `app_settings`, no push.

## Not done, and why

- **The runner's 8,000 default is unchanged** for every other agent; only the estimator asks for
  16,000. Raising the default is a cost decision for the owner.
- **A failed estimate blocks a second automatic attempt on the same intake** (by design of the
  claim); a re-run is a manual request (`POST /api/spine/estimate/:id`) once pane C's supersede
  path or a new intake clears it. Noted so nobody expects the cron to retry.
- **Shadow mode no longer executes `requestRun` rows on the spine worker.** Anything that relied
  on `runDue` in shadow (the P7 rerun, the manual estimate request) is handled by the legacy tick's
  shadow pass reading the same `nextTriageAt` key; the runs are dry there. In live they run as before.

## Decisions

- The claim is the row itself, not a separate lock table: one insert, one partial unique index,
  and the refusal reason names the holder.
- A failed row counts as "held" so the fallback draft is not silently replaced by a second
  automatic model call minutes later; Ben has the draft and the failure is visible on it.
- The retry sends a new goal rather than continuing the truncated transcript: a cut-off tool call
  must never be executed (the runner's own rule), so the cheapest safe retry is a fresh belt.
