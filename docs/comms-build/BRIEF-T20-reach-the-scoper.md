# BRIEF T20 — reach the Scoper: the dead `rules` lane, and ask for a photo once

Branch `fm/reach-the-scoper-t20`, from `941f467` (T19 merged). Written before coding. A sibling is
rebasing `scope-gas-only-t18` (PR #17) and touches `server/spine/triage.ts` (the gas lexicon,
`mergeTriage`'s out_of_scope drop, the prompt) and the eval fixtures, so every edit to `triage.ts`
here is kept to a few self-contained lines and the exact lines are listed in the DONE report.

## What the captain saw

**Fault A.** Run `run_e5372115-3758-431c-9d9e-869e5f85a93c`, thread `7917ee61…`, 7 Sep:

```
17:46 inbound   Hi i have a few jobs i need a quote for please
17:46 outbound  Hi Sam, thanks for getting in touch. --- Is it OK if we give you a quick call...
17:47 inbound   its just a few jobs, happy to send a list: - Mount tv to wall - Fit lock ...
```

The pass on the list: `agent: rules`, `lane: rules`, `decision: none`, reason "no proposal".
Triage tagged `needs_quote`, `chillwell`, `multiple_jobs` and still laned it `rules`. The Scoper
never ran; the customer got nothing.

**Fault B.** Run `run_b2836d5b-210a-4729-9f4b-52e80cbdf1e2`: a ring doorbell, postcode given,
location described twice, thread tagged `needs_quote` and `needs_photos`. The Scoper SENT an
`ask_gap` for a photo of the door and wall, with its own reason *"Customer repeated location
details but no media provided yet"*. The captain's rule: *"We would ask for a photo but if
hesitation its not a must as we would rather proceed and if needed ben can then ask for one."*

## Fault A, established from the code (no ledger access on this machine)

Line numbers are at `941f467`.

1. **The `rules` lane runs no agent.** `server/spine/index.ts:34-38` registers `RULES_PLACEHOLDER`,
   whose `run()` returns `null`; `agentForLane('rules')` (`:57`) picks it. `decide` then returns
   `{ kind: 'none', reason: 'no proposal' }` at `server/spine/decide.ts:98`. So "no proposal" on
   the rules lane is by construction: nothing in the spine can compose on that lane. The only
   thing that answers a rules-lane pass is outside the spine: the first-contact ack fired at
   ingest (`server/agents/comms-lanes.ts:128`) and the 10-minute holding line; the exit's
   content-free ask (`server/spine/asks.ts:97-98`) fires on `rules` + `none` too, gated by
   `spine.asks.enabled`.

2. **Two routes put a thread on that lane.**
   - `triageRules`, `server/spine/triage.ts:180-184`: `if (!hasOutbound(cf))` → `lane: 'rules'`.
     Checked BEFORE the `needs_quote` → `quote_clerk` branch (`:186-189`) and before the
     scoper default (`:202-203`). `hasOutbound` (`:105-107`) reads `message_out` / `call_out` off
     the case file timeline, which `buildCaseFile` fills from non-quarantined `messages` rows
     (`server/spine/case-file.ts:107-145`).
   - `mergeTriage`, `server/spine/triage.ts:288`: `let lane: Lane = model.lane;` — the model's
     lane is adopted verbatim (only exceptions, a dropped date_question/out_of_scope, and a rules
     `dropped` override it, `:289-292`). The prompt offers the model `"rules" only for a first
     contact or a content-free acknowledgement` (`:223`). Nothing stops the model choosing a lane
     that runs no agent.

3. **Which route this thread took.** The run's tags (`needs_quote`, `chillwell`, `multiple_jobs`)
   can only come from the model (`triageRules` adds only `callback_requested` / `rescope`), so the
   triage source was `model` and the lane was the model's choice (route 2). The ack was recorded
   as an outbound at 17:46: the ack goes `queueDraft → approveAndSendDraft → sendCustomerMessage`
   and lands as a `messages` row, and the ledger shows it before the 17:47 inbound. With the
   default debounce (`debounceMinutes: 10`, `server/spine/config.ts:85`; floor 3 s,
   `request-run.ts:97`) the pass on the list ran at about 17:57 with the ack in its case file, so
   `triageRules` would have said `scoper` (no quote tag was on the row yet; `:202`). Haiku, shown
   a thread whose only outbound is our ack and whose customer is answering that ack, called it a
   first contact and returned `lane: rules`; `mergeTriage` took it. (`intent` on that answer was
   most likely `ack_enquiry`, which is why the run reads exactly like a first-contact pass.)

4. **The timing gap is a second live path, not this thread's.** The ack is queued with a 60–150 s
   realism hold and released by the worker (`server/first-contact-ack.ts`, `comms-sweep.ts`
   `releaseHeldAcks`). A second customer message inside that hold makes the ack stale by identity;
   `approveAndSendDraft` reverts it and calls `requestFreshRun`, which is `requestRun(...,
   { delayMs: 0 })` (`server/draft-freshness.ts:159`). That pass builds a case file with two
   inbounds and NO outbound → `triageRules:180` → `rules` → nothing, and the model, seeing no
   outbound, says `rules` as well. T6 found the same shape in the sandbox (no ack row → every
   message first contact) and fixed it sandbox-only by mirroring the ack.

5. **After the pass, nothing recovers it.** The model's `needs_quote` landed on the row
   (`triage.ts:334-351`), `ensureQuoteRun` is refused inside the pass by the run's own lease
   (BACKLOG D11), and the net (`sweepUntriggeredQuotes`) re-opens it once because the D1 stamp
   did not see the tag — but a cadence pass whose model again says `rules` leaves a stamp that
   now includes `needs_quote`, and `lastPassCoversThisTurn` closes the net for good
   (`request-run.ts:334-342`). The holding line is suppressed because an outbound (the ack)
   landed after the inbound (`rules-layer.ts:152`). Silence until the customer writes again.

6. **It is a shape, on every door.** Any customer turn on which Haiku answers `lane: rules` gets
   no agent, no draft, no flag and no ask beyond the first-contact one. It is most likely exactly
   when a thread has one outbound (the ack) and the customer replies to it, which is the second
   message on every inbound WhatsApp / SMS / webform thread, and the first WhatsApp message after
   a post-call ack. How often Haiku does it is a ledger question (count `agent_runs` rows with
   `agent = 'rules'`, `decision = 'none'` and a triage child row with source `model` on a thread
   with an outbound older than the inbound); the code makes it possible on every one of them.

## Fault A, the fix (two deterministic rules, no words added anywhere)

- **A1** `mergeTriage`: the model may never move a thread ONTO the `rules` lane. First contact is a
  fact of the timeline (no outbound), not a judgement; if the model says `rules` and the rules did
  not, the rules' lane is kept, the intent is reset to `unknown` (the model's intent on such an
  answer is an `ack_*`), and a reason line records it. A model may still move a first contact off
  the rules lane (unchanged).
