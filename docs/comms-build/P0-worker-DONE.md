# PHASE 0 / B — worker gate, heartbeat, no V2 — DONE

Worktree `/Users/courtneebonnick/v6-wt-worker`, branch `p0-worker`, based on `c7e8410`.
Commits: `d64c1d9` (the build) + one follow-up (test typing + this file). Not pushed, not merged, not rebased.

## Files changed

New
- `server/worker-gate.ts` — `isCommsWorker()`, `isProductionDatabaseUrl()`, `describeWorkerState()`, `assertCommsWorkerAtBoot()`, `gateCustomerLoop()`, `skippedLoops()`, `resolveBuildVersion()`. Pure at import (no db/pushover), Pushover loaded lazily, never throws.
- `server/comms-worker-heartbeat.ts` — `maybeWriteHeartbeat()` (60 s throttle, worker only), `readHeartbeat()`, `getHeartbeatHealth()`, `checkHeartbeatStaleOnce()`, `startHeartbeatStaleCheck()`, plus pure helpers `assessHeartbeat`, `isUkAlertWindow`, `shouldAlertStale`, `parseHeartbeat`. db imported lazily.
- `server/worker-gate.test.ts` (13 tests), `server/comms-worker-heartbeat.test.ts` (11 tests).
- `docs/comms-build/PHASE0-OPS.md` — the ops checklist (Railway flag, Neon branch, strip local secrets, kill `tsx watch`, verify).

Modified
- `server/agents/comms-sweep.ts` — `sendV2Reply`, the `shouldUseV2`/`runV2Pipeline`/`V2PipelineOutcome` imports and both `if (shouldUseV2(...))` branches deleted; both paths call `runCommsAgent`. Slow sweep + boot catch-up and the fast tick are each wrapped in `gateCustomerLoop`. Heartbeat write added to the fast tick; stale check started with it. Unused static import of `queueDraft`/`approveAndSendDraft` removed (the dynamic imports inside morning-release / held-ack are untouched, second arguments unchanged).
- `server/cron.ts` — gated: comms SLA sweep, window-closing lane, backlog ageing lane, day-before customer reminders. Ungated (checked, no customer sends): quote-reminder log-only job, WhatsApp template poll, won auto-archive, SEO rank/GMB/GSC pulls, GMB posting.
- `server/index.ts` — `void assertCommsWorkerAtBoot()` before `setupCronJobs()`; `GET /api/health/comms-worker`; lead-automations scheduler gated (it sends to customers from five places: new-lead video request, quote-sent reminder, quote-viewed follow-up, awaiting-video reminder, lost-lead recovery). Payout cron and hourly invoice cron left ungated: the only customer send in that cron is `runDunningSequence`, which is already disabled and not called.
- `server/agent-staff.ts` — `workerHeartbeat` on the `/api/agents/staff` payload + a `WORKER ALIVE / STALE / NEVER SEEN` chip on the comms card.
- `server/pushover.ts` — `notifyWorkerHealth({ title, message })`.
- `shared/pushover-settings.ts` — new event key `worker_health` (group Dispatch, priority 1, siren). `normalize()` back-fills it into already-saved configs.

## What I verified and how

- `grep -rn 'shouldUseV2\|sendV2Reply\|runV2Pipeline' server/agents/` → nothing. `server/pipeline/v2.ts` and `server/workers/` untouched.
- `npm run check` (tsc): **exit 2 with 56 errors, identical to the baseline on `c7e8410` before any change** — all in `scripts/seed-diy-advice.ts` and `scripts/scrape-reddit-value-drivers.ts` (see "could not do"). Zero errors in any Phase 0 file.
- Isolated type-check of the Phase 0 files with a temp tsconfig extending the repo's (target ES2022, types node + vitest/globals): **0 errors in the nine Phase 0 files + both test files**; 117 errors in transitively imported pre-existing files (comms.ts, quotes.ts, invoices.ts, ...), none touched here.
- `npx vitest run` with `DATABASE_URL='postgres://u:p@127.0.0.1:1/x'` (the worktree has no `.env`; three suites import `server/db.ts`, which throws without the var but never connects in tests): **501 passed, 42 failed — the same 42 that fail at baseline**, all in `__tests__/eve-pricing-engine.test.ts` (37, `Cannot read properties of undefined (reading 'price')`), `call-script/__tests__/segment-classifier.test.ts` (4), `lib/contractor-pay.test.ts` (1). My 24 tests pass. Without the dummy `DATABASE_URL`, three additional suites fail at import; that is an env matter, not code.
- Gate behaviour covered by tests: production without flag → error + one page with the exact title; production with flag → silent; dev on `ep-broad-king` → one warn banner, no page; notify throwing → still resolves. `gateCustomerLoop` registers only with `COMMS_WORKER=1` and logs one skip line. Heartbeat: fresh/stale boundary at 600 s, missing → stale with null age, UK window 08–20 with BST/GMT conversion, one page per hour, passive process never writes or pages, worker with unreadable heartbeat pages once then throttles and stays quiet out of hours.
- NOT verified: a real boot, a real DB write of the heartbeat, a real Pushover delivery, `/api/health/comms-worker` over HTTP. The brief forbids running the dev server or touching the database from this pane; PHASE0-OPS.md §5 is the post-deploy verification.

