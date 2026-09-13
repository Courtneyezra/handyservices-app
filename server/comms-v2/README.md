# server/comms-v2

The clean-sheet comms desk (docs/comms-v2/). Nothing here touches server/spine/ or server/agents/;
the old desk stays live as rollback until the new one is proven and cut over.

## Goal 1: the desk, skeleton plus Scoping, WhatsApp only (`desk/`)

Contracts 1 to 6 (docs/comms-v2/contracts.md), one file per contract. The sandbox door's case
files live in memory for the length of the process; the live intake's are in the durable store
behind the same `store.ts` interface (`desk/database-store.ts`, Goal 3 below). Ben's kanban (Goal 2,
below) reads the sandbox door's in-process one for now.

| Contract | File | What it is |
|---|---|---|
| 1 Identity | `desk/identity.ts` | `resolve`, `canonical`, `link`, `registerInternal`. Keys are `phone:<national>` or `email:<lowercase>`, the convention the customer record already uses (server/clients.ts); the E.164 form is the channel address. Candidates mean no reply, and a key the turn only asserts (the form's typed email) names candidates for Ben rather than binding to that person; only the address the turn arrived on, or a key the business already holds for them, binds. Only `homeowner` and `internal` are live. |
| 2 Case file | `desk/case-file.ts`, `desk/store.ts` | One file per job with parties, append-only turns, the seven stages through `setStage`, facts refused without a source, the ask ledger (asked, answered, thanked), the hold as a flag with a named approver, sends with run id and approver and the model calls behind them. `invariantViolations` is the contract's invariants paragraph as one check. |
| gateway | `desk/whatsapp-adapter.ts`, `desk/gateway.ts` | Twilio and Meta webhook shapes to one turn, media downloaded on arrival on both paths; the door hands bytes over. The gateway resolves identity, opens or appends to the one file, hands the turn to the desk; clock and age enter here too. Not wired to a live webhook yet (cutover, behaviour.md answer 37). |
| 3 Router, composer | `desk/router.ts`, `desk/composer.ts`, `desk/models.ts` | Haiku 4.5 routes (structured output, two deterministic belts under it: regulated and money, each adding to what the model read rather than displacing it, so `exceptions` is a list, gravest first; a call request is the router's own reading, with no belt); Fable 5.1 at medium effort composes one reply from facts on the file, a blank line where a bubble breaks. Every call records model, tokens and cost (`ModelCallRecord`). Haiku takes no effort control; "low" is the recorded intent. |
| 4 Guards | `desk/guards.ts`, `desk/lexicon.ts` | The eight guards, no model. The business-claim guard carries the verbatim rail above its lexicon: every knowledge-base row the reply cites, by id or through a fact, must be a reviewed row whose body the reply carries word for word, whatever the reply is about. Pass, one retry to the composer with the failures named, then a hold with the fixed acknowledgement. `approverFor` is the slot: Ben for a homeowner, a rule-based approver for a tenant issue with no rules yet. |
| 5 Sender | `desk/sender.ts` | `chooseChannel` (the channel they wrote on; a form or a call opens WhatsApp, then SMS, then email; an SMS with the WhatsApp window open is answered there), `windowOf` (no recorded state is shut), `render` (per channel: WhatsApp bubbles, SMS one message, email a letter, the last two in channels/; blank lines, then sentence boundaries over ~300 characters, soft ceiling of four back to the composer, typing gaps 1 to 3 s; `asTyped` is the human path, where a blank line still breaks a bubble and nothing inside one is reflowed), `pickTemplate` on a shut window by purpose (named by server/window-templates.ts, approved and given its content SID by server/whatsapp-template-sync.ts) with a hold when none is approved; `templateWire` shapes it for the transport the customer wrote on, Twilio's content SID and variables or Meta's name, language and body components, `send` (dry run lands the reply on the thread as an outbound turn; live goes through server/outbound.ts as `agent.comms_v2`, switch key `comms_v2`, which the desk treats as off until `spine.senders.comms_v2.enabled` is written true; a default for one of the four fixed lines that are Ben's to review sends in dry run only, the Goal 1 lines send live; a live delivery that fails part way records the bubbles that went as a partial send), `initiate`, the desk-started template send Ben's chase uses (Goal 6): live, it goes through the same deliverer and gates as a reply but carries its own purpose, so `outboundLabelFor` sends a chase or an escalation as the fail-closed `marketing` class at the opt-out ledger under the context `comms_v2:<purpose>`, never as a customer `service_reply`; nothing calls it live until cutover. |
| 6 Scoping | `desk/scoping-tools.ts`, `desk/scoping-specialist.ts` | The shelf: describe_media (Gemini via server/spine/tools/describe-video.ts, once per media), confirm_location, readiness (job type and location; photos optional), next_question (job, location, access, photos; photos once), offer_call, regulated (gas and asbestos only). The specialist on Sonnet 5 returns facts with the turn they came from and short labels of what is unknown; the proposal comes from the tools. Never prose. |
| the desk | `desk/desk.ts`, `desk/fixed-lines.ts` | route, gather, compose, guards, render, window, send, then the ledger and the stage from what the business itself said: an approved template's own wording with its placeholders unfilled, never the enquiry a filled body quotes back, and the composed reply, never the greeting and sign-off the renderer wraps it in; the thanks for a photo is spent only where the words that went carried one, in any wording of gratitude rather than one that names the photo, because a thanks the ledger records but the reply never made leaves the photo unacknowledged for good. Money and date changes hold for Ben and the reply answers the rest; complaints, refunds, trust doubts and gas send one fixed line and no composer runs, and while that hold stands no specialist runs either: each later turn gets the short acknowledgement that Ben will come back; a composer refusal or failure, or a reply the sender refuses (live, one of Ben's four lines he has not reviewed), takes that same acknowledgement. A clock pass never sends. The four fixed lines come from the knowledge base when reviewed, else the defaults here. |
| a person's reply | `desk/human-reply.ts` | `humanReply`: Ben's own words from the board out through the one sender. The eight guards never run over them (behaviour.md answer 43): they gate a composed reply so the composer cannot invent what Ben himself is the source of. No send record claims otherwise: the `human:<their email or user id>` approver on the send is the record of which person wrote the words, so a slot two people share still answers that question, and guard results are not persisted on any send, so nothing anywhere reads as a pass no guard gave. Only the slot the file answers to may answer it: the approver its hold names while one stands, `approverFor`'s slot otherwise, so a session holding another slot is refused even on an unheld file. A human reply is not checked, but it is recorded: the ask ledger and `callOffered` are bookkeeping of what the business has already said, not a check on what may go, so the desk does not ask twice for a photo he has just asked for (`clauseAsks`) or offer a call he has just promised (`offersCall`). His prose is read more tightly than a composed reply: the subject word and the asking phrase must fall in one clause, so an ambiguous line records nothing and the desk asks again, rather than "I will be in touch later today, what is the best number for you?" marking access asked and no one ever asking about it. What still holds is what the sender owns: the sender renders and sends with approver `human:<their email or user id>` and a fresh run id, his line breaks inside a bubble kept as typed while a blank line still starts a new one, one run id sends once, the party must be on the file, and a shut window never carries his freeform words. A refusal speaks the refusing channel's own measure: an SMS over the two segments one text message may use says so in segments and characters, never in bubbles. The send lands as his turn, any hold clears with his words as the release, and the thread is automation's again (checklist 7.4). A refusal sends and records nothing and comes back with its reason for the board to show. |
| the door | `desk/sandbox-door.ts`, `desk/planned-send.ts` | start, message (multipart media), run, age, reset, state. Every response carries the planned send the desk emits itself (case id, party, channel, window state, template id, bubbles, fact and knowledge-base ids, every guard's result, approver, run id, hold, delivered), typed with a zod schema; `plannedSendOfResponse` is the one way a reader takes it and `sendLanded` checks the reply is on the thread. The SMS, form, email and call doors are mounted in front (channels/channel-doors.ts), the quoting door behind (quoting/quoting-door.ts). |
| the door host | `desk/door-host.ts`, `door-cli.ts` | Mounts the door on a loopback port for the length of a run. Connects only to the branch named by `COMMS_V2_DATABASE_URL`, refuses a missing value and a production one (server/worker-gate.ts's `isProductionDatabaseUrl`), never reads `DATABASE_URL`, and logs an address and variable names, never a value. |

Cost: every model call prices through server/agent-cost.ts, the one price table (Fable 5.1 has its row
there).

## Goal 3: the other four channels (`channels/`)

SMS, email, the web form and calls against the same desk (docs/comms-v2/design.md, "Five channels,
one desk"). Nothing below the gateway changed: each adapter produces the gateway's envelope
(`channels/envelope.ts`, the WhatsApp turn is one already) and `channels/channel-gateway.ts`
extends the gateway to take any channel: Identity resolves the address with the turn's hints and
links a phone and an email the same turn proves belong together (the form is the join; a form whose
phone is already known joins that person and its asserted email is linked on the way past, while a
form that only asserts a known email is held as candidates for Ben), the turn
lands on the person's one open file whatever the channel (answer 25), the addresses the turn proves
go on the party's channels before the turn lands, so a WhatsApp channel carries the number the turn
came from and never an address the party already had, the adapter's facts are recorded with the turn
as their source.

| Channel | File | In | Out |
|---|---|---|---|
| SMS | `channels/sms-adapter.ts` | Twilio's inbound on the shared webhook (a bare `From`); media is refused, a UK long code cannot receive MMS | `renderSms`: one message, at most two segments (GSM-7 or UCS-2 counted), typographic punctuation normalised; over two goes back to the composer. A person's own words from the board go as typed, punctuation and line breaks untouched, with only the two-segment ceiling still refusing. A reply on SMS to a party who does not write on WhatsApp carries the fixed `move_to_whatsapp` line (1.4), spent on the ask ledger when the reply carrying it sends, so a reworded one still goes exactly once and an acknowledgement that held the thread for Ben does not spend it; a WhatsApp channel with no inbound turn on it, which is all the presence source proves, does not withhold it either. An SMS from a party whose WhatsApp window is open is answered on WhatsApp. |
| Email | `channels/email-adapter.ts` | The sandbox door, the only way in until cutover (below): the quoted history stripped, photo attachments written where describe_media reads them, the thread kept on the party's email channel | `renderEmail`: one letter, "Hi <first name>," the paragraphs, the sign-off; the reply carries `In-Reply-To` and `References` and the subject with "Re:". Those are the desk's words, so a person's own words from the board get none of them: his letter is what he typed, line breaks and all, and a greeting or a sign-off is his to write. Render only: there is no live email delivery. The one outbound send is the only path that checks the opt-out ledger and it carries WhatsApp and SMS, so a live email send is refused. Whether email belongs in the STOP suppression list, and on what key, is a cutover decision. |
| Web form | `channels/form-adapter.ts` | Name, phone, email, the job, postcode, sometimes photos (bytes). Creates the file; the postcode and name are facts at intake; the job type is Scoping's to establish | No reply path of its own: `chooseChannel` follows a channel this customer has written on before, so a form filled in mid-thread is answered where the thread has been running, and for a first contact who has written on nothing it opens WhatsApp if the number is on it (the approved web form template, quoting the enquiry, 1.2; the row without the call offer when they have already rung us, 1.5), else SMS, else email. |
| Calls | `channels/call-adapter.ts`, `channels/call-reader.ts`, `channels/channel-desk.ts` | A finished call: `missed`, `answered_inbound`, or `ben_rang` (an unanswered outbound never reaches the desk). The transcript is the turn's body; the outcome is a fact on the file. The reader (Sonnet 5, facts only, no prose field) records the job, the location, what Ben asked for and whether a callback was agreed; Ben's asks go on the ledger as soon as the call is read, whatever the follow-up does next, so the desk never asks again | The desk never speaks. `missed`: one text back per thread (3.5), the missed-call template on WhatsApp, else its words on SMS; the acknowledgement goes on the ask ledger, so a second and third missed call send nothing. `answered_inbound`: nothing (3.5), and the caller is never offered a call (1.5). `ben_rang`: the post-call template with the name and the job (1.3), else its words on SMS; the thread continues from the file (3.2, 3.3) and nothing is held for Ben (3.4). No approved template on WhatsApp holds the follow-up for Ben with its words as the draft, never an SMS fallback (answer 34); so does a template the channel's own render refuses, a first name outside GSM 03.38 being enough to make one text three segments, because nobody is left silent after Ben's call. |

The templates: every row is in the one registry (server/window-templates.ts), including the
missed-call acknowledgement and the web form acknowledgement without the call offer, which the
channels added to it; a second list would hide an unattended send from the go-live surface.
`channels/templates.ts` only chooses the purpose. The sender's `pickTemplate` branches on purpose
(`service_reply`, `web_form_ack`, `web_form_ack_no_call`, `post_call_followup`, `missed_call`),
never on a name, and fills `{{1}}` name, `{{2}}` topic, `{{3}}` when we would ring: "shortly"
inside Ben's hours and "in the morning" outside them, by the UK hour of the desk's own clock
(server/working-hours.ts), which is the meaning the registry row declares and the rule the live
acknowledgement already follows. A party who has already
rung us, prefers text, or has been offered a call takes `web_form_ack_no_call` (checklist 1.5), the
same acknowledgement with the offer taken out; that name is not approved yet, so today the
acknowledgement holds for Ben with its words as the draft rather than asking to call. Off WhatsApp
the same words go as the one SMS or email; a call follow-up is never freeform.

Whether a number is on WhatsApp is a `WhatsAppPresence` source: the door's is the scenario seed
alone (`seed.whatsapp`); the live intake's reads the inbound WhatsApp messages the business holds.

### The old inputs, behind one switch

`COMMS_V2_INTAKE` (`channels/intake.ts`), read the way `COMMS_WORKER` is (server/worker-gate.ts):
exactly `1` is on, anything else is off. Off: nothing runs and nothing old changes. On: each old
entry point also forwards its raw event here, fire and forget, and the matching adapter hands the
turn to the channel gateway; the old handler still runs. The forwarding call is the one edit in old
code: server/whatsapp-api.ts `/incoming` (Twilio, WhatsApp and SMS), server/meta-whatsapp.ts
`/webhook`, server/leads.ts `POST /api/leads` (the web form), and server/call-logger.ts
`finalizeCall` (a finished call; the call row is read for its outcome). The desk behind the intake
runs in dry run: everything up to delivery, nothing leaves. The cutover that turns the old handler
off and this desk's delivery on is a later task.

**The switch alone does not start it.** `INTAKE_REQUIREMENTS` (`channels/intake.ts`) is what the
intake must have before it reads one live turn. One entry is outstanding: a populated
internal-number directory, because the identity here has never been told which numbers are ours, so
Ben's own handset would resolve as a customer (server/internal-numbers.ts already holds the
numbers). Until it lands the gateway refuses to be built and every forward logs what is missing; a
build that fails is forgotten, so the next forward tries again.

**Persistence has landed.** The intake's case files live in the `comms_v2_case_files` table
(`desk/database-store.ts`, migration `migrations/20260913_comms_v2_case_files.sql`), so a restart or
a redeploy loses no thread. The store keeps the synchronous interface in `desk/store.ts` by writing
through: the gateway reads every row when it is built and answers `get`, `findOpenFor` and `all`
from those files, and each `put` writes the whole file in the background, one write at a time. A
failed write is logged and retried without holding up another file's, and `flush` waits for them.
Because the desk changes a file in place, the gateway puts it once a turn lands and again after the
desk, a clock pass or an age. The identity directory is still in memory, so `identityFromCaseFiles`
rebuilds it from the parties on the loaded files, and a returning customer lands on their open file
rather than a second one. The store opens nothing unless the database in use is the branch
`COMMS_V2_DATABASE_URL` names (`live-database.ts`); apply the migration to that branch before the
switch goes on. The sandbox door keeps the memory store.

### Inbound email

There is no inbound email today and this goal does not add one: the email sandbox door is the only
way an email reaches the desk, and it is what proves the channel. `fromInboundEmail`
(`channels/email-adapter.ts`) covers the door and nothing else: a bare address, the words, the
subject and the thread's message id, with the door's media handed over as bytes. There is no
outbound email path either: a live email send is refused, so the desk runs dry on email.

A webhook is cutover work, and it is more than a route. The provider's own body shape, its HTML
parts, its base64 attachments and its header spellings land with it, written against a real payload
from the provider that was chosen rather than guessed at in advance. It needs a chosen provider, a path outside
the admin-gated `/api/comms-v2` prefix (mounting one under it puts `requireAdmin` in front of every
request, so a provider's POST is refused before the route is reached), and its own secret. Naming an
inbound mail provider is also a data-protection decision, not a code change alone: that provider
would receive customers' full message bodies and attachments, so it must be recorded in
`docs/COMMS_RECORD_OF_PROCESSING.md` and on the customer-facing list in
`client/src/pages/PrivacyPolicyPage.tsx` before anything is pointed at one.
## Goal 4: the Quoting specialist and its tool server (`quoting/`)

Contract 7 (docs/comms-v2/contracts.md). Registered with the desk by one import and one gather
step in `desk/desk.ts`, one call in `desk/router.ts`, a `brief` on `SpecialistReturn` that the
composer prints, and a mount in `desk/sandbox-door.ts`. Nothing under server/spine/ is edited; the
quote machinery that survives the rebuild is wrapped.

| Piece | File | What it is |
|---|---|---|
| the specialist | `quoting/quoting-specialist.ts` | Sonnet 5 at medium effort, two structured outputs and never a figure in front of it: before the draft, the clerk's intake (lines, what matters for pricing, what is not included, what Ben may want to request); after the quote, which labels a question concerns, whether it is money beyond a line, acceptance in chat, not ready. Money beyond a line holds for Ben whatever the quote's status, and the desk's money line goes with it, so a draft still with him hears about the ask. Returns facts cited to the quote and a `brief` for the composer; never a sentence. A draft the clerk could not build holds the thread for Ben with the failure named, asks nothing that turn and briefs the composer to promise nothing, because nothing was built and no notification reached him; that is the one shape whichever half failed, the intake model or the chain, since a quote drafted from the job title alone would carry no assumption and nothing excluded and the next thing done to a draft is that Ben prices it and sends it; the turn that does draft it releases that hold in the desk's own words with the price screen named. Runs once the job and location are known; owns the thread once the quote is sent (Scoping stops). A quote that is no longer live for figures - expired, revoked, superseded, one path on purpose - gives no figure and holds for Ben, because the reply that says he will come back to them on it is otherwise a promise nothing keeps. `applyQuotingRoute` is the router's hook: a quote live for figures answers its own (5.3 replaces 2.7) and a money question on one that is not goes back to Ben under 2.7, since the stage stays `quoted` after the row expires; a portal action is Quoting's turn. Clearing the belt is safe only because the question model re-raises the hold, so when that reading is skipped or fails the belt stands and the money hold is set without it. The desk reads that liveness once a turn and hands it to both the router and the figure guard. |
| the tool server | `quoting/quoting-tools.ts`, `quoting/quote-record.ts` | quote_readiness (job type and location, photos optional, the missing list for Ben), draft_quote (once per job, refused whenever the file's quote reference names a quote that exists; the missing list is recorded on the case file as the internal `ben_to_request` fact and never on the quote row, because `GET /api/personalized-quotes/:slug` needs no session and serves every line-item field but the materials array verbatim; the price catalogue is reached only from inside this chain, never as a shelf of its own), notify_ben (once, with the price screen link, recorded on the file), chase (four hours, then daily, three times; never a customer send), read_quote_line (to the penny with its citation, matched on the quote's own label only and never the citation; refuses draft, revoked, superseded, expired, an unknown label, and a label two lines share), live_figure_quotes (the same liveness rule asked of the file's quote, which the figure guard resolves a cited line against, so a stale quote's figures cannot be repeated), read_quote_scope (draft allowed; no figure), record_quote_facts (each line, the total, the deposit, the link, scope, not included, assumptions, once each, cited `quote_line` with the figure's own name, which carries the line position when two lines share a title so one line's price is never recorded as another's; never a line's labour or materials half, which the quote page prints in whole pounds and which is a breakdown rather than a line), price_quote (Ben's prices through the price screen's own `confirmPrices`, which leaves the row a draft), mark_quote_sent (only once the delivery landed: the quote leaves draft, its figures reach the file, the stage walks to quoted), record_acceptance (a human witness only: the row, quoted to accepted, one push to Ben). |
| the chain wrapper | `quoting/draft-quote.ts` | Calls server/spine/route-a.ts `runRouteAChain` with what a spine pass would supply (the intake as the clerk's artifact, a case-file shape carrying the v2 case id and the party's number) and its own injection points: the draft row is written here from the chain's pure `pricedDraftRow` (no old conversation needed), Ben's notification is captured for notify_ben, the job pack is skipped and said so. The estimator and the one pricing engine run for real. `FakeDrafter` for tests. |
| the store | `quoting/quote-store.ts` | The personalized_quotes row: read, insert the draft, price (server/spine/price-screen.ts `loadPriceScreen` and `confirmPrices`), accept (what the Stripe webhook writes, for the sandbox), add photos to a draft, delete the sandbox's own rows. `MemoryQuoteStore` for tests. |
| Ben's notifications | `quoting/ben-notifier.ts` | ready to price (with the price screen link and the missing list), chase, accepted. Nothing is dispatched: each notice is a fact on the file (`ben_notified`, `ben_chased`, `quote_accepted`), which is what the door shows as the recorded push. Dispatching it to Ben's phone through server/pushover.ts is a cutover item, against the switch that makes it reachable. |
| the door | `quoting/quoting-door.ts` | `POST /price` (Ben prices and sends; the one card his send clears is the one this route raised itself when an earlier attempt did not send, and only while no other voice has been added to it, because a hold is one card carrying every reason it has been raised for and clearing it would take a customer's question added to it since along with it (`notedOn` on the hold is where any automatic release asks; the desk's own notes about its own run - a shut window, no template, a reply the guards refused - join the card without marking it, because that is the same automatic step speaking). It clears in the desk's own words naming that send rather than the letter that went, which nobody read before it went, and a delivery that holds adds what stopped it to whatever card is already open. Every other card stands: a money question is not answered by being about money, because the delivery carries the link and nothing else, and the same goes for the acknowledgement a web-form enquiry was owed, for a complaint, refund, trust or regulated hold, and for acceptance, which stays human. The route is: the price screen write, then the desk's own composer writes the delivery with the quote link, Contract 4 checks it, and it goes through the one sender in dry run under `human:ben`, on the channel the customer wrote on rather than one this route names, so an SMS thread whose number is on WhatsApp but never wrote there still gets its quote; stage to quoted. The words are the desk's, not Ben's - the route carries no message body, so nobody would read a borrowed draft before it went - and answer 43's exemption is for words a person typed. The composer is told which channel that is rather than working it out for itself, so a delivery going by text is written as one short text. One sentence in the send is a fixed line rather than the composer's (`first_contact_ack` in `desk/fixed-lines.ts`): where the acknowledgement a web-form enquiry was owed held for Ben and never went, that line goes ahead of the composer's words, so the first message they ever receive names us and the enquiry it follows, and the composer is told the room left after it rather than the whole channel budget. Nothing is interpolated into it, so no model-written fact reaches a customer through it and a test runs the eight guards over its wording. The quote leaves draft only once that send has landed, so a shut window on a channel the customer chose, a guard failure or a refused send each hold for Ben and leave the quote a draft he can price again; no approved template carries a quote link, and wiring `quote_ready_link` into the desk's sender is a cutover item. The one channel the delivery skips is one the customer has never written on whose window is shut, which is the WhatsApp record a form or a call lead is given for a number known to be on WhatsApp: that never-opened window would hold a link no template can carry, so the delivery takes the next channel in the order instead. That rule is `chooseChannel`'s own `noTemplate` option in `desk/sender.ts`, so one function still decides the channel for every send the desk makes, and only a send no approved template can carry asks for it), `POST /accept` (the human event: the row, the stage, Ben's push, then one acknowledgement through the desk as the customer's turn; the store refuses a quote that is no longer live, an expired one included, before any deposit is written. On a shut window the desk holds that acknowledgement for Ben and says the customer accepted and is waiting on a word from him, rather than reaching for a template of another purpose: the only approved wording of that purpose asks the customer to write again, which the registry says must never stand as the reply, and a quote-accepted purpose of its own needs a template approved with Meta, filed beside the `quote_ready_link` cutover item), `GET /quote` (the file's quote facts and the row's lines to the penny). `/reset` removes the sandbox's quote rows, keyed on every contact the drama customer writes from: the row's `phone` column holds the number on a phone thread and the address on an email one, so the door a quote was drafted on does not decide whether its row survives. |

Facts the specialist writes carry the quote and the line as their source: `quote_line:<label> = £x.xx`
(`source: { kind: 'quote_line', quoteRef, line }`), `quote_scope:<label>`, `quote_not_included:<label>`,
`quote_assumption:<label>`, `quote_link`, `quote_status`. The composer copies a figure exactly as
written and cites the fact; the figure guard passes only that.

What the draft is missing reaches Ben on the admin-gated price screen (4.4) as well as in the
ready-to-price notice: `quoting/ben-to-request.ts` reads the internal `ben_to_request` fact off the
case file and `server/spine/price-screen.ts` asks for it through a lazy import, so nothing in the
spine depends on the new desk at load time. It is the one surface outside this directory the list
reaches, and it never touches the quote row. The list is answered again at the moment Ben looks,
not served as the draft left it: an entry `quote_readiness` wrote, recognised word for word against
`READINESS_WORDINGS`, is recomputed from the file, so a photo sent two turns after the draft stops
being asked for, while the intake model's own labels stand as written - including one that merely
opens with "photo", which the file cannot recompute. The stored fact is never rewritten - it
records what the draft was built without.

The quote delivery carries a first contact of its own on purpose. Where a form lead's
acknowledgement held for Ben and never went, the delivery is the first message they will ever
receive from us, and a bare quote link to a stranger is not one we would send: the door puts its
own `first_contact_ack` fixed line ahead of the composer's words, from the one registry of Ben's
fixed sentences (`desk/fixed-lines.ts`) like every other. It does not clear the acknowledgement
hold - that card stays Ben's until he answers it.

Four facts are Ben's, not the customer's: the three notifications carry the admin price screen link
and an internal note, and `ben_to_request` carries what the draft is missing. No guard reads what a
fact means, so they are kept out of the customer's
reply at the composer boundary - `INTERNAL_FACT_KEYS` and `customerVisibleFacts` in
`desk/case-file.ts`, used by `desk/composer.ts` for both the prompt and the ids it may cite
(`desk/composer.test.ts`). A new fact written for Ben's eyes belongs on that list the day it is
written.

### Driving Goal 4's checklist lines

The pipeline reads `test.instructions` from the default branch, so the scenarios are spelled out
here too. One thread on the comms-v2 door, in this order; the ready turn is the slow one
("Driving the door", below, says how long to allow for it).

| Line | Drive | Passes when |
|---|---|---|
| 4.1, 4.2 | `POST /start` with a job and a postcode in one message and no photo ("my kitchen mixer tap is dripping at the base and needs replacing, NG9 2AB") | the reply carries no figure, `state.conversation.stage` is `ready`, `state.quote.slug` is set, and the planned send's summary contains `quoting: drafted` |
| 4.3 | `GET /quote` | `state.quote.notifications` holds exactly one `ready_to_price` whose link is `/admin/price/<slug>`; the record is `draft` with every `pricePence` null |
| 4.4 | on the app's own comms-v2 door (the case file lives in that process), `POST /api/comms-v2/sandbox/start` with a job and a postcode and no photo, then open `/admin/price/<slug>` in the app as Ben | the screen shows a "To request" row naming what the draft is missing ("photo (asked once, none sent)"), read off the case file's internal `ben_to_request` fact through `quoting/ben-to-request.ts`; the `ready_to_price` notice names the same list and the fact is on the file. The quote row carries none of it on purpose: that row is served to anyone holding the quote's slug, so it is customer readable. The same list is on Ben's board card (`benToRequest` in Goal 2, below) |
| 4.5 | `POST /run`, then `POST /age {"hours": 5}`, then `POST /run` | the first note says "not due", the second "chase 1 recorded for Ben"; nothing reaches the customer on either pass |
| 5.2 | `POST /message` "Does that include a new tap?" | answered from the draft's scope with no figure (a money hold for Ben beside it is 2.7 still standing before the quote, not a failure) |
| a photo before 5.1 | `POST /message` as multipart with a photo and "here is the tap" | the reply thanks for it once, the media ledger reads thanked, and the photo joins the draft |
| a shut window at 5.1 | `POST /age {"hours": 25}`, then `POST /price {}` | held for Ben, nothing sent, the hold names the shut window and the missing quote-link template, and `GET /quote` still reads `draft` with no `quote_line:` fact on the file. This is the customer's own WhatsApp thread, which the delivery keeps: only a WhatsApp record nobody has written on is skipped for another channel. Then `POST /message` "any news on the quote?" to reopen the window before 5.1 |
| 5.1 | `POST /price {}` | the planned send's approver is `human:ben`, the bubbles carry `/quote/<slug>` and no figure, every guard reads `pass` (the words are the desk's, so all eight ran), the stage is `quoted`, and `GET /quote` now reads `sent` with every line priced. The only card this send clears is the one it raised itself on the shut-window attempt above, and the release's words name that send, not the letter that went |
| 5.3 | `POST /message` "What does that include, and how much is that line?" | the figure equals the price of that line on the record to the penny (£x.xx), `factIds` names the `quote_line` fact carrying that figure, the figure guard passes, and this turn raises no new hold (a money card left standing from 5.2 is still Ben's: the delivery answers nothing but the link). Never ask about the labour or the materials: they are not lines of the quote, so any figure given for one is a figure the customer's quote does not state |
| a labour question after 5.3 | `POST /message` "How much of that is labour?" | held for ben with the money line and no labour or materials figure: how a line splits is money beyond a quote line. Naming the line's own total back is not a failure: any figure that does appear equals a line of the live quote to the penny |
| 2.7 after | `POST /message` "Can you do it any cheaper?" | held for Ben, reason names money beyond a quote line, and no figure that is not a line of the live quote to the penny: naming a line's own total back is not a failure, a discount or a reduced total is |
| a form lead nobody wrote back to | on a fresh thread `POST /start` with door `form`, `seed {"whatsapp": true}`, a job and a postcode, then `POST /price {}` | two shapes, both correct, and which one runs depends on whether the branch has an approved `web_form_ack` template; record which. Acknowledgement sent: the delivery is a delivery, on `sms` with the quote link, no hold and no release. Acknowledgement held for Ben: nothing had reached them, so the delivery opens with the desk's own `first_contact_ack` fixed line ahead of the link in the same message, with no figure, and the acknowledgement's card still stands for Ben afterwards (`hold` naming `web_form_ack`, no release). `GET /quote` reads `sent` either way |
| 6.2 | `POST /message` "Leave it with me, I'll get back to you next month", then `POST /run` | one acknowledgement with no question, then nothing |
| 6.1, 6.3 | `POST /accept`, then `POST /accept` again | `notice.title` "Quote accepted", stage `accepted`, an `accepted` notification recorded, and one acknowledgement whose only promise is that Ben has been told (no date, time or duration); the second answers 409 |

What the price screen shows for a v2 draft: the lines with the customer's own words, suggestions and
band, the photos on the draft. Nothing internal is on the row, in any field: the quote endpoint is
reachable by slug with no session, so what the draft is missing is a fact on the case file instead,
served to the price screen and, as `benToRequest`, to Ben's board card (Goal 2, below). The price
screen's thread pane, the "asked, none sent" pill and its send button read the old conversation and
messages tables, so they stay empty or refuse for a sandbox draft until cutover re-points them at
the case file; the door's `/price` is the send in the meantime.

## Goal 5: the Scheduling specialist and the diary read (`scheduling/`)

The specialist for dates and lead time, on the Scoping pattern: it states typical lead time and
confirms a date that is already booked, never offers a slot and never books one. Booking stays on
the quote's picker. Registered in the desk by one gather step (desk/desk.ts: the router's
`scheduling` subject, its `date_change` exception, or either belt, so a date change the router
missed still reaches the specialist and holds), voiced by the
composer from the specialist's notes (desk/composer.ts, "Notes from scheduling"), and mounted on
the door under `/scheduling` (desk/sandbox-door.ts). Nothing under server/spine/ is touched.

| File | What it is |
|---|---|
| `scheduling/diary.ts` | The diary read, read-only. The one authoritative booked date is `contractor_booking_requests.scheduled_date` (spans through shared/schedule-composition.expandSpanDates); the five quote-side columns on `personalized_quotes` (`selected_date`, `available_dates`, `date_time_preferences`, `flex_booking_within_days`, `slot_offer`) are preferences, never read. Lead time is new: the median days from a booking being made to its first booked day over completed bookings from the last 180 days, at most 100 rows, nothing below 5. Lead time counts calendar days, so a booking made on the morning of its visit is 0 rather than a discarded fraction. `liveDiary` opens the branch database on first use and every read refuses unless `COMMS_V2_DATABASE_URL` names the database actually open, so the door mounted on the production server reads no real diary; `MemoryDiary` for tests. |
| `scheduling/scheduling-tools.ts` | The shelf: `typical_lead_time` (nothing when the sample is too small, when the door fixture emptied the diary, or when the read fails; never a guess, and every refusal names a category only, the count staying on `sample`, because how many jobs the business has finished is not the customer's business), `confirm_booked_date` (the one entry point to the file's booking, for the confirmation and for the date-change belt alike, so the two can never disagree: the booking the file references, else the booking made from its quote, which is the newest from it that stands and, when none does, the newest that does not, so a visit cancelled off a customer who has no booking reference on their file is still seen; the diary is the only source it reads; refuses a declined, cancelled, done or past booking, a booking with no date, and a booking no contractor has taken on, giving no date at all, and its `state` says which, because they are not the same thing to the customer: `cancelled` is a visit taken off them that they may still be expecting, so a request to move it reaches Ben, and `unknown` is a diary that could not say, which holds for Ben too on a date question, because the reply has just promised him, unless nothing says there is a booking at all, no reference on the file, no stage of `booked` and none the read resolved from its quote, and the question is about availability or how soon, where a read that could not say is nothing known and the quote's picker answers as it would have; a question about the day they are booked for still holds for him, since telling somebody who has a day to pick one is the worse answer; only `none` answers as a thread with nothing to move, being a diary that never had a booking and a job already done or past, which is a new job rather than a change; the date and its row id are all it returns, never the slot or the number of days, because no guard can check a half of the day against the diary), `picker_link` (`/quote/<slug>`, the canonical customer quote URL the live sender uses, for a sent quote; refuses no quote, a draft, superseded, revoked or expired one, a quote the customer already has a booking from, standing or still waiting on a contractor, since the picker is where that date was chosen and picking again would make a second booking from the one quote, and a quote the diary could not say about on a file that names a booking, the booking it could not read being possibly that same one; a booking cancelled off them is not refused, because rebooking is what they need, and neither is one from an earlier quote. A refusal that is the right answer, a booking they have or a draft not yet sent, stays out of the run's error; every other one, the unreadable diary included, reaches the log and the run summary. The two refusals that mean the customer has no quote to pick dates on at all, none on the file and one still in draft, are marked `unsent`, and the specialist reads that mark rather than the reason for the cell "dates come with your quote" answers), and two belts: `dateChangeMatch` (a request to move a booked job holds whatever the models read; only `move` takes a bare "it", every other verb needs a date, day, booking, appointment, visit or slot as its object, so "bring it with you" is not a date change, and only the verbs of movement take the job itself, so "move the job" is a date while "change the job" is the work they want done) and `dateQuestionMatch` (an explicit date question the router missed still reaches the specialist: the question forms only, so a turn that merely mentions a booking it was booked in for is not one; when the classification never came back, the router's own `scheduling` subject stands in for it too, so a date question is never met with silence); both run at the desk's gate. Every date fact carries `{ kind: 'diary', rowId }`, which the date guard recognises only while this run looked it up: a fact from an earlier turn was true when it was written and the diary may have moved since, so the composer is not shown it either, rather than being offered a date the guard would then refuse. A bare ordinal ("the 2nd") is read as a day only beside a day and month the reply looked up, which is the paraphrase worth catching; on its own, or beside a lead time, it is the 1st floor or first fix, which the guard leaves alone. The picker link cites the quote. A read that fails refuses with a stable category (`the diary could not be read`), which the composer is never told either. No reason ever reaches the notes it reads (contracts.md, Contract 3): not a cancellation, not a revoked or expired quote, not a failed read, not a count of anything. The notes say there is no date, or no link, and to say nothing about why; every reason rides to the hold, the log line and the run summary alone. |
| `scheduling/scheduling-specialist.ts` | Sonnet 5 classifies what the newest turn asks (lead_time, availability, booked_date, date_change) and, for a change, their words; the tools decide the rest from the diary, and every ask is load-bearing: which shelf answers is chosen by what they asked, not by what the diary happens to hold, so somebody with a visit booked who asks how soon a new job could be done gets the lead time for that new one, with the day they already have confirmed beside it rather than instead of it and no picker, since they booked on this quote's picker already, and a turn that asks two things gets both, the booked date and the lead time together. On a thread whose job is already booked the lead time answers and the picker does not, and the day it stands on is mentioned beside it, since they did not ask to move it; a booking still waiting on a contractor withholds the picker the same way and holds for Ben, so they hear we know they booked and he hears the job is stuck in the pool. No reply that holds for Ben carries a picker link, in any state. One reading decides the confirmation and the picker's refusal alike (`isTheirBooking`), the booking being theirs and from the quote the file carries, or the read having failed on a file that names a booking, and the grid in contracts.md has the cell for every ask against every state the diary read can return. A diary that could not say is read that one way by the confirmation, the picker's refusal and the fallback alike, so an unreadable read cannot be answered one way when the classifier returns and the opposite way when it does not. The fallback is otherwise the wider guess rather than that reading: any state the diary did not plainly call `none`, a cancelled visit included, holds for Ben, since sending somebody whose visit was taken off them to the picker with nothing reaching Ben is the worse way to be wrong about a turn nobody could read. When there is no date to confirm the notes still hold for Ben and forbid a day of the desk's own, not the lead time the same turn looked up: "Ben will come back to you on the date" and "we're usually booking in about 3 days" are both true and both sourced. A turn that asks nothing about dates is left alone: no lead time, no picker, no fact. A classification that never came back is not the same thing: when the model call failed and the date-question belt matches the turn, the deterministic reading stands in, so a date question is never met with silence. A model that read no ask is taken at its word. Two rules fill the cells the diary left empty: "dates come with your quote" is for a file with no quote the customer has been sent, none on it at all or one still in draft, and nowhere else, since somebody holding a quote hears it as the desk not knowing who they are, and a cell with nothing to say about dates at all, no day of theirs, no lead time and no page to pick on, holds for Ben rather than answering a date question with silence. Returns facts by id, the fixed lines to include by kind (`dates_with_quote` where the customer has no quote they have been sent and the diary no lead time, `date_change_to_ben` on a change to a date the customer already has and wherever a date question would otherwise go unanswered), a proposal (the hold), and a brief for the composer naming which fact to copy verbatim. A change is the one ask that looks nothing else up: no lead time, no picker, only the booked date if the diary holds one. Asked what day we are coming about a job no contractor has taken on, it gives no date and holds for Ben, because only he can answer that. Never prose; the tests assert it. |
| `scheduling/fixture.ts`, `scheduling/scheduling-door.ts` | The door's fixture: seeds N completed bookings, a sent quote and one booked job on the drama number, hung on a synthetic contractor of its own rather than a real one on the branch (every row marked; `reset` deletes exactly those, the contractor included), links the current sandbox thread (quote reference, booking reference) and walks its stage to `quoted` or `booked`; `diary: 'none'` tells the lead-time read the diary holds no completed bookings, so the "dates come with your quote" path is drivable live against a branch that already has a diary. Every write refuses through the same branch check the diary reads through, so the fixture can only write the database the specialist may read; `/reset` on the door puts the diary mode back to `diary`, so a fresh thread always starts from the real diary. |

What the customer sees, from the diary only: during scoping a date question gets the typical lead
time when the diary has one ("we're usually booking in about 3 days") and "dates come with your
quote" when it does not; after the quote an availability question points at the picker; once
booked the date is confirmed from the diary when they ask for it, and a request to move it holds
for Ben (`date_change`) while the reply still answers everything else. Asking how soon, or what
dates are free, is answered by the lead time on a booked thread as on any other, because the
question they asked is about a new job, not the one already in the diary; the day that one stands
on is confirmed beside the answer, so the reply reads as knowing they booked. A hold on a date change is not a fixed-line hold:
later turns still get the desk.

The date-change gate is deliberately loose: the desk passes the router's `date_change` exception
into the specialist, which then reads the turn as a change to a job the customer already has
whether or not the diary could find a standing booking. Nothing outside the door's fixture writes a
booking reference onto a case file yet, so a real customer asking to move a real visit would
otherwise be answered as if they were asking when we could come. On that path nothing else is
looked up: no typical lead time, no picker link, only the booked date if the diary happens to hold
one, the fixed line that Ben will come back on the date, and the rest of what they asked. A hold on
a job that turned out not to be booked is a harmless false positive; the missed one is not. Once
the desk can resolve a booking from the party itself, the gate tightens back to a standing booking.

## Goal 6: the Service specialist and its tool server (`service/`)

The specialist for facts and aftercare (docs/comms-v2/design.md, "Who handles what"; the tool server
is in docs/comms-v2/contracts.md). It answers only from a reviewed knowledge-base row, cited by id and
verbatim, or the customer's own record, and holds on everything else. The desk runs it beside Scoping:
its deterministic tools every turn, its model when the router sends the turn to `service`, or when
the customer's own words ask to change a detail on their record, whatever the router read.

| Piece | File | What it is |
|---|---|---|
| the tool server | `service/service-tools.ts` | `kbLookup` (the desk's one knowledge-base selector: reviewed rows by question, verbatim, read through `desk/scoping-tools.ts` `reviewedKb`, which wraps the old store's reviewed-only read; may return nothing), `customerRecord` (this party's own details from the file; `MASKED_FIELDS`, the email and address, reach the model only as held), `changeOfDetails` (a fact and a hold for Ben, when the new value can be read from the customer's own words; the record is never written here; for the email or address the fact names only the field and the value goes only to Ben's card; when no value can be read, a hold stands with no fact), `convergence` (JOB_ASKS_MAX job asks with no job type, or SCOPING_REPLIES_MAX replies while a job is being scoped and the file is not ready, is not converging; both counted since the last release, the replies only from when scoping began (`scopingFrom` on the file), so a facts-and-aftercare thread never counts until it turns to a job). |
| the specialist | `service/service-specialist.ts` | Sonnet 5 returns selections only: which looked-up row answers which question by id, which record field, a requested change, a complaint, refund or trust doubt. The tool server checks each selection (an id it did not return is no source), records each answer as a fact whose value is the row's body verbatim, and writes the composer's brief. Never a sentence for the customer. The model sees the customer's name and phone, and only that an email or address is held, never its value, so a customer asking what we hold for either holds for Ben as `no_source` with that reason on his card. |
| the hold vocabulary | `service/hold-reasons.ts`, `desk/fixed-lines.ts` | `HoldException` (desk/router.ts) is the router's exceptions plus `no_source`, `not_converging`, `change_of_details`; `callback` joins the router's own. Fixed line only (no composer, no specialist until Ben releases): complaint, refund, trust doubt, gas, not converging. Answer the rest (the fixed line rides in the reply): money, date change, callback, no source, change of details. Goal 6's lines are checklist wording and send live; only the four Ben reviews are read from the knowledge base. |
| return to automation | `desk/human-reply.ts`, `service/return-to-automation.ts` | One path for a human's reply: `humanReply` sends the words through the one sender under a `human:<person>` approver on the thread's own channel, records what they asked on the ask ledger, and releases the hold with those words. Ben's board and the door's "Ben replies" both call it; `automationState` reads where the thread is. The release records how many turns the thread had (`turnsBefore`) and each subject's ask count (`asksBefore`), so `convergence` counts both replies and job asks from there and a released thread can make progress; the ledger itself is untouched, so a subject is still never asked twice. The kanban (Goal 2) can also release the hold directly, which brings the thread back to automation without posting Ben's words to the customer. |
| Ben's chase | `service/chase.ts`, `desk/sender.ts` `initiate` | On the desk's clock pass a held thread chases Ben after one interval and the owner after a second, each a template send through `initiate` (template only, approver and run id, never freeform, never on the thread; the run id is spent on the file; a live pass carries the chase's own purpose to the deliverer and a refused delivery is on the record; nothing runs it live until cutover). Intervals and addresses are configuration (a missing address is a refusal on the record, never a silent skip); the door sets test values and drama numbers, and production values land at cutover with the caller that reads them. The two templates are defined in `chase.ts` and have not been submitted to Meta; approval is read from the live sync by name like any other. |
| the fixture | `service/fixture.ts` | Reviewed and unreviewed knowledge-base rows (`sandbox-kb-*`, reviewed as `human:sandbox-fixture`) written through the old store's own admin writes, and the two chase templates marked approved in the sync cache with a sandbox content SID. Branch database only; refused on production. |
| the door actions | `service/service-door.ts` | Mounted by `desk/sandbox-door.ts`: `POST /fixture`, `POST /ben-replies` (`{ text }`; the approver is the signed-in session's slot, never the body, so an unlisted session gets 403; the standalone door host has no session and runs as Ben), `POST /chase-intervals` (`{ chaseAfterMinutes, escalateAfterMinutes }`), `GET /chase`. Every `/run` response carries `chase`; the state carries `automation` and `chase`. |

## Driving the door

```
npm run comms-v2:door                 # serve the desk's sandbox door on a loopback port until interrupted; prints the URL once
npm run comms-v2:door -- --port 4747  # a fixed port
```

Then over HTTP at the printed URL: `POST /start` (`{ door, text, name, seed }`; the door is
`whatsapp`, `sms`, `form` (with `postcode?`, `email?`), `email` (with `subject?`) or `call` (with
`outcome: 'missed' | 'answered_inbound' | 'ben_rang'`, `transcript?`, `durationSeconds?`); the seed
being `customer: 'known'`, `prefersText`, `alreadyRung`, `whatsapp: true | false` (the number is
known to be on WhatsApp, or not), `facts`, `ledger`), `POST /message` (`{ text, channel: 'whatsapp'
| 'sms' | 'email', subject? }`, or multipart with `media` files on whatsapp and email), `POST /call`
(`{ transcript, outcome?, durationSeconds? }`: Ben rings them on the current thread), `POST /run` (a
clock pass; the unpriced-quote chase fires here once due), `POST /age` (`{ hours }`), `POST /reset`,
`GET /` (the thread and the case file; `state.quote` is the quote as the file records it, with Ben's
recorded pushes). Goal 4 adds `POST /price` (`{}` for the chain's suggestions, or
`{ lines: [{ lineId, finalPence }] }`), `POST /accept` and `GET /quote`. Every response carries
`plannedSend` and `state`; the planned send names the `approver`, and an email turn adds `email`
(the reply's subject and thread headers). The
ready turn runs the estimator and the pricing engine before it replies, so allow up to two minutes
for it. The drama customer is one person on every door: the sandbox phone and the sandbox
email (`sandbox-customer@example.invalid`) are linked, so a form, an SMS, an email and a call are
one thread (channels/channel-doors.ts).

Goal 5 adds `POST /scheduling/fixture`
(`{ completed: N, quote: true, booked: true, diary: 'diary' | 'none' }`: seed the diary on the
sandbox number and link the current thread, after `/start` with the job type and location in the
opening message) and `POST /scheduling/fixture/reset`. The seed answers with what it seeded, what
it linked and the diary mode; the reset with what it deleted and the mode back to the diary, which
is everything the scenarios below need.

The Goal 5 scenarios, each after `/start` with an opening message that names the job and a
postcode (`"Hi, my kitchen tap is dripping, NG9 2AB"`):

- 2.6 replaced, diary has a lead time: `/scheduling/fixture` `{ "completed": 6 }` (the branch diary
  may hold too few completed bookings of its own), then `/message` "When can you come?"; the planned
  send carries a `lead_time` fact with a `diary` source, the bubble copies its value, every guard
  passes.
- 2.6 replaced, no lead time: `/scheduling/fixture` `{ "diary": "none" }`, then the same question;
  the bubble carries "Dates come with your quote" and no lead time, day or time; `factIds` empty.
- 5.4: `/scheduling/fixture` `{ "quote": true }` (stage becomes `quoted`), then "What dates do you
  have?"; the bubble carries the `/quote/<slug>` picker link, no day or slot is offered.
- 5.5: `/scheduling/fixture` `{ "booked": true }` (stage becomes `booked`), then "Can we move it to
  the week after?"; the planned send holds for `ben` with reason `date_change: ...`, the bubbles
  carry "Ben will come back to you on the date" and the booked date read from the diary.
- Then `/scheduling/fixture/reset`.

The door has no session, so it has no answer action of its own: Ben's reply goes through the
board's authenticated route, which only his approver slot may call.

Goal 6 adds `POST /fixture`, `POST /ben-replies`, `POST /chase-intervals` and `GET /chase`
(above): the chase is driven with `/chase-intervals`, then `/age` and `/run`, and "Ben replies"
brings a held thread back to automation.

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
| the board | `api/board.ts` | `GET /board`: one column per Contract 2 stage, exactly the seven; each card is one file (customer, job type and location once known, last customer message and when, reply channel, mode, and `benToRequest` - what the draft is missing, read off the file's internal `ben_to_request` fact through `quoting/ben-to-request.ts`, empty once nothing is outstanding). Held cards float to the top of their column with the hold reason and approver. Filters `?held=true` and `?mode=sandbox\|live`; a file is `live` once any send on it delivered, `sandbox` otherwise. `GET /case-files/:id` is the file's turns and facts, read-only. |
| release | `api/routes.ts`, `api/approvers.ts` | `POST /case-files/:id/release { words }` calls the case file's own `release`, which enforces the approver-and-words invariant; the route only carries the words and names who is asking. The approver is the slot the signed-in session occupies, never the request body: the app_settings row keyed `comms_v2_approvers` maps slot to user ids (`{ "ben": ["<user id>"] }`, the insert SQL is in `approvers.ts`). A session no slot lists gets 403; with no row nobody can release. Fail closed: an unreadable row assigns nobody. |
| answer | `api/routes.ts`, `desk/human-reply.ts` | `POST /case-files/:id/answer { words }` sends Ben's own reply through the one sender (`desk/human-reply.ts`), on any card, held or not. Same session rules as release: 401 with no session, 403 with no slot, 400 with no words, 404 on an unknown file; this is the only answer path, so no unlisted session can answer as him. A session whose slot is not the file's own approver is refused 409, held or not, so a slot minted for one thread cannot answer another. The guards do not run over his words (answer 43); a refusal from the sender, a shut window, a reply over the bubble ceiling or an SMS over two segments, is 409 with its reason and nothing is sent, and a send returns the card, the approver the send carried, the bubbles that went, and the release the words cleared. |
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
store and every writing path in the desk asks the same question again at the moment it would open
the database, in `live-database.ts`: the database in use must be the branch that variable names,
and a refusal names that requirement and falls back to nothing. That is what the door host gives
for free and the deployed server does not: `/api/comms-v2/sandbox` is mounted there for Ben's
board, on the production database, where the quote machinery would otherwise write a real quote row
and publish a quote page with real prices. Writing is the whole subject, so the reviewed
knowledge-base readers and Ben's board reading its own `comms_v2_approvers` row do not ask
(contracts.md, Contract 7, "Which database the tools open", has why). Cutover replaces this with
the desk switch. The pipeline's run copies inherit a non-production environment through direnv from
their run root (see `.no-mistakes.yaml`, `test.instructions`); a developer's shell carries its own.
Nothing in the desk loads a file of its own or prints a value.

## Tests

`npx vitest run server/comms-v2`: every invariant in the contracts with a scripted model client,
the door driven over HTTP the way the test step drives it, the door host's refusal rules, the
database refusal every live writer makes (`live-database.test.ts`, including each method of the
live quote store on a production-shaped connection), a person's reply through the one sender with
no guards over it, and the board's queries, approver mapping and routes. The page's own test is
`npx vitest run --project client client/src/pages/admin/__tests__/CommsV2BoardPage.test.tsx`.
None of them needs a key or a database; a live desk test reads its keys from the environment.
