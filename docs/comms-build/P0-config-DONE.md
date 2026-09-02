# Phase 0 / C — process-local config + architecture tests — DONE

Worktree: `/Users/courtneebonnick/v6-wt-config`, branch `p0-config` (the brief originally said
`comms-v3/config`; a branch named `comms-v3` already exists so that ref name is impossible, and the
orchestrator had pre-created `p0-config`, which is what was used). Three commits on top of `c7e8410`:

| Commit | What |
|---|---|
| `4520028` | feat(comms): process-local config store so suites never touch the live row |
| `a43a4e5` | test(arch): Phase 0 architecture tests + production-DB guard for vitest |
| `7af7fe0` | fix(scripts): repair corrupted doc-comment openers that broke tsc |

## Files changed

- `server/agents/comms.ts` — `mergeOverDefaults()` helper; `localConfig` store; exported
  `useProcessLocalCommsConfig(seed?)`; `getCommsAgentConfig` returns the local store first, then the
  `COMMS_CONFIG_OVERRIDE` env seam, then the DB row; `setCommsAgentConfig` writes to the local store
  when armed, writes back to `COMMS_CONFIG_OVERRIDE` when that env seam is active, and only otherwise
  touches `app_settings`.
- `scripts/archive/_comms-lane-test.ts`, `scripts/archive/_voice-scenarios.ts` — call
  `useProcessLocalCommsConfig()` before any config read/write.
- `server/__tests__/architecture.test.ts` — new, see below.
- `server/__tests__/setup.ts` — new prod-DB guard; registered in `vitest.config.ts` (`setupFiles`).
- `scripts/seed-diy-advice.ts`, `scripts/scrape-reddit-value-drivers.ts` — first line `x**` → `/**`.

## What was verified and how

**Process-local config.** Ported from the *uncommitted* working tree of
`.claude/worktrees/angry-merkle-e4798d` (the committed branch `claude/dreamy-lamarr-4da59b` does not
contain it). Only the store, `useProcessLocalCommsConfig`, and the get/set branches were taken; the
`vaCallTask` field that main has since added is merged the same way as the other nested sections.
Nothing else from that branch was brought over. Verified by tsc and by reading the resulting
functions; no runtime suite was executed (rule 2: no DB).

**Which suites got the call.** `grep -l setCommsAgentConfig scripts` finds three files, all under
`scripts/archive/`: `_comms-lane-test.ts` and `_voice-scenarios.ts` (suites — patched) and
`_comms-agent-config.ts` (the operator CLI whose purpose *is* flipping the live row — left alone, see
Decisions). No top-level `scripts/_*.ts` calls `setCommsAgentConfig`; the 11 live suites that flip
config do it through `process.env.COMMS_CONFIG_OVERRIDE`, which is why that seam was also closed for
writes (see Decisions). Note the two patched suites are in `scripts/archive/`, whose files all still
import `../server` from their pre-move location and so cannot run as-is; the patch makes them safe
if anyone restores them, but the protection that matters today is the env-seam write fix.

**Architecture tests.** `npx vitest run server/__tests__/architecture.test.ts`:
- default: 11 passed, 8 skipped (the `[PHASE0_MERGED]` blocks).
- `PHASE0_MERGED=1` forced: 6 fail, each for the expected pre-merge reason —
  `shouldUseV2`/`sendV2Reply` still in `server/agents/comms-sweep.ts`; raw Twilio send still in
  `server/conversation-engine.ts`; no `worker-gate` import in `comms-sweep.ts` or `cron.ts`;
  `AUTOMATED_APPROVER` still in `server/message-drafts.ts`. So the gated tests are not vacuous.
- Live today: (b) no file outside the allowed list imports `approveAndSendDraft`, and every code
  reference to it outside `message-drafts.ts` is a recognised import (no namespace smuggling); (c)
  `sendWhatsAppMessage` / `sendViaMetaCloudApi` / `sendSmsMessage` are each defined in exactly one
  module and invoked only from `outbound.ts`, `whatsapp-api.ts`, `sms.ts` (or their own module);
  the Meta Graph `/messages` POST exists only in `meta-whatsapp.ts`. The scanner strips comments but
  keeps string contents (URLs), with a self-test.

**Prod-DB guard.** `DATABASE_URL='postgres://u:p@ep-broad-king-…' npx vitest run …` → the file fails
in setup with `[vitest setup] DATABASE_URL points at the production database (ep-broad-king)…`.
With `ALLOW_PROD_DB_TESTS=1` it passes. The setup file loads `dotenv/config` first, because
`server/db.ts` calls `dotenv.config()` at import time — without that the guard would read an empty
env while the test under it read `.env`. The main checkout's `.env` does contain `ep-broad-king`
(checked by count only), so on main this guard is not theoretical: three existing test files
(`ops-manager-guards`, `per-line-guardrails`, `sparse-day-fees`) import `db.ts` at module level and
would have opened a pool on production.

