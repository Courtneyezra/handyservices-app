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
| 5 Sender | `desk/sender.ts` | `chooseChannel`, `windowOf` (no recorded state is shut), `render` (WhatsApp only in Goal 1, other channels refused; blank lines, then sentence boundaries over ~300 characters, soft ceiling of four back to the composer, typing gaps 1 to 3 s; `asTyped` is the human path, where a blank line still breaks a bubble and nothing inside one is reflowed), `pickTemplate` on a shut window by purpose (named by server/window-templates.ts, approved and given its content SID by server/whatsapp-template-sync.ts) with a hold when none is approved; `templateWire` shapes it for the transport the customer wrote on, Twilio's content SID and variables or Meta's name, language and body components, `send` (dry run lands the reply on the thread as an outbound turn; live goes through server/outbound.ts as `agent.comms_v2`, switch key `comms_v2`, which the desk treats as off until `spine.senders.comms_v2.enabled` is written true; a default for one of the four fixed lines that are Ben's to review sends in dry run only, the Goal 1 lines send live; a live delivery that fails part way records the bubbles that went as a partial send), `initiate` present and unused. |
| 6 Scoping | `desk/scoping-tools.ts`, `desk/scoping-specialist.ts` | The shelf: describe_media (Gemini via server/spine/tools/describe-video.ts, once per media), confirm_location, readiness (job type and location; photos optional), next_question (job, location, access, photos; photos once), offer_call, regulated (gas and asbestos only), kb_lookup (reviewed rows, read-only). The specialist on Sonnet 5 returns facts with the turn they came from and short labels of what is unknown; the proposal comes from the tools. Never prose. |
| the desk | `desk/desk.ts`, `desk/fixed-lines.ts` | route, gather, compose, guards, render, window, send, then the ledger and the stage from what actually went. Money and date changes hold for Ben and the reply answers the rest; complaints, refunds, trust doubts and gas send one fixed line and no composer runs, and while that hold stands no specialist runs either: each later turn gets the short acknowledgement that Ben will come back; a composer refusal or failure, or a reply the sender refuses (live, one of Ben's four lines he has not reviewed), takes that same acknowledgement. A clock pass never sends. The four fixed lines come from the knowledge base when reviewed, else the defaults here. |
| a person's reply | `desk/human-reply.ts` | `humanReply`: Ben's own words from the board out through the one sender. The eight guards never run over them (behaviour.md answer 43): they gate a composed reply so the composer cannot invent what Ben himself is the source of. No send record claims otherwise: the `human:<their email or user id>` approver on the send is the record of which person wrote the words, so a slot two people share still answers that question, and guard results are not persisted on any send, so nothing anywhere reads as a pass no guard gave. Only the slot the file answers to may answer it: the approver its hold names while one stands, `approverFor`'s slot otherwise, so a session holding another slot is refused even on an unheld file. A human reply is not checked, but it is recorded: the ask ledger and `callOffered` are bookkeeping of what the business has already said, not a check on what may go, so the desk does not ask twice for a photo he has just asked for (`clauseAsks`) or offer a call he has just promised (`offersCall`). His prose is read more tightly than a composed reply: the subject word and the asking phrase must fall in one clause, so an ambiguous line records nothing and the desk asks again, rather than "I will be in touch later today, what is the best number for you?" marking access asked and no one ever asking about it. What still holds is what the sender owns: the sender renders and sends with approver `human:<their email or user id>` and a fresh run id, his line breaks inside a bubble kept as typed while a blank line still starts a new one, one run id sends once, the party must be on the file, and a shut window never carries his freeform words. The send lands as his turn, any hold clears with his words as the release, and the thread is automation's again (checklist 7.4). A refusal sends and records nothing and comes back with its reason for the board to show. |
| the door | `desk/sandbox-door.ts`, `desk/planned-send.ts` | start, message (multipart media), run, age, reset, state. Every response carries the planned send the desk emits itself (case id, party, channel, window state, template id, bubbles, fact and knowledge-base ids, every guard's result, approver, run id, hold, delivered), typed with a zod schema; `plannedSendOfResponse` is the one way a reader takes it and `sendLanded` checks the reply is on the thread. WhatsApp only; call and price answer 409. |
| the door host | `desk/door-host.ts`, `door-cli.ts` | Mounts the door on a loopback port for the length of a run. Connects only to the branch named by `COMMS_V2_DATABASE_URL`, refuses a missing value and a production one (server/worker-gate.ts's `isProductionDatabaseUrl`), never reads `DATABASE_URL`, and logs an address and variable names, never a value. |

Cost: every model call prices through server/agent-cost.ts, the one price table (Fable 5.1 has its row
there).

## Goal 4: the Quoting specialist and its tool server (`quoting/`)

Contract 7 (docs/comms-v2/contracts.md). Registered with the desk by one import and one gather
step in `desk/desk.ts`, one call in `desk/router.ts`, a `brief` on `SpecialistReturn` that the
composer prints, and a mount in `desk/sandbox-door.ts`. Nothing under server/spine/ is edited; the
quote machinery that survives the rebuild is wrapped.

| Piece | File | What it is |
|---|---|---|
| the specialist | `quoting/quoting-specialist.ts` | Sonnet 5 at medium effort, two structured outputs and never a figure in front of it: before the draft, the clerk's intake (lines, what matters for pricing, what is not included, what Ben may want to request); after the quote, which labels a question concerns, whether it is money beyond a line, acceptance in chat, not ready. Returns facts cited to the quote and a `brief` for the composer; never a sentence. A draft the clerk could not build holds the thread for Ben with the failure named, asks nothing that turn and briefs the composer to promise nothing, because nothing was built and no notification reached him; the turn that does draft it releases that hold in the desk's own words with the price screen named. Runs once the job and location are known; owns the thread once the quote is sent (Scoping stops). A quote that is no longer live for figures - expired, revoked, superseded, one path on purpose - gives no figure and holds for Ben, because the reply that says he will come back to them on it is otherwise a promise nothing keeps. `applyQuotingRoute` is the router's hook: a quote live for figures answers its own (5.3 replaces 2.7) and a money question on one that is not goes back to Ben under 2.7, since the stage stays `quoted` after the row expires; a portal action is Quoting's turn. Clearing the belt is safe only because the question model re-raises the hold, so when that reading is skipped or fails the belt stands and the money hold is set without it. The desk reads that liveness once a turn and hands it to both the router and the figure guard. |
| the tool server | `quoting/quoting-tools.ts`, `quoting/quote-record.ts` | quote_readiness (job type and location, photos optional, the missing list for Ben), draft_quote (once per job, refused whenever the file's quote reference names a quote that exists; the missing list is recorded on the case file as the internal `ben_to_request` fact and never on the quote row, because `GET /api/personalized-quotes/:slug` needs no session and serves every line-item field but the materials array verbatim; the price catalogue is reached only from inside this chain, never as a shelf of its own), notify_ben (once, with the price screen link, recorded on the file), chase (four hours, then daily, three times; never a customer send), read_quote_line (to the penny with its citation; refuses draft, revoked, superseded, expired, an unknown label), live_figure_quotes (the same liveness rule asked of the file's quote, which the figure guard resolves a cited line against, so a stale quote's figures cannot be repeated), read_quote_scope (draft allowed; no figure), record_quote_facts (each line, the total, the deposit, the link, scope, not included, assumptions, once each, cited `quote_line` with the label; never a line's labour or materials half, which the quote page prints in whole pounds and which is a breakdown rather than a line), price_quote (Ben's prices through the price screen's own `confirmPrices`, which leaves the row a draft), mark_quote_sent (only once the delivery landed: the quote leaves draft, its figures reach the file, the stage walks to quoted), record_acceptance (a human witness only: the row, quoted to accepted, one push to Ben). |
| the chain wrapper | `quoting/draft-quote.ts` | Calls server/spine/route-a.ts `runRouteAChain` with what a spine pass would supply (the intake as the clerk's artifact, a case-file shape carrying the v2 case id and the party's number) and its own injection points: the draft row is written here from the chain's pure `pricedDraftRow` (no old conversation needed), Ben's notification is captured for notify_ben, the job pack is skipped and said so. The estimator and the one pricing engine run for real. `FakeDrafter` for tests. |
| the store | `quoting/quote-store.ts` | The personalized_quotes row: read, insert the draft, price (server/spine/price-screen.ts `loadPriceScreen` and `confirmPrices`), accept (what the Stripe webhook writes, for the sandbox), add photos to a draft, delete the sandbox's own rows. `MemoryQuoteStore` for tests. |
| Ben's notifications | `quoting/ben-notifier.ts` | ready to price (with the price screen link and the missing list), chase, accepted. Nothing is dispatched: each notice is a fact on the file (`ben_notified`, `ben_chased`, `quote_accepted`), which is what the door shows as the recorded push. Dispatching it to Ben's phone through server/pushover.ts is a cutover item, against the switch that makes it reachable. |
| the door | `quoting/quoting-door.ts` | `POST /price` (Ben prices and sends; his send releases only a hold this route set, so a complaint, refund, trust or regulated hold is still a person's to answer: the price screen write, then the desk's own composer writes the delivery with the quote link, Contract 4 checks it, and it goes through the one sender in dry run under `human:ben`; stage to quoted. The words are the desk's, not Ben's - the route carries no message body, so nobody would read a borrowed draft before it went - and answer 43's exemption is for words a person typed. The quote leaves draft only once that send has landed, so a shut window, a guard failure or a refused send each hold for Ben and leave the quote a draft he can price again; no approved template carries a quote link, and wiring `quote_ready_link` into the desk's sender is a cutover item), `POST /accept` (the human event: the row, the stage, Ben's push, then one acknowledgement through the desk as the customer's turn), `GET /quote` (the file's quote facts and the row's lines to the penny). `/reset` removes the sandbox's quote rows. |

Facts the specialist writes carry the quote and the line as their source: `quote_line:<label> = £x.xx`
(`source: { kind: 'quote_line', quoteRef, line }`), `quote_scope:<label>`, `quote_not_included:<label>`,
`quote_assumption:<label>`, `quote_link`, `quote_status`. The composer copies a figure exactly as
written and cites the fact; the figure guard passes only that. A line whose amount changes leaves the
old fact on the append-only file, so only the newest `quote_line:<label>` for a quote is shown or
accepted (`isSupersededFigure`, `desk/case-file.ts`): a price the quote no longer carries cannot be
read back.

Four facts are Ben's, not the customer's: the three notifications carry the admin price screen link
and an internal note, and `ben_to_request` carries what the draft is missing. No guard reads what a
fact means, so they are kept out of the customer's
reply at the composer boundary - `INTERNAL_FACT_KEYS` and `customerVisibleFacts` in
`desk/case-file.ts`, used by `desk/composer.ts` for both the prompt and the ids it may cite
(`desk/composer.test.ts`). A new fact written for Ben's eyes belongs on that list the day it is
written.

### Driving Goal 4's checklist lines

The pipeline reads `test.instructions` from the default branch, so the scenarios are spelled out
here too. One thread on the comms-v2 door, in this order; the ready turn runs the estimator and
the pricing engine, so allow up to five minutes for it.

| Line | Drive | Passes when |
|---|---|---|
| 4.1, 4.2 | `POST /start` with a job and a postcode in one message and no photo ("my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB") | the reply carries no figure, `state.conversation.stage` is `ready`, `state.quote.slug` is set, and the planned send's summary contains `quoting: drafted` |
| 4.3 | `GET /quote` | `state.quote.notifications` holds exactly one `ready_to_price` whose link is `/admin/price/<slug>`; the record is `draft` with every `pricePence` null |
| 4.4 | `GET /quote`, and open `/admin/price/<slug>` in the app as Ben | the file carries the internal `ben_to_request` fact naming what to request ("photo (asked once, none sent)"), the `ready_to_price` notice repeats it, and the price screen shows the lines and the suggestions. The missing list is on no field of the quote row: showing it on Ben's board card is its own item (below) |
| 4.5 | `POST /run`, then `POST /age {"hours": 5}`, then `POST /run` | the first note says "not due", the second "chase 1 recorded for Ben"; nothing reaches the customer on either pass |
| 5.2 | `POST /message` "Does that include a new tap?" | answered from the draft's scope with no figure (a money hold for Ben beside it is 2.7 still standing before the quote, not a failure) |
| a photo before 5.1 | `POST /message` as multipart with a photo and "here is the tap" | the reply thanks for it once, the media ledger reads thanked, and the photo joins the draft |
| a shut window at 5.1 | `POST /age {"hours": 25}`, then `POST /price {}` | held for Ben, nothing sent, the hold names the shut window and the missing quote-link template, and `GET /quote` still reads `draft` with no `quote_line:` fact on the file. Then `POST /message` "any news on the quote?" to reopen the window before 5.1 |
| 5.1 | `POST /price {}` | the planned send's approver is `human:ben`, the bubbles carry `/quote/<slug>` and no figure, every guard reads `pass` (the words are the desk's, so all eight ran), the stage is `quoted`, and `GET /quote` now reads `sent` with every line priced |
| 5.3 | `POST /message` "What does that include, and how much is that line?" | the figure equals the price of that line on the record to the penny (£x.xx), `factIds` names the `quote_line` fact carrying that figure, the figure guard passes, no hold. Never ask about the labour or the materials: they are not lines of the quote, so any figure given for one is a figure the customer's quote does not state |
| a labour question after 5.3 | `POST /message` "How much of that is labour?" | held for ben with the money line and no figure: how a line splits is money beyond a quote line |
| 2.7 after | `POST /message` "Can you do it any cheaper?" | held for Ben, reason names money beyond a quote line, and no figure in the reply |
| 6.2 | `POST /message` "Leave it with me, I'll get back to you next month", then `POST /run` | one acknowledgement with no question, then nothing |
| 6.1, 6.3 | `POST /accept`, then `POST /accept` again | `notice.title` "Quote accepted", stage `accepted`, an `accepted` notification recorded, and one acknowledgement whose only promise is that Ben has been told (no date, time or duration); the second answers 409 |

What the price screen shows for a v2 draft: the lines with the customer's own words, suggestions and
band, the photos on the draft. Nothing internal is on the row, in any field: the quote endpoint is
reachable by slug with no session, so what the draft is missing is a fact on the case file instead,
and putting it on Ben's board card is filed as its own item (`ben_to_request` is already served by
`GET /api/comms-v2/case-files/:id`). Its thread pane, the "asked, none sent" pill and its
send button read the old conversation and messages tables, so they stay empty or refuse for a
sandbox draft until cutover re-points them at the case file; the door's `/price` is the send in the
meantime.

## Driving the door

```
npm run comms-v2:door                 # serve the desk's sandbox door on a loopback port until interrupted; prints the URL once
npm run comms-v2:door -- --port 4747  # a fixed port
```

Then over HTTP at the printed URL: `POST /start` (`{ door: 'whatsapp', text, name, seed }`, the seed
being `customer: 'known'`, `prefersText`, `alreadyRung`, `facts`, `ledger`), `POST /message`
(`{ text, channel: 'whatsapp' }`, or multipart with `media` files), `POST /run` (a clock pass; the
unpriced-quote chase fires here once due), `POST /age` (`{ hours }`), `POST /reset`, `GET /` (the
thread and the case file; `state.quote` is the quote as the file records it, with Ben's recorded
pushes). Goal 4 adds `POST /price` (`{}` for the chain's suggestions, or
`{ lines: [{ lineId, finalPence }] }`), `POST /accept` and `GET /quote`. Every response carries
`plannedSend` and `state`; the planned send names the `approver`. The ready turn runs the estimator
and the pricing engine before it replies, so allow up to two minutes for it. The door has no
session, so it has no answer action of its own: Ben's reply in his own words goes through the
board's authenticated route, which only his approver slot may call.

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
| answer | `api/routes.ts`, `desk/human-reply.ts` | `POST /case-files/:id/answer { words }` sends Ben's own reply through the one sender (`desk/human-reply.ts`), on any card, held or not. Same session rules as release: 401 with no session, 403 with no slot, 400 with no words, 404 on an unknown file; this is the only answer path, so no unlisted session can answer as him. A session whose slot is not the file's own approver is refused 409, held or not, so a slot minted for one thread cannot answer another. The guards do not run over his words (answer 43); a refusal from the sender, a shut window or a reply over the bubble ceiling, is 409 with its reason and nothing is sent, and a send returns the card, the approver the send carried, the bubbles that went, and the release the words cleared. |
| the store | `api/store.ts` | The desk has no durable case-file store yet, so the board reads a process-local instance of the Goal 1 sandbox door (one Desk, one Gateway, one in-memory store), separate from the door host's own singleton. Its router is mounted under `/sandbox`; the page's header control posts start and message to it. The door replaces its gateway on every start and reset, so the store is read through the door each time and a new start replaces the thread on the board. |

Sandbox threads only until cutover: the board reads the dry-run door, so nothing on it is a live
customer. The page polls every fifteen seconds; no websockets.

### Ben answers from a card: the live scenarios

The pipeline's test step drives these against the running app as Ben, on `/admin/comms-v2` (the
pipeline's admin account has the VA role on the branch database, so reach the board by URL), with
the board's own sandbox door under `/api/comms-v2/sandbox` seeding the thread:

1. A held card: start a sandbox thread, then send a money question as the customer ("How much
   roughly?"). The card holds for ben with the reason on it.
2. Ben taps the card, writes a reply in the answer form and sends. The thread on the door
   (`GET /api/comms-v2/sandbox/`) carries his turn with approver `human:<his own email or user id>`, and the bubbles are
   as the sender rendered them: a blank line is a new message.
3. The file shows Ben's turn (outbound, approver `human:<his own email or user id>`, labelled as his on the card's turn
   list and on the door's thread) and no hold, with his words recorded as the release.
4. The next customer message is answered by the desk again, approver `agent.comms_v2` (7.4).
5. A figure Ben types goes as he wrote it: his own words are never checked against the quote, and
   the send carries his own `human:` approver that no automated path can produce. No send record
   stores a guard result, so nothing claims a pass.
6. A reply the sender will not carry, one over the bubble ceiling of four, is refused with the
   sender's own reason shown on the board and nothing sent: no turn on the thread, no hold cleared.

## Environment

The door needs the branch database string and the model keys from the ordinary environment. The
desk's one database variable is `COMMS_V2_DATABASE_URL` (a Neon branch, never production); the
door host refuses a missing value and a production one and never reads `DATABASE_URL`. Every live
store and live reader in the desk asks the same question again at the moment it would open the
database, in `live-database.ts`: the database in use must be the branch that variable names, and a
refusal names that requirement and falls back to nothing. That is what the door host gives for
free and the deployed server does not: `/api/comms-v2/sandbox` is mounted there for Ben's board, on
the production database, where the quote machinery would otherwise write a real quote row and
publish a quote page with real prices. Ben's board reading its own `comms_v2_approvers` row is the
one caller outside the rule, because that row is meant to be read on the server the board runs on.
Cutover replaces this with the desk switch. The
pipeline's run copies inherit a non-production environment through direnv from their run root
(see `.no-mistakes.yaml`, `test.instructions`); a developer's shell carries its own. Nothing in the
desk loads a file of its own or prints a value.

## Tests

`npx vitest run server/comms-v2`: every invariant in the contracts with a scripted model client,
the door driven over HTTP the way the test step drives it, the door host's refusal rules, the
database refusal every live writer makes (`live-database.test.ts`, including each method of the
live quote store on a production-shaped connection), a person's reply through the one sender with
no guards over it, and the board's queries, approver mapping and routes. The page's own test is
`npx vitest run --project client client/src/pages/admin/__tests__/CommsV2BoardPage.test.tsx`.
None of them needs a key or a database; a live desk test reads its keys from the environment.
