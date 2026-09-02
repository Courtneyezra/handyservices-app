# P11 — runs and estimates killed by a deploy must not stay "running" forever

Branch `p11-run-janitor` from `comms-v3` at `a698068`, worktree `/Users/courtneebonnick/v6-wt-exit`.
Brief: `docs/comms-build/BRIEF-P11-run-janitor.md`. Incident: Sarah (4c0e227b…), 4 Sep — Railway
restarted the worker mid-chain; an 18:34 quote-prep run stayed UNFINISHED and a killed estimator
left a `running` estimate, which P10's `shouldRequestQuoteRun` read as "in progress" and so blocked
every future quote pass on that intake.

## Fix

1. **Janitor** (`server/spine/janitor.ts`, on the worker's 5-minute slow sweep, first thing, worker-gated)
   - `agent_runs` with `finished_at IS NULL` and `started_at` older than 15 min → `finished_at = now`,
     `error = 'orphaned: process restarted'`, decision untouched (`orphanUnfinishedRuns` in
     `server/agent-runs.ts`, one UPDATE … RETURNING). No ledger `run_finished`: the run never
     finished, and that event is the runner's own claim.
   - `quote_estimates` with status `running` and `created_at` older than 15 min → status `failed`,
     same error, `superseded_at` untouched (`listRunningEstimatesOlderThan` +
     `finishEstimate`). A non-superseded orphan then gets **Route A's failure path**:
     `runFallbackDraftForOrphan` (`server/spine/route-a.ts`) rebuilds the intake from the clerk
     artifact on the estimate's intake run, builds the fallback estimate keyed on the failed row
     (every line reference-priced, `check_this`, reason `estimator failed: orphaned: process
     restarted`), creates the draft, stamps `draft_quote_id` on the failed row, logs, and sends
     the Pushover "Priced from reference rates, estimator failed". A superseded orphan is only
     tidied; an orphan that already has a draft, or whose intake is gone, is skipped with a reason.
   - One `system_events` row per sweep (`kind 'sweep'`, `source 'run-janitor'`) with the counts;
     a quiet "nothing orphaned" row otherwise. Thresholds are pure (`isOrphanedRun`,
     `isOrphanedEstimate`); loaders and writers injected. Never throws.
   - With the dead estimate now `failed` (and, when it can be, carrying a draft), P10's
     `shouldRequestQuoteRun` stops treating it as in progress.

2. **Boot reconciliation** (`bootReconcile`, called from `startCommsInboundSweep` 5 s after boot,
   before the first sweep at 30 s): the janitor once, then P10's `sweepUntriggeredQuotes` with a
   limit of 50 — every thread still carrying `needs_quote` / `rescope` with nothing on the way
   gets its pass re-armed. A deploy mid-chain self-heals within a minute.

3. **Graceful shutdown** (`server/spine/lifecycle.ts`, `server/index.ts`)
   - `beginShutdown` / `isShuttingDown`: on SIGTERM (and SIGINT) the spine's `runDue` and the legacy
     fast tick stop claiming new rows.
   - `track` / `drain`: every `runOnce` registers itself; the handler waits up to **20 s** for
     in-flight passes, then `markOrphanedNow` closes whatever is still running (any age — this
     process is dying) before exit. The previous handler exited immediately.
   - **Railway's grace period is not recorded in this repo** (searched RUNBOOK, PHASE0-OPS,
     CUTOVER, and there is no railway.json / railway.toml). If the platform kills before the 20 s
     drain completes, the boot janitor closes the remainder within 15 min of the next start; the
     drain budget is a constant (`SHUTDOWN_DRAIN_MS`) to align with the service's setting once known.

4. **Tests** (`server/spine/janitor.test.ts`, 11, fakes only): both thresholds at the boundary;
   the janitor closes runs, fails estimates with the orphan error, prices the fallback draft and
   logs one row; a superseded orphan is failed but never priced; nothing orphaned → quiet row; a
   throwing loader and a failed fallback are reported, not thrown; boot reconcile runs the janitor
   before the re-arm and survives a failing re-arm; `markOrphanedNow` marks everything unfinished
   whatever its age; the lifecycle drain waits for and reports in-flight passes and releases a
   rejected one.

## Files

New: `server/spine/lifecycle.ts`, `server/spine/janitor.ts`, `server/spine/janitor.test.ts`, `P11-DONE.md`.
Changed: `server/spine/{estimate-store,route-a,request-run,index}.ts`, `server/agent-runs.ts`,
`server/agents/comms-sweep.ts`, `server/index.ts`. No migrations.

## Verification

| Gate | Result |
|---|---|
| tsc vs `a698068` | 1,868 → 1,868; (file, error code) multiset identical |
| server vitest | baseline 42 failed / 1,022 passed (71 files); after 42 failed / 1,032 passed (72 files); failing set identical |
| `npm run test:client` | 60 passed |
| esbuild `server/index.ts` | bundles |

No dev server, no database, no `app_settings`, no push.

## Not done, and why

- **The legacy agent's own runs** (`runCommsAgent`) are closed by the janitor like any other
  `agent_runs` row, but a legacy run killed mid-flight leaves no draft to recover; only spine
  estimates get the fallback draft. The legacy path retires in Phase 5.
- **Estimator claims after an orphan**: a `failed` orphan still holds its intake for
  `claimEstimate` (P8-fix's single flight), so an automatic re-estimate of the same intake does
  not happen; Ben has the reference-priced draft, and a manual estimate request or a new intake
  supersedes it. That is the P8-fix behaviour, unchanged.
- **The drain does not wait for the legacy agent's runs** (they are not tracked); it waits for
  spine passes only. The janitor covers the rest.

## Decisions

- The janitor runs at the head of the slow sweep, before P10's quote re-arm, so a dead estimate
  is already `failed` when `ensureQuoteRun` looks — order is the fix.
- The orphan fallback draft goes through Route A's own functions (fallback estimate → pricing
  bridge → `createPricedDraft` → Pushover) rather than a shortcut, so the draft Ben sees is the
  same shape whether the estimator failed or was killed.
- The shutdown tail marks orphans itself rather than waiting for the next boot, so a fast
  redeploy cannot leave a 15-minute window in which P10 sees a phantom "running" estimate.
