# server/comms-v2

The clean-sheet comms desk (docs/comms-v2/). Nothing here touches server/spine/ or server/agents/;
the old desk stays live as rollback until the new one is proven and cut over.

## Goal 1: the desk, skeleton plus Scoping, WhatsApp only (`desk/`)

Contracts 1 to 6 (docs/comms-v2/contracts.md), one file per contract. Case files live in memory
for the length of the process (the sandbox door runs in process); a durable store implements
`store.ts`'s interface later. Ben's kanban (Goal 2, below) reads the in-process one for now.

| Contract | File | What it is |
|---|---|---|
| 1 Identity | `desk/identity.ts` | `resolve`, `canonical`, `link`, `registerInternal`. Keys are `phone:<national>` or `email:<lowercase>`, the convention the customer record already uses (server/clients.ts); the E.164 form is the channel address. Candidates mean no reply, and a key the turn only asserts (the form's typed email) names candidates for Ben rather than binding to that person; only the address the turn arrived on, or a key the business already holds for them, binds. Only `homeowner` and `internal` are live. |
| 2 Case file | `desk/case-file.ts`, `desk/store.ts` | One file per job with parties, append-only turns, the seven stages through `setStage`, facts refused without a source, the ask ledger (asked, answered, thanked), the hold as a flag with a named approver, sends with run id and approver and the model calls behind them. `invariantViolations` is the contract's invariants paragraph as one check. |
| gateway | `desk/whatsapp-adapter.ts`, `desk/gateway.ts` | Twilio and Meta webhook shapes to one turn, media downloaded on arrival on both paths; the door hands bytes over. The gateway resolves identity, opens or appends to the one file, hands the turn to the desk; clock and age enter here too. Not wired to a live webhook yet (cutover, behaviour.md answer 37). |
| 3 Router, composer | `desk/router.ts`, `desk/composer.ts`, `desk/models.ts` | Haiku 4.5 routes (structured output, two deterministic belts under it: regulated and money); Fable 5.1 at medium effort composes one reply from facts on the file, a blank line where a bubble breaks. Every call records model, tokens and cost (`ModelCallRecord`). Haiku takes no effort control; "low" is the recorded intent. |
| 4 Guards | `desk/guards.ts`, `desk/lexicon.ts` | The eight guards, no model. Pass, one retry to the composer with the failures named, then a hold with the fixed acknowledgement. `approverFor` is the slot: Ben for a homeowner, a rule-based approver for a tenant issue with no rules yet. |
| 5 Sender | `desk/sender.ts` | `chooseChannel` (the channel they wrote on; a form or a call opens WhatsApp, then SMS, then email; an SMS with the WhatsApp window open is answered there), `windowOf` (no recorded state is shut), `render` (per channel: WhatsApp bubbles, SMS one message, email a letter, the last two in channels/; blank lines, then sentence boundaries over ~300 characters, soft ceiling of four back to the composer, typing gaps 1 to 3 s; `asTyped` is the human path, where a blank line still breaks a bubble and nothing inside one is reflowed), `pickTemplate` on a shut window by purpose (named by server/window-templates.ts, approved and given its content SID by server/whatsapp-template-sync.ts) with a hold when none is approved; `templateWire` shapes it for the transport the customer wrote on, Twilio's content SID and variables or Meta's name, language and body components, `send` (dry run lands the reply on the thread as an outbound turn; live goes through server/outbound.ts as `agent.comms_v2`, switch key `comms_v2`, which the desk treats as off until `spine.senders.comms_v2.enabled` is written true; a default for one of the four fixed lines that are Ben's to review sends in dry run only, the Goal 1 lines send live; a live delivery that fails part way records the bubbles that went as a partial send), `initiate` present and unused. |
| 6 Scoping | `desk/scoping-tools.ts`, `desk/scoping-specialist.ts` | The shelf: describe_media (Gemini via server/spine/tools/describe-video.ts, once per media), confirm_location, readiness (job type and location; photos optional), next_question (job, location, access, photos; photos once), offer_call, regulated (gas and asbestos only), kb_lookup (reviewed rows, read-only). The specialist on Sonnet 5 returns facts with the turn they came from and short labels of what is unknown; the proposal comes from the tools. Never prose. |
| the desk | `desk/desk.ts`, `desk/fixed-lines.ts` | route, gather, compose, guards, render, window, send, then the ledger and the stage from what the business itself said: an approved template's own wording with its placeholders unfilled, never the enquiry a filled body quotes back, and the composed reply, never the greeting and sign-off the renderer wraps it in. Money and date changes hold for Ben and the reply answers the rest; complaints, refunds, trust doubts and gas send one fixed line and no composer runs, and while that hold stands no specialist runs either: each later turn gets the short acknowledgement that Ben will come back; a composer refusal or failure, or a reply the sender refuses (live, one of Ben's four lines he has not reviewed), takes that same acknowledgement. A clock pass never sends. The four fixed lines come from the knowledge base when reviewed, else the defaults here. |
| a person's reply | `desk/human-reply.ts` | `humanReply`: Ben's own words from the board out through the one sender. The eight guards never run over them (behaviour.md answer 43): they gate a composed reply so the composer cannot invent what Ben himself is the source of. No send record claims otherwise: the `human:<their email or user id>` approver on the send is the record of which person wrote the words, so a slot two people share still answers that question, and guard results are not persisted on any send, so nothing anywhere reads as a pass no guard gave. Only the slot the file answers to may answer it: the approver its hold names while one stands, `approverFor`'s slot otherwise, so a session holding another slot is refused even on an unheld file. A human reply is not checked, but it is recorded: the ask ledger and `callOffered` are bookkeeping of what the business has already said, not a check on what may go, so the desk does not ask twice for a photo he has just asked for (`clauseAsks`) or offer a call he has just promised (`offersCall`). His prose is read more tightly than a composed reply: the subject word and the asking phrase must fall in one clause, so an ambiguous line records nothing and the desk asks again, rather than "I will be in touch later today, what is the best number for you?" marking access asked and no one ever asking about it. What still holds is what the sender owns: the sender renders and sends with approver `human:<their email or user id>` and a fresh run id, his line breaks inside a bubble kept as typed while a blank line still starts a new one, one run id sends once, the party must be on the file, and a shut window never carries his freeform words. A refusal speaks the refusing channel's own measure: an SMS over the two segments one text message may use says so in segments and characters, never in bubbles. The send lands as his turn, any hold clears with his words as the release, and the thread is automation's again (checklist 7.4). A refusal sends and records nothing and comes back with its reason for the board to show. |
| the door | `desk/sandbox-door.ts`, `desk/planned-send.ts` | start, message (multipart media), run, age, reset, state. Every response carries the planned send the desk emits itself (case id, party, channel, window state, template id, bubbles, fact and knowledge-base ids, every guard's result, approver, run id, hold, delivered), typed with a zod schema; `plannedSendOfResponse` is the one way a reader takes it and `sendLanded` checks the reply is on the thread. The SMS, form, email and call doors are mounted in front (channels/channel-doors.ts); price answers 409 until Goal 4. |
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
| Web form | `channels/form-adapter.ts` | Name, phone, email, the job, postcode, sometimes photos (bytes). Creates the file; the postcode and name are facts at intake; the job type is Scoping's to establish | No reply path of its own: `chooseChannel` opens WhatsApp if the number is on it (the approved web form template, quoting the enquiry, 1.2; the row without the call offer when they have already rung us, 1.5), else SMS, else email. |
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
intake must have before it reads one live turn, and both entries are outstanding: a persistent case
file store, because the desk's store holds every file, turn, media path and model call for the
length of the process, which is right for the sandbox door host and wrong for a server that runs for
weeks; and a populated internal-number directory, because the identity here has never been told
which numbers are ours, so Ben's own handset would resolve as a customer. Until both land the
gateway refuses to be built and every forward logs what is missing. The persistence task is the one
that lifts the first; server/internal-numbers.ts already holds the numbers for the second.

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
| `scheduling/scheduling-tools.ts` | The shelf: `typical_lead_time` (nothing when the sample is too small, when the door fixture emptied the diary, or when the read fails; never a guess, and every refusal names a category only, the count staying on `sample`, because how many jobs the business has finished is not the customer's business), `confirm_booked_date` (the one entry point to the file's booking, for the confirmation and for the date-change belt alike, so the two can never disagree: the booking the file references, else the booking made from its quote, which is the newest from it that stands and, when none does, the newest that does not, so a visit cancelled off a customer who has no booking reference on their file is still seen; the diary is the only source it reads; refuses a declined, cancelled, done or past booking, a booking with no date, and a booking no contractor has taken on, giving no date at all, and its `state` says which, because they are not the same thing to the customer: `cancelled` is a visit taken off them that they may still be expecting, so a request to move it reaches Ben, and `unknown` is a diary that could not say, which holds for Ben too on a date question, because the reply has just promised him, unless nothing on the file says there is a booking at all, where a read that threw is nothing known and the quote's picker answers as it would have; only `none` answers as a thread with nothing to move, being a diary that never had a booking and a job already done or past, which is a new job rather than a change; the date and its row id are all it returns, never the slot or the number of days, because no guard can check a half of the day against the diary), `picker_link` (`/quote/<slug>`, the canonical customer quote URL the live sender uses, for a sent quote; refuses no quote, a draft, superseded, revoked or expired one), and two belts: `dateChangeMatch` (a request to move a booked job holds whatever the models read; only `move` takes a bare "it", every other verb needs a date, day, booking, appointment, visit, job or slot as its object, so "bring it with you" is not a date change) and `dateQuestionMatch` (an explicit date question the router missed still reaches the specialist: the question forms only, so a turn that merely mentions a booking it was booked in for is not one); both run at the desk's gate. Every date fact carries `{ kind: 'diary', rowId }`, which the date guard recognises only while this run looked it up: a fact from an earlier turn was true when it was written and the diary may have moved since. The picker link cites the quote. A read that fails refuses with a stable category (`the diary could not be read`), which the composer is never told either: why there is no date to confirm, a cancellation above all, is Ben's to give in his own words, so the brief says only that there is none. Both the category and the machine text ride to the log line and the run summary alone. |
| `scheduling/scheduling-specialist.ts` | Sonnet 5 classifies what the newest turn asks (lead_time, availability, booked_date, date_change) and, for a change, their words; the tools decide the rest from the diary. A turn that asks nothing about dates is left alone: no lead time, no picker, no fact. A classification that never came back is not the same thing: when the model call failed and the date-question belt matches the turn, the deterministic reading stands in, so a date question is never met with silence. A model that read no ask is taken at its word. Returns facts by id, the fixed lines to include by kind (`dates_with_quote` when the diary has no lead time, `date_change_to_ben` on a change to a date the customer already has), a proposal (the hold), and a brief for the composer naming which fact to copy verbatim. A change is the one ask that looks nothing else up: no lead time, no picker, only the booked date if the diary holds one. Asked what day we are coming about a job no contractor has taken on, it gives no date and holds for Ben, because only he can answer that. Never prose; the tests assert it. |
| `scheduling/fixture.ts`, `scheduling/scheduling-door.ts` | The door's fixture: seeds N completed bookings, a sent quote and one booked job on the drama number, hung on a synthetic contractor of its own rather than a real one on the branch (every row marked; `reset` deletes exactly those, the contractor included), links the current sandbox thread (quote reference, booking reference) and walks its stage to `quoted` or `booked`; `diary: 'none'` tells the lead-time read the diary holds no completed bookings, so the "dates come with your quote" path is drivable live against a branch that already has a diary. Every write refuses through the same branch check the diary reads through, so the fixture can only write the database the specialist may read; `/reset` on the door puts the diary mode back to `diary`, so a fresh thread always starts from the real diary. |

What the customer sees, from the diary only: during scoping a date question gets the typical lead
time when the diary has one ("we're usually booking in about 3 days") and "dates come with your
quote" when it does not; after the quote an availability question points at the picker; once
booked the date is confirmed from the diary, and a request to move it holds for Ben (`date_change`)
while the reply still answers everything else. A hold on a date change is not a fixed-line hold:
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
clock pass), `POST /age` (`{ hours }`), `POST /reset`, `GET /` (the thread and the case file). Every
response carries `plannedSend` and `state`; an email turn adds `email` (the reply's subject and
thread headers). The drama customer is one person on every door: the sandbox phone and the sandbox
email (`sandbox-customer@example.invalid`) are linked, so a form, an SMS, an email and a call are
one thread (channels/channel-doors.ts).

Goal 5 adds `POST /scheduling/fixture`
(`{ completed: N, quote: true, booked: true, diary: 'diary' | 'none' }`: seed the diary on the
sandbox number and link the current thread, after `/start` with the job type and location in the
opening message) and `POST /scheduling/fixture/reset`. Both answer with what they seeded, what
they linked and the diary mode, which is everything the scenarios below need.

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
door host refuses a missing value and a production one and never reads `DATABASE_URL`. The
pipeline's run copies inherit a non-production environment through direnv from their run root
(see `.no-mistakes.yaml`, `test.instructions`); a developer's shell carries its own. Nothing in the
desk loads a file of its own or prints a value.

## Tests

`npx vitest run server/comms-v2`: every invariant in the contracts with a scripted model client,
the door driven over HTTP the way the test step drives it, the door
host's refusal rules, a person's reply through the one sender with no guards over it, and the
board's queries, approver mapping and routes. The page's own test is
`npx vitest run --project client client/src/pages/admin/__tests__/CommsV2BoardPage.test.tsx`.
None of them needs a key or a database; a live desk test reads its keys from the environment.
