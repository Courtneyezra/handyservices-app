# Overnight sandbox rounds

One line per round: the scenario, what happened, and the fix (or "no issue").
An `ESCALATE:` line at the top of this file is a live compliance or money finding, added on the
round it was found.

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
