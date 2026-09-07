# T21 — the follow-up after Ben's own call: DONE report

Brief: `BRIEF-T21-post-call-followup.md`. Branch `fm/post-call-followup-t21`, from `941f467` (T19
merged). The captain's flow, in his words:

> this is the flow when delaing with an inbound whatsapp, we ask for a call (optional) as they can
> proceed with messages but if happy and ben calls the post call follow up is needed as most the
> time ben will ask the uers on the call to send videos and pictures over for him to take a look

What was true before this branch: Ben rang a customer who had written on WhatsApp, asked for
photos, hung up, and the desk did nothing. Not a message, not an agent run, not a draft. The call
got a card and that was all. Now the desk resumes from his call: the Scoper reads the transcript
and composes the follow-up in its own words (the window is open because the customer wrote
first), and that follow-up lands as a draft for Ben to approve with one tap. Nothing new goes out
by itself (§ What can go out unattended).

**Not proven live.** No database, no model key and no browser against your server here; it is
proven by tests and by the code paths read in full. The walkthrough below is how you see it.

---

## How to check this (copy and paste)

```bash
git fetch origin && git checkout fm/post-call-followup-t21 && npm run dev
```

Open http://localhost:5001/admin/sandbox. Press **New scenario** if a thread is already open.

1. **Inbound WhatsApp** is the door selected. Type an opening line as a customer would, for example
   `Hi, my bathroom extractor fan has stopped working, can you replace it? NG7 2AB`, and press
   **Open through this door**. You get the T19 shape: your line as a customer bubble, then the
   mirrored ack *"Hi Sam, thanks for getting in touch. --- Is it OK if we give you a quick call to
   run through it? Or just reply here with the details."*, and the window strip in green (OPEN).
2. Type `Yes please give me a call` in the composer and **Send as customer**. The pass detail on
   the right says **FLAG for Ben — callback_requested** (triage lane `ben`, exception
   `callback_requested`). That is today's behaviour: a customer asking for a call is Ben's. The
   tag `callback_requested` lands on the thread (the header's tags, or *What happened on this
   thread*). Live, Ben's phone would have pinged.
3. **The new control.** Under the funnel strip on the left there is a violet box, **Ben rings
   them**, with a transcript already in it: Ben ringing the customer back, asking for *"a couple
   of photos of the fan and the switch on this WhatsApp, and a quick video of the ceiling"*. Leave
   it, or type your own (at least 40 characters, the ladder's own bar; use `Agent:` and
   `Customer:` as Deepgram does). Press **Ben rings them**. The desk thinks for ten to twenty
   seconds.
