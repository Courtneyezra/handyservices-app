# B2 — record real `cost_pence` on Scoper runs

PRD v3 build row 2 (§5.5, §11 invariant 6). Sibling of BACKLOG D7 (the cadence loop itself),
which is not this brief. Start commit `1fd113c3` (PRD v3). Branch `fm/scoper-cost-r2`.

## The defect that paid for this brief

The live ledger of 6 Sep shows 608 Scoper runs in seven days, 561 on one thread, every row with
`cost_pence` 0. The spend on Sonnet is invisible, so nobody can see a loop by its cost.

Where the cost is lost, verified against the code at the start commit:

1. `server/spine/index.ts` `runOnceInner` opens the `agent_runs` row with `startAgentRun({ id: runId, ... })`
   and closes it with `finishAgentRun(runId, ..., { error, durationMs, decision, lane, proposal,
   guardsHit })`. No `usage`, no `model`, no `turns`.
2. `server/agent-runs.ts` `finishAgentRun` computes `costPence = patch.usage ? computeCostPence(...) : null`
   and writes `usage: patch.usage ?? null, costPence` unconditionally.
3. `server/spine/agents/scoper.ts` (and `contractor-liaison.ts`) run their belt through `runAgent`
   in `server/agents/runner.ts` **with the spine's own `runId` and `persist: true`**. The runner's
   `startAgentRun` on that id is a no-op (`onConflictDoNothing`); its `finishAgentRun` writes the
   real `usage`, `model`, `turns` and a computed `cost_pence` onto the row. Then the spine's own
   `finishAgentRun` in (1) runs after it and, by (2), **overwrites `usage` and `cost_pence` with
   null**. The runner's `AgentRunResult` also carries `usage`/`model`/`turns` back to the Scoper,
   which returns only a `Proposal`, so the spine never sees them.
4. The triage model call and vision already record their own child rows (`parent_run_id`) with
   usage through `claudeJsonWithUsage`. Untouched.

## What to build

1. **A seam every spine agent can use.** `SpineAgent.run` gains an optional `reportUsage`
   callback on its input (`{ usage, model, turns }`, `AgentLoopUsage` in `types.ts`). The Scoper
   and the contractor liaison call it with the runner's result. `runOnceInner` captures it and
   passes `usage`, `model`, `turns` to its `finishAgentRun`, so the parent row's `cost_pence` is
   `computeCostPence(usage, model)`. No Scoper-only fork; the quote clerk and recovery, whose
   model calls live on child rows, simply do not report.
2. **Stop the close from wiping what the runner already wrote.** `finishAgentRun` only writes
   `usage`/`cost_pence` when the patch carries a `usage` key (`null` still clears; `undefined`
   leaves the row alone). This is what keeps accumulated usage on a run whose belt threw: the
   runner's `finally` has already persisted it before the spine closes the row.
3. **Price table.** `MODEL_PRICES_USD_PER_MTOK` already matches `SCOPER_MODEL` (`claude-sonnet-5`
   via `/sonnet/i`), `FAST_MODEL` (haiku) and `VERIFIER_MODEL` (opus). No row to add; the test pins
   that the configured Scoper model is priced.
4. **What the number means.** The parent row records the agent loop's own usage only. Child rows
   (triage, vision, the clerk's quote-prep, recovery's sweep) keep their own cost; nothing is
   rolled up.

## Hard constraints

- No schema change, no migration: `agent_runs.usage`, `cost_pence`, `model`, `turns` exist.
- No customer-facing money or price logic. `server/first-contact-ack.ts`, the money guards, the
  prompts: untouched. The model price table is an operating signal, not a customer price.
- Diff limited to: `server/spine/types.ts`, `server/spine/index.ts`, `server/spine/agents/scoper.ts`,
  `server/spine/agents/contractor-liaison.ts`, `server/agent-runs.ts`, one new test, this brief and
  the DONE report. Siblings D7 and B3 touch `index.ts` / `scoper.ts` too; keep the hunks small.
- No `.env`, no database in this worktree: unit tests and the build gate only. Nothing in the
  DONE report may claim live before/after.

## Tests

`server/spine/run-cost.test.ts`, mocking the same edges as `ben-lane-clerk.test.ts`:
- an agent that reports usage → `finishAgentRun` receives `usage`, `model`, `turns`, and the cost
  computed by the real `computeCostPence` for `SCOPER_MODEL` is > 0;
- the real Scoper with a stubbed runner reports the runner's usage through the same seam;
- an agent that throws → the run finishes with the error, no crash, and the patch carries no
  `usage` key, so the runner's persisted usage is not wiped;
- an agent that reports nothing → no `usage` key either.
`server/agent-runs.test.ts` (new, db mocked): `finishAgentRun` with `usage` undefined leaves
`usage`/`cost_pence` out of the update; with a usage it writes the computed pence.

## Build gate (CLAUDE.md)

Zero NEW tsc errors against `1fd113c3` (diff the error lists, not the counts). vitest: the failing
set unchanged (measured here without `.env`, and again with a placeholder `DATABASE_URL` so the
db module loads without connecting), plus the new tests green. `npm run build`'s esbuild step
bundles `server/index.ts`.

## Definition of done

`server/spine/index.ts` passes the agent's usage to `finishAgentRun`; the tests above pass; the
gate numbers are in `B2-DONE.md` and the PR body, with a Not-done section that says the live
ledger was not checked from this worktree.
