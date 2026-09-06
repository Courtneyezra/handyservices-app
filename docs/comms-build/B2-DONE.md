# B2 — DONE: Scoper runs record real `cost_pence`

PRD v3 build row 2. Brief: `BRIEF-B2-scoper-cost.md`. Start commit `1fd113c3` (PRD v3).
Branch `fm/scoper-cost-r2`. Built in a disposable worktree with **no `.env` and no database**:
everything below is unit tests and the build gate. Nothing here is a claim about the live ledger.

## What was wrong

The Scoper (and the contractor liaison) run their belt through `runAgent` in
`server/agents/runner.ts` **under the spine's own run id** with `persist: true`. The runner's
`finishAgentRun` writes the real `usage`, `model`, `turns` and `cost_pence` onto that row. Then
`runOnceInner` in `server/spine/index.ts` closes the same row with a patch that has no usage, and
`finishAgentRun` wrote `usage: patch.usage ?? null, costPence` unconditionally, so the last write
put `usage` null and `cost_pence` null back. Every Scoper row read as 0 spend.

## What shipped

| File | Change |
|---|---|
| `server/spine/types.ts` | `AgentLoopUsage { usage, model, turns }`; `SpineAgent.run` input gains an optional `reportUsage` callback. Additive; every existing agent and test stub still type-checks. |
| `server/spine/agents/scoper.ts` | After the runner returns, `reportUsage?.({ usage, model, turns })` from the `AgentRunResult`. |
| `server/spine/agents/contractor-liaison.ts` | Same one line. The two agents that run through `runAgent` both use the one seam; no Scoper-only fork. |
| `server/spine/index.ts` | `runOnceInner` captures the report and passes `usage`, `model`, `turns` to its `finishAgentRun`, so the row's `cost_pence` is `computeCostPence(usage, model)`. When nothing was reported the keys are left out of the patch. |
| `server/agent-runs.ts` | `finishAgentRun` writes `usage` / `cost_pence` only when the patch carries a `usage` key (`null` still clears; `undefined` leaves the columns alone). This is what keeps the runner's already-persisted usage on a run whose belt threw, or on any second close of a shared run id. |
| `server/spine/run-cost.test.ts` | New, 6 tests at the `runOnce` seam (db, model, exit, Route A mocked). |
| `server/agent-runs.test.ts` | New, 4 tests on the usage-column write rule (db mocked). |

Price table: `MODEL_PRICES_USD_PER_MTOK` already prices `SCOPER_MODEL` (`claude-sonnet-5` via the
`/sonnet/i` row), `FAST_MODEL` (haiku) and `VERIFIER_MODEL` (opus). **No row added**, so
`agent-cost.test.ts` is unchanged; `run-cost.test.ts` pins that the configured Scoper model is
priced and that a Sonnet-sized belt costs more than 0p.

## What the number means (ledger readers)

`cost_pence` on a spine run row is **the agent loop's own usage only**: the Scoper's or liaison's
turns through `runAgent`. Child rows keep their own cost and are not rolled up: the triage model
call (`parent_run_id`, P6), vision, the quote clerk's quote-prep child, recovery's sweep child.
The quote clerk and recovery therefore still show no usage on their parent row; their spend is on
the child row they cite. Total spend for a pass = the parent row plus its children, as before.

Two writers still close the Scoper's row (the runner, then the spine), and each appends its own
`run_finished` ledger event. That was true before this change and is unchanged; the second event
carries the same pence now instead of null. Collapsing the two closes is not in this brief.

## Tests

```
✓ server/spine/run-cost.test.ts (6)
  the configured Scoper model is in the price table
  an agent that reports usage: finishAgentRun receives usage, model and turns, and the cost is > 0
  the real Scoper reports the runner's usage through the same seam
  an agent that throws: the run still finishes with the error, and the close carries no usage key
  an agent whose usage is reported before it throws still hands it to the close
  an agent that reports nothing (its model calls are child rows) leaves the keys out
✓ server/agent-runs.test.ts (4)
  no usage key: finished_at, error and duration are written; usage and cost_pence are left alone
  a usage: writes it with the pence computed for the model
  usage null still clears both columns
  an unpriced model records the usage and a null cost, never a zero that hides the spend
```

Both files run green with no `.env` at all (they mock `server/db.ts`).

## Build gate, as measured

Measured by committing the change to a WIP commit, checking out `1fd113c3` for the before side,
then checking the branch out again for the after side. Fresh `npm ci` in the worktree.

| Check | Before (`1fd113c3`) | After | Verdict |
|---|---|---|---|
| `npx tsc --noEmit -p .` errors | 1,880 | 1,880 | **0 new.** The (file, TS code) multiset is identical. 11 lines differ textually in unrelated files (`lead-stage-engine.ts`, `leads.ts`, `inbox-board.ts`, `first-contact-ack.ts`, `call-thread.ts`, `contextual-pricing/routes.ts`) only because tsc prints union members in a different order once two test files join the program; none names a file this change touches. |
| `npx vitest run` (as `package.json` `test`, no `.env`) | 85 named failures, 26 files | 85, same names | **Unchanged.** Most are the spine suites failing at import on `DATABASE_URL must be set`, which is the worktree, not the code. |
| `npx vitest run` with a placeholder `DATABASE_URL` (`postgres://placeholder@localhost`, never connected; the pool is lazy) | 43 named failures, 4 files | 43 + 1 | **Unchanged** plus the 10 new tests green. The +1 is `call-script/__tests__/state-machine.test.ts › should get time in current station`, a wall-clock `setTimeout(10) ≥ 10ms` assertion; it passes 3/3 re-run in isolation. |
| esbuild `server/index.ts --platform=node --packages=external --bundle --format=esm` (the `build` script's server half) | — | bundles, 4.2 MB | **OK** |

Note for the next pane: `tsc` on this repo needs `NODE_OPTIONS=--max-old-space-size=8192`; at the
default 2 GB heap it dies with "Ineffective mark-compacts" and reports 0 errors.

## Not done

- **No live before/after.** This worktree has no `.env` and no database, so nothing was read from
  the real `agent_runs` table. Whether the 608 rows from D7's thread now show pence is for whoever
  runs the branch against the ledger; the unit tests are the only evidence here.
- **Not backfilled.** Existing Scoper rows keep `cost_pence` 0 / null. Their usage may still be on
  the row from the runner's write if the spine's later close ran after a failed runner close; a
  backfill from `usage` × price is a one-off script, not attempted without a database.
- **Two closes, two ledger events** per Scoper run (runner + spine) remain. A follow-up could pass
  `persist: false` from the spine to the runner now that the spine records the usage itself, but
  that changes who owns `transcript_ref` and `prompt_hash` on the row, so it is left for a brief.
- **`AGENTS.md` not created.** `fm-ensure-agents-md.sh` would promote the project's `CLAUDE.md`
  into `AGENTS.md` and replace it with a pointer; with three parallel PRs on this codebase that is
  a merge conflict waiting to happen, so it was skipped. The two durable facts from this pane are
  above (tsc heap flag; placeholder `DATABASE_URL` for the suites).
- Out of scope, untouched: the cadence loop (D7), `first-contact-ack.ts`, money guards, prompts,
  quote prices, dashboards.