4. What you should see:
   - in the thread, on the right (it is ours), a grey bubble labelled **📞 outbound call · Ben rang
     them · written by the live ingest** reading `Outbound call (1m 28s): Rang the customer back
     about their enquiry; asked for photos or a video on WhatsApp; quote to follow.; callback
     promised`. That line is `call-thread.ts` `describeCall`, the same code that writes a real
     call's card line;
   - the window strip **still green (OPEN)**: a call never touches the window;
   - a violet box on the right, **Ben's call, as call-thread.ts wrote it**, with:
     - a green line **Live, the desk is handed the thread: the ladder asked for a call_ended
       pass…** if your server has the spine on and it is between 08:00 and 21:00 UK. Otherwise an
       amber line naming the one rail that refused, in the outreach module's own code
       (`SPINE_OFF`, `QUIET_HOURS:22h`, and so on), and *the sandbox ran the pass anyway*;
     - **Callback settled: `callback_requested` cleared** (the tag from step 2 came off: Ben rang
       them, the debt is paid). *Tags now: sandbox.* (In the sandbox no flag row exists because
       the exit never runs, so nothing says "released from Ben"; live, the `[callback_requested]`
       flag row is dismissed and `needs_ben` cleared through T17's door.)
   - the pass detail: triage **lane scoper** (not `ben`: the reasons include *"the customer's last
     message was answered by our call (Ben spoke to them since): the text lexicons do not re-run
     on it (T21)"*), the Scoper's proposal at intent `ask_gap` referring to the call (something
     like *"Good to speak just now. Send over a couple of photos of the fan and the switch, and a
     quick video of the ceiling, and I'll get it priced up."* — the model's words, not fixed), and
     the decision **DRAFT for Ben**. If `ask_gap` is at SEND on your server the reason reads
     `precondition: ours_is_newest` (the call is the newest turn, so the reply waits for Ben); if
     it is at DRAFT the reason says so. Either way the dashed amber **proposed reply · NOT SENT**
     bubble is the follow-up, and live it would sit in your queue, chased at its due time (4
     working hours, T17).
   - *What happened on this thread* gains a `call` line: *Ben rang them: answered, 88s,
     transcript 5xx chars — live, the desk is handed the thread (call_ended); callback settled
     (callback_requested cleared). Window still OPEN (a call never touches it).*
5. **The photo arrives.** Press **Attach**, pick a photo, **Send as customer**. The pass is the
   ordinary inbound one: the Scoper sees the call transcript and the photo, and its reply is a
   `confirm_received` or the next scoping question. That is the loop the captain described,
   closed.
6. **Earlier passes on this thread** lists the call's pass with trigger `call_ended`.

**What a fault looks like:**
- No violet **Ben rings them** box, or the thread bubble for the call says *synthetic · never
  sent*: you are not on this branch (hard reload, check `git log -1`).
- The pass after the call says **FLAG for Ben — callback_requested** again: the T21 triage rule
  did not fire. Check the call bubble is there and the transcript was over 40 characters; stop
  and report with the run id.
- The decision after the call is **SEND**: stop and report the run id at once. The send
  precondition `ours_is_newest` should hold every reply on this pass.
- The violet box says `NO_CLASSIFICATION` or `RAILS_UNAVAILABLE`: the live ingest could not read
  a rail. The server log has `[CallThread]` lines saying which.
- The window strip turns SHUT after the call: `lastInboundAt` was touched. Stop and report.

**Nothing you do here can reach a phone.** The thread is on the reserved number `+447700900942`,
every pass is a dry run, the exit is never called, the live ingest's own `requestRun` refuses the
test number, and `/admin/comms`, `/admin/desk` and `/admin/price` must not show it.

---

## What was established (read, not assumed)

**The two gates, quoted.** `server/post-call-ladder.ts` at `941f467`:

- line 69: `if (!inbound) ackReason = 'outbound call: no customer ack';`
- line 88: `const spineRun = input.spineEnabled && kind === 'answered' && transcript.length >= MIN_TRANSCRIPT_CHARS ? 'call_ended' : null;`

`'answered'` is the inbound kind (`classifyCall`, line 62); a call Ben made is
`outbound_answered`. `server/call-thread.ts:618-624` requested the run only on `plan.spineRun`.
So PRD §4.1's *"Ben's own call feeds the scoping (`call-thread.ts:606-623`)"* was false: that
block was reachable only for an inbound answered call, and the test at
`server/__tests__/post-call-ladder.test.ts:72` pinned `spineRun: null` for outbound.

**An outbound call is transcribed exactly as an inbound one.** Groundwire dials through
`POST /api/twilio/sip-outbound` (`server/index.ts:1078-1123`), which forks the media stream to the
same realtime recorder with `legRole=agent_originated`; the row is created with
`direction: 'outbound'` (`twilio-realtime.ts:114`). `/api/twilio/sip-outbound-status` writes the
real talk time and `OUTBOUND_ANSWERED` / `OUTBOUND_NO_ANSWER` (`index.ts:1134-1160`);
`finalizeCall` keeps that result (`call-logger.ts:226-239`) and ingests with the live options
(`call-logger.ts:293-299`). For any call over 10 s (`twilio-realtime.ts:203`) the same chain runs
in both directions: Deepgram batch transcription, which also classifies (outbound gets
`SYSTEM_PROMPT_OUTBOUND`, kind `outbound_call`, `call-classifier.ts:93-106`); the video-request
decision (refuses `NOT_INBOUND`, `post-call-outreach.ts:318`); the lead upsert (fills
`calls.jobSummary` when empty, `call-lead.ts:89`); then a second `ingestCallIntoThread` with the
transcript in hand (`twilio-realtime.ts:245`). That second ingest runs the ladder with the
transcript and is where an inbound call got its `call_ended` run; an outbound call got a card
refresh and nothing else. The PRD's "38 of 51 transcribed" is therefore Deepgram's success rate,
not a gate.

**The window survives the call.** `canSendFreeform` reads `conversations.lastInboundAt` under 24 h
(`meta-whatsapp.ts:833-852`); call ingest never writes it (`call-thread.ts:558`, and the file
header's rule 1). A customer WhatsApp before the call keeps the window open across it, so the
follow-up may be freeform. `post-call-outreach.ts` is built for the other case (its header: a call
never opens the window, so it is always a template).

**What the spine learns of a call.** `buildCaseFile` reads the newest 8 `calls` rows and puts
each on the timeline as `call_in` / `call_out` with `body` = `calls.jobSummary` and `transcript` =
the first 4,000 characters (`case-file.ts:24, 114-119, 146-153`); the card line (with the
classifier's one-line summary) is also there as a `message_out` on channel `call`. The Scoper
rendered a transcript clipped at **700 characters, head only** (`scoper.ts:68, 163`): about fifty
seconds. Ben asks for photos at the end of a call, so on a three-minute call the Scoper did not
see the ask. Triage's model sees 600 (`triage.ts:255`).

**Triage would have re-fired.** `lastInbound(cf)` returns the newest `message_in` / `call_in`
(`triage.ts:98-104`); a `call_out` is not one. A pass after Ben's call read "yes please call me"
as `text` and `RE_CALLBACK` laned it to Ben again (`triage.ts:151-160`), deduped on the open flag
(`exit.ts:145`). With only the gate opened, the captain's exact flow would have produced nothing.
Proven by test (`answered-by-call.test.ts`: the same timeline lanes `ben` before the call and
`scoper` after it).

**The preconditions hold the reply for Ben.** On a SEND-tier `ask_gap`, `decide` runs
`sendPrecondition` last (`decide.ts:141-147`): `isReactive` (the customer wrote inside 45 min), then
`ours_is_newest`, and a `call_out` is ours (`send-preconditions.ts:72-73, 119-121`). Ben's call is
newer than the message that asked for it, so the Scoper's reply on the `call_ended` pass is a
pending draft. T17's `pending_draft` lane chases spine drafts (`sla-sweep.ts:100`).

**The outreach protections** (`post-call-outreach.ts`): `decideOutreach` (186-221), `evaluateSendRails`
(447-507), the minimum duration (323). Production: enabled, classify on, allowUndiscussed off,
mobile only, 20 s, quiet 21:00–08:00, 30-day dedupe.

**Two things nobody honoured.** `no_auto_messages` is read nowhere under `server/spine/`
(BACKLOG T21-b). T17's way back excludes call rows on purpose (`silence-breaker.ts:141`), so no
call released a thread from Ben; the spine's `callback_requested` flag stayed open after he rang,
while the older `callback_due` tag was settled by any outbound call (`call-thread.ts:567-578`).

---

## The two decisions

**1. The Scoper composes it, on the `call_ended` run.** It already reads the case file with the
call on it; `ask_gap` is exactly "ask for a photo or video"; the guards, `neverSend` and the send
preconditions apply to it; the exit is the only sender. A direct send from the post-call lane
would be a second sending path with its own wording, rails and Approver for a message whose whole
point is to read as part of the conversation. The template ladder is untouched and remains the
fallback for a shut window.

**2. What the agent knows: enough now for a call under five minutes, and the limit is stated.**
The Scoper now renders a call as its summary line plus up to 4,000 characters of transcript (the
case file's own cap), so Ben's ask at the end of a three-minute call is in front of it. The case
file still keeps the FIRST 4,000 characters: a call over about five minutes loses its end there
(BACKLOG T21-c), and the classifier's bullets ("Agreed: customer to send photos") do not reach the
case file (T21-d). The follow-up reads as a continuation because the transcript is there, not
because anything tells the model it is.

---

## What changed

**`server/post-call-ladder.ts`.** `outbound_answered` with the spine on and a transcript over the
bar asks for `call_ended`, behind `outboundHandoffVerdict` (pure, exported): the outreach config
readable, `duration ≥ minDurationSeconds`, a parseable number, not on `suppressedNumbers`, mobile
when `mobileOnly`, no `no_auto_messages` tag, a classification on the row, no objection or
decline (→ `tagNoAutoMessages`), not a complaint, not `callIncomplete`, no video request inside
`dedupeDays`, not a quiet hour. Inputs come pre-gathered (`LadderInput.outbound`); a missing input
refuses (`RAILS_UNAVAILABLE`, `CONFIG_UNREADABLE`, `DEDUPE_UNAVAILABLE`, `NO_CLASSIFICATION`). The
plan carries `spineRunReason` (the outreach module's own codes), `tagNoAutoMessages`,
`settleCallback`. The inbound path is unchanged except that it now also reports a reason.

Two rails are deliberately not inherited, and why: `callbackPromised` on an OUTBOUND verdict
means "our side promised further contact (a call, a quote, a text)" (`call-classifier.ts:104`),
which the follow-up is; `callIncomplete` still refuses. `EXISTING_WHATSAPP_THREAD` keeps a
template off a live thread; the live thread is the premise here. The template path's `enabled`
flag is not read: it is that path's master switch, and `evaluateSendRails` never reads it either
(the continuation lane's own precedent, `post-call-outreach.ts:857-860`).

**`server/post-call-outreach.ts`.** `readOutreachConfig()` (null on a failed read; `getOutreachConfig`
keeps its contract), `ukHourNow(now?)` and `isQuietHour(cfg, hour)` exported so the ladder reads
the same quiet-hours rule. No behaviour change on the template path.

**`server/call-thread.ts`.** `gatherOutboundRails` (each read its own try, null refuses; the dedupe
mirrors `evaluateSendRails` verbatim). The ladder is decided before 3b; 3b now clears
`callback_requested` as well as `callback_due` on an ANSWERED outbound call, and when the thread
was waiting for a call (the tag, or an open `[callback_requested]` flag row) goes through T17's
door `releaseFromBen` with `by: 'system:outbound_call'`. A call on a thread not waiting for one
releases nothing. `tagNoAutoMessages` is applied. The refusal is logged
(`No spine run for outbound call … : <reason>`). `CallThreadResult` gains `ladder` and
`callbackSettled`.

**`server/spine/answered-by-call.ts` (new) and two lines in `triage.ts`.** `answeredByOurCall(cf)`:
the customer's last turn, then an outbound call with a transcript (≥ 40 chars) at or after it,
by timestamp. In `triageRules`: `dateAsked` is off and the `if (text)` lexicon block does not run
when it is true, with a reason line. Nothing else in the file; T18's `RE_REGULATED` line and
T20's first-contact branch and `mergeTriage` are untouched.

**`server/spine/agents/scoper.ts`.** `renderTimelineItem`: a call shows `summary; transcript: …`
with the transcript clipped at 4,000 (`MAX_TRANSCRIPT_CHARS`), not the transcript alone at 700.
This applies to inbound calls too.

**The sandbox.** `sandbox-scenarios.ts`: `validateCall` (the default transcript, the duration
derived at twelve characters a second, the ladder's bar), `OUTBOUND_CALL_DEFAULT_TRANSCRIPT`,
`sandboxOutboundClassification` (the outbound prompt's shape). `sandbox-routes.ts`: `POST /call`
writes the `calls` row (answered, `OUTBOUND_ANSWERED`, starting strictly after the newest message,
as Ben rings after they wrote) and runs the LIVE `ingestCallRow` with `finalizeCall`'s options, so
the card line, the clocks, the callback settle and the ladder are the real code; then the
`call_ended` pass. `SandboxCallReport` on `metadata.sandbox.lastCall`, `callEventSummary`, event
kind `call`, `callDefaults` in state. `SandboxPage.tsx`: `CallStrip`, `CallDetail`,
`callVerdictLabel`, the call bubble's label.

**Tests** (+23 server, +5 client): `post-call-ladder.test.ts` (e): every rail, fail-closed inputs,
the two uninherited rails, unanswered, inbound unchanged; `answered-by-call.test.ts` (new): the
helper and `triageRules` on the captain's timeline before and after the call, and what still
stands; `sandbox-scenarios.test.ts`, `sandbox-routes.test.ts` (route pins now include `/call`),
`SandboxPage.test.tsx`.

---

## What can go out unattended after this

With `ask_gap` at SEND on `customer.default` (the brief's premise; not verifiable here) and the
send preconditions unchanged:

- **On the `call_ended` pass after Ben's call: nothing.** The call is the newest conversation
  turn, so `ours_is_newest` holds the Scoper's reply as a pending draft (or `not_reactive` does
  first, when the customer's last message is over 45 minutes old). Ben approves it with one tap;
  T17 chases him at the draft's due time.
- **The one case this pass can send by itself:** the customer wrote on WhatsApp after the call
  began and before the transcript landed (they sent the photos straight after hanging up). Then
  the customer's turn is newest and the reply is reactive to it, under exactly the rules the
  `inbound_message` pass already has for that message: the same guards, the same `ask_gap`
  structural rule (no quote, no date asked, no question in their message), the same 45-minute
  reactive window. The inbound pass on that message runs first anyway; if it drafted or sent, the
  later `call_ended` pass sees a `draft_pending` or `message_out` as newest and holds.
- Whether an answered outbound call should count as the customer's turn, so the follow-up goes
  automatically, is the captain's decision (BACKLOG T21-a). Nothing here weakens the gate.

## The inherited rails, side by side

| Outreach rail (`post-call-outreach.ts`) | T21 hand-off (`outboundHandoffVerdict`) |
|---|---|
| `NO_CLASSIFICATION` (a call we could not read sends nothing) | `NO_CLASSIFICATION` |
| `COMPLAINT` → a human | `COMPLAINT` |
| `CUSTOMER_DECLINED_MESSAGING` → tag `no_auto_messages` | same, `tagNoAutoMessages` applied by `ingestCallRow` |
| `CALLBACK_DUE` (callback promised or call incomplete) | `CALL_INCOMPLETE` only; `callbackPromised` not inherited (see above) |
| `TOO_SHORT:<d>s<<min>s` | `TOO_SHORT:<d>s<<min>s` |
| `UNPARSEABLE_PHONE`, `SUPPRESSED_NUMBER`, `NOT_A_MOBILE` | the same three |
| `ALREADY_ASKED_WITHIN_<n>D` | the same, plus `DEDUPE_UNAVAILABLE` when the read fails |
| `EXISTING_WHATSAPP_THREAD` | not inherited (the live thread is the premise) |
| `QUIET_HOURS:<h>h` | `QUIET_HOURS:<h>h` (refuses, does not delay: T21-e) |
| config unreadable → treated as disabled | `CONFIG_UNREADABLE` |
| (thread tag `no_auto_messages`, read by the sweep's fallback) | `NO_AUTO_MESSAGES` |

---

## Not done

- **Not proven live.** No database, model key or browser against the owner's server here. The
  sandbox walkthrough above is the check; the Scoper's actual wording after a call is the model's
  and was not observed.
- **The captain's decision on `ours_is_newest` for an outbound call (T21-a).** Left as it stands
  on purpose: the follow-up is a one-tap draft, not automatic.
- **`no_auto_messages` in the spine generally (T21-b).** Only this path honours it.
- **The case file's head-only 4,000-character cap (T21-c) and the classifier's bullets (T21-d).**
- **Quiet hours refuse rather than delay (T21-e);** the dedupe's raw-string phone match, mirrored
  as is (T21-f); whether a call on a non-callback `needs_ben` thread is Ben's reply (T21-g, with
  T17-a).
- **The sandbox writes no flag rows** (the exit never runs there), so "released from Ben" can only
  be seen live; the sandbox shows the tag settle.
- **`fm-ensure-agents-md.sh` was not run.** The repository has never had an `AGENTS.md`
  (`git log --all -- AGENTS.md` is empty) and `CLAUDE.md` is the project's real file; the helper
  would convert it into a pointer plus a new `AGENTS.md`, a repo-wide change that two sibling PRs
  touching `CLAUDE.md` would conflict with. Same call every earlier task made; flagged here.
- **Sibling overlap.** `triage.ts` is touched on the import line, the `dateAsked` line and the
  `if (text)` line only (T18 changes `RE_REGULATED` and `mergeTriage`; T20 the first-contact
  branch and `mergeTriage`). A rebase should be three-line.

---

## Build gate (measured on this machine, not assumed)

Baseline at `941f467` and the branch, same commands, same worktree (`node_modules` present):
`NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/tsc --noEmit -p .`; server vitest with
`DATABASE_URL=postgres://nobody:none@127.0.0.1:1/none` and `--reporter=json`; the client project
alone; esbuild with the build script's flags to a scratch outdir; both eval adapters.

| Check | Baseline `941f467` | Branch |
|---|---|---|
| tsc errors | 1,880 | 1,880; the only two list differences are the pre-existing `call-thread.ts` TS2353 and `post-call-outreach.ts` TS2769 moved by my added lines (per-file counts equal) |
| vitest server | 42 failed of 1,686 | 43 failed of 1,709 (+23 new tests); the failing set differs by ONE name, the load-flaky heap benchmark `call-script/__tests__/performance.test.ts › … without memory growth` (re-run result below) |
| vitest client | 0 failed of 228 | 0 failed of 233 (+5) |
| esbuild `server/index.ts` | — | bundles, 4.5 MB, exit 0 |
| `eval-comms.ts --adapter replay` | — | exit 0, regression red 0 |
| `eval-comms.ts --adapter triage` | — | exit 0, regression red 0 |
| Disk during the gate | — | 272 MB free at the start, 255 MB at the end; no ENOSPC |

The heap benchmark, re-run alone on the branch: failed again; re-run with `NODE_OPTIONS=--expose-gc`: 25 of 25 passed. It is a raw `heapUsed` delta with no GC hook (the same noise every report since T14 records), not a regression.
The call bubble's label on the sandbox page was edited after the gate had started, so tsc and the client project were run again afterwards: tsc 1,880 with the same two shifted lines; client 0 failed of 233. Server files were not touched by that edit.
