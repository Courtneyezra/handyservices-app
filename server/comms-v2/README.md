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
| 2 Case file | `desk/case-file.ts`, `desk/store.ts` | One file per job (a booked or done file is closed, and the person's next turn opens a new one) with parties, append-only turns, the seven stages through `setStage`, facts refused without a source, the ask ledger (asked, answered, thanked), the hold as a flag with a named approver, sends with run id and approver and the model calls behind them. `invariantViolations` is the contract's invariants paragraph as one check. |
| gateway | `desk/whatsapp-adapter.ts`, `desk/gateway.ts`, `desk/media-durability.ts` | Twilio and Meta webhook shapes to one turn, media downloaded on arrival on both paths; the door hands bytes over. Once a turn carrying media has landed on the file, in arrival order, and before the desk reads it, the gateway mirrors each file to S3 through the old desk's path (`server/media-store.ts` `mirrorMediaToS3`, key `chat-media/<file>`, the name in the turn's `/api/media/<file>` url), so the `/api/media/:file` route restores it after a deploy wipes the disk; a file the mirror refuses twice still lands, recorded `TurnMedia.stored: 'local_only'`, logged at error level and shown in the thread as a failure. A turn carrying media keeps the provider's message id (`Turn.providerMessageId`), so a lost item can be traced to the provider's copy and the old desk's copy of the same message; the media route's 404 says `no-store`, so a file restored later is not held broken by a cached miss. Media already on a box when this landed is preserved only by running `scripts/mirror-v2-media.mjs` on that box before the next deploy, a separately authorised step. A voice note, document or contact card is named on the turn (`Turn.unopened`), so the thread reads "1 voice note sent, which you cannot open" rather than a photo that failed to arrive; a shared location becomes the turn's text with its place name and address. The gateway resolves identity, opens or appends to the one file, hands the turn to the desk; clock and age enter here too. One reply per customer turn, not per message (`desk/turn-window.ts`): every message lands on the file as it arrives, but a text or photo on WhatsApp or SMS goes to the desk only once that party has been quiet on the channel for `CUSTOMER_TURN_QUIET_MS` (8 s, the old desk's debounce default, approved 15 Sep 2026), and the messages inside the window go together as one turn, marked `>>` together in every prompt's thread. A form, email, call or portal action goes at once, after what that party still had waiting. The desk runs on one file one pass at a time, clock passes included. The door and the live intake use the window; a gateway built without `quietMs` gives every message its own turn. The window is timed in the gateway's memory, so each burst is also recorded on the file as a wait (`TurnWait` on `waits`: its messages, when it falls due, and the gateway holding it, one per process) from its first message until the desk pass that answers it has finished; the wait comes off in the same put that lands the reply. A clock pass (`clock`, below) leaves alone every wait this gateway holds, still timing or being answered, and hands each wait another gateway left behind to the desk once it is due, once each, as a live burst flushes: a restart mid-window or mid-pass loses no message. A live message on the same party's channel takes such a wait into its fresh burst, so both draw one reply, and a turn that does not wait goes after it. A reply the desk writes records the messages it answered (`Turn.answers`), so recovery skips messages a reply already answered, and the one-reply guard (`customerTurnUnanswered`) counts a message that landed while the previous reply was being written, and that the reply did not answer, as a turn in between: the follow-up that answers it sends, and a second reply to an answered turn is still refused. A burst's pass takes its turn when it starts, not when the burst closed (`foldQueued`, the Kiran thread of 16 Sep 2026): the messages of this wait no reply has answered since, and every later burst of the same party on the channel already queued behind it, go as one turn; a queued burst taken in that way finds nothing left when its own pass starts and sends nothing (`decision: none`, note "already answered"). Not wired to a live webhook yet (cutover, behaviour.md answer 37). |
| 3 Router, composer | `desk/router.ts`, `desk/composer.ts`, `desk/models.ts` | Haiku 4.5 routes (structured output, two deterministic belts under it: regulated and money, each adding to what the model read rather than displacing it, so `exceptions` is a list, gravest first; a call request is the router's own reading, with no belt); Fable 5.1 at medium effort composes one reply from facts on the file, a blank line where a bubble breaks. Every call records model, tokens and cost (`ModelCallRecord`). Haiku takes no effort control; "low" is the recorded intent. |
| 4 Guards | `desk/guards.ts`, `desk/lexicon.ts` | The eight guards, no model. The business-claim guard carries the verbatim rail above its lexicon: every knowledge-base row the reply cites, by id or through a fact, must be a reviewed row whose body the reply carries word for word, whatever the reply is about. Pass, one retry to the composer with the failures named, then a hold with the fixed acknowledgement. `approverFor` is the slot: Ben for a homeowner, a rule-based approver for a tenant issue with no rules yet. |
| 5 Sender | `desk/sender.ts` | `chooseChannel` (the channel they wrote on; a form or a call opens WhatsApp, then SMS, then email; an SMS with the WhatsApp window open is answered there), `windowOf` (no recorded state is shut), `render` (per channel: WhatsApp bubbles, SMS one message, email a letter, the last two in channels/; blank lines, then sentence boundaries over about 160 characters with one or two sentences a bubble and a sentence still over it cut at a comma, never mid-phrase (a short form such as "e.g.", "hrs." or "a.m." never ends a bubble, and a numbered list item keeps its line break and its number; on WhatsApp and SMS a "-", "•" or "*" bulleted list becomes one sentence of comma-joined items, `bulletsAsProse` in desk/dashes.ts, so no hyphen is left as punctuation), at most three bubbles; over three it goes back to the composer to shorten once, and only a shortened reply still over three is split again at 200 (`softWidth`, logged); a shorten that fails the guards or still runs over at 200 falls back to the guarded reply split at 200, and only a reply over three even then holds (behaviour.md answer 93), typing gaps of roughly each bubble's typing time, 30 ms a character from 2.5 to 7 s (answer 91; the 8 s quiet window is not this); `wideBubbles` keeps the old 300-character split, still at most three bubbles, for one of Ben's fixed lines sent on its own, the held acknowledgement, and a quote delivery that cannot fit three 160-character bubbles (one that cannot fit three wide ones holds); `asTyped` is the human path, where a blank line still breaks a bubble, nothing inside one is reflowed, and the gaps of 1 to 3 s stay as they were, under the same ceiling of three), `pickTemplate` on a shut window by purpose (named by server/window-templates.ts, approved and given its content SID by server/whatsapp-template-sync.ts) with a hold when none is approved; `templateWire` shapes it for the transport the customer wrote on, Twilio's content SID and variables or Meta's name, language and body components, `send` (dry run lands the reply on the thread as an outbound turn; live goes through server/outbound.ts as `agent.comms_v2`, switch key `comms_v2`, which the desk treats as off until `spine.senders.comms_v2.enabled` is written true; that desk switch gates every live send whoever licensed it, a `human:*` send included although its registry row has no switch key, and an approver row with a key of its own must have that switch on as well; a default for one of the four fixed lines that are Ben's to review sends in dry run only, the Goal 1 lines send live; before any send the live deliverer asks the opt-out ledger about every address the party has written to us on, phone and email (`provenAddresses`; an address only typed into the web form proves nothing and is never asked about, answer 126), so an opt-out on one channel stops a send on every other; a live delivery that fails part way records the bubbles that went as a partial send), `initiate`, the desk-started template send Ben's chase uses (Goal 6): live, it goes through the same deliverer and gates as a reply but carries its own purpose, so `outboundLabelFor` sends a chase or an escalation as the fail-closed `marketing` class at the opt-out ledger under the context `comms_v2:<purpose>`, never as a customer `service_reply`; the live clock calls it live once the switch-over switches are on (`channels/live-clock.ts`). |
| 6 Scoping | `desk/scoping-tools.ts`, `desk/scoping-specialist.ts` | The shelf: describe_media (Gemini via server/spine/tools/describe-video.ts, once per media, a turn's photos described together; the composer is shown only the plain opening of each description, `lightPhotoSummary`, with any word read off the photo that no customer typed (`unmentionedPhotoText`) taken out of it and out of the job details, so a reply mentions one light detail and never a defect, a brand or what is not shown, behaviour.md answer 92, and a defect seen only in a photo is not a job detail; the router and composer threads name each kind a turn carried, `mediaCountLabel`, so a photo and a video in one turn read as "1 photo and 1 video", never as two photos; one the vision model could not describe reads "not seen by you", and when nothing on the thread was described the composer is told to thank for it without saying what it shows), confirm_location, readiness (job type and location; photos optional), next_question (job, location, access, photos; photos once), offer_call, regulated (gas and asbestos only; a combi or a pilot light counts as gas, a combi oven or drill does not, and a flue only beside a gas word, so a wood burner's flue is ours). The specialist on Sonnet 5 returns facts with the turn they came from and short labels of what is unknown; the proposal comes from the tools. Never prose. |
| the desk | `desk/desk.ts`, `desk/fixed-lines.ts` | A turn that is an opt-out (`detectOptOut`, server/opt-out-detect.ts: a plain STOP or "do not contact me") gets no reply and no model call; each message of a burst is read on its own, as the old inbound path reads it, so "No thanks" then "STOP" in one quiet window is an opt-out, and a call transcript is read sentence by sentence, cut at commas and at "so", "but" and "and", leaving out our labelled side of the call, and an email is read both whole and as the message on its own, without the `Subject:` line the adapter puts in front of it (`withoutEmailSubject`), so a bare "STOP" under a real subject is still the terse instruction it is. Only on the channels whose opt-out the old inbound path records in the ledger (server/agents/comms-lanes.ts gate 0), the allow-list `OPT_OUT_RECORDED_ON` (SMS, WhatsApp), is that all; on every other turn (a call transcript, an email, a web form with or without a phone, any channel added later) it also holds for Ben with the channel named ("customer may have asked to stop on a call; check and record the opt-out"), so a transcript that trips on Ben's own words lands with him rather than silently. While that opt-out hold stands the thread stays silent on every later turn too (`optOutHeld`): no specialist reads it, no reply is composed and nothing is sent, and the card records why, because someone who asked us to stop is not written to again whatever the opt-out ledger says yet. It is read ahead of an exception hold and is graver, so a thread held on a complaint as well gets no acknowledgement either. A close does not end it: a file that closes while it stands (a booked or a done job) passes it to the file that person's next message opens (`carryOptOutHold`), so the silence ends where the hold does, with the person it is for; their newest file alone is read, so a hold released is not raised again. Only the fact travels: the new card is written there, naming the file the opt-out is recorded on, because the earlier card's own words - a complaint, and whatever the customer said in it - belong to that thread and never to a fresh file about another job. Otherwise route, gather, compose, guards, render, window, send, then the ledger and the stage from what the business itself said: an approved template's own wording with its placeholders unfilled, never the enquiry a filled body quotes back, and the composed reply, never the greeting and sign-off the renderer wraps it in; the question Scoping proposed is spent only by a question about the job or that subject (`asksProposed`), never by a call offer or a question for a different subject, so a reply whose only question asks for a photo leaves access still to ask; a reply offering a call to a party who prefers text or has already rung goes back to the composer once unless the turn itself asks for a call (`asksForCall`, which does not read "please don't call me" as asking); a reply that asks a question on a short pause ("one sec"), a promise of more or a not-ready turn goes back to the composer once and holds for Ben if it asks again; the thanks for a photo is spent only where the words that went carried one, in any wording of gratitude rather than one that names the photo, because a thanks the ledger records but the reply never made leaves the photo unacknowledged for good. Money and date changes hold for Ben and the reply answers the rest; complaints, refunds, trust doubts and gas send one fixed line and no composer runs (regulated work not identified as gas sends nothing, see the hold vocabulary below), and while that hold stands no specialist runs either: each later turn gets the short acknowledgement that he will come back, in his own first person like every fixed line (none names Ben, the office or the team in the third person); a composer refusal or failure, or a reply the sender refuses (live, one of Ben's four lines he has not reviewed), takes that same acknowledgement, which names a photo or video the turn brought ("Thanks for the video, leave it with me...") and so spends its thanks, unless the file's media thanks is already spent, when it is the plain line so the ask-ledger guard never silences it; it stays a line that sends without Ben's review. A photo or video still unthanked that came in more than `LATE_MEDIA_MS` (30 minutes) before a turn with no media of its own, with no message to that party since, is thanked for in a line the desk adds after the composed reply, saying it came in earlier, yesterday or the other day and that the reply is late; the composer is told to leave it alone and sent back once if it thanks for it anyway. Once any message has gone to the party after the media (a fixed line, the held acknowledgement, Ben's own reply from the board), nobody thanks for it: neither the late line nor the composer. Media a minute before the text is still thanked for in the one covering reply. A clock pass never sends. The four fixed lines come from the knowledge base when reviewed, else the defaults here. Never a repeat of the previous message (behaviour.md answer 90, `desk/repeat.ts`): a reply that wraps up ("that's everything I need", the quote, price, estimate, cost or figure being put together, sent or dropped over, with them, on its way, coming their way, to follow, expected, in their inbox or being worked on, in any wording; a question never wraps up, nor does an answer about what the quote covers) when the business already wrapped up since it last asked the party anything (a closing offer such as "Anything else I can help with?" asks nothing) goes back to the composer once with the sentences named, and whatever it still repeats is taken out; a reply left with nothing sends nothing. A turn that asks a question is answered even with words already said, and a fixed line is never taken out. |
| model health | `desk/model-health.ts` | Whether the desk can answer, from the customer turns it ran. `Desk.handleTurn` gives each turn its own `TurnModelWatch` over the client and hands the verdict to `deps.modelHealth`, which the live intake alone sets (`channels/intake.ts` `intakeModelHealth`): a sandbox desk answers no customer, so its failures neither page nor move the health read, and it never writes the production row. Turns are recorded one at a time, under a transaction-scoped lock on the row, and a report older than the row's `lastTurnAt` is ignored, so an outage failing many customers at once pages once; each update is bounded (5 s in the process; Postgres caps its lock wait and idle time at 10 s so a stalled holder cannot drain the pool) and the page is sent after it without being waited on, so a slow page or a hung write holds up no turn; an update that outlives its bound sends the page it decided when it commits, and one that never commits pages nothing, leaving the next turn to decide against the row. A turn fails when a call got no answer from the provider (`StructuredResult.failure === 'provider'`: the request threw an `APIError`, whatever the status) or the router or composer came back with nothing other than a refusal; a throw that is not an `APIError` is the SDK parsing an answer that did come back against the schema we sent, so it is an unusable `output` and a specialist's is not an outage (`failureKindOf`, `desk/models.ts`); never on the error's words, which travel verbatim as the payload. The verdict is the `app_settings` row `comms_v2_model_health`, read without a model call by the unauthenticated `GET /api/health/comms-worker` (`status: "cannot_answer"`, and `desk` with only `status` and `canAnswer`, `publicCommsHealth`) and in full, the provider's words, the failed call and the turn times, by the admin `/admin/staff` payload; production pages on `worker_health` once an episode, hourly while it lasts, and once when a turn succeeds again. docs/RUNBOOK.md §4 Health. |
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
| SMS | `channels/sms-adapter.ts` | Twilio's inbound on the shared webhook (a bare `From`); media is refused, a UK long code cannot receive MMS, and the turn records how many never reached us (`Turn.mediaFailed`, as does a WhatsApp download that failed) so the router and composer read a photo that did not come through rather than an empty turn | `renderSms`: one message, at most two segments (GSM-7 or UCS-2 counted), typographic punctuation normalised; over two goes back to the composer. The composer is told up front to write no emoji or symbols, and a retry for a text made UCS-2 is told which characters did it (`ShortenBrief.wideChars`) and the GSM-7 room it gets back without them. A person's own words from the board go as typed, punctuation and line breaks untouched, with only the two-segment ceiling still refusing. A reply on SMS to a party who does not write on WhatsApp carries the fixed `move_to_whatsapp` line (1.4), spent on the ask ledger when the reply carrying it sends, so a reworded one still goes exactly once and an acknowledgement that held the thread for Ben does not spend it; a WhatsApp channel with no inbound turn on it, which is all the presence source proves, does not withhold it either. An SMS from a party whose WhatsApp window is open is answered on WhatsApp. |
| Email | `channels/email-adapter.ts`, `channels/resend-inbound.ts`, `channels/email-inbound.ts` | The sandbox door, and Resend's inbound webhook behind its own switch (below): the display-name From, the text part or the HTML part read as text, the quoted history stripped (a reply header even when wrapped or run on, a phone's "Sent from" footer, and a signature after the `-- ` line), photo attachments written where describe_media reads them, the thread kept on the party's email channel | `renderEmail`: one letter, "Hi <first name>," the paragraphs, the sign-off; the reply carries `In-Reply-To` and `References` and the subject with "Re:". Those are the desk's words, so a person's own words from the board get none of them: his letter is what he typed, line breaks and all, and a greeting or a sign-off is his to write. Render only: there is no live email delivery. The one outbound send carries WhatsApp and SMS only, so a live email send is refused. The opt-out ledger (`server/opt-out.ts`, `comms_opt_outs`) matches on the email address as a second key beside the phone: an opt-out is one row, on the address it arrived on and never copied onto another address on file, and the live deliverer asks the ledger about every address the party has written to us on before any channel rule, so an email to an opted-out address is refused as an opt-out. |
| Web form | `channels/form-adapter.ts` | Name, phone, email, the job, postcode, sometimes photos (bytes). Creates the file; the postcode and name are facts at intake; the job type is Scoping's to establish | No reply path of its own: `chooseChannel` follows a channel this customer has written on before, so a form filled in mid-thread is answered where the thread has been running, and for a first contact who has written on nothing it opens WhatsApp if the number is on it (the approved web form template, quoting the enquiry, 1.2; the row without the call offer when they have already rung us, 1.5), else SMS, else email. |
| Calls | `channels/call-adapter.ts`, `channels/call-reader.ts`, `channels/channel-desk.ts` | A finished call: `missed`, `answered_inbound`, or `ben_rang` (an unanswered outbound never reaches the desk). The transcript is the turn's body; the outcome is a fact on the file. The reader (Sonnet 5, facts only, no prose field) records the job, the location, what Ben asked for and whether a callback was agreed; Ben's asks go on the ledger as soon as the call is read, whatever the follow-up does next, so the desk never asks again. A live call is read when its transcript lands, not at hang-up, where there is none yet | The desk never speaks. A transcript that reads as an opt-out is checked before the reader runs and holds for Ben (the desk row). `missed`: one text back per thread (3.5), the missed-call template on WhatsApp, else its words on SMS; the acknowledgement goes on the ask ledger, so a second and third missed call send nothing; a missed call on a thread we wrote on in the last 60 days is an ongoing conversation, not a first contact, and gets no text back, as the old desk's first-contact gate. `answered_inbound`: nothing (3.5), and the caller is never offered a call (1.5). After any call they made, a composed reply that offers one anyway (`offersCall`, which does not count a call that already happened, such as "as we discussed on the phone") goes back to the composer once and holds for Ben if it offers again, unless the customer's turn asks to be called; the same holds for a party who prefers text. `ben_rang`: the post-call template with the name and the job (1.3), else its words on SMS; the thread continues from the file (3.2, 3.3) and nothing is held for Ben (3.4). No approved template on WhatsApp holds the follow-up for Ben with its words as the draft, never an SMS fallback (answer 34); so does a template the channel's own render refuses, a first name outside GSM 03.38 being enough to make one text three segments, because nobody is left silent after Ben's call. A door call may carry a `summary`, standing in for the telephony side's job summary, so its bubble on Ben's board shows one as a live call's does; a missed call's bubble promises no summary or transcript. |

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
same acknowledgement with the offer taken out; Meta approved that name on 15 Sep 2026
(docs/META-TEMPLATE-RUNBOOK.md), and wherever the sync cache does not show it approved the
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
`/webhook`, server/leads.ts `POST /api/leads` (the web form, and only where the body is an enquiry
someone wrote in with: that route also records a booking once Stripe has taken the money, the
instant-quote card's booking and a slot reserved on a quote we already sent, and none of those is a
new enquiry, so the forward asks `isWebFormEnquiry` there, the one rule the old ingest reads too),
and server/call-logger.ts
`finalizeCall` (a finished call; the call row is read for its outcome) and server/twilio-realtime.ts
after the batch transcription (`call_transcribed`: the same call once its transcript and job summary
are on the row). A call turn carries its call id (`Turn.callId`), so any later pass of that call,
the transcribed one or a second hang-up signal, fills in the turn it already made
(`channels/channel-gateway.ts` `attachCall`): no second turn, no reply, nothing sent; a
`call_transcribed` pass with no such turn opens nothing. The hang-up pass has no transcript to read,
so the call reader skips it, and the transcript that fills the turn in is read then
(`channels/channel-desk.ts` `readLateTranscript`), for facts and Ben's asks only, after the same opt-out check as at hang-up: an opt-out there is read by no model and holds for Ben. The desk behind the intake
runs in dry run, everything up to delivery with nothing leaving, until the new desk is the live desk
("Which database the intake opens", below): then it delivers and the old desk stands down at the
same moment. docs/comms-v2/cutover.md is the flip and the roll-back.

**The switch alone does not start it.** `INTAKE_REQUIREMENTS` (`channels/intake.ts`) is what the
intake must have before it reads one live turn. None is outstanding; while one is, the gateway
refuses to be built and every forward logs what is missing, and a build that fails is forgotten, so
the next forward tries again.

**The numbers that are ours resolve internal.** When the gateway is built, `seedInternalNumbers`
(`channels/intake.ts`) registers every number server/internal-numbers.ts knows with the identity's
`registerInternal`: the business's own lines, the staff and contractor numbers in the database
(`users.phone`, `handyman_profiles.whatsapp_number`, `contractor_job_links.contractor_phone`), and
the numbers in the `INTERNAL_PHONE_NUMBERS` environment variable. An internal key resolves ahead of
every other role and the gateway refuses the turn, so no case file opens. The build refuses when the
database cannot be read. The list is read once a build, so a number added later counts after a
restart. A key a case file already holds as a customer is refused and counted in the log line.

**Persistence has landed.** The intake's case files live in the `comms_v2_case_files` table
(`desk/database-store.ts`, migration `migrations/20260913_comms_v2_case_files.sql`), so a restart or
a redeploy loses no thread. The store keeps the synchronous interface in `desk/store.ts` by writing
through: the gateway reads every row when it is built and answers `get`, `findOpenFor` and `all`
from those files, and each `put` writes the whole file in the background, one write at a time. A
failed write is logged and retried without holding up another file's, and `flush` waits for them.
Because the desk changes a file in place, the gateway puts it once a turn lands and again after the
desk, a clock pass or an age. The identity directory is still in memory, so `identityFromCaseFiles`
rebuilds it from the parties on the loaded files, and a returning customer lands on their open file
rather than a second one. The sandbox door keeps the memory store.

**Which database the intake opens: the switch-over.** The gateway is built for a purpose, read from
the switches on every forward (`liveChannelGateway`): `live` while the new desk is the live desk,
`sandbox` otherwise. Live is `commsV2Live()` in `switch.ts`, and it is yes only with all of these on:

| Switch | Where | Off by default |
|---|---|---|
| intake | `COMMS_V2_INTAKE=1`, the environment | yes |
| desk | `spine.commsDesk = 'comms_v2'`, the `spine` app_settings row, read only through `isCommsV2Desk` (server/spine/config.ts); owner-only on `POST /api/spine/config`, where choosing `comms_v2` needs `confirm: 'LIVE'` | yes (`spine`) |
| delivery | `spine.senders.comms_v2.enabled = true`, the same row (`desk/sender.ts`) | yes |
| the process | `COMMS_WORKER=1`: production is one service that is the web process and the worker (docs/RUNBOOK.md), and the desk's clock runs only in the worker, so another process is never the live desk | — |

For `sandbox` the store, the quote store, the draft chain and the diary open only the branch
`COMMS_V2_DATABASE_URL` names, as before; apply the migration to that branch first. For `live` they
open the database in use, production included, and every call asks the switches again, so flipping
one back refuses the very next write and the next forward builds a sandbox gateway instead (the set
aside store keeps retrying its unwritten files, and lands them if the switches come back on). The
sandbox door always asks the branch question, whatever the switches say, so it never writes
production.

**What live means.** Everything below follows the same `commsV2Live()`, so it all turns on and off
together, on the next read, with nothing written to any row:

- The intake's desk delivers (`INTAKE_DESK_MODE`: `live` for the live purpose, never for the sandbox),
  through the one outbound send under `agent.comms_v2`, and a board answer goes out the same way.
  Each handled forward's decision line ends with the mode of the gateway that handled it
  (`deliveryLabelFor`): `(live delivery)` here, `(dry run)` for the sandbox.
- The old desk stands down (`old-desk.ts`): every sender in `OLD_DESK_SENDERS` (the legacy agent and
  its autosend, the spine's lane agents, the SLA chase, the rules layer's replies, the webform chase,
  the lead automations) is refused at server/outbound.ts with a `send_refused` event; the spine's
  `spineMode()` and `isSpineEnabled()` read as off; the legacy agent's `getCommsAgentConfig()` reads
  as disabled with its inbound lane off (`setCommsAgentConfig` still merges over the stored row).
  A read that fails is not live, so the old desk answers; the new desk's delivery refuses on it.
- The old comms page is retired for customers (`old-comms.ts`). Its sends are the composer,
  templates, quick replies, voice notes and draft approval, whichever screen calls them, and they
  refuse any thread that is not a contractor's with `OLD_COMMS_RETIRED`. `staffThreadPath` sends staff
  links and notifications for a customer thread to `/admin/comms-v2`, and `GET /api/comms-v2/old-comms`
  tells the sidebar and `/admin/comms` to drop the customer lane. The contractor lane, its links and
  its sends stay, since the new desk never takes contractors. A read that fails is not retired, and
  a thread whose role cannot be read counts as a customer's.
- The live clock (`channels/live-clock.ts`, registered in server/cron.ts for the comms worker only)
  passes every held file, every file with a quote, every file with a chase record and every file
  holding a burst of customer messages (`waits`), once a minute; a pass never messages a customer
  except to recover a burst another gateway left behind at a restart (`clockDue`, `Gateway.clock`
  above), and leaves a burst this process is still timing or answering alone. Ticks never overlap.
  The same tick closes a quoted file that has gone 30 days quiet ("A stale quote closes itself after
  30 days" below).
- Ben's chase goes to `COMMS_V2_CHASE_BEN_E164` and the owner's escalation to
  `COMMS_V2_CHASE_OWNER_E164` (`chaseStateFromEnv`); a number not set is a refusal on the record.

With any switch off none of it runs. A process that has every switch on but is not the comms worker
logs once that it is not the live desk and builds no live gateway.

### Inbound email

Inbound email comes from Resend (the captain's choice, 16 Sep 2026), which already sends the
business's email. Resend POSTs a signed `email.received` event to
`POST /api/webhooks/resend/inbound-email` (`channels/email-inbound.ts`). That path is mounted
outside the admin-gated `/api/comms-v2` prefix, because a provider has no session and would be
refused there. The route has its own authentication: Resend's Svix signature (`svix-id`,
`svix-timestamp`, `svix-signature`), checked over the raw body with the `svix` library against
`RESEND_INBOUND_WEBHOOK_SECRET`. A missing or bad signature, or a timestamp more than five minutes
out, is a 401. A delivery already taken, whether by its `svix-id` or by its received email's id, is
answered 200 and adds no second turn: the process remembers both for a day, and the store below
holds the email id for good.

**Switched off unless turned on deliberately.** The route accepts nothing into the desk unless
`COMMS_V2_EMAIL_INBOUND=1` and the intake switch `COMMS_V2_INTAKE=1` are both set, each read the way
`COMMS_V2_INTAKE` is (exactly `1`). Off, it answers 404 and reads nothing. On but without the
signing secret or `RESEND_API_KEY`, it answers 503. On, it keeps the turn and then hands it to the intake, which
takes it to the gateway in use (dry run until the desk is live, as for every other channel).

**Kept before Resend is answered** (the captain's "Separate safeguard", `channels/inbound-email-store.ts`).
The route writes each accepted email's envelope to `comms_v2_inbound_emails`, keyed by Resend's email
id, before it answers 200; a write that fails is a 503, so Resend delivers again. The first hand-over
starts after the answer, and the comms worker's minute loop (`runInboundEmailRetryTick`, only while
inbound email is on) retries each row the desk does not have yet with backoff, up to eight attempts.
An attempt holds its row for ten minutes, so two never run at once. The row is done once the intake
has returned, the desk has handled the turn, and the durable case file store has written the file
the turn landed on (`forwardNow` flushes that file alone, so another file's failing write does not
hold this email). An email that spends every attempt is kept as failed, logged at error level and
paged. The hand-over
carries a delivery id (`resend:<email id>`) that the gateway records on the turn (`Turn.deliveryId`)
and refuses to land twice (`duplicate`), so a redelivery, an attempt racing another, or a restart
between the desk taking the email and the row being marked adds no second turn. The desk runs on
that turn again only while it is unhandled: no reply to the party covers it (`coveredByReply`, the
one-reply guard's position rule, so a reply to a later turn or a person's own words after it count)
and no desk run recorded its result
on it (`Turn.handledBy`, written in the same put as the run's reply; a hold or a deliberate
no-reply is a result). So a desk run that throws after the turn landed is run again on the next
attempt, through the file's one pass queue, and a run that finished is never run twice. The
switches, the migration and the worker needed to turn it on are in docs/RUNBOOK.md.

Automated and internal mail never becomes a turn (`ignoredReason` in `channels/resend-inbound.ts`):
an `Auto-Submitted` header other than `no`, `Precedence` bulk, list or junk, a noreply,
mailer-daemon or postmaster sender, an address in `INTERNAL_EMAIL_ADDRESSES` (read through
`server/internal-numbers.ts`, never committed), or a From with no readable address. It is answered
200 as ignored, marked seen, logged with the reason only, and none of its attachments is downloaded.

Resend's event carries metadata only, never the body or the attachment bytes. So the route reads
the email (`GET /emails/receiving/{id}`) and its attachments
(`GET /emails/receiving/{id}/attachments`) with `RESEND_API_KEY` before it answers
(`channels/resend-inbound.ts`). A read that fails is a 502, so Resend retries. The adapter
(`channels/email-adapter.ts`) turns that into the email turn:
- The From header's display name and address (`"Jones, Sam" <sam@...>`), unfolded; the address is
  lowercased. A From header that does not parse to an address or carries an encoded word gives way
  to Resend's own `from` field.
- The plain-text part, or the HTML part read as text when the client sent none. A closed `<blockquote>`
  (matched open to close, so words between two quotes are kept) or Gmail quote block is dropped,
  and the quoted history is then stripped from the text.
- `Message-ID`, `In-Reply-To` and `References`, kept on the party's email channel so a reply joins
  the same thread.
- Each photo or video, downloaded from its signed URL (the API key is never sent there). A photo is
  checked against its own bytes. Anything else, a download over 40 MB, more than eight media, or a
  failed download is named on the turn's media failures. An inline image under 16 KB is taken as a
  signature or logo and skipped.

Anyone can email the business, so the parse is linear in what it reads: each text or HTML part is
read up to 200 KB, and a From longer than an RFC 5322 line (998 characters) has no address.

The sandbox door (`fromDoorEmail`) still hands its media over as bytes.

Resend receiving customers' full message bodies and attachments is recorded in
`docs/COMMS_RECORD_OF_PROCESSING.md` and on the customer-facing list in
`client/src/pages/PrivacyPolicyPage.tsx`. Pointing Resend at the route, setting the secret and
turning the switch on are owner actions (docs/RUNBOOK.md, "Inbound email (Resend)").

There is still no outbound email path. A live email send is refused, so the desk runs dry on email.
## Goal 4: the Quoting specialist and its tool server (`quoting/`)

Contract 7 (docs/comms-v2/contracts.md). Registered with the desk by one import and one gather
step in `desk/desk.ts`, one call in `desk/router.ts`, a `brief` on `SpecialistReturn` that the
composer prints, and a mount in `desk/sandbox-door.ts`. Nothing under server/spine/ is edited; the
quote machinery that survives the rebuild is wrapped.

| Piece | File | What it is |
|---|---|---|
| the specialist | `quoting/quoting-specialist.ts` | Sonnet 5 at medium effort, two structured outputs and never a figure in front of it: before the draft, the clerk's intake (lines, what matters for pricing, what is not included, what Ben may want to request; a defect seen only in a photo is never a line, at most something for Ben to request); after the quote, which labels a question concerns, whether it is money beyond a line, acceptance in chat, not ready. Money beyond a line holds for Ben whatever the quote's status, and the desk's money line goes with it, so a draft still with him hears about the ask. Returns facts cited to the quote and a `brief` for the composer; never a sentence. A draft the clerk could not build holds the thread for Ben with the failure named, asks nothing that turn and briefs the composer to promise nothing, because nothing was built and no notification reached him; that is the one shape whichever half failed, the intake model or the chain, since a quote drafted from the job title alone would carry no assumption and nothing excluded and the next thing done to a draft is that Ben prices it and sends it; the turn that does draft it releases that hold in the desk's own words with the price screen named. Runs once the job and location are known; owns the thread once the quote is sent (Scoping stops). With `deps.background` (the live intake's desk, which passes `persist`), the chain runs off the reply path (`quoting/background-draft.ts`): the pass records a `quote_drafting` fact, starts the draft and briefs the composer as for a drafted quote, and the draft notifies Ben and records its facts when it finishes, then the file is put again; a failure holds for Ben with the same reason the inline failure uses and sends the customer nothing; a turn while it runs starts no second draft; a clock pass starts a draft a restart lost again, at most twice, then holds for Ben. Without it (the sandbox door, the tests) the draft is awaited in the pass as before. A quote that is no longer live for figures gives no figure. Revoked and superseded hold for Ben, because the reply that says he will come back to them on it is otherwise a promise nothing keeps. Expired is read as the quote live again and offered to the desk for reissue (`ReissueCandidate`, with money beyond a line, acceptance in chat or a failed reading as blockers); the desk claims it only when nothing else is Ben's, and `afterReissue` briefs the composer to answer the rest without repeating the reissue sentence. A reissue on the row that the file never recorded telling the customer about is flagged once for Ben (`unannounced`). `applyQuotingRoute` is the router's hook: a quote live for figures answers its own (5.3 replaces 2.7) and a money question on one that is not goes back to Ben under 2.7, since the stage stays `quoted` after the row expires, except a message on an expired quote that is nothing but a plain ask of its own price (`plainPriceAsk`), which Quoting takes so the reissue answers it; any other money-shaped turn stays Ben's; a portal action is Quoting's turn. Clearing the belt is safe only because the question model re-raises the hold, so when that reading is skipped or fails the belt stands and the money hold is set without it. The desk reads that liveness once a turn and hands it to both the router and the figure guard. |
| the tool server | `quoting/quoting-tools.ts`, `quoting/quote-record.ts` | quote_readiness (job type and location, photos optional, the missing list for Ben), draft_quote (once per job, refused whenever the file's quote reference names a quote that exists; the missing list is recorded on the case file as the internal `ben_to_request` fact and never on the quote row, because `GET /api/personalized-quotes/:slug` needs no session and serves every line-item field but the materials array verbatim; the price catalogue is reached only from inside this chain, never as a shelf of its own), notify_ben (once, with the price screen link, recorded on the file), chase (four hours, then daily, three times; never a customer send), read_quote_line (to the penny with its citation, matched on the quote's own label only and never the citation; refuses draft, revoked, superseded, expired, an unknown label, and a label two lines share), live_figure_quotes (the same liveness rule asked of the file's quote, which the figure guard resolves a cited line against, so a stale quote's figures cannot be repeated), read_quote_scope (draft allowed; no figure), record_quote_facts (each line, the total, the deposit, the link, scope, not included, assumptions, once each, cited `quote_line` with the figure's own name, which carries the line position when two lines share a title so one line's price is never recorded as another's; never a line's labour or materials half, which the quote page prints in whole pounds and which is a breakdown rather than a line), price_quote (Ben's prices through the price screen's own `confirmPrices`, which leaves the row a draft), mark_quote_sent (only once the delivery landed: the quote leaves draft, its figures reach the file, the stage walks to quoted), record_acceptance (a human witness only: the row, quoted to accepted, one push to Ben; live, with the payment the Stripe webhook already wrote as its witness, the row is confirmed rather than written and the file walks to accepted whether or not the quote was still live when it was paid). |
| the reissue | `quoting/reissue.ts` | The captain's ruling of 16 Sep 2026 for an expired quote: automatic, the original total plus 5% rounded up to the next pound (the lines scaled to it by largest remainder, never rounded each), always from the original, which the row keeps under `pricing_suggestions.reissue` with every reissue's run id. `planReissue` refuses a row it cannot price from the original with certainty (a refresh on the customer's page from before any record existed, or a total other than the record's `lastSetPence`, which an edit leaves behind); the store writes the plan behind a compare-and-set on the total, both counters and the lapse, so one run claims one lapse. `planSelfRefresh` prices the quote page's own refresh of a row the desk has reissued from the same original, so it never compounds past that figure and the desk can still reissue after it; on a row the desk never reissued the page refreshes as it always has, 5% on the current figure, but `legacyRefreshRecord` keeps the original and the total it set, so the desk's later reissue still prices from what the customer first saw. `reissueLine` is the sentence the reply opens with. The desk (`desk/desk.ts` `claimReissue`) asks for it only with no other hold on the turn or the thread, an open window and no standing opt-out (`QuoteStore.optedOut`, fail closed), puts the sentence ahead of the composer's words through the eight guards, and records the outcome as the internal `quote_reissued` fact, which Ben's card shows (`quoteReissue`); a reissue whose reply did not go holds for Ben with the new price and link. |
| the chain wrapper | `quoting/draft-quote.ts` | Calls server/spine/route-a.ts `runRouteAChain` with what a spine pass would supply (the intake as the clerk's artifact, a case-file shape carrying the v2 case id and the party's number) and its own injection points: the draft row is written here from the chain's pure `pricedDraftRow` (no old conversation needed), Ben's notification is captured for notify_ben, the job pack is skipped and said so. The estimator and the one pricing engine run for real. `FakeDrafter` for tests. |
| the store | `quoting/quote-store.ts` | The personalized_quotes row: read, insert the draft, price (server/spine/price-screen.ts `loadPriceScreen` and `confirmPrices`), accept (what the Stripe webhook writes, for the sandbox), add photos to a draft, delete the sandbox's own rows. `MemoryQuoteStore` for tests. |
| Ben's notifications | `quoting/ben-notifier.ts` | ready to price (with the price screen link and the missing list), chase, accepted. Every notice is a fact on the file (`ben_notified`, `ben_chased`, `quote_accepted`) carrying what the notifier did. The sandbox door's notifier only records, which is what the door shows as the recorded push. The live intake's (`liveBenNotifier`) sends the notice to Ben's phone through server/pushover.ts `notifyDeskNotice`, under the old desk's event key for that kind (`quote_prep_ready`, `chase`, `quote_accepted`) with the desk's own words, and only while `commsV2Live()` says so, asked at every notice; otherwise it records only. A push Pushover skipped or that failed is said so on the fact. |
| the webhook's acceptance | `quoting/live-acceptance.ts` | The live `POST /accept`: server/stripe-routes.ts `payment_intent.succeeded` asks here, once the payment is on the row, in the place of the old desk's two alerts (`notifyQuoteAccepted` and the web push). Only while `commsV2Live()` holds and an open live case file carries the paid quote (`liveQuoteFile`, the price screen's own lookup), the new desk records the acceptance on that file (the `quote_accepted` fact, the stage, Ben's push through `liveBenNotifier`, awaited in the webhook), and once the webhook's response has closed the acceptance enters the live desk as the customer's turn for one acknowledgement, held for Ben on a shut window like the door's. A file already carrying `quote_accepted` for the quote is a repeat delivery and nothing runs on either desk; every other quote, any switch off, and a recording that refuses or throws keeps the old alerts, so Ben is always told about money. Test: `quoting/live-acceptance.test.ts`, a simulated event over memory stores. |
| the door | `quoting/quoting-door.ts` | `POST /price` (Ben prices and sends; the one card his send clears is the one this route raised itself when an earlier attempt did not send, and only while no other voice has been added to it, because a hold is one card carrying every reason it has been raised for and clearing it would take a customer's question added to it since along with it (`notedOn` on the hold is where any automatic release asks; the desk's own notes about its own run - a shut window, no template, a reply the guards refused - join the card without marking it, because that is the same automatic step speaking). It clears in the desk's own words naming that send rather than the letter that went, which nobody read before it went, and a delivery that holds adds what stopped it to whatever card is already open. Every other card stands: a money question is not answered by being about money, because the delivery carries the link and nothing else, and the same goes for the acknowledgement a web-form enquiry was owed, for a complaint, refund, trust or regulated hold, and for acceptance, which stays human. The route is: the price screen write, then the desk's own composer writes the delivery with the quote link, Contract 4 checks it, and it goes through the one sender in dry run under `human:ben`, on the channel the customer wrote on rather than one this route names, so an SMS thread whose number is on WhatsApp but never wrote there still gets its quote; stage to quoted. The words are the desk's, not Ben's - the route carries no message body, so nobody would read a borrowed draft before it went - and answer 43's exemption is for words a person typed. The composer is told which channel that is rather than working it out for itself, so a delivery going by text is written as one short text. One sentence in the send is a fixed line rather than the composer's (`first_contact_ack` in `desk/fixed-lines.ts`): where the acknowledgement a web-form enquiry was owed held for Ben and never went, that line goes ahead of the composer's words, so the first message they ever receive names us and the enquiry it follows, and the composer is told the room left after it rather than the whole channel budget. Nothing is interpolated into it, so no model-written fact reaches a customer through it and a test runs the eight guards over its wording. A thread held because the customer asked us to stop is read before anything is written and the delivery stops there: the words are the desk's own composer's rather than the words of whoever pressed send, so nothing is composed, no template goes either, and the reason joins the card the price screen shows back. The quote leaves draft only once that send has landed, so a shut window on a channel the customer chose, a guard failure or a refused send each hold for Ben and leave the quote a draft he can price again; on a shut window the approved `quote_ready_link` template carries the link as its second variable instead (its approved wording, not the composer's, sent under the person who licensed it), and only with that template not approved does a shut window hold. The delivery is `quoting/deliver-quote.ts`, and it is the same path Ben's live price screen takes for a quote a live case file carries (`quoting/price-screen-send.ts`, asked first by `POST /api/spine/price/:slug/send`; every other quote, and every quote while a switch-over switch is off, keeps the old `deliverQuoteLink`). The one channel the delivery skips is one the customer has never written on whose window is shut, which is the WhatsApp record a form or a call lead is given for a number known to be on WhatsApp: that never-opened window would hold a link no template can carry, so the delivery takes the next channel in the order instead. That rule is `chooseChannel`'s own `noTemplate` option in `desk/sender.ts`, so one function still decides the channel for every send the desk makes, and only a send no approved template can carry asks for it), `POST /accept` (the human event: the row, the stage, Ben's push, then one acknowledgement through the desk as the customer's turn; the store refuses a quote that is no longer live, an expired one included, before any deposit is written. On a shut window the desk holds that acknowledgement for Ben and says the customer accepted and is waiting on a word from him, rather than reaching for a template of another purpose: the only approved wording of that purpose asks the customer to write again, which the registry says must never stand as the reply, and a quote-accepted purpose of its own is `quote_accepted_ack_v1` (`server/window-templates.ts`, approved but unused by the captain's ruling — submission status in `docs/META-TEMPLATE-RUNBOOK.md`), whose wiring into `desk/sender.ts` TRIGGERS_FOR_PURPOSE is its own cutover item), `POST /lapse` (the sandbox's own sent quote past its price lock, branch database only, so the reissue can be driven), `GET /quote` (the file's quote facts and the row's lines to the penny). `/reset` removes the sandbox's quote rows, keyed on every contact the drama customer writes from: the row's `phone` column holds the number on a phone thread and the address on an email one, so the door a quote was drafted on does not decide whether its row survives. |

Facts the specialist writes carry the quote and the line as their source: `quote_line:<label> = £x.xx`
(`source: { kind: 'quote_line', quoteRef, line }`), `quote_scope:<label>`, `quote_not_included:<label>`,
`quote_assumption:<label>`, `quote_link`, `quote_status`. The composer copies a figure exactly as
written and cites the fact; the figure guard passes only that. A line whose amount changes (a
reissue) leaves the old fact on the append-only file, so only the newest `quote_line:<label>` for a
quote is shown or accepted (`isSupersededFigure`, `desk/case-file.ts`).

What the draft is missing reaches Ben on the admin-gated price screen (4.4) as well as in the
ready-to-price notice: `quoting/ben-to-request.ts` reads the internal `ben_to_request` fact off the
case file and `server/spine/price-screen.ts` asks for it through a lazy import, so nothing in the
spine depends on the new desk at load time. It is the one surface outside this directory the list
reaches, and it never touches the quote row. The list is answered again at the moment Ben looks,
not served as the draft left it: an entry `quote_readiness` wrote, recognised word for word against
`READINESS_WORDINGS`, is recomputed from the file, so a photo sent two turns after the draft stops
being asked for, while the intake model's own labels stand as written - including one that merely
opens with "photo", which the file cannot recompute. The stored fact is kept true too: the desk calls
`refreshBenToRequest` at the start of every customer turn and again once the specialists have read it, so a photo that lands after the draft no
longer reads on the file (and Ben's board) as "photo (asked once, none sent)"; once nothing is left
it reads `NOTHING_TO_REQUEST`, which the screen shows as no list.

Nothing the desk writes reaches a customer with a dash used as punctuation (`desk/dashes.ts`, the
house rule in `brand-voice/whatsapp-comms.md`): the composer is told to use a comma or a full stop,
its reply, a fixed line and every non-typed render are rewritten, and the verbatim rail compares a
reviewed row's words the same way. Hyphenated words stay; a person's own words go as typed.

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
| a shut window at 5.1 | `POST /age {"hours": 25}`, then `POST /price {}` | two shapes, both correct, depending on whether the branch's template cache has `quote_ready_link` approved; record which. Not approved: held for Ben, nothing sent, the hold names the shut window and the missing quote-link template, and `GET /quote` still reads `draft` with no `quote_line:` fact on the file. Approved: sent as that template on the shut window (`templateId` `quote_ready_link`, one bubble with the first name and `/quote/<slug>`, approver `human:ben`, to the drama number), `GET /quote` reads `sent`, and 5.1 below is driven on a fresh thread. This is the customer's own WhatsApp thread, which the delivery keeps: only a WhatsApp record nobody has written on is skipped for another channel. Then `POST /message` "any news on the quote?" to reopen the window before 5.1 |
| 5.1 | `POST /price {}` | the planned send's approver is `human:ben`, the bubbles carry `/quote/<slug>` and no figure, every guard reads `pass` (the words are the desk's, so all eight ran), the stage is `quoted`, and `GET /quote` now reads `sent` with every line priced. The only card this send clears is the one it raised itself on the shut-window attempt above, and the release's words name that send, not the letter that went |
| 5.3 | `POST /message` "What does that include, and how much is that line?" | the figure equals the price of that line on the record to the penny (£x.xx), `factIds` names the `quote_line` fact carrying that figure, the figure guard passes, and this turn raises no new hold (a money card left standing from 5.2 is still Ben's: the delivery answers nothing but the link). Never ask about the labour or the materials: they are not lines of the quote, so any figure given for one is a figure the customer's quote does not state |
| a labour question after 5.3 | `POST /message` "How much of that is labour?" | held for ben with the money line and no labour or materials figure: how a line splits is money beyond a quote line. Naming the line's own total back is not a failure: any figure that does appear equals a line of the live quote to the penny |
| 2.7 after | `POST /message` "Can you do it any cheaper?" | held for Ben, reason names money beyond a quote line, and no figure that is not a line of the live quote to the penny: naming a line's own total back is not a failure, a discount or a reduced total is |
| a form lead nobody wrote back to | on a fresh thread `POST /start` with door `form`, `seed {"whatsapp": true}`, a job and a postcode, then `POST /price {}` | two shapes, both correct, and which one runs depends on whether the branch has an approved `web_form_ack` template; record which. Acknowledgement sent: the delivery is a delivery, on `sms` with the quote link, no hold and no release. Acknowledgement held for Ben: nothing had reached them, so the delivery opens with the desk's own `first_contact_ack` fixed line ahead of the link in the same message, with no figure, and the acknowledgement's card still stands for Ben afterwards (`hold` naming `web_form_ack`, no release). `GET /quote` reads `sent` either way |
| 6.2 | `POST /message` "Leave it with me, I'll get back to you next month", then `POST /run` | one acknowledgement with no question, then nothing |
| 6.1, 6.3 | `POST /accept`, then `POST /accept` again | `notice.title` "Quote accepted", stage `accepted`, an `accepted` notification recorded, and one acknowledgement whose only promise is that Ben has been told (no date, time or duration); the second answers 409 |

### Driving the expired-quote reissue

One thread on the comms-v2 door, after 5.1 has sent the quote. `POST /lapse` puts the sandbox's own
sent quote past its price lock (branch database only), so no row is edited by hand. Everything else
about the reissue (opt-out, a second worker, a restart, revoked and accepted quotes, the rounding,
the page's own refresh) is proven by `quoting/reissue.test.ts` and `desk/reissue-desk.test.ts`;
the live drive is these three steps and should take minutes, not the whole test window.

| Drive | Passes when |
|---|---|
| `POST /lapse`, then `POST /message` "What does that include again?" | one reply whose first bubble is "Your previous quote has expired, so I've updated it. The new price is £X. Here's your updated quote: <link>", X the sent total times 1.05 rounded up to the pound; no hold; every guard passes; `GET /quote` reads `sent` at that total, and Ben's board card shows "Quote reissued automatically" with the figure and when it went |
| `POST /message` "thanks" | no second reissue sentence |
| `POST /lapse`, then `POST /message` "is this still ok?" | the same £X again, never 5% on top of it |

What the price screen shows for a v2 draft: the lines with the customer's own words, suggestions and
band, the photos on the draft. Nothing internal is on the row, in any field: the quote endpoint is
reachable by slug with no session, so what the draft is missing is a fact on the case file instead,
served to the price screen and, as `benToRequest`, to Ben's board card (Goal 2, below). The price
screen's thread pane reads the case file for a draft whose row carries `source_channel` `comms_v2`
(`quoting/price-screen-thread.ts`, asked by `server/spine/price-screen.ts` through a lazy import):
every turn on the file whatever channel it came in on, a call's transcript and the web form
included, each photo on it as a message of its own, and the "asked, none sent" pill reads that same
thread. The file is found where the "To request" list's is (`priceScreenCaseFiles`), so a slug
drafted in another process shows an empty pane rather than another thread. Every other draft keeps
the old conversation and messages tables. The live send takes the new desk's delivery for a quote
on a live case file (`quoting/price-screen-send.ts`); for a sandbox draft the door's `/price` is the
send.

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
| `scheduling/diary.ts` | The diary read, read-only. The one authoritative booked date is `contractor_booking_requests.scheduled_date` (spans through shared/schedule-composition.expandSpanDates); the five quote-side columns on `personalized_quotes` (`selected_date`, `available_dates`, `date_time_preferences`, `flex_booking_within_days`, `slot_offer`) are preferences, never read. Lead time is new: the median days from a booking being made to its first booked day over completed bookings from the last 180 days, at most 100 rows, nothing below 5. Lead time counts calendar days, so a booking made on the morning of its visit is 0 rather than a discarded fraction. `liveDiary` opens the branch database on first use and every read refuses unless `COMMS_V2_DATABASE_URL` names the database actually open, so the door mounted on the production server reads no real diary; `MemoryDiary` for tests, with the phone and email of each seeded row in `contacts`. `bookingsForContact` is the customer's bookings by their own phone and email (see the date-change gate below). |
| `scheduling/scheduling-tools.ts` | The shelf: `typical_lead_time` (nothing when the sample is too small or when the read fails; never a guess, and every refusal names a category only, the count staying on `sample`, because how many jobs the business has finished is not the customer's business), `confirm_booked_date` (the one entry point to the file's booking, for the confirmation and for the date-change belt alike, so the two can never disagree: the booking the file references, else the booking made from its quote, which is the newest from it that stands and, when none does, the newest that does not, so a visit cancelled off a customer who has no booking reference on their file is still seen; the diary is the only source it reads; refuses a declined, cancelled, done or past booking, a booking with no date, and a booking no contractor has taken on, giving no date at all, and its `state` says which, because they are not the same thing to the customer: `cancelled` is a visit taken off them that they may still be expecting, so a request to move it reaches Ben, and `unknown` is a diary that could not say, which holds for Ben too on a date question, because the reply has just promised him, unless nothing says there is a booking at all, no reference on the file, no stage of `booked` and none the read resolved from its quote, and the question is about availability or how soon, where a read that could not say is nothing known and the quote's picker answers as it would have; a question about the day they are booked for still holds for him, since telling somebody who has a day to pick one is the worse answer; only `none` answers as a thread with nothing to move, being a diary that never had a booking and a job already done or past, which is a new job rather than a change; the date and its row id are all it returns, never the slot or the number of days, because no guard can check a half of the day against the diary), `picker_link` (`/quote/<slug>`, the canonical customer quote URL the live sender uses, for a sent quote; refuses no quote, a draft, superseded, revoked or expired one, a quote the customer already has a booking from, standing or still waiting on a contractor, since the picker is where that date was chosen and picking again would make a second booking from the one quote, and a quote the diary could not say about on a file that names a booking, the booking it could not read being possibly that same one; a booking cancelled off them is not refused, because rebooking is what they need, and neither is one from an earlier quote. A refusal that is the right answer, a booking they have or a draft not yet sent, stays out of the run's error; every other one, the unreadable diary included, reaches the log and the run summary. The two refusals that mean the customer has no quote to pick dates on at all, none on the file and one still in draft, are marked `unsent`, and the specialist reads that mark rather than the reason for the cell "dates come with your quote" answers), and two belts: `dateChangeMatch` (a request to move a booked job holds whatever the models read; only `move` takes a bare "it", every other verb needs a date, day, booking, appointment, visit or slot as its object, so "bring it with you" is not a date change, and only the verbs of movement take the job itself, so "move the job" is a date while "change the job" is the work they want done) and `dateQuestionMatch` (an explicit date question the router missed still reaches the specialist: the question forms only, so a turn that merely mentions a booking it was booked in for is not one; when the classification never came back, the router's own `scheduling` subject stands in for it too, so a date question is never met with silence); both run at the desk's gate. Every date fact carries `{ kind: 'diary', rowId }`, which the date guard recognises only while this run looked it up: a fact from an earlier turn was true when it was written and the diary may have moved since, so the composer is not shown it either, rather than being offered a date the guard would then refuse. A bare ordinal is read on its own words, never on whether the reply gives a date elsewhere (`desk/lexicon.ts` `ordinalDays`): it is a day, and must be a looked-up value like any other date, unless a thing the trade counts comes straight after it, so "the 1st floor bathroom" or "2nd fix" beside a looked-up date passes first time while "the 2nd" is caught with or without one; a word not on that list leaves the ordinal a day, which costs a retry and at worst the acknowledgement, never a date. The picker link cites the quote. A read that fails refuses with a stable category (`the diary could not be read`), which the composer is never told either. No reason ever reaches the notes it reads (contracts.md, Contract 3): not a cancellation, not a revoked or expired quote, not a failed read, not a count of anything. The notes say there is no date, or no link, and to say nothing about why; every reason rides to the hold, the log line and the run summary alone. |
| `scheduling/scheduling-specialist.ts` | Sonnet 5 classifies what the newest turn asks (`availability`, whether worded as how soon we could come or as what dates we have, since every branch answers the two alike; `booked_date`; `date_change`) and, for a change, their words; the tools decide the rest from the diary, and every ask is load-bearing: which shelf answers is chosen by what they asked, not by what the diary happens to hold, so somebody with a visit booked who asks how soon a new job could be done gets the lead time for that new one, with the day they already have confirmed beside it rather than instead of it and no picker, since they booked on this quote's picker already, and a turn that asks two things gets both, the booked date and the lead time together. On a thread whose job is already booked the lead time answers and the picker does not, and the day it stands on is mentioned beside it, since they did not ask to move it; a booking still waiting on a contractor withholds the picker the same way and holds for Ben, so they hear we know they booked and he hears the job is stuck in the pool. No reply that holds for Ben carries a picker link, in any state. One reading decides the confirmation and the picker's refusal alike (`isTheirBooking`), the booking being theirs and from the quote the file carries, or the read having failed on a file that names a booking, and the grid in contracts.md has the cell for every ask against every state the diary read can return. A diary that could not say is read that one way by the confirmation, the picker's refusal and the fallback alike, so an unreadable read cannot be answered one way when the classifier returns and the opposite way when it does not. The fallback is otherwise the wider guess rather than that reading: any state the diary did not plainly call `none`, a cancelled visit included, holds for Ben, since sending somebody whose visit was taken off them to the picker with nothing reaching Ben is the worse way to be wrong about a turn nobody could read. When there is no date to confirm the notes still hold for Ben and forbid a day of the desk's own, not the lead time the same turn looked up: "Let me check on the date and come straight back to you" and "we're usually booking in about 3 days" are both true and both sourced. A turn that asks nothing about dates is left alone: no lead time, no picker, no fact. A classification that never came back is not the same thing: when the model call failed and the date-question belt matches the turn, the deterministic reading stands in, so a date question is never met with silence. A model that read no ask is taken at its word. Two rules fill the cells the diary left empty: "dates come with your quote" is for a file with no quote the customer has been sent, none on it at all or one still in draft, and nowhere else, since somebody holding a quote hears it as the desk not knowing who they are, and a cell with nothing to say about dates at all, no day of theirs, no lead time and no page to pick on, holds for Ben rather than answering a date question with silence. Returns facts by id, the fixed lines to include by kind (`dates_with_quote` where the customer has no quote they have been sent and the diary no lead time, `date_change_to_ben` on a change to a date the customer already has and wherever a date question would otherwise go unanswered), a proposal (the hold), and a brief for the composer naming which fact to copy verbatim. A change is the one ask that looks nothing else up: no lead time, no picker, only the booked date if the diary holds one. Asked what day we are coming about a job no contractor has taken on, it gives no date and holds for Ben, because only he can answer that. Never prose; the tests assert it. |
| `scheduling/fixture.ts`, `scheduling/scheduling-door.ts` | The door's fixture: seeds N completed bookings, a sent quote and one booked job on the drama number, hung on a synthetic contractor of its own rather than a real one on the branch (every row marked; `reset` deletes exactly those, the contractor included), links the current sandbox thread (quote reference, booking reference) and walks its stage to `quoted` or `booked`, unless `link: false`, which seeds the rows alone so the specialist has to find the booking by the customer's phone; `diary: 'none'` empties the completed bookings of the one diary the door and the desk share (`FixtureDiary`, which passes every other read through), so the "dates come with your quote" path is drivable live against a branch that already has a diary; the tool server only sees a reader that returned no completed bookings, the same path as too few. Every write refuses through the same branch check the diary reads through, so the fixture can only write the database the specialist may read; `/reset` on the door reads the completed bookings again, so a fresh thread always starts from the real diary. |

What the customer sees, from the diary only: during scoping a date question gets the typical lead
time when the diary has one ("we're usually booking in about 3 days") and "dates come with your
quote" when it does not; after the quote an availability question points at the picker; once
booked the date is confirmed from the diary when they ask for it, and a request to move it holds
for Ben (`date_change`) while the reply still answers everything else. Asking how soon, or what
dates are free, is answered by the lead time on a booked thread as on any other, because the
question they asked is about a new job, not the one already in the diary; the day that one stands
on is confirmed beside the answer, so the reply reads as knowing they booked. A hold on a date change is not a fixed-line hold:
later turns still get the desk.

The date-change gate is a change to a booked job (checklist 5.5), and the booking is resolved from
the customer, not only from the references on the file — but only on a date-change-shaped turn: one
the router flagged with its `date_change` exception, one the deterministic belt on the words
(`dateChangeMatch`) matches, or one the classifier itself reads as `date_change`. The one other turn
that looks up is one the classifier reads as `booked_date` on a file naming no booking and no quote:
a booked file is closed (below), so a booked customer's "what day are you coming?" opens a new file,
and the booking is found by their phone there, by the same rule. A plain availability turn never
looks the customer up by contact and never writes a booking onto the job, so a repeat customer's
unrelated standing booking can never be mistaken for the job in a brand-new thread. Where the turn is shaped this way, the specialist looks the customer up in the
diary by the phones and emails the case file records for them (`contactKeysOf`: every customer
party's canonical key and channel addresses; never the desk's own people or contractors, and never a
number typed in a turn, so nobody can claim a booking from chat). `bookingsForContact` matches a
booking row on its own contact or on its quote's, however the number was typed, and keeps only
bookings the customer may still be expecting (`stillExpected`: one that stands, whether or not a
contractor has taken it, or one cancelled off them whose day has not come). Where the answer is
plain, a file naming no booking and no quote with exactly one standing booking of theirs, the booking
reference is written onto the job (`linkPartyBooking`), so `confirm_booked_date` reads it on its own
path and later turns see it. Two standing bookings, a file carrying a quote, or only a cancelled
booking write nothing, because confirming the wrong job's date is worse than confirming none. A
request to move a date then holds for Ben when the file's booking could stand, when the customer has
any booking still expected under their contact, and when the router raised its `date_change`
exception but the diary could not say (no diary, no contact on the file, a read that failed), which
fails closed. The router's exception on a thread the diary plainly says holds nothing of theirs is
answered as the availability question it is, and since nothing then reaches Ben, the brief forbids
promising he will come back on moving it and the commitment guard refuses a reply that does (a
promise and its hold never diverge). On a hold nothing else
is looked up: no typical lead time, no picker link, only the booked date if the file's booking gives
one, the fixed line that he will come back on the date (in his own first person), and the rest of what they asked. The desk's
gate runs the same read for a move the router missed on a file naming neither a booking nor a quote.

## Closing a case file (`file-close.ts`)

The 17 Sep job-file close answer ("Both"): a file closes on its own when its job is booked or done, and Ben can close
one by hand. `booked` and `done` are the closed stages (`CLOSED_STAGES` in `desk/case-file.ts`);
`closeFile` is the one move into them, walking a file forward to `booked` from wherever it stands
(the booking is real whichever steps the file saw) and to `done` from anywhere, and refusing a file
already at or past the stage, so an event delivered twice changes nothing.

| Close | Event | Where it is called |
|---|---|---|
| booked | the booking from the file's quote lands, its id written onto the job | `server/booking-engine.ts` `confirmBooking` (the quote page's picker: the slot the customer reserved, promoted by the Stripe webhook once paid; the flex placements reuse it) and `assignFromPool` (the dispatch pool, a slot offer the customer took, the webhook's auto-assign), and Ben's dispatch from the daily planner (`server/daily-planner-routes.ts` `POST /confirm-dispatch`, `/dispatch-all` and `/confirm-cluster`, one close per quote booked) |
| done | the job is signed off | `server/job-lifecycle.ts` `finalizeJobCompletion` (the job routes and the ops actions; the job row is the booking, so its id is the booking's) and the field app's `POST /:token/jobs/:bookingId/complete` (`server/contractor-app-routes.ts`) and the contractor dashboard's `POST /api/jobs/:id/complete` (`server/job-assignment.ts`, the route that answers that path, mounted ahead of the job-lifecycle one), each naming the booking as well as the quote |
| done | the job's invoice is paid | the Stripe webhook's invoice payment (`server/stripe-routes.ts`, both the `invoiceId` path and the payment-intent fallback; a consolidated invoice, whose own quote is empty, closes the file of each child invoice's quote once the children are marked paid) and `POST /api/invoices/:id/mark-paid`. The public `POST /api/pay/:shortCode/complete` is not wired: it is unauthenticated and verifies no payment, and the webhook already covers a real one |
| done, by hand | Ben on the board | `POST /api/comms-v2/case-files/:id/close { words? }` (below; words required on a held file) |

An event finds its files by the quote it names, matching the job's quote reference as the quote's short
slug (Quoting's draft) or its id (the scheduling fixture), and by the booking it names, matching the
job's booking reference: a booked customer's follow-up file, opened by their next message and given only
the booking by `linkPartyBooking` when they ask when we are coming, closes with the job, so their next
enquiry opens a fresh file rather than one still naming the old booking. The booking alone closes a file
only while it carries no quote reference: a follow-up file since quoted for a new job stays open with that
quote, and closes when that quote's own events arrive. Only files not yet done, on the live
intake's store and only while the new desk is the live desk (`commsV2Live`). Each call is awaited
after the event's own write and never throws into it; no log line carries a value from a file.

### A stale quote closes itself after 30 days

17 Sep, answer 125, "Close after 30 days": a quoted customer who was never booked kept an open file
forever, so a return months later with a different job landed on the old file and was refused with "a
quote already stands". A file at `quoted`, not held for Ben, whose quote has stood unanswered for
`STALE_QUOTE_CLOSE_DAYS` (30, `file-close.ts`) closes as `done`, recorded on the stage change with why
and marked `staleQuote`. Measured from the file's last activity (`quietSince`): the newest stage move to
`quoted`, the desk's later automatic reissue of the quote (`quote_reissued`, which puts it live again
without moving the stage), or the newest turn either way, so a file with any conversation in the last
30 days never closes. `accepted` and `booked` files
have moved past `quoted`, so they, a file held for Ben and a file with a customer burst waiting, are
never touched (`staleQuoteDue`). Run by the live clock tick (`closeStaleQuotes`, called from
`channels/live-clock.ts`'s `liveClockTick`) each minute, not a scheduler of its own; each close is a
pass queued behind any desk pass on the file (`Gateway.passOn`) and asks again there, so it never
closes a file under a customer's turn. As with the events above: only the live intake's store, only
while the new desk is the live desk, never throws into the tick, and the customer's next message then
opens a fresh file. The sandbox door's `POST /run` runs the same close before its clock pass, on its
own in-memory files, and names what it closed in `staleClosed`, so the 30 days can be driven there
(`POST /age {"hours": 720}` twice over, then `POST /run`) rather than only in the worker.

A stale close is the one close that reopens (`reopenStaleQuoteFiles`): a payment on its quote (the
Stripe webhook, `quoting/live-acceptance.ts`) or a booking or completion naming it puts the file back
at `quoted` with a system turn saying why, and the event then moves it on and is recorded on it, so no
take-up of the quote is lost; a payment the desk then cannot record closes it again as stale
(`recloseStaleQuote`) and goes to the old alerts. The quote itself is not changed. A file closed by its booking, its
completion or by hand stays closed.

A closed file is never where the person's next message lands (`desk/store.ts` `newestOpenFor`): that
message opens a new file with no job type, location, quote or facts, so Scoping starts the new job
from nothing and Quoting drafts its own quote rather than refusing beside the old one ("a quote
already stands"). A booked file's clocks still run (`channels/live-clock.ts` stops only at `done`),
because a hold on it is still Ben's. A file at `quoted` or `accepted` stays open and takes the
message, as it did before, a quoted one until it goes 30 days quiet (above): that quote is still
being decided or is paid and waiting for its date, so a message then is about it, and the 17 Sep
report behind that answer showed harm only from files that never closed.

By hand, `closeByHand` moves the file to `done` with `approver: human:<email or user id>` and the
person's `words` on the stage change (the scrub classifies both keys; `why` stays the
desk's own words). A file with no hold closes without words. A standing hold is released first by
the same rule as `/release`, with the person's own words, so a closed file waits in nobody's queue:
on a held file, empty words refuse with 409 ("release needs the approver's words") and a hold named
for another slot refuses too, and in either case nothing changes. No placeholder is ever stored as
the approver's words.

## Goal 6: the Service specialist and its tool server (`service/`)

The specialist for facts and aftercare (docs/comms-v2/design.md, "Who handles what"; the tool server
is in docs/comms-v2/contracts.md). It answers only from a reviewed knowledge-base row, cited by id and
verbatim, or the customer's own record (their details on the file and, for a customer the CRM knows,
their leads, quotes, jobs and invoices, read-only), and holds on everything else. The desk runs it beside Scoping:
its deterministic tools every turn, its model when the router sends the turn to `service`, or when
the customer's own words ask to change a detail on their record or whether we cover their area
(`asksAboutOurArea`, which reads everyday wordings such as "do you travel to Derby", "are you covering Beeston" or "does your area include West Bridgford", as well as "are you able to cover Beeston", "do you cover beeston too" and "do you cover that far out", widens the knowledge-base lookup to the areas-covered row, raises no hold
and leaves Scoping to run on a mixed turn's job half),
whatever the router read. A router-prompt carve-out for coverage can go on top of that match once
the router has an eval to catch drift. When its model did not read the turn, a composed reply that
puts off a question the customer asked on that turn ("I'll check and come back to you on that",
`deferralMatch` in desk/lexicon.ts; "I'll have a look and get back to you" on a job turn is not one)
holds as `no_source` in the desk (desk.ts 6b), unless the turn raised or noted a hold of its own, so
the promise is on his board; a turn Service read is left to its own answers.

| Piece | File | What it is |
|---|---|---|
| the tool server | `service/service-tools.ts` | `kbLookup` (the desk's one knowledge-base selector: reviewed rows by question, verbatim, read through `desk/scoping-tools.ts` `reviewedKb`, which wraps the old store's reviewed-only read; may return nothing), `customerRecord` (this party's own details from the file; `MASKED_FIELDS`, the email and address, reach the model only as held), `changeOfDetails` (a fact and a hold for Ben, when the new value can be read from the customer's own words; the record is never written here; for the email or address the fact names only the field and the value goes only to Ben's card; when no value can be read, a hold stands with no fact), `convergence` (JOB_ASKS_MAX job asks with no job type, or SCOPING_REPLIES_MAX replies while a job is being scoped and the file is not ready, is not converging; both counted since the last release, the replies only from when scoping began (`scopingFrom` on the file), so a facts-and-aftercare thread never counts until it turns to a job, and only replies to customer turns that gave the file no fact, so a cooperative burst never trips it). |
| the specialist | `service/service-specialist.ts` | Sonnet 5 returns selections only: which looked-up row answers which question by id, which record field, which question is about the customer's own job, a requested change, a complaint, refund or trust doubt. The tool server checks each selection (an id it did not return is no source; a job question is left to Scoping when Scoping ran on the turn, so a mixed turn never holds the job half as no source), records each answer as a fact whose value is the row's body verbatim, and writes the composer's brief. Never a sentence for the customer: the model's `asked` label reaches the brief and Ben's card only as far as `askedLabel` clips it (`ASKED_LABEL_MAX`, 60 characters), which is why the schema's own ceiling on it is loose - a string ceiling is not enforced as the answer is written, and a label the model ran over threw the whole answer away, holding a known customer's invoice question for Ben every time (17 Sep 2026). The model sees the customer's name and phone, and only that an email or address is held, never its value, so a customer asking what we hold for either holds for Ben as `no_source` with that reason on his card. |
| the hold vocabulary | `service/hold-reasons.ts`, `desk/fixed-lines.ts` | `HoldException` (desk/router.ts) is the router's exceptions plus `no_source`, `not_converging`, `change_of_details`; `callback` joins the router's own. Service raises `money` only for an invoice money question the router handed it that no invoice answered. Fixed line only (no composer, no specialist until Ben releases): complaint, refund, trust doubt, gas (answer 21; nothing else freezes a thread). Gas beside work we do in the same message does not freeze it (18 Sep 2026): Scoping reads the turn first, its job type names only the work we do (`workBesideRegulated`, desk/scoping-tools.ts, a belt that fails closed to the freeze), the gas line goes unchanged after the composed reply (alone, with no promise to check, on a later turn that asks only about the gas item: Service's `gasLineGoes`), the quote carries only that work, a reply carrying it that does not go notes `GAS_LINE_NOT_SENT` on the hold (`settleGasLine`, desk/desk.ts) so Ben tells them, and the hold stays `regulated` with `REGULATED_WITH_REST` in its reason, which `freezes` (service/hold-reasons.ts) reads so later turns are scoped too; a complaint, refund or trust doubt still takes the card over and freezes it. The regulated line is the gas line, so it goes only when the turn is positively gas (a gas term matches and no asbestos or artex-ceiling term does); any other regulated hold, including one only the router flagged, sends nothing and says why on the hold (`regulatedWithoutLine`), and the held acknowledgement follows the same rule. Answer the rest (the fixed line rides in the reply): money, date change, callback, no source, change of details, not converging. Not converging's line goes once; the desk restates its own card while the file still lacks something and releases it once scoping converges (`releaseConvergedHold`, desk/desk.ts), so a card never says "no location" once the address is on the file. Goal 6's lines are checklist wording and send live; only the four Ben reviews are read from the knowledge base. |
| return to automation | `desk/human-reply.ts`, `service/return-to-automation.ts` | One path for a human's reply: `humanReply` sends the words through the one sender under a `human:<person>` approver on the thread's own channel, records what they asked on the ask ledger, and releases the hold with those words. Ben's board and the door's "Ben replies" both call it; `automationState` reads where the thread is. The release records how many turns the thread had (`turnsBefore`) and each subject's ask count (`asksBefore`), so `convergence` counts both replies and job asks from there and a released thread can make progress; the ledger itself is untouched, so a subject is still never asked twice. The kanban (Goal 2) can also release the hold directly, which brings the thread back to automation without posting Ben's words to the customer. |
| Ben's chase | `service/chase.ts`, `desk/sender.ts` `initiate` | On the desk's clock pass a held thread chases Ben after one interval and the owner after a second, each a template send through `initiate` (template only, approver and run id, never freeform, never on the thread; the run id is spent on the file; a live pass carries the chase's own purpose to the deliverer and a refused delivery is on the record). The record is the file's own `chase` field, so the durable store keeps it and a restart never chases again; every attempt records its mode and the label the deliverer carried it under (`outboundLabelFor`: the fail-closed `marketing` class, context `comms_v2:<purpose>`), refused ones included. Intervals and addresses are configuration (a missing address is a refusal on the record, never a silent skip); the door sets test values and drama numbers, and the live intake reads the numbers from the environment (`chaseStateFromEnv`) and runs on the live clock. The two templates (`desk_approver_chase_v1`, `desk_owner_escalation_v1`) are rows in the one registry (`server/window-templates.ts`, `audience: 'approver'`), which `chase.ts` reads rather than keeping its own copy; submission status is `docs/META-TEMPLATE-RUNBOOK.md`, and approval is read from the live sync by name like any other. |
| the fixture | `service/fixture.ts` | Reviewed and unreviewed knowledge-base rows (`sandbox-kb-*`, reviewed as `human:sandbox-fixture`) written through the old store's own admin writes, and the two chase templates marked approved in the sync cache with a sandbox content SID, as are the two channel templates Meta approved on 15 Sep 2026 (`post_call_followup_v1` for 1.3, `web_enquiry_ack_no_call_v1` for 1.5; `FIXTURE_APPROVED_ON_META`), with their wording read from the registry, so their approved-template branch is drivable. Nothing is written to Meta or Twilio. Branch database only; refused on production. |
| the customer's full record | `service/customer-record.ts`, `desk/identity.ts` `resolveKnown` | Read-only (captain's answer of 17 Sep, "Read-only full record"; answer 11's "their records"). Identity binds only on a proven channel (captain's answer 126, "Only proven channels"; `PROVEN_CHANNELS`): a WhatsApp or SMS turn from the number, or an email from an address the CRM record itself holds. It asks `knownCustomer` by the key that turn arrived on and binds the one `service_clients` row it names (`dedupe_key`, primary phone or email; two rows bind nobody; a failed read leaves the turn unbound and logs it). The binding belongs to the key (`Person.crmByKey`) and is carried on the turn (`Turn.customerId`), never on the file or the person as a whole: a web-form or call turn, and a key linked to the person only through a form, never carries one, so such a turn is a new enquiry to Service even when the same person's phone has proved a client (a burst reads the record only when every message in it proved the same client). A restart looks each key up again. Lookups for one person finish in arrival order, and a turn with nothing to look up still lands synchronously. For a turn that carries a client Service reads `record`: their leads, quotes (status only, never a figure: answer 23 keeps quote figures to Quoting's live line), jobs from `contractor_booking_requests` with their visit days (a day only once a contractor has taken the job on, or once it is done: the diary's own `unacceptedReason`), and invoices once sent (`sent`, `paid`, `overdue`; a draft or void invoice is never read), newest ten of each, by `client_id`. No email, address, postcode, access or internal-note column is selected, a property-header invoice line (which names the address) is skipped, and the free text that is read passes the specialist's address and email mask (answers 46 and 47). The model picks an item by ref (`source: history`); each of its values is recorded as a fact keyed `record:<ref>:<attr>` with source `customer_record` and field `crm:<ref>:<attr>`, and the brief tells the composer to read back only what answers, never adding up. Such a fact is `isReadThisRunOnly` (desk/case-file.ts), like a diary date: the composer is shown it, and the figure and date guards accept it, only on the run that read it. A known customer's invoice or receipt question (`asksAboutInvoice`) runs Service whatever the router read, and a money question of that shape that asks nothing an invoice cannot settle (`invoiceMoneyQuestion`: no discount, refund, dispute, quote, or price for work, no haggle or terms of payment the lexicon's `haggles` knows, and no figure the customer names, so a turn that also asks a new price or offers a sum stays Ben's) is handed to Service instead of Ben (`Route.moneyToService`); unanswered from an invoice row, Service raises the `money` hold itself. The live intake reads the database in use while the new desk is live; the door reads the branch only. |
| the record fixture | `service/record-fixture.ts` | Opt-in, separate from `POST /fixture` because it makes the door's drama number a known customer for every thread until reset: a `service_clients` row for `07700900942` (the existing one if the branch already has it), a lead, and invoice `SANDBOX-INV-0001` sent and part paid (total £120.00, deposit £40.00, balance due £80.00, due eleven days after the fixture ran). `sandbox-crm-*` ids, synthetic values, no email or address. Branch database only; refused on production. The reset removes the invoice, the lead and the client row it wrote (kept if a sandbox quote now points at it). |
| the door actions | `service/service-door.ts` | Mounted by `desk/sandbox-door.ts`: `POST /fixture`, `POST /record-fixture`, `POST /record-fixture/reset`, `POST /ben-replies` (`{ text }`; the approver is the signed-in session's slot, never the body, so an unlisted session gets 403; the standalone door host has no session and runs as Ben), `POST /chase-intervals` (`{ chaseAfterMinutes, escalateAfterMinutes }`), `GET /chase`. Every `/run` response carries `chase`; the state carries `automation` and `chase`. |

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
clock pass, as the live tick runs it: the stale-quote close first (`staleClosed` on the response), then
the pass, where the unpriced-quote chase fires once due), `POST /age` (`{ hours }`), `POST /reset`,
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
(`{ completed: N, quote: true, booked: true, diary: 'diary' | 'none', link: false }`: seed the diary
on the sandbox number and link the current thread, after `/start` with the job type and location in
the opening message; `link: false` seeds the rows alone, so the booking is found by the customer's
phone) and `POST /scheduling/fixture/reset`. The seed answers with what it seeded, what
it linked and `diary` (`'diary'` while the completed bookings are read, `'none'` while emptied); the
reset with what it deleted and `diary` back to `'diary'`, which is everything the scenarios below need.

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
  carry "Let me check on the date and come straight back to you" and the booked date read from the diary.
- 5.5 found by the customer's phone: `/start` with an opening message that names the job but no
  postcode (`"Hi, my kitchen tap is dripping"`, so no quote is drafted), `/scheduling/fixture`
  `{ "booked": true, "link": false }` (`linked` is null), then "Can we move it to the week after?";
  the same hold, fixed line and booked date, and `state.caseFile.job.bookingRef` is now the seeded
  booking.
- Never booked: `/scheduling/fixture/reset`, a fresh `/start`, then "Can we move it to the week
  after?"; no hold and no "Let me check on the date and come straight back to you", and `job.bookingRef` stays null.
- Then `/scheduling/fixture/reset`.

A burst (checklist cross-cutting 2 and 2.8): after `/start`, send three `POST /message` WhatsApp
texts together, without waiting for a response between them. Each response comes back once the
thread has been quiet for the window (8 s) and the desk has answered, and each carries
`burst.turnIds` naming all three messages. One planned send has `delivered` true; the other two
share its `runId` with `delivered` false and a note starting "one customer turn". `state.messages`
ends inbound, inbound, inbound, outbound. A message sent only after the previous response has come
back is a new turn and gets its own reply, so each such `/message` response takes at least the
window.

The door has no session, so it has no answer action of its own: Ben's reply goes through the
board's authenticated route, which only his approver slot may call.

Goal 6 adds `POST /fixture`, `POST /ben-replies`, `POST /chase-intervals` and `GET /chase`
(above): the chase is driven with `/chase-intervals`, then `/age` and `/run`, and "Ben replies"
brings a held thread back to automation.

The first-contact, scoping and hold rows, each as its own thread, after `POST /fixture` once (it
puts the two channel approvals in the branch's cache):

- 1.3: `/start` door `call`, outcome `ben_rang`, a transcript in which Ben asks for photos, seed
  `{ "whatsapp": true }`; `templateId` `post_call_followup_v1` on a shut window, one bubble with the
  first name and the job from the call, no hold, `ben_asked_for` on the file.
- 1.5: `/start` door `form` with a job and a postcode, seed `{ "whatsapp": true, "alreadyRung": true }`;
  `templateId` `web_enquiry_ack_no_call_v1`, the enquiry quoted back, no call mentioned, no hold.
  A WhatsApp `/message` after it gets a reply that mentions no call.
- 1.6: `/start` a job with no postcode, `/message` "text only please", then a real answer; the file's
  `prefers_text` fact has the thread as its source (no seed), and no reply after it mentions a call,
  the phone or ringing.
- 2.3: `/start` a vague job ("a few things need doing around the house"), then answer in words for
  three turns; every reply asks at most one question about the job, with one question mark, and
  never a subject the ask ledger already holds.
- 7.1, a trust doubt: `/start` a job, then "How do I know you're not a scam?"; the `trust` fixed line
  alone, a hold for ben with exception `trust_doubt` and no composer call; a further message gets the
  held acknowledgement with the hold still standing.
- 7.2, a refund: `/start` "I paid a deposit but need to cancel, can I get a refund?"; the `refund`
  fixed line, a hold for ben with exception `refund`, no figure.

The switch-over adds two things to drive without sending anything (docs/comms-v2/cutover.md):

- `POST /run { "live": true }`: the same clock pass with the desk in live mode and the real live
  deliverer, so a due chase or escalation is stopped at the new desk's own switch and recorded under
  its own purpose. The door refuses it (409) off the branch database, where the new desk is the live
  desk, while `spine.senders.comms_v2.enabled` is on, and for any recipient but its drama numbers.
  After `POST /fixture` (the chase template approvals), on a held thread: `/chase-intervals {1, 2}`,
  `/age {hours: 0.05}`, `/run {live: true}` answers `chase.action` refused for `approver_chase` with a
  reason naming `spine.senders.comms_v2.enabled`, and `GET /chase` shows the attempt with `mode: live`
  and `label: { purpose: marketing, context: comms_v2:approver_chase }`. For the owner: `/run {}` chases
  Ben in dry run, `/age {hours: 0.06}`, then `/run {live: true}` records the same for
  `owner_escalation`. Nothing is sent and no chase run id is spent.
- A form start with `photos: [{ contentBase64, mime }]`, the web form's own shape, takes the server-side
  photo checks `POST /api/leads` takes (`channels/media.ts`): the response's `mediaFailures` says
  `too many photos (5), kept the first 4` for five, `photo too large` for one over 6 MB, `not a
  recognised image` for bytes that are not an image whatever the mime says, and `media` holds a valid
  photo typed by its bytes. The app's own door takes a 10 MB body and the door host 12 MB.

This is the surface the no-mistakes pipeline's end-to-end test step drives to validate a goal. The
checklist lines for the goal (docs/comms-v2/design.md, Goal 1's stop condition) are the scenarios
the test step exercises; its recorded evidence goes in the PR. See docs/comms-v2/contracts.md,
"Validation". Ben's board (below) mounts its own instance of the same door under
`/api/comms-v2/sandbox`, which is how a thread gets onto the board.

## Goal 2: Ben's desk as a kanban board (`api/`)

`/admin/comms-v2` (client/src/pages/admin/CommsV2BoardPage.tsx, full screen outside the admin shell) over
`/api/comms-v2` (`api/routes.ts`, mounted behind `requireAdmin` in server/index.ts): a thin
read-and-act layer over Contract 2's case file. The page renders full screen: the route is outside
`SidebarLayout` in `client/src/App.tsx` (`isFullScreenAdmin`, `client/src/lib/handy-desk-path.ts`),
so neither the sidebar chunk nor the live-call socket loads on it, under a header of words
(`client/src/components/layout/FullScreenHeader.tsx`: the logo, "Comms board", Handy Desk, Diary
(soon), "N open · M held", Held only, and a More menu standing in for the sidebar). It is plain and
minimal (captain, 18 Sep 2026): a Kanban only, the Floor view gone, over `GET /board`
(`client/src/components/comms-board/BoardViews.tsx`, card and count mapping in
`client/src/lib/comms-board.ts`), with the Live / Sandbox switch where the sandbox works. A card is
a plain rectangle with no icons, pills or avatars: the name and the wait, the reply channel as a
word before the wait only when it is not WhatsApp ("SMS · 40m"), and on a held card one amber line,
`holdException` or else the hold reason, and "draft ready" from `hasDraft`, with a thin amber edge.
The states are a skeleton on the first fetch only, an empty board, an empty
held filter with "Show all files", a filter change that keeps the previous board dimmed and busy
only until the new one arrives (a failed fetch for the new filter shows the error, never the old
filter's cards), a failed poll that keeps the last good copy with "Retry now",
and the read-only board when `viewer.canAct` is false. Below 1024px it is one stage at a time under
word tabs with Held first. It still doubles as the window onto
the sandbox while the rest of the desk is built. Tapping a card opens that customer's thread (Handy
Desk B4, `client/src/components/comms-v2/ThreadView.tsx`, drawn like a WhatsApp chat). The
same component opens from a Handy Desk queue card. At 1024px and up (`useIsWideBoard`,
`client/src/hooks/useIsWideBoard.ts`) it is a column beside the board rendered only while a card is
picked: it slides in, narrowing the board rather than covering it, the picked card outlined and
scrolled into view, and slides out again on Close, Esc or a second tap on the picked card, leaving
the board full width; there is no empty panel at rest (Esc is ignored while focus is in any field
on the page, such as the ask bar, or while one of the thread's own boxes holds words). Below that width it is full screen, with a back arrow ‹ Board (‹ Queue on the desk);
Esc and a tap outside are ignored while one of the thread's own boxes (the reply, the close-file
words) holds words. Which of the two shows
follows the window as it is now, so narrowing it with a card selected brings that card's thread into
the sheet. On the Handy Desk leaving the sheet puts the card down with it, so the queue's highlight,
the ask bar's context and the answer surface agree at every width; "Ask about this" in its header is
the one leaving that keeps the card, closing the sheet back onto the ask bar. An ask bar answer takes the
right-hand side over the thread while it shows, and the composer's half-written reply is the page's,
kept per case file, so it is still there when the thread comes back. It shows, in WhatsApp's own
shape and colours:
- a header of words: the name, a line with the role, stage, job and the reply channel and its
  window (`replyChannel`, `replyWindow`), then More (Call `tel:` when there is a number, View
  customer `/admin/clients/:clientKey`, Latest quote `/admin/price/:slug` when a quote is on file,
  and Close file) and Close (`threadLinks`, `client/src/lib/comms-v2-thread.ts`);
- the customer's bubbles in white on the left and ours in green on the right, the first of each run
  with its tail and, on our side, a small "Desk" or staff name; the time inside each bubble, with
  the channel as a word only when it is not WhatsApp; a day chip between days (`chatItems`);
- media in its bubble with its description and confidence;
- calls and system turns as centred notes, a call with a "Transcribing…" state until the summary or
  transcript lands and a transcript toggle; the facts behind a toggle;
- the held draft in the chat as a dashed bubble on our side marked "Draft · not sent", the hold's
  age and reason in plain words under it, and Edit (the draft into the message field), Release
  hold only and Send this;
- a round message field with one send button. There are no read ticks: a turn carries no delivery
  state.

"Send this" posts send-held-draft with the draft on screen as `expectedDraft`. When the desk has
replaced it since (409 "the held draft changed since you saw it"), the view re-reads the file, shows
the new draft and asks again. One box feeds both "Send reply" (answer, the send button) and "Release hold only"
(release, under the held draft). A reply shows as a sending bubble at once, then as sent from the response, until a read
carries its turn.

On a shut window, freeform sends are disabled, whether the file says the window is shut or a send is
refused for it. The template card then shows the template-offer preview: the template's name and
wording, or its refusal, read when the card appears, again on any newer customer turn and again
after a send or release, never on a clock of its own. "Send template" posts send-template. Every refusal is shown in the desk's
own words, with the typed words kept. A session whose `viewer.canAct` is false sees the thread with
every action hidden and one line where the composer would be: "Read only: no approver slot is
assigned to your login." The More menu offers "Close file" on a file not yet done (the close route
below), opening its confirm above the message field. A thread that fails to load offers Retry and a way back.

Opening another file, even one already cached, remounts the thread. It starts with an empty reply
box, its buttons disabled and no earlier send outcome shown, so one customer's words can never be
sent to another (`client/src/pages/admin/__tests__/CommsV2BoardPage.switch-conversation.test.tsx`).

| Piece | File | What it is |
|---|---|---|
| the board | `api/board.ts`, `api/routes.ts` | `GET /board`: one column per Contract 2 stage, exactly the seven; each card is one file (customer, job type and location once known, last customer message and when, reply channel, mode, and `benToRequest` - what the draft is missing, read off the file's internal `ben_to_request` fact through `quoting/ben-to-request.ts`, empty once nothing is outstanding, and `quoteSlug`, the quote the file's job names, null until one is on the file). Held cards float to the top of their column with the hold reason and approver, `holdException` (the router exception that raised the hold, `Hold.exception`, else null) and `hasDraft` (the hold carries a held-back draft: the "Draft ready" pill; the ask agent's floor surface reads the same flag). Filters `?held=true` and `?mode=sandbox\|live`; a file is `live` once any send on it delivered, `sandbox` otherwise. The response also carries `sandboxAvailable` (`api/routes.ts`, from `live-database.ts`'s `commsV2DatabaseCheck`): true only where the sandbox door could write on this process's database, never production, never by hostname. `client/src/pages/admin/CommsV2BoardPage.tsx` reads it to hide the sandbox thread control, the sandbox/live filter and every mode badge in production, failing towards hidden on any refusal reason. It also carries `viewer: { approver, canAct }`: the slot this session occupies through the same `slotOf` lookup the write routes refuse on (403), and whether it holds one, so the page can show a read-only board before a write fails; holding a slot is not enough on its own, because each write still checks that the file answers to that slot. The page otherwise reads plainly as "Comms board", not the sandbox window it doubles as pre-cutover. `GET /case-files/:id` is the file's turns (with media; a call turn also carries `call`, its headline, summary and transcript, `callViewOf`, the last two null until they land, shown on the page as the summary and a show-transcript toggle) and facts, read-only, plus `replyChannel`, `replyWindow` and `replyRefusal`: the channel a reply from the thread would go out on and that channel's window, `{ state: 'open' \| 'shut', reason, closesAt }` (`closesAt` is when WhatsApp's 24-hour window shuts; null when shut and on SMS or email, which have no window), both read through `desk/human-reply.ts` `replyRouteOf`, the routing the answer and template sends use, so they can differ from the card's `replyChannel` (the last send's channel); with no reply to route, both are null and `replyRefusal` is the send's own reason. Then `speakerNames`: the `users` row's first and last name for every `human:<login>` approver on the file (`api/approvers.ts` `readStaffNames`, matched case-insensitively and keyed lowercase; a login with no match falls back to its own local part on the page). While a case file is open the page re-reads it every 15s so a message arriving mid-conversation appears without closing and reopening it. |
| the Handy Desk queue | `api/queue.ts`, `api/routes.ts` | `GET /queue`: every held file as one flat "Needs you" list for `/admin/handy-desk` (`client/src/pages/admin/HandyDesk.tsx`, card copy in `client/src/lib/handy-desk-queue.ts`; the quick links' held-count badge on "Comms board", `useHeldCount` in `client/src/components/layout/QuickLinks.tsx`, polling every 15s on every admin page): the board card plus the hold's `draft` and `waitingWorkingHours`, office hours since the hold was raised (`server/working-hours.ts`), longest first. **Holds only, and an in-memory read** - this route never touches the quotes table, whatever the caller asks for. The quotes waiting to be priced also appear in Needs you (answer Q12), but the page reads those from `/api/spine/price-queue` on that query's own slower clock (`usePriceQueue`, 60s with a 30s staleTime) and merges them in client-side (`withReadyToPrice` in `client/src/lib/handy-desk-queue.ts`): **below every hold**, in the payload's own oldest-first order, as `kind: 'ready_to_price'` cards (the union tag is stamped on the client by `withReadyToPrice`; the wire carries none), except that a held file's own quote (the card's `quoteSlug` matching a row's `slug`) does not list twice: it folds onto the held card as `readyToPrice`, which keeps the hold's own badge and reason and adds a line and an "Open & price" link (the same pane beside the queue from 1024px, the page on a phone), and the held count stays a count of held customers (change N1 of the Needs-you audit). A ready-to-price card carries (customer, job, postcode, `waitingMs` - the true wall-clock wait, since the office clock stops scanning after a fortnight and would read alike on every older draft - `pricePath` to `/admin/price/:slug`, no money figure; it has no conversation to select, so tapping it opens Price and Send for that quote: the page on a phone, and from 1024px the same screen embedded as the answer surface, which keeps Ben's unsent edits while he looks elsewhere (`client/src/pages/admin/HandyDesk.tsx`'s header)). A person waiting on a reply is never pushed below an unpriced draft. The two reads answer at different speeds and fail independently, so the page decides what it may say once from both of their states (`needsYouView`, tabulated in `client/src/pages/admin/HandyDesk.tsx`'s header): the headline count appears only when both reads have a payload it can stand behind, "Nothing needs you." only when both are empty, and a read that failed with its last payload still listed is called out of date rather than unread. Then `handledToday`: the turns answered since local midnight in Europe/London, one per outbound run whether the desk or a person sent it, which the page's header counter shows so it survives a reload. `?mode=sandbox\|live`, `sandboxAvailable` and `viewer` as on `/board`; each item carries the card's `holdException` and `hasDraft` too. Read only: a card's buttons are the send-held-draft, answer, release and send-template routes below, so the same approver-slot check and sender refusals apply. Tapping a card opens the same thread view as the board: on the right at 1024px and up, full screen below. It never reads the old `/api/desk`. The old desk's `assignment`, `sla_breach` and `call_task` items have no new-desk equivalent yet, so the queue has none. |
| release | `api/routes.ts`, `api/approvers.ts` | `POST /case-files/:id/release { words }` calls the case file's own `release`, which enforces the approver-and-words invariant; the route only carries the words and names who is asking. The approver is the slot the signed-in session occupies, never the request body: the app_settings row keyed `comms_v2_approvers` maps slot to user ids (`{ "ben": ["<user id>"] }`, the insert SQL is in `approvers.ts`). A session no slot lists gets 403; with no row nobody can release. Fail closed: an unreadable row assigns nobody. |
| close | `api/routes.ts`, `file-close.ts` | `POST /case-files/:id/close { words? }`: Ben closes the file as done by hand ("Closing a case file" above). Same session rules as release: 401 with no session, 403 with no slot, 404 on an unknown file; 409 on a file already done, a held file closed without words, or a hold another slot must release. Returns the card, the stage change and the release, if a hold was cleared. The thread view (`client/src/components/comms-v2/CloseFileForm.tsx`, from the thread's More menu) offers "Close file" on any file not done, and not to a session with no approver slot, with words (required on a held file, optional otherwise) and a second tap to confirm; a close re-reads the file and refreshes the board or queue. |
| answer | `api/routes.ts`, `desk/human-reply.ts` | `POST /case-files/:id/answer { words }` sends Ben's own reply through the one sender (`desk/human-reply.ts`), on any card, held or not. Same session rules as release: 401 with no session, 403 with no slot, 400 with no words, 404 on an unknown file; this is the only answer path, so no unlisted session can answer as him. A session whose slot is not the file's own approver is refused 409, held or not, so a slot minted for one thread cannot answer another. The guards do not run over his words (answer 43); a refusal from the sender, a shut window, a reply over the bubble ceiling or an SMS over two segments, is 409 with its reason and nothing is sent, and a send returns the card, the approver the send carried, the bubbles that went, and the release the words cleared. |
| send held draft | `api/routes.ts`, `desk/human-reply.ts` (`sendHeldDraft`) | `POST /case-files/:id/send-held-draft`, optional body `{ expectedDraft }`: sends the desk's own held-back draft exactly as it stands, one tap, rendered as the desk's own replies are (bubbles of about 160 characters, the email greeting and sign-off); only a draft that still runs over the ceiling at 200 goes as typed words, split at blank lines only. Same pipeline and same session/approver rules as answer, with the draft as the words; refuses first when there is no held draft, then with 409 "the held draft changed since you saw it" (`HELD_DRAFT_CHANGED`, `shared/ops-types.ts`), sending nothing, when `expectedDraft` is given and the held draft differs. Without it, it sends whatever is held (the Handy Desk queue cards); the thread view and the Handy Desk answer surface always send it. |
| send window template | `api/routes.ts`, `desk/human-reply.ts` (`sendWindowTemplate`) | `POST /case-files/:id/send-template`, no body, only once the WhatsApp window is shut (a freeform reply is refused there, not this). Offers a template only when its wording is true for the thread: `quote_ready_link` with the exact link the file's own sends show went out, once a quote has been sent on it; otherwise `answer_ready_reopen_v1` only when the customer's newest turn is unanswered and itself contains a literal `?`. The desk's held acknowledgement ("Thanks, leave it with me and I'll come back to you.", or its variant naming a photo or video) is not an answer: a question followed only by that line is still offered the template, known by the desk's approver and the line's exact wording (`isHeldAckText` in `desk/fixed-lines.ts`, since a send record keeps no fixed-line kind). Neither is the desk's other holding line: on a standing `no_source` hold the fixed `no_source` line ("Let me check on that one and come straight back to you.") goes out woven into a composed reply, so there is no fixed wording to match, and the hold is itself the desk's record that nothing on file answered the question, so while it stands the desk's own sends do not count as answers. Any other outbound turn after the question answers it, as does a desk send once that hold has gone. The reopen template is offered only when any standing hold is for a question (no exception, or `no_source`); a complaint, money or other exception hold is never offered it, so the reopen template never clears one (`quote_ready_link` takes no notice of the hold, as before). Its subject is the file's recorded job type, else the fixed words "your enquiry", never the customer's own text. Neither applies: refuses with "no template is true for this thread: the customer needs to write again before a reply can go", which is shown as the refusal instead of a retry. Where the button is offered is above: the thread's template card on a shut window, and a Handy Desk queue card under a shut-window refusal of its own send. `quote_accepted_ack_v1`, `enquiry_followup_optin_v1` and every marketing-category template are never reached from this button. `GET /case-files/:id/template-offer` is its dry run (`previewWindowTemplate`): the same session rules (401, 403, 404), then `{ ok: true, template, language, channel, body }`, the template the send would carry and its filled wording, or `{ ok: false, reason }` with the send's exact refusal, as a 200. It sends, records and releases nothing. Both run `planWindowTemplate`, so the preview cannot name a template or wording the send would not use; the one thing it does not run is the sender's own gate (the opt-out ledger and the sender switch), whose refusal the send still returns as `send refused: <reason>`. |
| the store | `api/store.ts` | Chosen per request (`boardSourceFor`). While the new desk is the live desk (`switch.ts`, "Which database the intake opens" above) the board reads and acts on the live intake's durable store, and an answer goes out in that intake's delivery mode; a live desk whose gateway cannot be built answers 503 with the reason. Otherwise the board reads a process-local instance of the Goal 1 sandbox door (one Desk, one Gateway, one in-memory store), separate from the door host's own singleton, and answers in dry run. The door's router is mounted under `/sandbox` either way; the page's header control posts start and message to it. A release or an answer is put back to the store it came from, so a durable store writes it. The door replaces its gateway on every start and reset, so the store is looked up each time and a new start replaces the thread on the board. |

With the switches off, which is every pipeline run, the board reads the dry-run door, so nothing on
it is a live customer. The board itself polls every fifteen seconds; no websockets.

### Ben answers from a card: the live scenarios

The pipeline's test step drives these against the running app as Ben, on `/admin/comms-v2` (the
pipeline's admin account has the VA role on the branch database, so reach the board by URL), with
the board's own sandbox door under `/api/comms-v2/sandbox` seeding the thread:

1. A held card: start a sandbox thread, then send a money question as the customer ("How much
   roughly?"). The card holds for ben with the reason on it.
2. Ben taps the card, writes a reply in the thread's box and presses "Send reply". The thread on the door
   (`GET /api/comms-v2/sandbox/`) carries his turn with approver `human:<his own email or user id>`, and the bubbles are
   as the sender rendered them: a blank line is a new message.
3. The file shows Ben's turn (outbound, approver `human:<his own email or user id>`, labelled as his on the card's turn
   list and on the door's thread) and no hold, with his words recorded as the release.
4. The next customer message is answered by the desk again, approver `agent.comms_v2` (7.4).
5. A figure Ben types goes as he wrote it: his own words are never checked against the quote, and
   the send carries his own `human:` approver that no automated path can produce. No send record
   stores a guard result, so nothing claims a pass.
6. A reply the sender will not carry, one over the bubble ceiling of three, is refused with the
   sender's own reason shown on the board and nothing sent: no turn on the thread, no hold cleared.
7. The board's views: the board is full width with no thread until a card is picked; the held card
   from 1 opens its thread beside the board and a second tap on it closes it again. "Held only"
   leaves only held cards, and with nothing held says "Nothing is waiting on you" with "Show all
   files". Below 1024px the word tabs start with "Held" and a card opens its thread full screen.

## Handy Desk: the ask agent (`ask/`)

Ben's ask bar for the Handy Desk (the Claude Design handoff, tasks T2 and T3), built on the new desk
and nothing else. It reads the comms-v2 board and case files from the same store the kanban reads
(`api/store.ts`), holds at most one drafted reply per file for Ben, and answers with an `OpsAnswer`
(`shared/ops-types.ts`) that a client renders as the answer surface. It is not the old Ops Manager
(`server/agents/ops-manager.ts`, left for the legacy sunset): it never reads `message_drafts`, the
old inbox board, the VA call sheet or the old comms agent, and `ask/agent.test.ts` fails on an
import of any of them.

| Piece | File | What it is |
|---|---|---|
| the turn | `ask/agent.ts` | `runAskTurn`. Haiku 4.5 (`ROUTER_MODEL`) routes (`RouteSchema`): the ask's `intents` (find, show, message, book, call, note), the `domains` it touches (clients, quotes, bookings, contractors, messages, calls, invoices), the surface it wants, its `steps` in order, whether it asks for a money action (answered with `MONEY_REFUSAL` before any tool runs, with no plan: no money actions yet) and whether it wants a draft. Sonnet 5 (`SPECIALIST_MODEL`) reasons, in the generic tool loop (`server/agents/runner.ts`, recorded in `agent_runs` under trigger `comms_v2_ask_turn`), at most `MAX_TURNS` turns. The selected card (`context.caseFileId`, or `context.phone` matched against the file's canonical key and channel addresses) and the router's steps are named in the goal. Session history goes stale, so before the reasoner starts a `floor` ask reads `get_board` and a `thread` ask (or an unrouted one with a selected card) reads `get_case_file`, taking the tool from the run's `toolsFor` list, which always holds both, and the goal tells the model to answer from that read, not from earlier messages. A draft the run held is proposed for sending automatically. |
| the shelves | `ask/tool-groups.ts` | Answer 110, "One agent + read-only shelves". The tools come in one group per domain (`TOOL_GROUPS`), and a run is offered the board and case-file reads (`get_board`, `find_case_files`, `get_case_file`, `tools.ts` `caseFileReads`) always, whatever the route names, then only the routed domains' groups (`toolsFor`), plus `messages` (which adds the held draft and its send proposal) when a card is selected or no domain was named, each tool once, and `give_answer` last; a failed route offers every group. The route step of the transcript carries `offered`. Each task in the ask-agent set fills its own group; today only `messages` has tools. |
| the tools | `ask/tools.ts` | The `messages` group: `get_board`, `find_case_files`, `get_case_file` (read only, `caseFileReads`, offered in every run); `draft_reply` (the one write, a held draft); `propose_send_held_draft` (a proposal). `give_answer` (what the surface shows: `thread`, `floor` or `words`, and the plan's steps). Every proposal goes through `proposeInRun`: one new proposal per run (the next step is proposed after Ben confirms this one, on a fresh read), and the first refusal stops the run's chain. There is no cap on steps across runs (answer A5, "No limit"). |
| the writer | `ask/composer.ts` | `draft_reply` hands a brief to the writing model (`COMPOSER_MODEL`) over the file's thread and customer-visible facts; one more attempt with the refusal named if the guards or the render refuse. |
| the hold | `ask/hold-draft.ts` | The draft goes onto `Hold.draft`, the shape the desk uses for a reply it held back, after the eight guards (`desk/guards.ts` `runGuards`, as a person's action, nothing cited, so no figure, date, commitment, business claim, disclosure, repeated ask or unlined regulated work) and the channel's render as typed. A file with no hold is held for `approverFor` with the reason "Asked on the Handy Desk: <person> asked for a reply to be drafted (<brief>)"; a standing hold with no draft gets the draft and the note (`noteOnHold`); a standing draft is never overwritten. A shut window still holds, with a warning. A session with no approver slot cannot draft. |
| proposals | `ask/actions.ts` | Specification N1 and N15. `proposeAction` saves a change as a row of `comms_v2_ask_actions` (migration `migrations/20260918_comms_v2_ask_actions.sql`; `server/scrub/plan.ts` classifies it): kind, exact args, the exact preview and its sha256 (`previewHash`, over the kind, the args, the preview text and each outgoing tile's address and channel in order), who asked, and `expiresAt`, 15 minutes on or London midnight if sooner (`expiryFor`; `COMMS_V2_ASK_PROPOSAL_TTL_SECONDS` shortens the 15 minutes only when neither `NODE_ENV` nor `DATABASE_URL` is production, see below). It first makes the checks the confirm will: a slot, the slot the file answers to (its hold's approver, else `approverFor`), the kind's preconditions and preview. One open proposal per kind per case file: the same proposal again from the same session is reused and re-pointed to the newer ask run, so the newest answer offering it is the one whose plan moves, a different one is refused while the first waits, and one that no longer matches the file is expired as superseded. `confirmAction` runs it once: not found unless the session is the person's; refused without a slot (403) or with a slot the file does not answer to (403, the proposal stays); expired past its time (410); a compare-and-set from `proposed` to `confirmed` with `confirmedBy: human:<person>` and a fresh run id, so a second or racing confirm gets the first one's outcome and nothing runs twice; then the preconditions and the preview hash again (a change since is refused with `PREVIEW_CHANGED`, never run), then the kind's executor; the outcome is written back as `executed` with its result or `refused` with the reason. `cancelAction` moves it to `cancelled`. Status only moves forward: proposed, then confirmed, then executed or refused; or proposed, then cancelled, expired or refused. |
| the kinds | `ask/action-kinds.ts`, `ask/kinds/` | `ACTION_KINDS`, one `ActionKindDef` per `ConfirmKind` (`shared/ops-types.ts` `CONFIRM_KINDS`): its label, whether it sends, its argument parser, its case file, its preconditions, its preview and its executor, which runs through the desk's one sender or the one function for that change, never an admin HTTP route or the old desk. Registered today: `draft.release` (`kinds/draft-release.ts`: `sendHeldDraft` under the confirming person and the confirm's run id, refusing in the send's own tick when the held draft is no longer the confirmed preview; its preview tile is `replyRouteOf`'s channel and address, the ones the send uses, and its preconditions refuse a file with no route or a shut window in `humanReply`'s own words (`shutWindowRefusal`), so no confirm is offered for a send certain to be refused, a draft held on a shut window stays held with the refusal on the answer's note, and a window that shuts after proposing is refused at confirm, nothing sent). `message.send`, `quote.resend_link`, `booking.move` and `call.start` are added by the other tasks of the ask-agent set; `booking.create` stays unregistered until design-map Q8 is answered, and is refused with that reason. No kind hands a thread kept with a person back to the desk (answer 114): a person's send on Ben's confirm is allowed on such a thread, and the switch back is Ben's, on the thread view. |
| the audit | `desk/case-file.ts` `recordSystemTurn` | Specification N16. A confirmed change that sent nothing leaves a `SystemTurn` on `CaseFile.systemTurns` (additive): what happened, "by human:<person> (ask action <id>)", its action id and run id, once per action. It is kept off `turns`, which every reply-order rule reads, and the thread surface shows the two together in time order. A confirmed message is recorded as its send, as any send is. |
| the answer | `ask/surface.ts`, `ask/plan.ts` | `buildAnswer` reads the surface's data off the store after the loop, never from the model: `thread` is the file's last forty lines (`SurfaceTurn`: its turns, a call turn with its summary, and its system lines as `who: 'system'`), `floor` is `boardOf`'s seven columns with the hold ring and whether a draft stands, `words` is the reply alone. `confirm` is the run's one proposal, `{ label, actionId, kind }` (and, for `draft.release`, the older `action` with its case file id); `outgoing` is that proposal's preview tiles, each carrying `actionId`, then any other draft this run held. `plan` (N14) is the strip for an ask of two or more steps: the steps the reasoner gave, done as it said (the router's steps stand in only for a run that neither proposed nor was refused, since they carry no done flags; otherwise, with no reasoner plan, no strip), and the proposal's step `current` with its `actionId`, or `refused` with the reason verbatim and every later step `dropped` (`buildPlan`). `cleanSteps` keeps every step, trimming only each label. A thread naming a file the store does not hold falls back to `words` with the reason on the note. |
| sessions and confirms | `ask/sessions.ts`, `ask/routes.ts` | `/api/comms-v2/ask` (mounted inside the board router, so behind `requireAdmin`): `POST /sessions/today` (one per person per London day), `POST /sessions`, `GET /sessions`, `GET /sessions/:id`, `POST /sessions/:id/archive`, `POST /sessions/:id/messages { text, via: typed\|voice\|tap, context: { caseFileId?, phone? } }` → 202 `{ runId }`. `GET /actions/:id`, `POST /actions/:id/confirm` → 200 `{ action, repeat, continuedRunId }` or 403/404/409/410 `{ error, action }`, and `POST /actions/:id/cancel`: the person and the slot come from the session (`slotOf`), never the body. A session and its proposals are their creator's; anyone else gets 404. The run streams on the comms event bus (`GET /api/comms/events`) as `ops_message` (the ask), `ops_run_started`, `ops_run_event` (`LeanRunStep`, the first of type `route`), `ops_message` (the answer, `AskMessageDTO.answer`), and `ops_run_finished`, which always fires. Once the answer is written its proposal is named with the message (`attachMessage`). A confirm or a cancel moves that answer's plan (`planAfter`) and re-emits the message as `ops_message`; a confirmed step with steps waiting after it starts the next run of the chain at once, as a `tap` ask "Carry on with the plan: <steps>" on the same session, and returns its `continuedRunId`. Rows live in `comms_v2_ask_sessions` and `comms_v2_ask_messages` (migration `migrations/20260917_comms_v2_ask_sessions.sql`; `server/scrub/plan.ts` classifies them). |
| the board's send | `api/routes.ts` | The one-tap send the kanban already had, `POST /case-files/:id/send-held-draft` (`desk/human-reply.ts` `sendHeldDraft`), with its slot check, window rule, bubble ceiling and, live, the opt-out ledger in `server/outbound.ts`, is the same path `draft.release` runs. `ask/routes.test.ts` holds that an ask-held draft is refused there with exactly the words a desk-held draft gets. |

Reused from the old Ops Manager's wire: `OpsSessionDTO`, `OpsMessageDTO` (extended as
`AskMessageDTO`), `LeanRunStep` and its shaper (`server/agents/transcript-lean.ts`), the four
`ops_*` event names and shapes, and the one-run-per-session lock. Replaced: its tables
(`ops_sessions`/`ops_messages`), its tools, its `queue_draft` write and its model choice.

The client half: the queue (T1, above), the ask bar (T2) and the answer surface (T3) on
`/admin/handy-desk`. The ask bar (`client/src/hooks/useAskSession.ts`, pure state in
`client/src/lib/handy-desk-ask.ts`, components in `client/src/components/handy-desk/`) opens
`POST /sessions/today`, posts each ask with the selected card as `context`, and folds this
session's `ops_*` events into the thinking card (tool names in mono, the newest step amber); it
never calls the old `/api/ops` routes. A live run also settles without `ops_run_finished`: the
session detail is polled while it runs and its answer row (same `runId`) ends it, and a run silent
for three minutes with no answer row settles as failed, so a dropped stream or a restart never
locks the bar. Both the asked answer and the newest answer on the person's newest session render in
the one `AnswerCard` (`AnswerCard.tsx`), which hands the `OpsAnswer` to `AnswerSurfaceBody`
(`AnswerSurface.tsx`, helpers in `client/src/lib/handy-desk-answer.ts`): the typed surface, "What
goes out when you confirm", the note, "Change something" (the sentence back in the ask bar) and the
confirm. The `draft.release` confirm posts send-held-draft with the tile's draft as `expectedDraft`;
on `HELD_DRAFT_CHANGED` it re-reads the case file and shows the new draft for another confirm, and
an answer from an earlier London day offers no send.

This is the core of the ask-agent set (the specification's N1, N14 to N17). Typed for the other
tasks but not produced here: the `pick`, `client`, `booking` and `contractor` surfaces (stubs in
`AnswerSurface`), `diary` (`server/lib/contractor-week.ts`), `map` (`server/dispatch-map-routes.ts`),
`quote` and `ledger` (read only: money actions stay refused), the other tool groups and the other
proposal kinds. `invoice.chase` and `contractor.pay` stay out: no money actions yet.

### Driving the ask agent's confirm

Log in as Ben, open a thread on the app's own door (`POST /api/comms-v2/sandbox/start`), open an ask
session and ask for a reply to that thread, then act on the proposal the answer carries
(`answer.confirm.actionId`) through `/api/comms-v2/ask/actions/:id`:
- with Ben's slot removed from `comms_v2_approvers`, a confirm is 403 and the proposal stays `proposed`;
- with the slot back, a confirm is 200, the draft lands as a dry-run send under `human:<Ben>`, and a
  second confirm is 200 with `repeat: true` and nothing more sent;
- a second session asking for the same send is refused while the first waits; the same session
  asking again gets the same action id, re-pointed to its newer answer;
- a cancel is 200, and a confirm after it is 409;
- a draft changed after the answer is refused with "what this would do has changed", nothing sent;
- a money ask is refused before any tool runs, with no plan and no confirm.

Expiry is proven by `ask/actions.test.ts` with an injected clock; a live check must not wait out the
real 15 minutes. To see it live, start the app with `COMMS_V2_ASK_PROPOSAL_TTL_SECONDS=60` (honoured
only when `NODE_ENV` is not `production` and `DATABASE_URL` is not production, and only below 900), wait a minute, and expect the
confirm to be 410 with the proposal `expired` and nothing sent; otherwise skip the live expiry check.

## Environment

The door needs the branch database string and the model keys from the ordinary environment. The
desk's one database variable is `COMMS_V2_DATABASE_URL` (a Neon branch, never production); the
door host refuses a missing value and a production one and never reads `DATABASE_URL`. Every
store and every writing path in the desk asks again at the moment it would open the database, in
`live-database.ts`, for its purpose. For the sandbox the database in use must be the branch that
variable names, and a refusal names that requirement and falls back to nothing. That is what the
door host gives for free and the deployed server does not: `/api/comms-v2/sandbox` is mounted there
for Ben's board, on the production database, where the quote machinery would otherwise write a real
quote row and publish a quote page with real prices. For the live intake the answer is the desk
switch instead: the database in use, only while the new desk is the live desk ("Which database the
intake opens", above). Writing is the whole subject, so the reviewed knowledge-base readers and
Ben's board reading its own `comms_v2_approvers` row do not ask (contracts.md, Contract 7, "Which
database the tools open", has why). The pipeline's run copies inherit a non-production environment through direnv from
their run root (see `.no-mistakes.yaml`, `test.instructions`); a developer's shell carries its own.
Nothing in the desk loads a file of its own or prints a value.

`COMMS_V2_ASK_PROPOSAL_TTL_SECONDS` shortens how long an ask proposal can be confirmed, for a
sandbox or branch run only: whole seconds, below 900, ignored when `NODE_ENV` is `production` or `DATABASE_URL` is
production. Unset or ignored, a proposal is confirmable for 15 minutes or until London midnight.

`INTERNAL_PHONE_NUMBERS` holds the numbers that are ours but are in no table and must never be in
the repo: Ben's own handset and any staff number the database does not hold. Ben or the captain
sets it on Railway (the service's Variables), as numbers separated by commas, each `+44...` or
`07...` for a UK number, or `+<country code>...` for an international one (for example a `+84`
number), for example `INTERNAL_PHONE_NUMBERS=+447700900001,+447700900002`. Unset means none. It is
read by server/internal-numbers.ts, so the outbound call check honours it too; the intake picks up
a change on its next restart.

## Tests

`npx vitest run server/comms-v2`: every invariant in the contracts with a scripted model client,
the door driven over HTTP the way the test step drives it, the door host's refusal rules, the
database refusal every live writer makes (`live-database.test.ts`, including each method of the
live quote store on a production-shaped connection, and every live dependency refusing production
while the switches are at their defaults), the switches and the one live question (`switch.test.ts`),
the old desk standing down (`old-desk.test.ts`), the live clock (`channels/live-clock.test.ts`), the
chase record surviving the durable store (`service/chase-record.test.ts`), the door's live pass and
the form's photo checks (`desk/switchover-door.test.ts`), a person's reply through the one sender with
no guards over it, and the board's queries, approver mapping and routes. The page's own tests are
`npx vitest run --project client client/src/pages/admin/__tests__/CommsV2BoardPage.test.tsx
client/src/components/comms-v2/__tests__/ThreadView.test.tsx`.
None of them needs a key or a database; a live desk test reads its keys from the environment.