## Could not do, and why

1. **`npm run check` does not pass — and cannot, in this repo, without out-of-scope work.** The two scripts above begin with `x**` instead of `/**` (committed in `cc574b9`). Because they are *syntax* errors, tsc stops before semantic checking, so the 56 errors are a mask. I repaired the two characters to see behind it: the project then reports **1,887 semantic errors** (scripts/archive, client pages, server files such as dispatch-optimizer, stripe-routes, shared/schema `$inferInsert`). The repo has no `target` in tsconfig, so tsc checks at ES5 while the real build is esbuild/Vite. I **reverted the two-character repair** so `npm run check` stays at its baseline output and this branch's diff is Phase 0 only. Recommend a separate ticket: decide the tsc target/scope for `npm run check`, then fix or exclude `scripts/archive`.
2. **vitest is not fully green** for the same reason: 42 pre-existing failures in pricing / classifier / contractor-pay tests, unrelated to comms. Not touched.
3. The worktree did not exist when I started. I attempted to create `comms-v3/worker` (blocked by an existing branch literally named `comms-v3`), then the orchestrator created `/Users/courtneebonnick/v6-wt-worker` on `p0-worker` a minute later. I deleted my stray `comms-v3-worker` branch. No other worktree or the main checkout was edited.
4. The `node_modules` symlink is shared with the main checkout, and `tsconfig.json` puts the incremental `tsBuildInfoFile` inside it. Three panes running tsc at once crashed mine with a V8 heap abort; reruns used `NODE_OPTIONS=--max-old-space-size=8192`. Worth moving `tsBuildInfoFile` out of node_modules.

## Decisions the brief did not specify

- **Lead automations are gated** (index.ts boot). The brief listed comms-sweep + cron.ts; the heading was "gate every loop that can reach a customer" and lead-automations sends to customers on a 5-minute timer from the same boot block, so leaving it open would have contradicted the design's "Railway is the only process that can send".
- **Not gated:** payout cron (Stripe transfers to contractors, no messaging), invoice cron (its only customer send is the disabled dunning sequence), pipeline-sweeper and dispatch-cron (alert-only, verified no send calls), quote-followup-alerts (Pushover to Ben only), WhatsApp template poll, won auto-archive, SEO.
- **New Pushover event `worker_health`** rather than reusing `send_failed`/`escalation`, so Ben can route infra alarms separately. Placed in the existing `Dispatch` group to avoid touching the group union / NotificationsPage.
- **Health route returns 503 when stale** (not just `stale: true`) so a Railway/uptime check can key on the status code. Payload includes `at, pid, host, version, thisProcess.role, skippedLoopsInThisProcess` on top of the brief's `{ ok, ageSeconds, stale }`.
- **A failed heartbeat READ counts as stale** for the worker's own check (cannot prove alive = not alive from Ben's side). A failed WRITE resets the throttle so the next 15 s tick retries instead of waiting a minute.
- **Stale check only pages when this process is the worker** (per brief); passive processes surface staleness via the health route and the staff chip only.
- **`version`** = `RAILWAY_GIT_COMMIT_SHA` / `SOURCE_COMMIT` / `GIT_SHA` / `COMMIT_SHA`, else `git rev-parse --short=12 HEAD`, else null; cached per process.
- The staff card chip reads the heartbeat on every `/api/agents/staff` call (one extra `app_settings` select). The route now also returns `workerHeartbeat` top-level with the same shape as the health route.
- Dev-on-production warning is a `console.warn` banner only (no page), as the brief asked; if `COMMS_WORKER=1` is *also* set on that dev process the banner says so explicitly, because that is the one combination that can still send from a laptop.
