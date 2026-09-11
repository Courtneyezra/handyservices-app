# server/comms-v2

The clean-sheet comms desk (docs/comms-v2/). Nothing here touches server/spine/ or server/agents/;
the old desk stays live as rollback until the new one is proven and cut over.

## Goal 1: the desk, skeleton plus Scoping, WhatsApp only (`desk/`)

Contracts 1 to 6 (docs/comms-v2/contracts.md), one file per contract. Case files live in memory
for the length of the process (the sandbox door runs in process); a durable store implements
`store.ts`'s interface when Ben's kanban (Goal 2) needs one.

| Contract | File | What it is |
|---|---|---|
| 1 Identity | `desk/identity.ts` | `resolve`, `canonical`, `link`, `registerInternal`. Keys are `phone:<national>` or `email:<lowercase>`, the convention the customer record already uses (server/clients.ts); the E.164 form is the channel address. Candidates mean no reply. Only `homeowner` and `internal` are live. |
| 2 Case file | `desk/case-file.ts`, `desk/store.ts` | One file per job with parties, append-only turns, the seven stages through `setStage`, facts refused without a source, the ask ledger (asked, answered, thanked), the hold as a flag with a named approver, sends with run id and approver and the model calls behind them. `invariantViolations` is the contract's invariants paragraph as one check. |
| gateway | `desk/whatsapp-adapter.ts`, `desk/gateway.ts` | Twilio and Meta webhook shapes to one turn, media downloaded on arrival on both paths; the door hands bytes over. The gateway resolves identity, opens or appends to the one file, hands the turn to the desk; clock and age enter here too. Not wired to a live webhook yet (cutover, behaviour.md answer 37). |
| 3 Router, composer | `desk/router.ts`, `desk/composer.ts`, `desk/models.ts` | Haiku 4.5 routes (structured output, two deterministic belts under it: regulated and money); Fable 5.1 at medium effort composes one reply from facts on the file, a blank line where a bubble breaks. Every call records model, tokens and cost (`ModelCallRecord`). Haiku takes no effort control; "low" is the recorded intent. |
| 4 Guards | `desk/guards.ts`, `desk/lexicon.ts` | The eight guards, no model. Pass, one retry to the composer with the failures named, then a hold with the fixed acknowledgement. `approverFor` is the slot: Ben for a homeowner, a rule-based approver for a tenant issue with no rules yet. |
| 5 Sender | `desk/sender.ts` | `chooseChannel`, `windowOf` (no recorded state is shut), `render` (WhatsApp only in Goal 1, other channels refused; blank lines, then sentence boundaries over ~300 characters, soft ceiling of four back to the composer, typing gaps 1 to 3 s), `pickTemplate` on a shut window by purpose (named by server/window-templates.ts, approved and given its content SID by server/whatsapp-template-sync.ts) with a hold when none is approved; `templateWire` shapes it for the transport the customer wrote on, Twilio's content SID and variables or Meta's name, language and body components, `send` (dry run lands the reply on the thread as an outbound turn; live goes through server/outbound.ts as `agent.comms_v2`, switch key `comms_v2`, which the desk treats as off until `spine.senders.comms_v2.enabled` is written true; a default for one of the four fixed lines that are Ben's to review sends in dry run only, the Goal 1 lines send live; a live delivery that fails part way records the bubbles that went as a partial send), `initiate` present and unused. |
| 6 Scoping | `desk/scoping-tools.ts`, `desk/scoping-specialist.ts` | The shelf: describe_media (Gemini via server/spine/tools/describe-video.ts, once per media), confirm_location, readiness (job type and location; photos optional), next_question (job, location, access, photos; photos once), offer_call, regulated (gas and asbestos only), kb_lookup (reviewed rows, read-only). The specialist on Sonnet 5 returns facts with the turn they came from and short labels of what is unknown; the proposal comes from the tools. Never prose. |
| the desk | `desk/desk.ts`, `desk/fixed-lines.ts` | route, gather, compose, guards, render, window, send, then the ledger and the stage from what actually went. Money and date changes hold for Ben and the reply answers the rest; complaints, refunds, trust doubts and gas send one fixed line and no composer runs, and while that hold stands no specialist runs either: each later turn gets the short acknowledgement that Ben will come back; a composer refusal or failure, or a reply the sender refuses (live, one of Ben's four lines he has not reviewed), takes that same acknowledgement. A clock pass never sends. The four fixed lines come from the knowledge base when reviewed, else the defaults here. |
| the door | `desk/sandbox-door.ts`, `desk/planned-send.ts` | start, message (multipart media), run, age, reset, state. Every response carries the planned send the desk emits itself (case id, party, channel, window state, template id, bubbles, fact and knowledge-base ids, every guard's result, approver, run id, hold, delivered), typed with a zod schema; `plannedSendOfResponse` is the one way a reader takes it and `sendLanded` checks the reply is on the thread. WhatsApp only; call and price answer 409. |
| the door host | `desk/door-host.ts`, `door-cli.ts` | Mounts the door on a loopback port for the length of a run. Connects only to the branch named by `COMMS_V2_DATABASE_URL`, refuses a missing value and a production one (server/worker-gate.ts's `isProductionDatabaseUrl`), never reads `DATABASE_URL`, and logs an address and variable names, never a value. |

Cost: every model call prices through server/agent-cost.ts, the one price table (Fable 5.1 has its row
there).

## Driving the door

```
npm run comms-v2:door                 # serve the desk's sandbox door on a loopback port until interrupted; prints the URL once
npm run comms-v2:door -- --port 4747  # a fixed port
```

Then over HTTP at the printed URL: `POST /start` (`{ door: 'whatsapp', text, name, seed }`, the seed
being `customer: 'known'`, `prefersText`, `alreadyRung`, `facts`, `ledger`), `POST /message`
(`{ text, channel: 'whatsapp' }`, or multipart with `media` files), `POST /run` (a clock pass),
`POST /age` (`{ hours }`), `POST /reset`, `GET /` (the thread and the case file). Every response
carries `plannedSend` and `state`.

This is the surface the no-mistakes pipeline's end-to-end test step drives to validate a goal, and
the one Ben's sandbox will be wired to. The checklist lines for the goal (docs/comms-v2/design.md,
Goal 1's stop condition) are the scenarios the test step exercises; its recorded evidence goes in
the PR. See docs/comms-v2/contracts.md, "Validation".

## Environment

The door needs the branch database string and the model keys. They may live in one more place on
this machine so the pipeline's test step can drive the desk live: a machine-local file at
`$HOME/.config/handyservices/comms-v2.env` (mode 600), in dotenv form. `server/comms-v2/env.ts`
loads it before the door and the desk's tests run and takes exactly three names from it:
`COMMS_V2_DATABASE_URL`, `ANTHROPIC_API_KEY` and `GEMINI_API_KEY`. It fills only the variables the
process does not already have, ignores every other name in the file (the door logs the ignored
names, never a value), and never prints, logs or commits a value.

The desk's one database variable is `COMMS_V2_DATABASE_URL` (a Neon branch, never production).

## Tests

`npx vitest run server/comms-v2`: every invariant in the contracts with a scripted model client,
the door driven over HTTP the way the test step drives it, the env loader, and the door host's
refusal rules. None of them needs a key or a database. The machine-local file is loaded for this
directory's tests only (the `comms-v2` vitest project), so a live desk test can rely on it; the
rest of the server suite never sees it.
