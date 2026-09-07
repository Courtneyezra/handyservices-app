# BRIEF T21 — the follow-up after Ben's own call

Branch `fm/post-call-followup-t21`, from `941f467` (T19 merged). Written before coding.

## The captain's flow, in his words

> this is the flow when delaing with an inbound whatsapp, we ask for a call (optional) as they can
> proceed with messages but if happy and ben calls the post call follow up is needed as most the
> time ben will ask the uers on the call to send videos and pictures over for him to take a look

A customer writes on WhatsApp (the 24 h window opens). The ack offers a call. They say yes, Ben
rings them from Groundwire, and on the call he asks for photos or a video. The message after that
call is not a courtesy: it is the thing that collects what he asked for. Today nothing sends it.

## What the code does today (established, not assumed)

**The two gates.** `server/post-call-ladder.ts`:

- line 69: `if (!inbound) ackReason = 'outbound call: no customer ack';` — the ack branch never runs
  for a call Ben made (right: nobody rang us).
- line 88: `spineRun = input.spineEnabled && kind === 'answered' && transcript.length >= MIN_TRANSCRIPT_CHARS ? 'call_ended' : null`
  — `'answered'` is the INBOUND kind (`classifyCall`, line 62: an outbound call is
  `outbound_answered` / `outbound_unanswered`). So an outbound call never asks the spine for a run.
- `server/call-thread.ts:618-624` requests `call_ended` only when `plan.spineRun` is set. PRD §4.1's
  "Ben's own call feeds the scoping (`call-thread.ts:606-623`)" is therefore false in the code: that
  block is only reached for an inbound answered call. The existing test pins it
  (`server/__tests__/post-call-ladder.test.ts:72`: outbound → `spineRun: null`).

**How an outbound call is recorded and transcribed.** Groundwire dials through
`POST /api/twilio/sip-outbound` (`server/index.ts:1078-1123`), which forks the media stream to the
same realtime recorder as an inbound call with `legRole=agent_originated`, so the row is created
with `direction: 'outbound'` (`server/twilio-realtime.ts:114`) and the speaker labels are swapped.
`/api/twilio/sip-outbound-status` (`index.ts:1134-1160`) writes the real talk time and
`OUTBOUND_ANSWERED` / `OUTBOUND_NO_ANSWER`; `finalizeCall` keeps that result
(`server/call-logger.ts:226-239`) and ingests the call with the live options
(`call-logger.ts:293-299`: ack, continuation, outboundOpensCard). Then, for any call over 10 s
(`twilio-realtime.ts:203`), the same chain runs for both directions: Deepgram batch transcription
(which also classifies: outbound gets `SYSTEM_PROMPT_OUTBOUND`, kind `outbound_call`,
`server/call-classifier.ts:93-106`) → the video-request decision (refuses `NOT_INBOUND` at
`post-call-outreach.ts:318`) → the lead upsert (fills `calls.jobSummary` when empty,
`server/call-lead.ts:89`) → a second `ingestCallIntoThread` with the transcript in hand
(`twilio-realtime.ts:245`). That second ingest runs the ladder again with the transcript and is
exactly where an inbound call gets its `call_ended` run; an outbound call gets nothing there. So
the code guarantees an outbound call is transcribed whenever an inbound one would be; the PRD's
"38 of 51 transcribed" is consistent with Deepgram failures, not with a gate.

**The freeform window across the call.** `canSendFreeform` reads `conversations.lastInboundAt`
and answers open when it is under 24 h old (`server/meta-whatsapp.ts:833-852`). Call ingest never
writes that column (`call-thread.ts:558` "Deliberately absent: lastInboundAt"; the file header's
rule 1). So a customer's WhatsApp before the call keeps the window open across it, and a reply
after the call may be freeform. That is what makes this case different from
`post-call-outreach.ts`, which is written for a call that arrives with no window (its header).

**What the spine learns of a call.** `buildCaseFile` reads the newest 8 `calls` rows for the
number and puts each on the timeline as `call_in` / `call_out` with `body` = `calls.jobSummary`
and `transcript` = the first 4,000 characters (`server/spine/case-file.ts:114-119, 146-153`). The
call's card line (with the classifier's one-line summary) is also there as a `message_out` on
channel `call`. The Scoper renders a transcript clipped to **700 characters, head only**
(`server/spine/agents/scoper.ts:68, 163`): about 50 seconds of talk. Ben's ask for photos is at
the end of the call, so on a three-minute call the Scoper does not see it. Triage's model input
gets 600 characters (`triage.ts:255`).

