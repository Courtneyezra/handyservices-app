# Overnight sandbox rounds

One line per round: the scenario, what happened, and the fix (or "no issue").
An `ESCALATE:` line at the top of this file is a live compliance or money finding, added on the
round it was found.

NOTE: (round 13, 17 Sep 2026, 23:26 UTC) — **the Anthropic API for this environment is out of
credit**, so no further live model turns can be driven tonight: every customer turn now comes back
`router_failed` and holds for Ben with the fixed acknowledgement ("Thanks, leave it with me and I'll
come back to you."). The provider's own words, captured on the door's log this round: `router: 400
{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to
access the Anthropic API..."}} (held for Ben)`. That is the desk behaving exactly as designed (a
reading that failed cannot rule out a complaint or a refund, `server/comms-v2/desk/desk.ts:393`, and
model-health pages on a `provider` failure), not a fault — but a later round must not read a
`router_failed` hold as a product bug until credit is back.

ESCALATE: (round 10, 17 Sep 2026) — **a customer who had just paid was answered as a brand new
enquiry.** `POST /api/leads` is the web form's route, but it is not only the web form's: the
personalized quote page posts a lead the moment Stripe has taken the money
(`client/src/pages/PersonalizedQuotePage.tsx:4161`, `source: 'personalized_quote'` with a
`stripePaymentId`), the instant-quote card does the same
(`client/src/components/InstantActionQuote.tsx:62`), and a quote link posts one to reserve a slot.
`server/leads.ts:158` forwarded **every** one of them into the new desk as `kind: 'web_form'`, with
no filter at all, while the old ingest twenty lines below it has always refused exactly these
(`isPostPaymentRecord`, `isWebForm`: "A lead posted AFTER a successful payment ... is not a new
enquiry"). Live, with the desk answering customers, the paid booking therefore lands on the gateway
as a fresh web enquiry: the file that closed on the payment is closed, so it opens a **new** case
file, and the desk sends the web-form acknowledgement — driven on the door this round, word for
word: *"Hi Meredith, thanks for getting in touch. We got your message: "Our bathroom extractor fan
has packed in and the ceiling is". Is it OK if we give you a quick call in the morning to run
through it? Or just reply here with the details and we will price it up."* — and Scoping runs on to
draft a second quote for Ben to price (`quoting: drafted aqsvrl07 for Ben to price`) for the job
they have paid for. Money state: a paid job re-enters the desk as unquoted, is offered a re-price
in writing, and a duplicate quote draft is put in front of Ben. Fixed on the round (below).

ESCALATE: (round 5, 17 Sep 2026) — **an inbound email's opt-out was not honoured at all.** The
email adapter puts `Subject: <subject>` in front of what the person wrote, and the opt-out detector
reads the turn's body, so the whole-message rule could never fire on email: an email whose entire
message was "STOP", under the ordinary subject "Re: Your quote for the kitchen tap at 14 Elm Road",
was routed, composed and answered ("I won't send anything further about the kitchen tap..."), a
quote was drafted for Ben to price, nothing was held and no suppression was recorded anywhere — the
old inbound path's ledger covers SMS and WhatsApp only, so on email the desk's own check is the only
one there is. A longer but still plain "Please unsubscribe me from this, I do not want any more
emails about the quote." was missed the same way, the subject's words pushing it past the
short-message threshold. Live, inbound email reaches this desk whenever `COMMS_V2_EMAIL_INBOUND` is
on, so a customer who writes STOP by email stays unsuppressed and keeps being messaged. Fixed on the
round (below).

- Round 1 (17 Sep 2026) — the reopen template on a hold that is not a question, WhatsApp, driven on
  the app's own comms-v2 sandbox door as Ben. A complaint ("Nobody turned up for the bathroom job
  yesterday... What is going on?") held on `complaint` with the complaint fixed line sent; window
  aged 30h shut; the board's template-offer and send-template both refused with "no template is
  true for this thread", the hold stood and no turn was written — correct. The positive control
  found a live gap: a plain question nothing on file answers ("what year was your company
  founded?") holds on `no_source` and the desk's holding line goes out as the fixed `no_source`
  line woven into a composed reply, so `unansweredQuestion` counted it as an answer and the board
  offered Ben no template at all once the window shut — the customer could never be reopened,
  against behaviour.md answer 94 ("the holding line is not an answer"). Fix: a standing `no_source`
  hold makes the desk's own sends holding lines rather than answers in
  `unansweredQuestion` (`server/comms-v2/desk/human-reply.ts`), read from the recorded exception
  like `heldOnQuestion`, with two regression tests in `desk/human-reply.test.ts`. Re-driven live:
  the complaint still draws nothing, and the question now reaches the template rung (refused only
  by this branch's unapproved `service_reply` rung, an environment limit).
- Round 2 (17 Sep 2026) — file close, WhatsApp, driven on the app's own comms-v2 sandbox door and
  board as Ben. Ben's hand close is right end to end: a `ready` file (Nadia, kitchen tap SE13) closed
  from the board recorded `human:ben@handyservices.com` with his words, and her next message about a
  different job opened a NEW file carrying no job type, location or quote; a held file (Owen, a
  no-show complaint held for `ben`) refused the close with no words ("release needs the approver's
  words") and nothing changed, then closed with his words, releasing the hold, and his next message
  opened a new unheld file. The finding was on the 30-day stale-quote close (answer 95): it runs only
  in the live worker's clock tick, and the sandbox door's `POST /run` did not run it, so the one
  close that reopens could not be driven on the sandbox at all — a live behaviour with no sandbox
  path. Fix: the door's `/run` runs `closeStaleQuotes` before its clock pass, as `liveClockTick`
  does, on its own in-memory files, and names them in `staleClosed`
  (`server/comms-v2/desk/sandbox-door.ts`), with a door-level regression test in
  `desk/sandbox-door.test.ts` (31 days closes, 29 does not; it fails without the change). Re-driven
  live: Priya's quote (au64wlx9, £205) aged 31 days closed as `done` on a `/run`, and her later "is
  that quote still good? how much now?" opened a fresh file and held for Ben on `money` with no
  price and no reissue — correct, since the new file carries no quote.
- Round 3 (17 Sep 2026) — the ask agent's proposal store, WhatsApp, driven on the app's own
  comms-v2 ask bar and board as Ben, with a second synthetic admin seeded on the branch database
  (`va.sandbox.drama@handyservices.test`, listed in no approver slot). No issue: every rule the
  store claims held live. Ben asked for a reply on Marcus's complaint card; the run held the draft
  and saved `draft.release` as a proposal with nothing sent and the draft still on the hold. The
  unlisted admin could neither read (404 "no such proposal") nor confirm (404) Ben's proposal, and
  every board write on that card — release, send-held-draft, answer, close — refused them 403 "no
  approver slot is assigned to this user", with `viewer.canAct` false; asked on their own ask
  session, `draft_reply` came back refused in the same words, so nothing was drafted and nothing
  proposed. Ben's own confirm ran it once, under `human:ben@handyservices.com` — ignoring a
  `person` planted in the body — as three bubbles through the one sender, released the hold, and a
  second confirm returned `repeat: true` and sent nothing more. With
  `COMMS_V2_ASK_PROPOSAL_TTL_SECONDS=60` a proposal made at 20:14:16 expired at 20:15:16 and the
  confirm after it was a 410 with the draft left held for Ben's own send. One thing for the
  captain, written to OVERNIGHT-QUESTIONS.md rather than guessed: the plan strip bound the pending
  confirm to "Promise call tomorrow to rebook", a step the same answer said it could not do, and
  the confirm then marked that step done and chased the next one.
- Round 4 (17 Sep 2026) — the read-only CRM record on a known customer, WhatsApp and the web form,
  driven on the app's own comms-v2 sandbox door as Ben with the door's own record fixture (the drama
  number made a known customer on the branch: one enquiry and invoice SANDBOX-INV-0001, £120 total,
  £40 deposit, £80 outstanding). The finding is live and reproduced twice before the fix: Sam's
  WhatsApp question "have I paid it all off or is there still something outstanding?" was held for
  Ben with the holding line every single time, and no record fact was written, although the record
  read had the answer. The cause was the Service specialist's own schema: `asked`, the short label
  the model writes for each thing the customer asked, was capped at 60 characters, the provider does
  not enforce a string ceiling as it writes, and the model echoed the question back — so the SDK
  threw on the whole answer, every selection in it lost, and the specialist read a failed model call
  as no source. Fix: the ceiling on `asked` is loose (200) and the label is used only as far as
  `askedLabel` clips it (`ASKED_LABEL_MAX`, 60), so no more prose rides into the brief than the
  label it is meant to be (`server/comms-v2/service/service-specialist.ts`), with a regression test
  in `service/customer-record.test.ts` driving the live question through and the prose test in
  `service/service-specialist.test.ts` moved to the new ceiling and the clip. The same drive showed
  a second live fault: because the throw came from the SDK's own parse, `AnthropicModelClient`
  labelled it `failure: 'provider'`, so a Service specialist's schema fight counted as a turn the
  desk could not answer — a `worker_health` page reading "comms desk cannot answer: model call
  failed" with the provider's name on it, and `/api/health/comms-worker` reading `cannot_answer`,
  while the provider was fine. Fix: `failureKindOf` (`desk/models.ts`) classifies structurally — an
  `APIError` is the provider, any other throw is an answer that came back unusable — with a
  regression test in `desk/model-health.test.ts` built on the genuine SDK throw. Not an ESCALATE: no
  wrong figure, invoice state or reissue ever reached a customer; the desk failed closed both times.
  Re-driven live after the fix: the same question is answered from the row in three bubbles —
  "sent, not yet paid", deposit £40.00, balance £80.00, due 28 September 2026 — every figure and
  date the row's own as a `crm:` fact, all eight guards passing, no hold. The negative controls hold
  too: the same question through the web form door with the same phone and postcode bound no
  customer id, read no record and held for Ben with no figure (answer 126), and a haggle on the same
  invoice ("any chance of knocking something off that invoice?") held for Ben on `refund` with the
  fixed line, no figure, no quote and no reissue.
- Round 5 (17 Sep 2026) — opt-outs and STOP, driven on the app's own comms-v2 sandbox door as Ben
  across SMS, a call and email. SMS is right: a job enquiry answered, then "STOP" mid-thread got no
  reply and no model call ("the customer asked us to stop (\"stop\", marketing): no reply, no model
  call"), no new hold, and Ben's card shows the STOP as the last customer message. A call where the
  caller said "...I sorted it at the weekend so please stop contacting me about it" was read by no
  model and held for Ben to record the opt-out, naming the channel. Email was broken (the ESCALATE
  above): the subject line the adapter carries in front of the message meant a bare "STOP" email was
  answered and a "Please unsubscribe me..." email was answered, with no hold and nothing recorded.
  Fix: the opt-out check reads an email both whole and as the message on its own, without the
  `Subject:` line (`withoutEmailSubject` in `channels/email-adapter.ts`, beside the one place that
  writes that line; `emailTexts` in `desk/desk.ts` `optOutIn`, the same shape as the call
  transcript's sentences), with a desk regression test (a bare STOP under a real subject holds for
  Ben; it fails without the fix), a negative control (an email that only mentions a tap that will
  not stop dripping is still routed, composed and sent) and an adapter test for the helper.
  Re-driven live: both emails now get no reply, no model call and a hold for Ben naming the channel,
  and the tap email still gets its normal reply. One thing for the captain rather than a guess,
  written to OVERNIGHT-QUESTIONS.md: while that opt-out hold stands, the person's next message ("Did
  you get my email?") drew a full composed reply asking for the postcode and a photo, offering a
  call and offering WhatsApp — the desk treats an opt-out hold as an ordinary hold, and behaviour.md
  records nothing about what a thread should do between the stop request and Ben recording it.
- Round 6 (17 Sep 2026) — the expired quote and the +5% reissue, WhatsApp, driven on the app's own
  comms-v2 sandbox door as Ben (scoped a bathroom fan and a sticking door at SE13 5QT, Ben priced
  and sent, `/lapse` expired the quote). The finding is live: the most ordinary way a customer
  returns to a quote that lapsed weeks ago — "Hi Ben, sorry for the slow reply. Is that price still
  ok?" — was not reissued at all. `plainPriceAsk` (`desk/lexicon.ts`) requires every clause to be a
  plain price ask or a pleasantry, and its pleasantry list holds a bare "sorry" but nothing like
  "sorry for the slow reply", so the apology made the whole message not-plain, the money exemption
  did not fire and the thread held for Ben on `money: price` with the holding line ("I can't confirm
  the figure just yet"). The captain's ruling is that a plain ask of the quote's own price is
  answered by the reissue, and an apology for being slow to write back asks nothing, names no figure
  and adds no scope. Fix: the pleasantry set takes that apology family (`DELAY_APOLOGY` in
  `desk/lexicon.ts`: "sorry for the delay", "apologies for the slow reply", "sorry it's taken me so
  long to get back to you", "sorry for not getting back to you sooner", each with an optional "on
  this"), narrow on purpose so an apology about anything else is still not a pleasantry, with four
  regression tests in `desk/reissue-desk.test.ts` (three plain asks under an apology reissued — they
  fail without the fix — a delay apology beside a discount ask still Ben's, and "sorry for the mess
  in the bathroom, how much is it now?" still Ben's) and the rule restated in
  `docs/comms-v2/contracts.md`. Not an ESCALATE: nothing wrong went to the customer and no figure
  moved, the desk failed closed to Ben; the cost is a reissue that never happens and a card Ben must
  answer by hand. Re-driven live after the fix on a fresh thread: a £169.00 quote lapsed, the same
  message reissued it at £178.00 (169 × 1.05 = 177.45, up to the pound), one reply of three bubbles
  (146/50/127 characters) opening with the expiry sentence and the link, every guard passing and no
  hold. The haggle control on the same door holds: a lapsed £188.00 quote met with "Sorry for the
  slow reply. Any chance of knocking a bit off that price?" held for Ben on money with no figure in
  the reply, no reissue, and the row still £188.00 and expired. Noted for a later round, not chased
  here: the door's `POST /reset` now fails to delete the sandbox quotes it made
  (`quotes: { error: 'violates foreign key constraint "invoices_quote_id_personalized_quotes_id_fk"' }`),
  so the drama number's quote rows stay on the branch; nothing customer-facing reads them, since a
  file reads only its own `quoteRef`.
- Round 7 (17 Sep 2026) — "do you cover <area>" questions and a mixed coverage-plus-job message,
  WhatsApp, driven on the app's own comms-v2 sandbox door against the branch database (the reviewed
  areas row on the branch is `sandbox-kb-areas`, "We cover Nottingham and the surrounding areas,
  Beeston and West Bridgford included"). The baseline holds: "Hi, do you cover Beeston?" answers
  from that row word for word with no hold, and the mixed message ("Do you cover West Bridgford? The
  radiator valve in the back bedroom is leaking.") answers the coverage half from the row and scopes
  the job half in the same three bubbles, drafting a quote for Ben to price. The finding is live: the
  most ordinary British way of asking — "Hi, whereabouts do you cover?" — was not read as a coverage
  question at all. `asksAboutOurArea` (`service/service-tools.ts`) knows "where are you based" but
  nothing beginning "whereabouts", and nothing of the plain "where do you cover?" either, so on that
  turn the router did not list service, the Service specialist never read the turn, the areas row was
  never offered, and the desk sent "I'll double-check exactly what I can cover for you and come back
  to you on that" and held the file for Ben on `no_source`. The same miss bites from the other side:
  "Whereabouts are you based?" DID route to service, but because the matcher said no, the
  `AREA_QUERY` augmentation of the knowledge-base lookup was not added, the stem search found
  nothing, and Service raised `no_source` itself — a question we hold a reviewed answer to, held for
  a human on both paths. Fix: two clauses in `RE_AREA_PHRASE` — "where"/"whereabouts" in front of a
  verb about where we work ("whereabouts do you cover", "where do you cover", "whereabouts can you
  come out to", "whereabouts do you guys work") and "whereabouts are you based" folded into the
  existing based clause — deliberately narrow, because "whereabouts" is the same trap "cover" is:
  six positive regression cases (all six fail without the fix) and five negatives beside them in
  `service/service-tools.test.ts` ("whereabouts are you?" is a customer asking when we are coming,
  "whereabouts do you want the old radiator left?" and "whereabouts is the stopcock usually?" are
  about the job, "whereabouts do you go for parts?" is about us but not our patch). Not an ESCALATE:
  nothing wrong went to the customer and no figure moved — the desk failed closed to Ben; the cost is
  a card for Ben on a question the knowledge base answers, and a first reply that stalls the enquiry.
  Re-driven live on a restarted door: "Hi, whereabouts do you cover?" and "Whereabouts are you
  based?" now both cite `sandbox-kb-areas` verbatim with every guard passing and no hold, and
  "Whereabouts do you cover? Bathroom extractor fan has packed up in Beeston." answers the coverage
  half and scopes the fan in three bubbles (123/110/109 characters). Negative controls re-driven
  live: "Whereabouts are you? I have been waiting since 9." draws no areas row and holds for Ben as
  before, and "Whereabouts do you want the old radiator left?" stays an ordinary scoping turn with no
  knowledge-base row cited. Noted, not chased: that radiator reply said "I'll come back to you on
  where best to leave it" and raised no hold, because the question reads as a job ask — the thread
  went on to draft a quote for Ben, so the question reaches him on the card, but the deferral itself
  is unrecorded.
- Round 8 (17 Sep 2026) — photos and video on an enquiry, WhatsApp, driven on the app's own comms-v2
  sandbox door against the branch database (a synthetic leaking-tap photo and a synthetic
  dropped-door video generated for the drive; no real customer media). The finding is live and
  reproduced on the desk and then straight against the provider: a photo on an enquiry was **not
  described at all**. Tessa's "it is coming from round the bottom of the tap where it meets the
  worktop" with the photo attached logged `[describe_video] ... attempt 1 failed (no JSON object in
  model reply); retrying once` and then `no description after 2 attempt(s)`, so no `media_image`
  fact was written, the photo added nothing to the scope, and the reply fell back to the
  no-description wording ("Thanks for the photo too") with no detail off it — behaviour.md answer
  92's one light detail never happens. The cause is the output ceiling: `callGemini`
  (`server/spine/tools/describe-video.ts`) asked for `maxOutputTokens: 1024`, and Gemini 3 Flash
  thinks on every call and cannot be told not to (the module's own T14 note), with Google counting
  those thinking tokens against that same ceiling. Replaying the desk's exact request five times
  against the provider: thinking cost 658, 749, 891, 965 and 979 tokens, and three of the five came
  back `finishReason: MAX_TOKENS` with the JSON cut mid-object — so roughly half of all photo and
  video descriptions die, silently and at random, the desk only ever seeing "no JSON object in model
  reply". Fix: `MAX_OUTPUT_TOKENS` (4096) with the measurement written down beside it, and a reply
  cut at the ceiling now says so ("gemini reply was cut at maxOutputTokens (4096); thinking tokens
  count against it") instead of being reported as a model that answered off-schema, classified
  `reply` and retried as before. Two regression tests in `describe-video.test.ts` (the request's
  ceiling clears the measured thinking plus a description; a `MAX_TOKENS` reply is named, retried
  once and never cached) — both fail without the fix. Not an ESCALATE: nothing wrong went to the
  customer and no figure moved; the cost is every photo and video the desk half the time never
  reads, and a quote brief built without it. Re-driven live on a restarted door: the same photo is
  now described (`media_image`: chrome swan-neck tap, water pooling, green limescale at the base
  flange) and the reply is three bubbles of 100/79/41 characters opening "Thanks for the photo
  Tessa, that's really helpful. I can see the water pooling on the worktop there." — one light
  detail, no defect, no brand, no mention of what is not shown. The next turn (postcode and "it's a
  mixer tap") does not thank for the photo again, the media ledger reading thanked once. A second
  thread with a video and a photo in the same turn described both, recorded `media_video` and
  `media_image`, and answered in two bubbles: "both came through fine. I can see the door catching
  on the frame in the video, and the water pooling on the worktop in the photo." — one light detail
  each, every guard passing and no hold.
- Round 9 (17 Sep 2026) — phone calls, answered and missed, driven on the app's own comms-v2 sandbox
  door against the branch database (the door's call front door and `POST /call`, on the drama
  number). The baseline holds on every rung: a missed first contact drew one text back
  (`missed_call_ack` on WhatsApp, the same words as one SMS on a number not on WhatsApp), a second
  missed call on the same thread drew nothing ("one text back, never a second (checklist 3.5)"), a
  missed call on a thread we had written on minutes earlier drew nothing either and stayed on the
  board, an answered inbound call was read for facts with no acknowledgement, and Ben's own outbound
  call (`ben_rang`) sent `post_call_followup_v1` and left the file unheld. Ben's bubble carries what
  it should: `callViewOf` (`server/comms-v2/api/board.ts:169`) gave the headline, the telephony
  side's one-line summary and the whole transcript on each answered call, and headline-only on a
  missed one. The finding is live and came out of the first realistic long call: an eight-minute
  call in which the customer listed six jobs round the house was **not read at all**. The desk
  logged `call reader: Failed to parse structured output: ... benAskedFor.0.detail: Too big:
  expected string to have <=80 characters` and the file was left with nothing but `call_outcome` and
  the summary — no job type, no job phrase, no `location` (NG9 3TR was said out loud), no
  `ben_asked_for`, stage stuck on `scoping` instead of `ready`, and none of the three things Ben
  asked for on the phone (photos, the alcove measurements, who would be in) on the ask ledger, which
  is the one thing this reader exists to carry. The cause is round 4's fault in another file:
  `callReadSchema` (`server/comms-v2/channels/call-reader.ts`) capped the model's own free text at
  80/120/60 characters with the ask array at 6, the provider does not enforce a string or array
  ceiling as it writes, and one field 10 characters over makes the SDK's parse throw, so the whole
  answer is lost — there is no retry, and `readCall` reads a throw as a call it could not read. Fix:
  the schema's ceilings are loose enough that only runaway prose trips them, and the intended length
  is applied after the parse by `clipCallRead` (`CALL_READ_LIMITS`, `ASKED_MAX`), so a long answer is
  shorter rather than a call nobody read; two regression tests in `channels/call-reader.test.ts` (the
  measured live answer now parses, clips and reaches the ledger; every field clips and a short answer
  is untouched), both failing without the fix. Not an ESCALATE: no figure, invoice or reissue moved
  and nothing wrong went to the customer; the cost is a call the desk never heard, a quote brief
  built without it, and the customer asked again for the photos and the postcode they had just given
  Ben on the phone. Re-driven live on a restarted server: the same transcript now lands `job_type`,
  `job_phrase`, `location` NG9 3TR and `ben_asked_for` (all three asks) at hang-up, the file moves to
  `ready`, the bubble still carries the headline, the summary and all 3,525 characters of transcript,
  and the customer's next message ("When do you reckon you could get to it?") is answered in three
  bubbles (38/73/99 characters) that ask for none of it again: "No worries Rhian, good to chat
  earlier. / I'm usually booking in about 4 days at the moment, so not too long a wait. / With it
  being a fair list, is there one bit you'd want doing first, say the grab rails for your mum?"
- Round 10 (17 Sep 2026) — the web enquiry form as a front door in its own right, driven on the
  app's own comms-v2 sandbox door against the branch database (the form door, `POST /start` with
  `door: "form"`). The front door itself is in good shape on both of its branches. On a number that
  is on WhatsApp the reply is the approved acknowledgement and nothing else: `windowState: "shut"`,
  `templateId: "web_enquiry_ack_context"`, one bubble quoting the enquiry back and "in the morning"
  for `{{3}}` (the drive ran at 22:13 UTC, outside Ben's hours, which is the meaning the registry
  row declares), every guard passing, approver `agent.comms_v2`, no hold. The intake facts land as
  the adapter promises — `customer_name` and `location` NG7 2QP written `by: "form_adapter"` at the
  form turn, the job type left to Scoping, which then wrote it — and the file goes to `ready` with a
  quote drafted for Ben to price. On a number that is not on WhatsApp the same enquiry opens SMS
  instead (`channel: "sms"`, no template, one message of 293 characters inside the two-segment
  ceiling) and carries the `move_to_whatsapp` fixed line exactly once ("If it's easier, you can
  message us on WhatsApp on this same number"), which is checklist 1.4 on a door that is not SMS.
  The finding is not in the door but in what feeds it live: `POST /api/leads` is the web form's
  route and also four other screens', and `server/leads.ts:158` forwarded every lead it inserts into
  the new desk as `kind: 'web_form'` with no filter, so a booking the quote page records after Stripe
  has taken the money reached the desk as a fresh enquiry — see the ESCALATE line at the top of this
  file for what the customer would have received, driven word for word on the door. The old ingest
  in the same handler has always refused exactly those leads (`isPostPaymentRecord`, and an
  `isWebForm` allow-list of the web form's own sources), so the fix is one rule both paths read:
  `isWebFormEnquiry` (`server/leads.ts`) — never a lead carrying a `stripePaymentId`, never
  `personalized_quote`, otherwise the web form's own sources (`web_quote`, `webform`, `website`,
  `*hero_flow`) — with the forward gated on it and `isWebForm` now derived from it, so a source
  added later cannot be added to one path and forgotten on the other. Five regression tests in
  `server/leads-comms-v2-forward.test.ts` drive the real route handler: a `desktop_hero_flow`
  enquiry is forwarded, a paid `personalized_quote` booking is not, a paid `instant_quote` booking
  is not, a `quote_link_reservation` slot is not, and the rule itself is pinned source by source;
  the three "not" tests fail against the old code. The forward itself could not be driven live,
  because it runs only under `COMMS_V2_INTAKE`, which this run may not set — the door drive shows
  what the desk does with that envelope and the route tests show which leads now build one. Two of
  the newly-excluded sources are a product question rather than a defect, raised as
  OVERNIGHT-QUESTIONS.md entry 4 (a reserved slot and the instant-price tool now reach the desk not
  at all).

- Round 11 (17 Sep 2026) — bubble size and pacing across a longer exchange, WhatsApp, driven on the
  app's own comms-v2 sandbox door: a five-job enquiry from a Bramcote flat and four customer turns
  (the shelf wall, two more jobs plus availability, a rambling turn with a job withdrawn, then five
  questions fired at once). The bubble rules held on every turn: three bubbles at most and never one
  over the soft 160 characters (answer 93) — 153/141/114, 138/131/63, 145/112/41 and 147/137/92
  characters — with typing gaps of 4590/4230/3420, 4140/3930/2500, 4350/3360/2500 and 4410/4110/2760
  ms, each roughly its own bubble's typing time inside the 2.5 to 7 second band (answer 91). The
  five-question turn was answered with what the file could answer, one wrap-up, and the rest held for
  Ben (`no_source: Is parking a problem, our road is permit only on one side?`), still in three
  bubbles, and the render never had to ask the composer to shorten. No bubble or pacing fault.
  **The fault this round found is in the pricing path.** Twice inside the one quote the desk drafted
  for Ben, the estimator's `search_web` came back `{"summary":"Web search failed: results is not
  iterable","sources":[]}`: Anthropic's web-search tool puts an **object** in a result block's
  `content` when that search errored (`web_search_tool_result_error`, with an `error_code` such as a
  rate limit, which the reply before it said in words: "my search access got rate-limited"), and
  `server/agents/estimator-tools.ts:139` iterated that object, so the `for ... of` threw, the catch
  around the whole request caught it, and the model's own text — the material prices it had already
  found and written out — was replaced with that error string. Live, every quote the new desk drafts
  is priced by this estimator, so a search that part-errored lost its price evidence silently and the
  line fell back to a model estimate. Fixed on the round: `webSearchAnswer` (same file) reads the
  block shape before iterating it, keeps the text and the sources of the blocks that worked, names
  each `error_code` to the estimator and warns with it, so a part-refused search is a search with an
  error named rather than a search that never happened. Three regression tests in
  `server/agents/estimator-tools.test.ts`, all three failing against the old reader with exactly the
  live message (`TypeError: results is not iterable`).
  Re-driven after the fix on a fresh five-job enquiry (Sherwood): the estimator's three parallel
  searches all came back with their answers and the log carries no `results is not iterable` and no
  part-refused search, so the reader is no longer the thing that decides whether a search counted.
  The post-fix drive's own reply kept the rules too: 95/147/144 characters in three bubbles, gaps
  2850/4410/4320 ms.
- Round 12 (17 Sep 2026) — held drafts on Ben's board: the queue, what a card carries, releasing and
  sending a held draft, and the guards over Ben's own words. Driven on the app's own comms-v2
  sandbox door and board as Ben (Dermot Whelan, West Bridgford, a dripping kitchen mixer tap and a
  dead extractor fan; enquiry, Ben prices, 30 hours pass, the customer accepts and pays the deposit
  on the quote page). The board's own rules held on every step: `/queue` gave the card with the
  hold's reason and exception, its working-hours wait, `hasDraft`, the job type, location, last
  customer message, reply channel, mode and Ben's `benToRequest` list; `release` with blank words
  refused ("release needs the approver's words") and changed nothing; `send-held-draft` on a hold
  carrying none refused ("there is no held draft to send"); an `expectedDraft` that was not the
  draft now held refused with "the held draft changed since you saw it"; and on a shut window both
  Ben's typed answer and the held draft refused with the window's own words rather than holding
  silently. **The guards are the composer's and not Ben's**, proven live: his answer -- "all our
  work is guaranteed for 12 months ... I will come back and sort it at no charge. I can do Tuesday
  the 22nd at 9am, and ... about 180 pounds all in" -- a figure, a date, a commitment and a claim
  about the business with no fact behind any of them, went out exactly as typed, split at his blank
  line, under `human:ben@handyservices.com`, with the hold released in his words and no guard
  record on the send. The desk's own composed turns on the same thread were guarded (all eight
  passing). The "Send as is" path works end to end: the acceptance hold's draft went as two bubbles
  ("Thanks Dermot, that's come through and I've got the deposit, appreciate it." / "I'll be in touch
  about the day.") under his human approver once the customer wrote again and the window reopened,
  and the hold cleared with the draft recorded as the release. A plain `release` with words cleared
  a hold and sent the customer nothing.
  **The fault this round found is on the shut-window template button.** On the accepted file --
  stage `accepted`, `quote_status = accepted: the deposit is paid`, £176 deposit taken -- the board
  offered Ben `quote_ready_link` and would have sent it: *"Hi Dermot, your quote is ready.
  Everything is on the link, the itemised price and the booking:
  https://handyservices.app/quote/4ktwxtqu. Any questions, just reply here."* That is the one wording the captain's answer 58 forbids
  ("only a template that is true for the thread"): they are not waiting for a quote or a booking,
  they have accepted and paid, and the desk itself held the file one line earlier saying what they
  are waiting on is a word from Ben about the day. `sentQuoteLink`
  (`server/comms-v2/desk/human-reply.ts:199`) read the link off the file's sends with no regard for
  what became of the quote, so every accepted thread whose window has shut -- the ordinary shape of
  an acceptance, since most people accept more than 24 hours after their last message -- carried
  that offer on Ben's card (`/admin/comms-v2` and the Handy Desk both read
  `GET /case-files/:id/template-offer`, `client/src/pages/admin/CommsV2BoardPage.tsx:361`). Not an
  ESCALATE: no price, invoice or payment state moves on it -- the quote store refuses a second
  acceptance (`server/comms-v2/quoting/quote-store.ts:187`) -- it is a false thing said to a
  customer who has just paid. Fix: `sentQuoteLink` offers no link for a quote the file records as
  accepted, read through the new `acceptanceRecorded`
  (`server/comms-v2/quoting/quote-record.ts`), which is the read the live Stripe path already made
  inline and now shares (`quoting/live-acceptance.ts`). Two regression tests in
  `desk/human-reply.test.ts`: an accepted, paid thread offers and sends nothing ("no template is
  true for this thread"), which fails against the old code by sending `quote_ready_link`, and an
  acceptance recorded against a different quote leaves this thread's offer alone. Re-driven live on
  a fresh enquiry through price, 30 hours and an acceptance: `template-offer` now answers "no
  template is true for this thread: the customer needs to write again before a reply can go",
  `send-template` refuses it 409, and the card still carries the desk's own held draft for Ben to
  send the moment they write.
  One thing noted and not chased: a held draft is not re-checked against what the desk has said
  since, so after the customer wrote again and the desk's fresh reply confirmed the deposit, the
  older draft on the same hold still said it too. Sending it is Ben's own call and his words are
  never checked (answer 43), so this is left as recorded behaviour.
- Round 13 (17 Sep 2026) — a plain thanks after the quote is promised (answer 90), WhatsApp, driven
  on the app's own comms-v2 sandbox door (Aoife, a radiator come loose off the wall and a towel rail
  pulled out of the plaster, first floor bathroom, Sherwood NG5). **No issue on the behaviour.** The
  thread ran enquiry → one scoping question (wall type, with a photo offered once) → one access
  question → the wrap-up *"Brilliant, thanks Aoife, driveway parking and someone in during the day
  makes life easy." / "That's everything I need for now. I'll put the quote together and send it over
  to you here."*; the customer's bare "Thanks 🙏" then drew exactly one short bubble, *"No worries
  Aoife 👍"*, routed `turnKind: acknowledgement`, all eight guards passing, with no repeat of the
  quote promise and no second wrap-up. Bubble counts held throughout (3, 2, 2, 1).
  What the round did find is on the door itself, not the desk: the desk says why it held a turn
  **only** through `DeskDeps.log` (`server/comms-v2/desk/desk.ts:372`, `:394`), and the door host
  passed none (`server/comms-v2/desk/door-host.ts:89`), so that log was a no-op and a `router_failed`
  hold arrived on a drive with no reason attached at all — the response carries the fixed hold
  wording and nothing else. The next turn of this very round held that way, and the only way to tell
  whether the desk had misread a polite "Brilliant, thanks again. Looking forward to seeing the
  quote." or the provider had simply gone down was to wire the log up. Fix: `doorRouterDeps`
  (`server/comms-v2/desk/door-host.ts`) gives the sandbox router the desk's log on the door's stdout,
  one line prefixed `[desk]`, with two tests in `desk/door-host.test.ts` pinning the log and the
  approver it is built with. Re-driven live on a fresh door: the same turn now prints its reason, and
  it was the provider — this environment's Anthropic credit had run out mid-round (the NOTE at the
  top of this file). The app-mounted copy of the same door (`commsV2BoardDoor()` in
  `server/comms-v2/api/store.ts:26`, built with `{}` from `server/index.ts:522`) is still silent the
  same way; left alone this round because that singleton is built by whichever caller reaches it
  first.
