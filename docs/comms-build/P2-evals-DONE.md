# Phase 2 / C — eval harness + clerk & recovery on the spine — DONE

Worktree `/Users/courtneebonnick/v6-wt-config`, branch `p2-evals`, started from `b48178e` (comms-v3).

## Migrations

None. Nothing in this pane needed a table: verdicts (Phase 1) and `agent_runs` (Phase 1 / A) carry
everything. The spine kill switch is the `app_settings` row `spine` (read only; never written here).

## Contract (server/spine/types.ts) — extended by ADDING only

- `Intent` gained `'propose_intake' | 'propose_nudges'` (PROPOSE-tier artifacts).
- `Proposal` gained optional `artifact?: ProposalArtifact | null`; new `ArtifactKind`, `ProposalArtifact`.
- `SpineAgent` gained optional `accepts?(input): boolean` (trigger predicate).
Nothing existing was renamed, removed or retyped. A `Record<Intent, …>` that is not `Partial` in
another pane would now need the two new keys; in the file today `tierByIntent` and `templates` are
both `Partial`, so nothing breaks.

## Files

**Harness + evals (no database, no network)**
- `scripts/eval-comms.ts` — the Phase 2 harness (adapters `replay` / `legacy` / `spine`, `--family`,
  `--only`, `--trials` (default 3), `--adapter`, `--quick`; `EVAL_LIVE=1` is the only way it may
  touch a network). Points `DATABASE_URL` at `127.0.0.1:1` when unset so a transitive `db.ts`
  import cannot open a pool.
- `scripts/eval-comms-db.ts` — the previous DB-fixture harness, renamed (results now under
  `eval-results/db/`). Its two case files (`eval-cases/real-failures.json`,
  `eval-cases/quote-prep-readiness.json`) stay where they were; the new loader reads only
  `eval-cases/<family>/*.json` and skips `seed/`.
- `scripts/eval-seed-guards.ts` — generates `eval-cases/guards/*.json` from the seed corpus and
  writes `eval-cases/guards/INCIDENT_REVIEW.md`.
