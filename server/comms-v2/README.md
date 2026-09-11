# server/comms-v2

The clean-sheet comms desk (docs/comms-v2/). Nothing here touches server/spine/ or server/agents/;
the old desk stays live as rollback until the new one is proven and cut over.

## Goal 1: the desk, skeleton plus Scoping, WhatsApp only (`desk/`)

Contracts 1 to 6 (docs/comms-v2/contracts.md), one file per contract, beside the judge. Case files
live in memory for the length of the process (the sandbox and the judge run in process); a durable
store implements `store.ts`'s interface when Ben's kanban (Goal 2) needs one.

| Contract | File | What it is |
|---|---|---|
| 1 Identity | `desk/identity.ts` | `resolve`, `canonical`, `link`, `registerInternal`. Keys are `phone:<national>` or `email:<lowercase>`, the convention the customer record already uses (server/clients.ts); the E.164 form is the channel address. Candidates mean no reply. Only `homeowner` and `internal` are live. |
| 2 Case file | `desk/case-file.ts`, `desk/store.ts` | One file per job with parties, append-only turns, the seven stages through `setStage`, facts refused without a source, the ask ledger (asked, answered, thanked), the hold as a flag with a named approver, sends with run id and approver and the model calls behind them. `invariantViolations` is the contract's invariants paragraph as one check. |
| gateway | `desk/whatsapp-adapter.ts`, `desk/gateway.ts` | Twilio and Meta webhook shapes to one turn, media downloaded on arrival on both paths; the door hands bytes over. The gateway resolves identity, opens or appends to the one file, hands the turn to the desk; clock and age enter here too. Not wired to a live webhook yet (cutover, behaviour.md answer 37). |
| 3 Router, composer | `desk/router.ts`, `desk/composer.ts`, `desk/models.ts` | Haiku 4.5 routes (structured output, two deterministic belts under it: regulated and money); Fable 5.1 at medium effort composes one reply from facts on the file, a blank line where a bubble breaks. Every call records model, tokens and cost (`ModelCallRecord`). Haiku takes no effort control; "low" is the recorded intent. |
| 4 Guards | `desk/guards.ts`, `desk/lexicon.ts` | The eight guards, no model. Pass, one retry to the composer with the failures named, then a hold with the fixed acknowledgement. `approverFor` is the slot: Ben for a homeowner, a rule-based approver for a tenant issue with no rules yet. |
| 5 Sender | `desk/sender.ts` | `chooseChannel`, `windowOf` (no recorded state is shut), `render` (blank lines, then sentence boundaries over ~300 characters, soft ceiling of four back to the composer, typing gaps 1 to 3 s), `pickTemplate` on a shut window by purpose with a hold when none is approved, `send` (dry run lands the reply on the thread as an outbound turn; live goes through server/outbound.ts, whose registry gate refuses `agent.comms_v2` until it has a row at cutover), `initiate` present and unused. |
| 6 Scoping | `desk/scoping-tools.ts`, `desk/scoping-specialist.ts` | The shelf: describe_media (Gemini via server/spine/tools/describe-video.ts, once per media), confirm_location, readiness (job type and location; photos optional), next_question (job, location, access, photos; photos once), offer_call, regulated (gas and asbestos only), kb_lookup (reviewed rows, read-only). The specialist on Sonnet 5 returns facts with the turn they came from and short labels of what is unknown; the proposal comes from the tools. Never prose. |
| the desk | `desk/desk.ts`, `desk/fixed-lines.ts` | route, gather, compose, guards, render, window, send, then the ledger and the stage from what actually went. Money and date changes hold for Ben and the reply answers the rest; complaints, refunds, trust doubts and gas send one fixed line and no composer runs; a composer refusal or failure takes the fixed acknowledgement. A clock pass never sends. The four fixed lines come from the knowledge base when reviewed, else the defaults here. |
| the door | `desk/sandbox-door.ts` | start, message (multipart media), run, age, reset, state. Every response carries the Contract 7 planned send the desk emits itself. Whatsapp only; call and price answer 409. |

Cost: Fable 5.1 is priced in `desk/models.ts` until server/agent-cost.ts carries a row (outside this
build's boundary); every other model prices through that table.

Tests: `npx vitest run server/comms-v2/desk` (every invariant in the contracts, with a scripted
model client; the door driven the judge's way). The judge run is the integration test.

## Goal 0: the judge (`judge/`)

Contract 7 (docs/comms-v2/contracts.md). What lets a goal loop stop itself: a planned-send object,
scripted scenarios, a runner over the sandbox door, and two reports.

```
npm run comms-v2:judge                      # every Goal 1 scenario, twice, against the new desk, reports under reports/<stamp>/
npm run comms-v2:judge -- --desk current    # the same against the old desk (rollback)
npm run comms-v2:judge -- --only 2.7        # one line's scenario
npm run comms-v2:judge -- --out example     # the committed Goal 0 evidence at reports/example/ (old desk)
npm run comms-v2:judge -- --out example-v2  # the committed Goal 1 evidence at reports/example-v2/ (new desk)
```

| Piece | File | What it is |
|---|---|---|
| planned send | `judge/planned-send.ts` | The Contract 7 object, typed with a zod schema. The new desk emits it itself on every door response and it is taken after a schema check; for the old desk an adapter builds one from the sandbox dry-run response, with a field it cannot supply as the literal `unavailable`, never guessed. |
| scenario | `judge/scenario.ts`, `judge/scenarios/*.json` | The format (seed, turns, expectations) and one file per Goal 1 line: 1.1, 1.6, 1.7, 2.1 to 2.8. Seeds state known or new customer, prefers text, already rung, window open or shut. |
| expectations | `judge/expectations.ts` | Deterministic assertions over the planned send and the file. An expectation on an `unavailable` field fails with "unavailable from current desk"; a shut window the door could not honour fails with "window seed unsupported by current desk"; a post-send-dependent expectation after a reply the door never landed fails with "artefact: dry-run reply not landed on thread" (see the limitation below). |
| door | `judge/door.ts` | The sandbox WhatsApp door: the chosen desk's router mounted in-process on a loopback port (`--desk v2`, the default, is `desk/sandbox-door.ts`; `--desk current` is the old sandbox), connecting only to `COMMS_V2_JUDGE_DATABASE_URL` (a Neon branch). It refuses to open without it or when that value names the production database; `DATABASE_URL` is never read. There is no door to a running server. Logs and reports carry the door's mode and host, never a variable's value. `seedPlan` says which seed features each door honours; the new desk's honours all of them. |
| model judge | `judge/model-judge.ts` | Line 2.3 only, "in its own words": the project's Anthropic client on `claude-haiku-4-5`; model id, prompt hash and verdict are recorded beside the deterministic assertion, never instead of it. |
| runner | `judge/runner.ts`, `judge/cli.ts` | One turn at a time through the door; the whole set twice; a line passes only when it passes both runs. A door that cannot be reached or times out is an error, never a pass. Exit code non-zero on any error; a fail is not an error. |
| reports | `judge/report.ts`, `reports/` | `judge-report.json` and `judge-report.md`, per line pass, fail or error with the planned send and a case-file snapshot as evidence. `reports/` is gitignored except `reports/example/`. |

Goal 0's stop condition: the runner executes every Goal 1 scenario against the current desk and
produces both reports with zero errors. Fails against the old desk are expected. Goal 1 is done
when the same runner reports all eleven lines passing, twice in a row, against the new desk:
`reports/example-v2/` is that evidence.

Known limitation of the old desk's door (cleared by the new desk's, which lands every reply): the sandbox puts only the rules-layer first-contact ack on
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
