# server/comms-v2

The clean-sheet comms desk (docs/comms-v2/). Nothing here touches server/spine/ or server/agents/;
the old desk stays live as rollback until the new one is proven and cut over.

## Goal 0: the judge (`judge/`)

Contract 7 (docs/comms-v2/contracts.md). What lets a goal loop stop itself: a planned-send object,
scripted scenarios, a runner over the sandbox door, and two reports.

```
npm run comms-v2:judge                      # every Goal 1 scenario, twice, reports under reports/<stamp>/
npm run comms-v2:judge -- --only 2.7        # one line's scenario
npm run comms-v2:judge -- --out example     # the committed evidence at reports/example/
```

| Piece | File | What it is |
|---|---|---|
| planned send | `judge/planned-send.ts` | The Contract 7 object, typed with a zod schema, and the adapter that builds one from a sandbox dry-run response. A field the current desk cannot supply is the literal `unavailable`, never guessed. |
| scenario | `judge/scenario.ts`, `judge/scenarios/*.json` | The format (seed, turns, expectations) and one file per Goal 1 line: 1.1, 1.6, 1.7, 2.1 to 2.8. Seeds state known or new customer, prefers text, already rung, window open or shut. |
| expectations | `judge/expectations.ts` | Deterministic assertions over the planned send and the file. An expectation on an `unavailable` field fails with "unavailable from current desk"; a shut window the door could not honour fails with "window seed unsupported by current desk"; a post-send-dependent expectation after a reply the door never landed fails with "artefact: dry-run reply not landed on thread" (see the limitation below). |
| door | `judge/door.ts` | The sandbox WhatsApp door: the exported router mounted in-process on a loopback port, connecting only to `COMMS_V2_JUDGE_DATABASE_URL` (a Neon branch). It refuses to open without it or when that value names the production database; `DATABASE_URL` is never read. There is no door to a running server. Logs and reports carry the door's mode and host, never a variable's value. `seedPlan` says which seed features the current door honours. |
| model judge | `judge/model-judge.ts` | Line 2.3 only, "in its own words": the project's Anthropic client on `claude-haiku-4-5`; model id, prompt hash and verdict are recorded beside the deterministic assertion, never instead of it. |
| runner | `judge/runner.ts`, `judge/cli.ts` | One turn at a time through the door; the whole set twice; a line passes only when it passes both runs. A door that cannot be reached or times out is an error, never a pass. Exit code non-zero on any error; a fail is not an error. |
| reports | `judge/report.ts`, `reports/` | `judge-report.json` and `judge-report.md`, per line pass, fail or error with the planned send and a case-file snapshot as evidence. `reports/` is gitignored except `reports/example/`. |

Goal 0's stop condition: the runner executes every Goal 1 scenario against the current desk and
produces both reports with zero errors. Fails against the old desk are expected. Goal 1 is done
when the same runner reports all eleven lines passing, twice in a row, against the new desk.

Known limitation of the current door: the sandbox puts only the rules-layer first-contact ack on
the thread. A desk reply planned in dry run never reaches the exit, so it is not on the thread
when the next turn runs, and the desk then behaves as if it had never spoken (it re-asks, or
proposes the same reply on a clock pass). The runner reads the thread after every turn and, once
a planned reply has not landed, records the expectations on later turns that only hold when the
desk has seen its own reply (`reply_not_sent`, `not_asks_subject`, `asked_at_most_once`) as fail
with the reason `artefact: dry-run reply not landed on thread`, in both reports; the markdown
header carries the limitation whenever a run recorded one. Those verdicts judge the door, not
the desk; the other kinds on the same turns are still judged. A door that lands its replies (the
new desk's gateway) clears this by itself.

Tests: `npx vitest run server/comms-v2` (schema, evaluator, scenarios, adapter, door). The
integration test that runs one scenario end to end against the sandbox needs
`COMMS_V2_JUDGE_DATABASE_URL`, the model keys and `COMMS_V2_JUDGE_LIVE=1`.