- `server/evals/case-schema.ts` (types, loader, validator), `guard-chain.ts` (runs EVERY detector in
  `draft-guards.ts`, keeps production's first-violation verdict, maps codes → spine `GuardName`,
  mirrors comms.ts `ESCALATE_CODES`), `triage-lexicon.ts` (§3.3 deterministic pre-checks over the
  customer's words), `graders.ts`, `scoreboard.ts`, `case-file-from-context.ts`.
- Tests: `server/evals/{graders,scoreboard,triage-lexicon,guard-chain}.test.ts`,
  `server/spine/agents/line-category.test.ts` — 25 cases.
- `eval-cases/{guards,first_contact,money_question,date_question,complaint,incident_regressions,absence}/`
  — 200 cases (165 generated + 35 hand-written).
- `eval-results/` is **gitignored** by the project (`.gitignore` line 65), so `latest.json`,
  `latest.md` and the timestamped runs are NOT committed even though COMMS_EVALS_PLAN §4 says
  "files + git diff are the comparison tool". I respected the ignore rather than force-adding;
  un-ignore it in a follow-up if the plan's intent wins. The scoreboard reproduces in ~5s with
  `npx tsx scripts/eval-comms.ts`.

**Spine (ships dark)**
- `server/spine/config.ts` — `getSpineConfig()` fail-closed `{ enabled: false }`,
  `isSpineEnabled()`, `isSpineAgentEnabled()`, `useProcessLocalSpineConfig()` for suites.
- `server/spine/agents/quote-clerk.ts`, `recovery.ts`, `index.ts` (registry), `line-category.ts`.
- `server/spine/run-record.ts` — spine-level `agent_runs` rows via `server/agent-runs.ts`.
- `server/spine/bridge.ts` — `requestRunOrNull()`; see Not done.
- `server/agents/ops-manager.ts` — `run_comms_agent` → spine `requestRun` when enabled, else legacy.

## Verification

- **tsc** (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`, ~8–20 min
  depending on the other panes' tsc runs): baseline 1882 errors on `b48178e`, 1882 after. Per-file ×
  error-code counts differ only by the rename (`scripts/eval-comms.ts` → `eval-comms-db.ts` carries
  its three pre-existing errors). My first pass introduced five (four ES5 Map/Set iterations, one
  `webform` → `TimelineItem.channel` mismatch); all fixed, re-run confirmed.
- **vitest** (`DATABASE_URL=postgres://u:p@127.0.0.1:1/x npx vitest run`): baseline 42 failed /
  608 passed / 8 skipped (29 files); after 42 failed / 633 passed / 8 skipped (34 files). The
  failing-file set is identical (diffed sorted summaries). Unit tests for graders, scoreboard
  deltas, lexicon, guard chain and line categories: 25/25.
- **esbuild** (`npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external`)
  succeeds, 3.6 MB, no errors. The variable-specifier dynamic import in `bridge.ts` bundles as-is.
- **Harness**: `npx tsx scripts/eval-comms.ts --adapter all` → exit 0. 200 cases × 3 trials on
  `replay`: 196 green, 4 red (all `kind: capability`, the labelled incident misses); `legacy` and
  `spine` skipped with reasons. Re-running produced the delta column against the previous run.
  A deliberately wrong candidate (a "no worries, let us know if you change your mind" reply that I
  first wrote for the capitulation case) showed red before I corrected the case — the harness
  catches what it should.
- Rules kept: no dev server, no DB, no `app_settings` writes, no push, tsc never twice at once.

## §9: guard chain false-negative rate on the incident set (23 sends, 31 Aug–2 Sep)

| | |
|---|---|
| Labelled should-have-held | 11 |
| Caught by a text guard | 1 (`duration_claim`) |
| Caught only by the triage lexicon (customer asked price / date / callback) | 6 |
| Missed by both | 4 |
| **Text-guard false-negative rate** | **90.9%** |
| **With §3.3 lexicon pre-checks** | **36.4%** |
| Labelled `unguarded_but_fine` | 12 |

The four misses (`eval-cases/guards/INCIDENT_REVIEW.md`): a "PM time for Craig's visit" promise
the date detector does not read as a date; two replies that start scheduling in chat instead of
pointing to the picker; a commitment to fit a customer-supplied sash-window kit. All four are
kind `capability` so the scoreboard shows them red without failing the build. Owner to confirm
the labels — they are my first pass.

## Not done, and why

- **Adapters `legacy` and `spine` never run a model here.** `runCommsAgent` has no propose/dry-run
  mode (only the sweeps take `dryRun`), and seeding DB fixtures is the other harness's job. The
  spine adapter probes `server/spine/run-once`, `runner`, `index` for `runOnce` and needs a
  registered `scoper`; neither exists on this branch. Both skip with a printed reason. So today's
  numbers are the **replay** adapter: real detectors and lexicon over recorded/written replies.
- **`server/spine/bridge.ts` uses a variable-specifier dynamic import** of `./request-run` because
  pane A's file is not here. Post-merge, replace with a static import (TODO in the file). Until
  then, in the esbuild bundle that dynamic import resolves relative to `dist/`, i.e. it fails and
  the Ops Manager falls back to legacy — which is also the behaviour while `spine.enabled` is false.
- **Registry collision risk**: `server/spine/agents/index.ts` was created here ("create if pane B
  has not"). If pane B also created it, merge by keeping one file and both `registerSpineAgent`
  calls.
- **`accepts` for the clerk on `call_ended`** reads transcripts from `caseFile.timeline` — the case
  file assembler is pane A's; my check is the contract's `TimelineItem.transcript`.
- **Alicia survey-required** (`ir-004`) has no detector; it is a capability case that stays red
  until one exists.
- **No LLM judge** (COMMS_EVALS_PLAN Phase 3) — deterministic graders only, as briefed.

## Decisions the design left open

1. **Replay adapter.** The brief named `legacy` and `spine`; both are unavailable without a DB or
   pane A. Grading the recorded send through the real detectors is what makes the 165-send corpus
   and the §9 number possible today, so `replay` is a third adapter and the default headline.
2. **Guards family = detector snapshot.** Each real send is pinned to the detector codes it trips
   today (`guardsMustTrip` / `guardsMustNotTrip`). A loosened detector turns clean sends red; a
   broken one turns tripped sends red. That is the regression signal the plan asked for.
3. **"Must flag" counts the lexicon.** `mustFlag` passes on a flag, an escalating text guard, OR a
   lexicon exception in the customer's last message — because §3.3 says exceptions lane to Ben
   before any agent runs. The two rates are reported separately so nobody mistakes the lexicon
   for the guard chain.
4. **Escalating set** mirrors `ESCALATE_CODES` (money, discount, date, liability, duration,
   policy). Voice breaches and unseen implications are rewrites, not Ben items.
5. **Capability vs regression exit code.** `kind: capability` cases (the four misses, Alicia) print
   as MISS and never fail the run; only regression red exits 1. Otherwise "green on the seed
   families" and "report the misses honestly" contradict each other.
6. **`category` is deterministic** (keyword rules over `JobCategoryValues`), not a model field. It
   is a label evals can pin; the clerk's prompt is unchanged.
7. **Spine run rows**: the wrapper mints a child run id for the wrapped legacy agent and records
   its own row under the spine name (`quote_clerk` / `recovery`) with `childRunId` in the
   proposal, so the runner's own row is not overwritten.
8. **Recovery accepts only `cadence` / `manual`** — it is a sweep over quotes, not a per-thread
   agent, so it never fires on inbound messages.
9. **Lexicon width.** Every pattern has a matching must-NOT-trip case in `absence/`; the eight
   ordinary replies and ten ordinary customer lines in the unit test are the balance set.
