# PHASE 3 / B — the sampler and the switch — DONE

Worktree `/Users/courtneebonnick/v6-wt-worker`, branch `p3-sampler`, based on `6d20718` (comms-v3 with Phases 0–2).
Not pushed, not merged. No dev server, no DB access, `app_settings` untouched. Everything ships dark.

## Migrations to apply (exact filenames)

- `migrations/20260903_agent_runs_shadow_decision.sql` — idempotent: `agent_runs.shadow_decision text`, index `(decision, finished_at)`, partial index on `finished_at WHERE shadow_decision IS NOT NULL`. Matching Drizzle change in `shared/schema.ts` (`agentRuns.shadowDecision`). Apply before flipping to shadow; the sampler and report only read.

## The switches (all default off, fail closed)

`app_settings.spine` gained three additive fields, merged over defaults by `server/spine/config.ts`:
- `mode: 'off' | 'shadow' | 'live'` — explicit; when absent the mode is derived from `enabled` + `shadow` (`server/spine/switch.ts`). `enabled:false` is always off, even with `mode:'live'` written.
- `autonomy: { enabled: false }` — reserved for the promotion/demotion job (pane A); read nowhere yet, so a flip changes nothing until that job lands.
- `sampler: { enabled: false, rate: 0.1, min: 1, max: 15 }` — the 08:30 sampler.
Flip: `npx tsx scripts/_spine-mode.ts --off|--shadow|--live [--by name]` (`--status` to read; `--live` on production needs `--yes`). Writes through `setSpineMode` → `setSpineConfig`, which upserts the row and logs a `config_change` system event. There is no `setSetting` in `server/settings.ts`; `setSpineConfig` is the existing writer for this row.

## Files