- **A2** `triageRules`: the first-contact branch fires only when the customer's message is the
  thread's ONLY inbound. Two customer messages with nothing from us between them mean the ack did
  not land (held, refused, disabled, or the timing gap in §4) and the rules layer will not answer
  the second one; the thread moves on to the ordinary lanes (needs_quote → clerk, quote → post
  quote, else the Scoper). One inbound and no outbound is still first contact: the ack answers it.

Not done on purpose: the rules layer is not made to say anything; the prompt line offering
"rules" is left for the sibling's prompt edit (the merge refuses it regardless); the D11 lease
refusal and the D1 net are untouched.

## Fault B, established

- The Scoper's only gate on WHEN it asks is the model's judgement (`server/spine/prompts/
  scoper.core.md:28-32`: "ask for a photo or video", "if something that changes the price is
  missing, ask for it"). The tool boundary refuses `point_to_picker` without a quote and
  `quote_on_its_way` with a live quote (`scoper.ts:322-327`) but has no rule about media asks.
- `ask_gap` is at SEND; the send preconditions (`server/spine/send-preconditions.ts:128-134`)
  gate it on quote / date / a question mark in the customer's last message, nothing about a prior
  ask. So a second media ask sends without Ben seeing it.
- Four things ask a customer for media today: the first-contact ack's folded sentence
  (`first-contact-ack.ts:535-562`, when `askForMedia`), the rules layer's `ask_media`
  (`rules-layer.ts:75-79`, from the exit on a rules-lane `none`), the Scoper's `ask_gap`, and Ben.
  All four are outbound message bodies on the thread.
- **What the price screen already tracks as missing.** `buildPricePayload`
  (`server/spine/price-screen.ts:396-399`) already computes `photos` / `videos` (the quote's own
  media columns) and `sentPhotos` / `sentVideo` (from the embedded thread), and each line carries
  `evidence.media` (`:387-393`). The clerk's intake has `gaps` (`server/agents/quote-prep.ts:252-
  273`), but `readiness: quote_ready` may not carry a customer gap (`:268-270`) and Route A runs
  only on `quote_ready` (`index.ts:349`), so a "no photo" GAP would stall the quote — the exact
  blocking the captain wants gone. The job pack's `missing` is post-deposit delivery fields.
  Reused here: `photos` / `videos` / `sentPhotos` / `sentVideo` and the thread. Nothing new is
  invented as "missing".
- **Can Ben already ask from the price screen?** Yes. `POST /api/spine/price/:slug/ask
  { question }` → `askFirst` (`price-brief.ts:539-551`): one question queued as a pending draft in
  his queue through `queueDraft`, the quote held (`hold.reason = 'ask_first'`) until she answers;
  the page's "Ask her first" sheet (`PriceAndSendPage.tsx:1149-1166`) is that route. There is also
  `POST /api/spine/ask/:conversationId { kind: 'ask_media' }` (`routes.ts:253-262`), the rules
  layer's fixed photo ask sent at once under the signed-in human's approver. So B3 is wiring.

## Fault B, the fix

- **B1 ask once**, deterministic, read off the thread's own history: a new pure module
  `server/spine/media-ask.ts` finds the newest outbound that asks for a photo/video and says
  whether the customer has replied since without sending any (`outstanding`). It is applied at
  the Scoper's tool boundary (`propose_reply` refuses a body that asks for media while the ask
  is outstanding, with a refusal that tells the model to proceed and tag `needs_quote`), stated
  once on the rendered case file so the model does not spend a turn finding out, and belted in
  `send-preconditions.ts` as `ask_gap:media_already_asked` for the SEND move. Why the tool and
  not only the precondition: a precondition refusal is a pending draft for Ben, i.e. the second
  ask would still be composed and land in his queue; the captain's rule is that it is not asked,
  and the tool boundary is where the Scoper's other "when may it propose this" rules already live.
- **B2 the gap travels.** The clerk's `get_thread` data carries the same fact (`mediaAsk`), and
  the price payload gains `customerMedia` (sent photos / video, and the ask fact) computed from
  the thread it already embeds. The page shows a "No photo" pill when the customer sent none,
  with "asked …, replied without one" when that is so.
- **B3 wiring.** The pill opens the existing "Ask her first" sheet pre-filled with the rules
  layer's photo ask; Ben still taps "Queue the question". Nothing is sent without him.

No Scoper wording changes, no new templates, no guard or rail changes, no media settings, no
`describe-video.ts`, no ack wording, no money rules, no migration, no `app_settings` flag.

## Consequences to state

- Asking once means some quotes are built on less information and priced on printed assumptions;
  more will need revising. Ben sees "No photo" on the screen and can ask before pricing.
- On `ask_gap` at SEND: a second photo ask no longer goes out (before: it did, unseen). A first
  photo ask still goes out as before. A Scoper turn after the ask-once refusal proceeds with a
  `confirm_received` / `clarify_scope` and the `needs_quote` tag; `confirm_received` is at SEND
  only where the last inbound brought media or a postcode (unchanged precondition).
- With `firstContactAutoAck.askForMedia` on, the ack's folded sentence counts as the one ask.
- A thread whose second message Haiku calls `rules` now runs the Scoper (one Sonnet call); a bare
  "thanks" reaching the Scoper is answered by its own "say nothing" rule.

## Proof

- Unit tests in `server/spine/reach-the-scoper-t20.test.ts` (triage A1/A2, the media-ask module,
  the Scoper gate through the stubbed belt, the precondition belt, the price payload field) and a
  client test for the pill; an eval case under `eval-cases/ask_gap/` graded by `--adapter triage`.
- Sandbox walkthrough in the DONE report (inbound WhatsApp door, opening line, immediate reply
  with a list). This machine has no database or model key, so the walkthrough is the captain's to
  repeat; the tests prove the mechanism.

## Gate

`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` (zero new vs `941f467`), vitest
failing-set diff (server with placeholder `DATABASE_URL`, client separately), esbuild bundles
`server/index.ts`, both no-key eval adapters exit 0. ENOSPC → `blocked:`.