**Triage would re-fire on the customer's stale message.** `lastInbound(cf)` returns the newest
`message_in` / `call_in` (`triage.ts:98-104`); a `call_out` is not one. On a run after Ben's call
the rules read the customer's last message ("yes please call me") as `text` (`triage.ts:114-115`)
and `RE_CALLBACK` lanes the thread to Ben again (`triage.ts:151-160`), so even with the gate open
the pass would flag and no agent would speak. The flag would dedupe on the open row
(`exit.ts:145`), so nothing at all would happen.

**The send preconditions hold the follow-up for Ben.** On a SEND-tier `ask_gap`, `decide` runs
`sendPrecondition` last (`decide.ts:141-147`): `isReactive` (the customer wrote inside 45 min),
then `ours_is_newest` — and a `call_out` counts as ours (`send-preconditions.ts:72-73, 119-121`).
Ben's call is always newer than the message that asked for it, so the Scoper's reply on this pass
is always `pending` for Ben. The T17 `pending_draft` chase lane covers spine drafts
(`sla-sweep.ts:100`, source `spine`).

**The outreach protections** (`post-call-outreach.ts`): `decideOutreach` (186-221: no
classification → nothing; complaint → a human; declined / objection → `no_auto_messages`;
callback promised or call incomplete → callback_due, nothing sent), `evaluateSendRails` (447-507:
unparseable phone, suppressed numbers, mobile-only, the 30-day dedupe on `videoRequestSentAt`, an
existing WhatsApp thread, quiet hours), and the minimum duration (323). Production:
`post_call_video_request.enabled = true`, classify on, allowUndiscussed off, mobile only, 20 s
minimum, quiet 21:00–08:00, 30-day dedupe.

**Two things nobody honours today.** (1) `no_auto_messages` is read nowhere under `server/spine/`
(grep): a thread so tagged can get a Scoper reply on any pass. (2) T17's way back excludes call
rows on purpose (`server/agents/silence-breaker.ts:141`: `notInArray(channel, ['call','note'])`),
so a call Ben makes never releases a thread from Ben, and the spine's `callback_requested` flag
stays open after he rings. The older `callback_due` tag IS settled by an outbound call
(`call-thread.ts:567-578`).

## The two decisions

**1. Who composes.** The Scoper, on the `call_ended` run. It reads the case file with the call on
it, its `ask_gap` intent is exactly "ask for a photo or video", the guards, `neverSend` and the
send preconditions already apply, and the exit is the only sender. A direct send from the
post-call lane would be a second sending path with its own wording rules, its own rails and its
own Approver, for a message whose whole point is to read as part of the conversation. The
template ladder stays as the fallback for a shut window, unchanged.

