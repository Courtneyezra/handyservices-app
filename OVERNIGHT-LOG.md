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
