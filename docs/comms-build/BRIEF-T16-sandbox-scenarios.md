# T16 — the sandbox's four front doors, the messaging window, and the full funnel

Branch `fm/sandbox-scenarios-t16`, start commit `0d7bb6c` (T13 merged). Written before coding.

## Why now

The owner used the sandbox for the first time on 7 Sep and asked for four things: the four ways a
lead really arrives (an inbound WhatsApp, a phone call where WhatsApp was agreed, a webform, an
inbound SMS), each with its own rules about what may be said; the 24-hour messaging window as
something he can see and flip; one thread carried from first contact through the clerk, a priced
draft, Ben's notification, the quote going out, questions before and after, and acceptance; and an
answer to whether the ack he saw after sending a photo on a clean thread is right.

Today the sandbox opens exactly one kind of thread: a WhatsApp thread on the reserved number with
no history, window open by construction (`insertInbound` sets `lastInboundAt` on every message).
T5 deliberately skips Route A and job pack filing, so the thread can never reach a priced draft
or Ben's ping. The window is a single word in the run detail. None of the four doors can be
opened, and the two that matter most (webform, post-call) are exactly the ones where the window is
shut and a template is the only lawful thing to send.

## The safety property that must not weaken

Three layers, all pinned in `server/spine/sandbox.test.ts` and `sandbox-routes.test.ts`:

1. **Dry run.** `runOnce({ sandbox: true })` implies `dryRun`; the exit (the only sender) is never
   reached. Nothing in this task calls the exit, `sendCustomerMessage`, `approveAndSendDraft`,
   `queueDraft`, `maybeAutoAckFirstContact`, `maybeSendPostCallContinuation`, or Pushover.
2. **The number.** Every read and write is keyed on `+447700900942` / `447700900942@c.us`. No
   route takes a parameter; no handler reads a conversation id, a quote id or a call id from the
   client. A seeded call row, webform message, draft quote or estimate is written against the
   sandbox thread and the sandbox number only, and `Reset` deletes all of it.
3. **No trigger.** The thread never gets `metadata.nextTriageAt`; `requestRun` and the sweeps
   refuse test numbers. New in T16: a Route A draft on the sandbox number must not appear in the
   price queue (`WAITING_DRAFT_WHERE`, both readers), and the price screen's send route must
   refuse a sandbox-number draft outright, because that route ends in a real Twilio send and the
   outbound gate has no test-number guard (`server/outbound.ts`, checked).

Every new route is re-pinned parameterless; the three layers are re-pinned with a seeded call, a
webform message and a Route A draft on the thread; the two new exclusions are pinned at the source.

## What the live system does at each door (established from the code, not invented)

| Door | Live writer | Thread shape | Window | First thing the customer gets |
|---|---|---|---|---|
| **Inbound WhatsApp** | `server/conversation-engine.ts` `handleInboundMessage` (`From` = `whatsapp:`) | inbound row `channel whatsapp`; `lastInboundAt = now`, `canSendFreeform` | OPEN for 24 h from every inbound | First contact: the rules layer's ack (`first-contact-ack.ts`, intent `ack_enquiry`, or `ack_photos` when media came with it), freeform, held 60–150 s; gated by `comms_agent.firstContactAutoAck.enabled` + channel `whatsapp`. Then the desk on the next message. |
| **Post-call, WhatsApp agreed** | `server/call-thread.ts` `ingestCallRow` → `post-call-ladder.ts` → `post-call-outreach.ts` `maybeSendPostCallContinuation` | a `calls` row (transcription, `classification` jsonb from `call-classifier.ts`: `kind`, `whatsappAgreed`, `jobPhrase`, `jobSummary`…) and a `call_<id>` message row (`channel call`, preview from `describeCall`). `lastInboundAt` NOT touched: a call never opens the window. | SHUT | `decideOutreach` must say `AGREED_ON_CALL`; then `pickContinuationTemplate` (`post_call_continuation` with `{{2}}` = `jobPhrase`, else `post_call_continuation_generic`), resolved **by name against the approved cache**; the slotted body must pass `checkDraft`; **no approved template → `NO_APPROVED_TEMPLATE`, nothing can send** (fail closed, no legacy fallback). Auto-sent under the first-contact exception (`maybeAutoSendFirstContactDraft`, channel `post_call`). Gated by `post_call_continuation.enabled`. The ladder also asks the spine for a `call_ended` run when the transcript is ≥ 40 chars and the spine is on; the clerk accepts `call_ended` with a transcript. |
| **Webform** | `server/leads.ts` (`isWebForm`) | inbound row `channel webform`, content = the enquiry, `contactName` = the form name; `lastInboundAt` NOT touched | SHUT | `scheduleInboundTriage(channel 'webform')` → `maybeAutoAckFirstContact` → window shut → template ladder `FIRST_CONTACT_TEMPLATE_PREFERENCE` (`web_enquiry_ack_context` with `{{1}}` name, `{{2}}` the enquiry snippet, `{{3}}` "shortly"/"in the morning"; then `call_request`, `first_contact_ack`, `video_request`, `postcode_request`, `1_contact_generic`), else **SMS** with the composed ack, else queued for Ben. Then the desk's `inbound_message` pass. |
| **Inbound SMS** | `handleInboundMessage` (bare `From`) | inbound row `channel sms`; `lastInboundAt` NOT touched | n/a — SMS has no window; WhatsApp window stays SHUT | Ack **by SMS** (`smsOnly`), the composed body; with `askForMedia` on, the SMS variant of the media ask ("WhatsApp a quick photo … to this number", only while the SMS and WhatsApp senders are the same number). The Scoper's prompt (`prompts/scoper.core.md`): an SMS thread is answered by SMS, tight, ask them to describe rather than attach, invite a switch once with the wa.me link. |