New
- `server/spine/switch.ts` — `spineModeFrom(cfg)` (pure), `spineMode()`, `setSpineMode()`, `parseSpineMode()`, `isSpineLive()`.
- `server/spine/shadow.ts` — `runShadow(conversationId, trigger)`: `runOnce(..., { shadow: true })`, exit forced off, never throws, never blocks legacy.
- `server/spine/agents/verifier.ts` — READ-tier `SpineAgent` (`run` → null) + `judgeSend()`: the `move-quality-v1` rubric (moveRight / voiceRight / unsafe / reason / code) on Opus 5 via `claudeJsonWithUsage`, zod-validated, injectable llm. `verdictFrom()` maps to `sample_fine` / `sample_not_fine` + a `VERDICT_REASONS` code (unsafe outranks everything).
- `server/spine/sampler.ts` — `selectSamples()` (pure: random 10% of unflagged, clamped [min,max], plus every flagged send), `yesterdayBoundsUk`, `sampleDueAt` (next office day 08:00), `runSampler()` (worker-gated + `spine.sampler.enabled`): yesterday's `agent_runs` with `decision='send'` whose `proposal.decision.approver` starts `agent.`, joined to the sent draft; signals: opt-out after the send (`comms_opt_outs`), complaint keyword in a later inbound (`RE_COMPLAINT` from triage), no reply within 48h of a send containing `?`. Per pick: judge → `draft_verdicts` row by `agent.verifier` (via `recordVerdict`), and an `agent_questions` row (`source:'sampler'`, options `['fine','not fine']`, `due_at` next office day, id `aq_sample_<draftId>` so reruns insert nothing twice; already-judged drafts skipped).
- `server/spine/shadow-report.ts` — `compareShadow()` (pure): pairs each shadow run with the nearest legacy run on the same thread within 15 min, scores decision / intent (legacy `[intent]` mapped to spine vocabulary by `LEGACY_INTENT_MAP`) / guard-hit agreement, decision matrix; `shadowReportMarkdown()`; loaders (`loadShadowRuns` from `shadow_decision`, `loadLegacyRuns` derived from the legacy run's drafts and flags).
- `scripts/_shadow-report.ts --days N [--out file]`, `scripts/_spine-mode.ts`.
- `client/src/components/comms/SampleReviewStrip.tsx` — "Yesterday's automatic sends to check", one tap fine / not fine (reason chips reuse `VerdictReasonChips`), via `GET /api/agent-questions?status=open&source=sampler` and `POST /api/agent-questions/:id/answer`. Renders nothing when the queue is empty.
- Tests: `server/spine/switch.test.ts` (7), `server/spine/sampler.test.ts` (9), `server/spine/shadow-report.test.ts` (5), `server/spine/agents/verifier.test.ts` (5).

Modified
- `server/spine/config.ts` — the three fields + defaults + merge. `server/spine/index.ts` — `RunOnceOpts.shadow` (implies dryRun; stamps `shadowDecision`; `proposal.shadow` in the jsonb). `server/agent-runs.ts` — `FinishAgentRunInput.shadowDecision` (additive). `server/llm.ts` — `VERIFIER_MODEL = 'claude-opus-5'`. `server/spine/agents/index.ts` — verifier registered.
- Three-way wiring: `server/agents/comms-lanes.ts` (live → spine `requestRun`; shadow/off → legacy arm), `server/agents/comms-sweep.ts` (`tickDueTriage`: live → `runDue`, shadow → `runShadow` then legacy, off → legacy; `sweepOnce`: live → spine `requestRun(…,'cadence')` and legacy never called, shadow → `runShadow` then legacy), `server/cron.ts` (the three legacy comms lanes return early in live; new 08:30 sampler cron, worker-gated), `server/agents/ops-manager.ts` (`run_comms_agent` reports the mode; the shared row already works both ways).
- `server/agent-questions.ts` — `?source=` filter on the list; on answer, a `source:'sampler'` row writes Ben's `draft_verdicts` row by `human:<id>` (`sample_fine` only for a clear "fine"; reason chip from the body, else `fine`/null). The judge's row stays.
- `client/src/pages/admin/CommsPage.tsx` — strip mounted above the lane switch (customer lane only); tapping an item opens the thread.

## Verification

- **tsc**: baseline (`6d20718`, throwaway worktree, private tsbuildinfo) 1,883 errors → after **1,883, zero new** (the one changed line is a pre-existing comms.ts error whose union members print in a different order). One import error I introduced (`commsPhoneKey` lives in `phone-utils.ts`, not `opt-out.ts`) was caught by esbuild and fixed before this run.
- **vitest**: baseline 42 failed / 687 passed / 8 skipped (38 files) → after **42 failed / 713 passed / 8 skipped (42 files)**; same 42 (eve-pricing-engine 37, segment-classifier 4, contractor-pay 1). 26 new tests green.
- **esbuild**: `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external` succeeds.
- NOT verified: a real Opus call, a real sampler run against data, the strip in a browser, a real flip. All forbidden from this pane.

## Not done, and why

- **Promotion/demotion job** is not in this brief (pane A); `autonomy.enabled` is reserved and read nowhere.
- **Judge agreement stat** is pane A's; both rows are stored (`by = 'agent.verifier'` and `by = 'human:<id>'` on the same `draft_id`). Note `verdict-stats.ts` counts `sample_*` rows separately from human decisions already, so the judge's rows cannot inflate the promotion gate.
- **Shadow pairing is heuristic** (same thread, nearest legacy run within 15 min). Legacy runs carry no decision column; "what legacy did" is derived from the drafts/flags stamped with the run id, and legacy intents are mapped approximately (`LEGACY_INTENT_MAP`); the raw pair is printed beside the mapped one.
- The sampler's `agent_questions.conversationId` is `''` when a run had no conversation (column is NOT NULL); the strip handles it.

## Decisions the design left open

- `draft_verdicts.by` is documented "always a person"; the brief asks for the judge's row by `agent.verifier`, so that is written as-is. Stats already exclude `sample_*` from human counts.
- Shadow mode keeps the legacy debounce as the driver (lanes arm legacy; the legacy tick runs the shadow pass inline before `runCommsAgent`), so one claim, one run pair per thread, and legacy timing is unchanged. `isSpineEnabled()` semantics are untouched for pane A's `runDue` guard; in shadow `runDue` is simply never the caller.
- In live mode the slow-sweep backstop asks the spine for a `cadence` run rather than running anything itself.
- Ben's "not fine" without a chip records reason `null` (not `fine`); "fine" records `fine`.
- Sample review due time = next office day 08:00 (never same day); the sampler runs 08:30 so the row is due the following morning.
- Selection clamps the random draw to what is available and adds every flagged send on top (so a bad day can exceed 15).