**`npm run check`.** Not green, and cannot be made green in this scope. On the untouched branch tsc
reported 56 errors, all *syntax* errors from the two `x**` files, and stopped there (tsc skips the
semantic pass when parsing fails). With those repaired, tsc runs to completion (7m50s, needs
`NODE_OPTIONS=--max-old-space-size=8192`; the default heap crashes) and reports **1887 pre-existing
semantic errors**: 1538 in `scripts/` (727 are `TS2307` unresolved modules — 321 of the 393 files in
`scripts/archive/` still import `../server` from their old location, so the whole archive is dead
by path), 212 in `server/`, 126 in `client/`, 7 in `shared/`. `tsconfig.json` sets no `target`, so
`Set` iteration and class-field errors (`TS2802`, `TS1378`) fire everywhere. None of the errors are on
lines this branch added: `server/agents/comms.ts` errors are at lines 529–1748 (pre-existing `Set`
iteration, `bullets`, `IntakeReadiness`), my edits are at 165–265; `setup.ts` and
`vitest.config.ts` have none; the two archive suites' errors are the unresolved `../server` paths
that predate this branch. The full log is in the session scratchpad (`check3.log`).

**`npx vitest run` (full).** Baseline on untouched `c7e8410`: 7 files failed, 45 tests failed / 453
passed. After this branch: 6 files failed, 42 failed / 467 passed / 8 skipped. Every remaining
failure is pre-existing and unrelated to comms:

| File | Failures | Cause |
|---|---|---|
| `server/__tests__/eve-pricing-engine.test.ts` | 38 | `Cannot read properties of undefined (reading 'price')` + pricing assertions; pricing-engine drift |
| `server/call-script/__tests__/segment-classifier.test.ts` | 4 | classifier expectations |
| `server/lib/contractor-pay.test.ts` | 1 | assertion |
| `server/agents/ops-manager-guards.test.ts`, `server/contextual-pricing/per-line-guardrails.test.ts`, `server/sparse-day-fees.test.ts` | 3 files | import `server/db.ts`, which throws without `DATABASE_URL` (worktree has no `.env`; on main they would hit prod and now trip the guard) |
| `server/call-script/__tests__/performance.test.ts` | 0–4 | timing thresholds (<1ms/<5ms); failed in the baseline run, passed in the second — flaky |

## What I could not do and why

- **Make the full `npx vitest run` green.** The failures above are business-logic tests (pricing
  engine, classifier, contractor pay) and DB-dependent tests that were already red on the branch I
  started from. Changing their expectations is a product decision, and mocking a DB for them is a
  separate piece of work; neither is Phase 0 scope. I did not touch them. My additions pass, and the
  set of failing files is a strict subset of the baseline (one fewer: the flaky performance file).
- **Run any suite that exercises the ported config against a live process** — rule 2 forbids the DB.
- **Test (d) live** — `server/worker-gate.ts` does not exist on this branch (worker pane).

## Decisions the design did not specify

1. **`COMMS_CONFIG_OVERRIDE` writes.** Main already had a read-only env seam
   (`COMMS_CONFIG_OVERRIDE`) that 11 live suites use, and several reassign it mid-run (off → on). A
   suite under that seam that called `setCommsAgentConfig` (force-off / restore) merged its override
   into `next` and wrote it to the **live row**. `setCommsAgentConfig` now writes `next` back into
   `process.env.COMMS_CONFIG_OVERRIDE` instead when that env var is set. The explicit local store
   still takes precedence over the env seam. I kept the env seam rather than replacing it because
   those suites depend on re-reading the env var on every call.
2. **`scripts/archive/_comms-agent-config.ts` not patched.** It is the operator CLI for changing
   the live row on purpose (`--enable`, `--no-autosend`, …). Arming process-local config there would
   make it a no-op.
3. **Allowed list for (b).** The brief's 8-file list matches a plain grep, but four of those files
   (`promise-tracker.ts`, `outbound.ts`, `auto-ack-window.ts`, `agent-staff.ts`) mention
   `approveAndSendDraft` only in comments. The live test uses the brief's list as a ceiling (subset);
   the `[PHASE0_MERGED]` exact-set test compares against the four real importers
   (`comms.ts`, `comms-sweep.ts`, `sla-sweep.ts`, `first-contact-ack.ts`). Orchestrator: shrink that
   list if the exit branch migrates any of them.
4. **(c) split into two layers.** Wrapper calls (live now) and raw Twilio/Meta primitives
   (`[PHASE0_MERGED]`, because `server/conversation-engine.ts` calls `twilioClient.messages.create`
   today, reached from `server/email-service.ts` via `conversationEngine.sendMessage`). **This is an
   open send door not on the brief's list**; the exit pane should be told. Anthropic's SDK also uses
   `.messages.create(`, so the Twilio detector requires an import of `twilio` / `twilio-client` or the
   REST `Messages.json` URL.
5. **Comment-stripped scans.** All identifier checks run on comment-stripped source, so a comment
   saying "sendV2Reply was removed" will not fail (a) or (e).
6. **Corrupted script headers fixed.** Out of the brief's scope, but `npm run check` cannot pass
   otherwise, and the two `x**` lines also made tsc skip semantic checking for the entire project.
7. **Awaited `logSystemEvent`.** The angry-merkle diff also changes `void logSystemEvent(...)` to
   `await` in `setCommsAgentConfig`. The brief said port *only* the process-local mechanism, so this
   was not taken; it is a one-line follow-up worth doing.