The spine reads the window through `buildCaseFile` → `canSendFreeform(phone)` → `conversations.lastInboundAt` < 24 h; `channelLastUsed` from the last inbound row's channel. `decide` → `deliverable`: SMS thread → SMS; window open → freeform; else the pack's template for the intent, else pending. `exit.windowShut` → template-first send.

## What to build

### 1. Four entry scenarios — `POST /api/comms-sandbox/start { door, name?, text?, jobPhrase?, whatsappAgreed?, transcript? }`

Resets the thread and seeds the door's shape exactly as the live writer would, then returns the
entry report (which door, what was written, the window, what the customer would receive and by
which rung of which ladder, and the config gates on this server) plus the desk's first pass where
the live system would run one.

- `whatsapp`: a clean thread with the given name as the pushname. No seed; the owner types. This
  is today's behaviour, kept as the baseline.
- `webform`: the inbound `webform` row; the ack ladder walked against the real template cache
  (`findApprovedTemplateWithValues` with the same three values `first-contact-ack.ts` passes),
  the rung reported by name and status, the outcome mirrored onto the thread as a synthetic
  outbound (channel `whatsapp` for a template, `sms` for the SMS fallback, nothing when it would
  queue for Ben); then `runOnce(inbound_message, sandbox)`.
- `post_call`: a `calls` row and its `call_<id>` message row (via the real `describeCall`);
  the continuation decided with the real `decideOutreach` / `pickContinuationTemplate` /
  `normalizeJobRef` / `checkDraft` against the real cache; the result mirrored (template body) or
  the refusal reported in the live reason's words; then `runOnce(call_ended, sandbox)` when the
  ladder would ask for it.
- `sms`: the inbound `sms` row; the SMS ack mirrored (composed body, plus the SMS media ask when
  the config would add it); then `runOnce(inbound_message, sandbox)`.

`POST /message` gains `channel: 'whatsapp' | 'sms'` (an SMS never moves `lastInboundAt`; a
photo on SMS is refused with the reason a UK long code cannot receive MMS).

The first-contact mirror (T6) is kept and made more honest: it now carries the contact name the
way the live ack would, and reports the config gate (`firstContactAutoAck.enabled`, channels,
`askForMedia`) so the page can say whether production would send it today.

### 2. The window as a control

- The thread header shows the window as the case file will read it: open/shut, when the last
  customer WhatsApp was, the channel last used, and what that permits.
- `POST /age { hours }` moves every timestamp on the sandbox thread back by N hours (messages,
  the conversation's clocks, calls, quotes including `expiresAt`, runs, flags). This is the honest
  way to shut a window: the rows are exactly what the live database holds N hours later.
- `POST /run { trigger: 'cadence' | 'manual' }` runs a pass with no new customer message — what a
  clock does live. Age 25 h, run a clock pass: the decision shows the template path or the
  pending reason. Age 3 days with a quote out: the quote is expired.

### 3. The funnel

- **Route A in the sandbox (BACKLOG T5-a).** `runOnce` no longer skips a `quote_ready` clerk
  artifact in the sandbox. The chain runs with injected deps: the estimator and the pricing engine
  are real (read-only pricing, a real estimate row on the sandbox conversation, a real draft on the
  sandbox number with prices null); `notify` records the exact Pushover Ben would have received
  instead of dispatching it; `writePack` records what the job pack would have held instead of
  writing it; `log` records instead of writing system events. `visit_first` and `decline` run as
  live (they only build proposals).
- **Ben prices and sends** — `POST /price { totalPence? }`: the waiting draft becomes the sent
  quote the way `confirmPrices` + `deliverQuoteLink` would leave it (prices set, `is_draft` false,
  the "here's your quote" line with the link on the thread as a synthetic outbound), with the
  delivery mode decided as live: freeform when the window is open, else `quote_ready_link` if
  approved, else "queued until the window reopens". Stage → `quote_sent`.
- **Customer accepts** — `POST /accept`: `depositPaidAt` stamped on the sandbox quote, stage →
  `won` on the sandbox conversation, and the "Quote accepted" Pushover recorded, not sent. The
  report says what the live system does next (job-pack asks from the slow sweep) and that the
  sandbox does not run sweeps.
- The page carries a funnel strip (enquiry → scoping → clerk → priced draft / Ben pinged →
  quote sent → accepted) and every "Ben's phone would have buzzed" box in the run detail.

### 4. The exclusions this task adds

- `WAITING_DRAFT_WHERE` excludes the sandbox number (one string, both readers move together).
- `POST /api/spine/price/:slug/send` refuses a draft on the sandbox number before anything else.
- `Reset` also deletes `calls`, `quote_estimates` and `job_packs` rows for the sandbox thread.

### 5. The ack question

Answered in the DONE report from `conversation-engine.ts` → `scheduleInboundTriage(hasMedia)` →
`runFirstContactAck` (`intent = hasMedia ? 'ack_photos' : 'ack_enquiry'`) and `triageRules`
(`withMedia → ack_photos`).

## Out of scope

No change to any live prompt, pack, tier, precondition, setting or flag; `describe-video.ts`,
`agent-cost.ts` (a sibling owns them), the first-contact ack's own logic, the sampler, autonomy,
prices and money. No migration. The order is doors + window first, funnel second; whatever is not
finished to a defensible standard is listed under Not done rather than shipped half-built.
