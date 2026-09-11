# server/comms-v2

The clean-sheet comms desk (docs/comms-v2/). Nothing here touches server/spine/ or server/agents/;
the old desk stays live as rollback until the new one is proven and cut over.

## Goal 1: the desk, skeleton plus Scoping, WhatsApp only (`desk/`)

Contracts 1 to 6 (docs/comms-v2/contracts.md), one file per contract. Case files live in memory
for the length of the process (the sandbox door runs in process); a durable store implements
`store.ts`'s interface later. Ben's kanban (Goal 2, below) reads the in-process one for now.

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
| a person's reply | `desk/human-reply.ts` | `humanReply`: Ben's own words from the board out through the one sender. Records nothing until the eight guards pass over his words exactly as over a composed reply (no bypass for a person: a figure needs the quote line cited, a date a diary fact); on pass the sender renders and sends with approver `human:<slot>` and a fresh run id, the send lands as his turn, any hold clears with his words as the release, and the thread is automation's again (checklist 7.4). On a failure nothing is sent and the failures come back for the board to show. The one-reply guard reads the desk's own "Ben will come back" reply as the promise his reply keeps; a second human reply with no customer turn between is still refused. |
| the door | `desk/sandbox-door.ts`, `desk/planned-send.ts` | start, message (multipart media), run, age, reset, answer, state. Every response carries the planned send the desk emits itself (case id, party, channel, window state, template id, bubbles, fact and knowledge-base ids, every guard's result, approver, run id, hold, delivered), typed with a zod schema; `plannedSendOfResponse` is the one way a reader takes it and `sendLanded` checks the reply is on the thread. WhatsApp only; call and price answer 409. |
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
`POST /age` (`{ hours }`), `POST /answer` (`{ words, factIds }`, Ben's own reply on the thread;
the door has no session so it stands in for Ben's slot), `POST /reset`, `GET /` (the thread and
the case file). Every response carries `plannedSend` and `state`; the planned send names the
`approver` and the `author`, `desk` or `human`.

This is the surface the no-mistakes pipeline's end-to-end test step drives to validate a goal. The
checklist lines for the goal (docs/comms-v2/design.md, Goal 1's stop condition) are the scenarios
the test step exercises; its recorded evidence goes in the PR. See docs/comms-v2/contracts.md,
"Validation". Ben's board (below) mounts its own instance of the same door under
`/api/comms-v2/sandbox`, which is how a thread gets onto the board.

## Goal 2: Ben's desk as a kanban board (`api/`)

`/admin/comms-v2` (client/src/pages/admin/CommsV2BoardPage.tsx, in the admin shell) over
`/api/comms-v2` (`api/routes.ts`, mounted behind `requireAdmin` in server/index.ts): a thin
read-and-act layer over Contract 2's case file. Not polished, just visible and operable; it
doubles as the window onto the sandbox while the rest of the desk is built.

| Piece | File | What it is |
|---|---|---|
| the board | `api/board.ts` | `GET /board`: one column per Contract 2 stage, exactly the seven; each card is one file (customer, job type and location once known, last customer message and when, reply channel, mode). Held cards float to the top of their column with the hold reason and approver. Filters `?held=true` and `?mode=sandbox\|live`; a file is `live` once any send on it delivered, `sandbox` otherwise. `GET /case-files/:id` is the file's turns and facts, read-only. |
| release | `api/routes.ts`, `api/approvers.ts` | `POST /case-files/:id/release { words }` calls the case file's own `release`, which enforces the approver-and-words invariant; the route only carries the words and names who is asking. The approver is the slot the signed-in session occupies, never the request body: the app_settings row keyed `comms_v2_approvers` maps slot to user ids (`{ "ben": ["<user id>"] }`, the insert SQL is in `approvers.ts`). A session no slot lists gets 403; with no row nobody can release. Fail closed: an unreadable row assigns nobody. |
| answer | `api/routes.ts`, `desk/human-reply.ts` | `POST /case-files/:id/answer { words, factIds }` sends Ben's own reply through the one sender (`desk/human-reply.ts`), on any card, held or not. Same session rules as release: 401 with no session, 403 with no slot, 400 with no words, 404 on an unknown file. A guard failure is 409 carrying `failures` and every guard's verdict, and nothing is sent; a pass returns the card, the bubbles that went and the release the words cleared. The detail view carries `quoteLines`, the live quote's lines, so the form can cite one when Ben types a figure. |
| the store | `api/store.ts` | The desk has no durable case-file store yet, so the board reads a process-local instance of the Goal 1 sandbox door (one Desk, one Gateway, one in-memory store), separate from the door host's own singleton. Its router is mounted under `/sandbox`; the page's header control posts start and message to it. The door replaces its gateway on every start and reset, so the store is read through the door each time and a new start replaces the thread on the board. |

Sandbox threads only until cutover: the board reads the dry-run door, so nothing on it is a live
customer. The page polls every fifteen seconds; no websockets.

### Ben answers from a card: the live scenarios

The pipeline's test step drives these against the running app as Ben, on `/admin/comms-v2` (the
pipeline's admin account has the VA role on the branch database, so reach the board by URL), with
the board's own sandbox door under `/api/comms-v2/sandbox` seeding the thread:

1. A held card: start a sandbox thread, then send a money question as the customer ("How much
   roughly?"). The card holds for ben with the reason on it.
2. Ben taps the card, writes a reply in the answer form and sends. The planned send on the door
   (`GET /api/comms-v2/sandbox/`, or the door's own `POST /answer`) names approver `human:ben` and
   author `human`, with the bubbles as the sender rendered them.
3. The file shows Ben's turn (outbound, approver `human:ben`) and no hold, with his words recorded
   as the release.
4. The next customer message is answered by the desk again, approver `agent.comms_v2` (7.4).
5. A reply carrying an unsourced figure ("about £120 all in") is refused with the figure guard's
   reason shown on the board, and nothing is sent.
6. The same figure sends once it cites a quote line: seed one through `POST /start` with
   `seed.facts` and cite it in the answer form.

## Environment

The door needs the branch database string and the model keys from the ordinary environment. The
desk's one database variable is `COMMS_V2_DATABASE_URL` (a Neon branch, never production); the
door host refuses a missing value and a production one and never reads `DATABASE_URL`. The
pipeline's run copies inherit a non-production environment through direnv from their run root
(see `.no-mistakes.yaml`, `test.instructions`); a developer's shell carries its own. Nothing in the
desk loads a file of its own or prints a value.

## Tests

`npx vitest run server/comms-v2`: every invariant in the contracts with a scripted model client,
the door driven over HTTP the way the test step drives it (its answer action included), the door
host's refusal rules, a person's reply through the one sender with the guards over it, and the
board's queries, approver mapping and routes. The page's own test is
`npx vitest run --project client client/src/pages/admin/__tests__/CommsV2BoardPage.test.tsx`.
None of them needs a key or a database; a live desk test reads its keys from the environment.