**2. What the agent knows.** Today: not enough. The case file carries the first 4,000 characters
of the transcript and the summary lines; the Scoper is shown 700 of those characters. This brief
fixes the second half (the Scoper renders what the case file carries: summary and transcript, up
to the case file's own 4,000-character cap) and states the residual plainly: a call longer than
about five minutes loses its end at the case file (head-only cap). That is reported, not built
around.

## What to build

**A. The ladder (`server/post-call-ladder.ts`, pure).** `outbound_answered` with the spine on and a
transcript over the bar asks for `call_ended` too, behind the inherited rails, evaluated from
inputs the caller gathers (`LadderInput.outbound`): the outreach config (unreadable → nothing),
the minimum duration, a parseable mobile number not on the suppression list, no
`no_auto_messages` tag, a classification on the row (none → nothing: a call we could not read
authorises nothing), no messaging objection or decline (→ tag `no_auto_messages`), not a
complaint, not an incomplete call, no video request inside the dedupe window, not quiet hours.
The plan carries `spineRunReason` in the live module's own reason words, `tagNoAutoMessages`, and
`settleCallback`. `callbackPromised` on an OUTBOUND verdict is not a refusal: the outbound prompt
defines it as "further contact promised (a call, a quote, a text)" (`call-classifier.ts:104`), and
the follow-up IS that contact; `callIncomplete` (the line dropped) is. The existing-WhatsApp-thread
rail is not inherited: it exists to keep a template off a live thread, and the live thread is the
premise here. Both are stated in the report.

**B. `server/call-thread.ts`.** Gather the rail inputs for an answered outbound call, each
fail-closed (a failed read is a missing input and the ladder sends nothing), log the reason when
the hand-off is refused, apply `tagNoAutoMessages`, and settle the callback: an ANSWERED outbound
call on a thread waiting for a call (`callback_requested` tag, or an open `[callback_requested]`
flag) clears the tag and goes through T17's door `releaseFromBen` with `by: 'system:outbound_call'`
so the thread comes back. A call on a thread that was not waiting for one does not release it
(T17's rule stands). `CallThreadResult` gains `ladder` so the sandbox can show the plan.

**C. `server/spine/triage.ts`, surgical.** New pure helper `answeredByOurCall(cf)` in its own
module (`server/spine/answered-by-call.ts`): true when the newest conversation turn is an outbound
call with a transcript and it is newer than the customer's last message. In `triageRules`, when it
is true the text lexicons do not re-fire on that message (the `if (text)` block gets one extra
condition; `dateAsked` too), with a reason line. Nothing else in the file. Lines: the `dateAsked`
line and the `if (text) {` line only; T18's `RE_REGULATED` line and T20's first-contact branch and
`mergeTriage` are not touched.

**D. `server/spine/agents/scoper.ts`.** `renderTimelineItem` shows a call as its summary line plus
the transcript clipped at 4,000 (the case file's cap), instead of the transcript alone at 700.

**E. The sandbox.** `POST /api/comms-sandbox/call { transcript? }`: on the current sandbox
thread, insert the outbound `calls` row (answered, `OUTBOUND_ANSWERED`, the classifier's
outbound-shaped verdict, a summary), then run the LIVE `ingestCallRow` with the live options, so
the card line, the clocks, the callback settle and the ladder are the real code; `requestRun`
refuses the test number as it should, and the sandbox runs the `call_ended` pass itself, reporting
whether live would have asked for it and why. The page gets a **Ben rings them** control (a
transcript box with a default in Ben's voice asking for photos) and a report box: the call as
written, the ladder's verdict and reason, the callback settled, the window still open, then the
pass. The walkthrough in `T21-DONE.md`: WhatsApp door → "yes please call me" → Ben rings them →
the Scoper's follow-up, pending for Ben on the precondition → the customer's photo.

## What can go out unattended after this

With `ask_gap` at SEND on `customer.default` and the preconditions unchanged: on the `call_ended`
pass after Ben's call, nothing. The call is the newest conversation turn, so `ours_is_newest`
holds the reply as a pending draft for Ben (or `not_reactive` does first); T17 chases him at the
draft's due time. The one case where this pass can send by itself is when the customer has
written on WhatsApp after the call began and before the transcript landed; then the customer's
turn is newest and the reply is reactive to it under exactly the rules the inbound_message pass
already has. Whether an outbound call should count as the customer's turn is the captain's
decision, listed as a backlog item, not made here.

## Not touched

The approved Meta templates, the template ladder, `post_call_video_request`,
`post_call_continuation`, any setting or flag, prices, tiers, the sampler, autonomy, media
settings, the first-contact ack's wording, `decide.ts`, `send-preconditions.ts`, `exit.ts`,
`case-file.ts`, migrations. Sibling files: `triage.ts` beyond the two lines above,
`triage.test.ts`, eval fixtures, `draft-guards.ts`, `quote-prep.ts`.

## Files

`server/post-call-ladder.ts`, `server/call-thread.ts`, `server/spine/answered-by-call.ts` (new),
`server/spine/triage.ts` (two lines + import), `server/spine/agents/scoper.ts` (render),
`server/spine/sandbox-scenarios.ts` (the outbound-call plan and verdict, pure),
`server/spine/sandbox-routes.ts` (`/call`), `client/src/pages/admin/SandboxPage.tsx`, tests:
`server/__tests__/post-call-ladder.test.ts`, `server/spine/answered-by-call.test.ts` (new),
`server/spine/sandbox-scenarios.test.ts`, `server/spine/sandbox-routes.test.ts`,
`client/src/pages/admin/__tests__/SandboxPage.test.tsx`; `CLAUDE.md` pointer; `T21-DONE.md`.

## Gate

Baseline at `941f467` on this machine, measured before any edit: tsc 1,880 errors (8 GB heap),
server vitest 42 failed of 1,686 (dummy `DATABASE_URL`), client 0 failed of 228. Same commands
after; zero new tsc errors, failing set unchanged plus nothing of mine; esbuild bundles
`server/index.ts`; both no-key eval adapters exit 0.
