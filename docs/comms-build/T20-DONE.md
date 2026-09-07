# T20 — reach the Scoper: DONE report

Brief: `BRIEF-T20-reach-the-scoper.md`. Branch `fm/reach-the-scoper-t20`, written from `941f467`
(T19 merged) and **rebased onto `f152d18`** after T18 (`d917b46`, gas-only scope) and T21
(`f152d18`, the follow-up after Ben's call) merged; `f152d18` is the start commit the gate below
is measured against. Four things, in the captain's order: **Fault A** (the reply to our ack got silence),
**Fault B** (the Scoper insisted on a photo it did not need), then the two additions from the
Priya thread (**thank once** for the same photo; **"one second let me check" is not a promise**).
All four are done and proven by tests. **This machine has no database and no model key**, so the
sandbox walkthrough below is the captain's to repeat; nothing here was seen on a live screen.

---

## How to check this in the sandbox (copy and paste)

```bash
git fetch origin && git checkout fm/reach-the-scoper-t20 && npm run dev
```

Open http://localhost:5001/admin/sandbox and press **Reset thread**, then **New scenario**.
**Inbound WhatsApp** is selected by default.

**Fault A — the reply to the ack reaches the Scoper.**

1. In the message box type exactly `Hi i have a few jobs i need a quote for please` and press
   **Open through this door**. As before (T19): your line on the left, the bubble *rules layer
   ack · mirrored · never sent* with the greeting and the call question, and in the pass detail
   `Triage (rules): lane rules, intent ack_enquiry`. First contact is still the rules layer's.
2. Straight away, in the composer, type a list as the customer did and send:
   `its just a few jobs, happy to send a list: - Mount tv to wall - Fit lock to bathroom door - Change a light fitting`
3. **What you should see now.** The triage line reads `lane scoper` (or `lane quote_clerk` if the
   first pass's model already tagged the thread `needs_quote`), never `lane rules`. If Haiku
   answered `rules` you will see it in the triage reasons: *model chose lane rules on a thread
   that is not first contact; kept the rules' lane scoper (T20)*. Then `Pack customer.default →
   agent scoper`, the Scoper's tools stream, and a dashed amber **NOT SENT** bubble with its
   reply. **No second *rules layer ack* bubble appears** (at `941f467`, when Haiku said `rules`
   with intent `ack_enquiry`, the sandbox placed a second mirrored ack and no agent ran; live,
   the customer got nothing).
4. **What a fault looks like.** The pass detail says `lane rules` on your second message, or the
   decision reads *nothing from this pass — no proposal. First contact is the rules layer's*.
   Stop and report with the run id; that is the fault this branch removes.

**Fault B — ask for a photo once, then proceed.**

5. Press **Reset thread**, **New scenario**, Inbound WhatsApp, type
   `Hi, I need a ring doorbell fitting at NG7 2AB` and open the door (the ack mirrors as in step 1).
6. Send `Its going on the front door, left of the frame as you look at it`. The Scoper's reply
   should be its usual first ask for a photo (the amber NOT SENT bubble, intent `ask_gap`). If
   `ask_gap` is at SEND on your server the sandbox still never sends: read the decision line.
7. Send `Front door, brick wall to the left of the frame, no photo sorry` — no attachment.
8. **What you should see now.** The Scoper does **not** ask for a photo again. In the pass detail
   the case file carries a line beginning `MEDIA ASKED ONCE: we asked for a photo or video at …
   and they have replied without one. Do not ask for media again.` If the model tries anyway, the
   tool feed shows the refusal *Refused: we already asked for a photo or video (at …) and they
   replied without sending one…* and the model's next `propose_reply` carries on without it
   (typically `confirm_received` or `clarify_scope`, tags `needs_quote`). The decision for a
   proceeding reply is whatever its tier says; a second photo ask can no longer be sent even at
   SEND (the decision would read `pending — precondition: media_already_asked`).
9. Press **Run clock pass** (`/run`, trigger `cadence`). The thread is tagged `needs_quote`, the
   clerk runs, Route A prices it on the sandbox number, and the note says *Ben would have been
   pinged*. Open `/admin/price/<the draft's slug>` (the slug is in the note). In the header pill
   row you should see **No photo · asked, none sent**. Tap it: the *Ask Sam one thing first* sheet
   opens **pre-filled** with *Could you send a quick photo or video of the job? A clip of where the
   problem is helps us get it right first time.* Nothing has been sent; **Queue the question**
   would put it in your queue exactly as the existing Ask-her-first does. (The sandbox draft is
   excluded from the price queue and its send refuses, as T16 set up.)
10. **What a fault looks like.** A second photo ask in step 8; no `MEDIA ASKED ONCE` line in the
    case file; the pill missing on a draft with no customer photo; the sheet opening empty.

**Addition 1 — thank once.** Reset, open the WhatsApp door with `the extractor fan in our bathroom
has stopped working`, then **Attach** any photo with the text `This is the fan`. The Scoper thanks
for it (its usual *got the photo* line). Now send `its just got black mould marks at the minute`
with no attachment. The next reply must **not** thank for the photo again: if the model tries, the
tool feed shows *Refused: we already thanked them for the photo or video (at …) and nothing new
has arrived since. Do not thank them for it again: start with the substance.* Attach a second
photo and the thanks is allowed again (new media).

**Addition 2 — a pause is not a promise.** On the same thread send `one second let me check`.
The decision must **not** be `none — waiting_for_promised` (at `941f467` it was). Then send
`I will send the measurements tomorrow`: that one **is** still `waiting_for_promised`.

**Nothing you do here can reach a phone.** The thread is on the reserved number `+447700900942`,
every pass is a dry run, the exit is never called.

---

## Fault A — what was established (line numbers at `941f467`)

**"No proposal" on the rules lane is by construction.** `agentForLane('rules')` picks
`RULES_PLACEHOLDER`, whose `run()` returns `null` (`server/spine/index.ts:34-38, 57`); `decide`
then returns `{ kind: 'none', reason: 'no proposal' }` (`server/spine/decide.ts:98`). Nothing in
the spine can compose on that lane. What answers a rules-lane pass lives outside the spine: the
first-contact ack fired at ingest (`server/agents/comms-lanes.ts:128`, not awaited), the 10-minute
holding line, and the exit's content-free ask (`server/spine/asks.ts:97-98`, gated by
`spine.asks.enabled`), all of which are for a FIRST message.

**Two routes put a thread on that lane.**

1. `triageRules` (`server/spine/triage.ts:180-184`): `if (!hasOutbound(cf))` → `lane: 'rules'`,
   checked before `needs_quote → quote_clerk` (`:186-189`) and the scoper default (`:202-203`).
   `hasOutbound` (`:105-107`) reads `message_out` / `call_out` off the case file, which
   `buildCaseFile` fills from non-quarantined `messages` rows (`server/spine/case-file.ts:107-145`).
2. `mergeTriage` (`server/spine/triage.ts:288`): `let lane: Lane = model.lane;` — the model's
   lane is adopted verbatim. The prompt offers it `"rules" only for a first contact or a
   content-free acknowledgement` (`:223`). Nothing stopped the model choosing a lane that runs
   no agent.

**Which route this thread took.** The run's tags (`needs_quote`, `chillwell`, `multiple_jobs`)
can only come from the model (the rules add only `callback_requested` / `rescope`), so the
triage source was `model` and the lane was Haiku's choice: route 2. **The ack had been recorded
as an outbound.** It goes `queueDraft → approveAndSendDraft → sendCustomerMessage` and lands as a
`messages` row; the ledger shows it at 17:46, before the 17:47 list. With the default debounce
(`debounceMinutes: 10`, `server/spine/config.ts:85`; floor 3 s, `request-run.ts:97`) the pass on
the list ran around 17:57 with the ack in its case file, so `triageRules` said `scoper` (no quote
tag was on the row yet), and Haiku, shown a thread whose only outbound is our ack and whose
customer is answering that ack, called it a first contact. The reason text and the intent it
returned are not in the brief's excerpt; the triage child row (`agent_runs`, parent
`run_e5372115…`, `proposal.source`) settles it and is the captain's to read.

**The timing gap is real, on a different path, not this thread's.** The ack is queued with a
60–150 s realism hold and released by the worker (S15 §4.6). A second customer message inside the
hold makes the ack stale by identity; `approveAndSendDraft` reverts it and `requestFreshRun` asks
for a run with `delayMs: 0` (`server/draft-freshness.ts:159`). That pass builds a case file with two
inbounds and NO outbound → route 1 → `rules` → nothing, and the model, seeing no outbound, says
`rules` too. T6 met the same shape in the sandbox (no ack row ever written) and fixed it sandbox-only.

**After the pass, nothing recovered it.** The model's `needs_quote` landed on the row
(`triage.ts:334-351`); `ensureQuoteRun` inside the pass is refused by the run's own lease (BACKLOG
D11); the net re-opens the thread once because the D1 stamp had not seen the tag, but a cadence
pass whose model again says `rules` leaves a stamp that includes `needs_quote`, and
`lastPassCoversThisTurn` closes the net for good (`request-run.ts:334-342`). The holding line is
suppressed because an outbound (the ack) landed after the inbound (`rules-layer.ts:152`).

**It is a shape, on every door.** Any customer turn on which Haiku answers `lane: rules` gets no
agent, no draft, no flag and no ask. The likeliest moment is exactly the second message on every
inbound WhatsApp, SMS and webform thread, and the first WhatsApp message after a post-call ack: one
outbound (our ack) and the customer replying to it. How often it happened is a ledger question:
`agent_runs` rows with `agent = 'rules'`, `decision = 'none'`, whose triage child has
`proposal.source = 'model'`, on a thread with an outbound older than the inbound.

## Fault A — the fix (`server/spine/triage.ts`; the exact lines, for the sibling's rebase)

Diff hunks against `941f467` (old → new line numbers):

- `@@ -70 +70,13 @@` and `@@ -72 +84 @@` — `RE_PROMISED_MORE` narrowed and `RE_PAUSE_ONLY` added
  (Addition 2, below). Above the sibling's lexicon hunk (`43-60`), below nothing of theirs.
- `@@ -179,0 +192,5 @@` and `@@ -181,3 +198,7 @@` — the first-contact branch in `triageRules`
  (old lines 180-184): fires only while the customer's message is the thread's ONLY text message
  (`message_in` with channel other than `call`; a call lands as both a call-channel message and a
  call row, `server/call-thread.ts:513-519`, and its own ack answers it). A second text with
  nothing from us between adds the reason *no outbound on the thread but N customer messages: the
  ack did not land…* and falls through to the ordinary lanes. The sibling's `156-167` hunk is
  the regulated branch above this; no overlap.
- `@@ -287 +308 @@` and `@@ -288,0 +310,12 @@` — in `mergeTriage`, `const intent` becomes `let`,
  and directly after `let lane: Lane = model.lane;` a self-contained block: if the model says
  `rules` and the rules did not, keep the rules' lane, set the intent to `unknown` (the model's
  intent on such an answer is an `ack_*`, and `resolveStaticPack` would otherwise pick a rules
  pack on it), and record *model chose lane rules on a thread that is not first contact; kept the
  rules' lane <lane> (T20)*. The sibling's `277-289` hunk ends two lines above; their `295-310`
  hunk (the `reasons:` array) is the one line below that this branch also touches:
- `@@ -298 +331 @@` — `reasons: [...model.reasons, ...laneNotes, ...rules.reasons]`. The sibling
  turns the same line into a multi-line array; the merge is to add `...laneNotes` between their
  two spreads.

Nothing else in `triage.ts` changed: not the lexicons, not the prompt, not the out_of_scope
handling, not the model call. The rules layer says nothing new; the prompt line still offers
"rules" (the merge refuses it, whatever the prompt says).

## Fault B — what was established

- The only gate on WHEN the Scoper asks for a photo was the model's judgement
  (`scoper.core.md:28-32`). The tool boundary refused `point_to_picker` without a quote and
  `quote_on_its_way` with a live one (`scoper.ts:322-327`) and nothing about media.
- `ask_gap` is at SEND. The send preconditions (`send-preconditions.ts:128-134`) gate it on quote /
  date / a question mark in the last message: a second photo ask sent unseen.
- Four things ask a customer for media, all as outbound bodies on the thread: the first-contact
  ack's folded sentence (`first-contact-ack.ts:535-562`, when `askForMedia`), the rules layer's
  `ask_media` (`rules-layer.ts:75-79`, from the exit on a rules-lane `none`), the Scoper's
  `ask_gap`, and Ben.
- **What the price screen already tracks as missing.** `buildPricePayload`
  (`server/spine/price-screen.ts:396-399`) computes `photos` / `videos` (the quote's own media
  columns) and `sentPhotos` / `sentVideo` (from the embedded thread) and gives every line
  `evidence.media`. The clerk's intake has `gaps`, but `quote_ready` may not carry a customer gap
  (`server/agents/quote-prep.ts:268-270`) and Route A runs only on `quote_ready` (`index.ts:349`),
  so a "no photo" GAP would stall the quote — the blocking the captain wants gone. The job pack's
  `missing` is post-deposit delivery fields. **Reused:** `photos` / `videos` / `sentPhotos` /
  `sentVideo` and the thread. No new notion of missing was invented.
- **Ben can already ask from the price screen: yes, this was wiring.** `POST
  /api/spine/price/:slug/ask { question }` → `askFirst` (`price-brief.ts:539-551`) queues one
  question as a pending draft in his queue and holds the quote until she answers; the page's
  "Ask her first" sheet is that route. There is also `POST /api/spine/ask/:conversationId
  { kind: 'ask_media' }` (`routes.ts:253-262`), the rules layer's fixed photo ask sent at once under
  the signed-in human's approver, used by the quote card; the price screen keeps its own
  hold-until-she-answers semantics, so the pill uses the sheet.

## Fault B — the fix

- **`server/spine/media-ask.ts` (new, pure).** `asksForMedia(body)` recognises every asker (an
  asking verb near a media noun, the soft "a photo would help", a question with a media noun;
  "no need for a photo" is not an ask). `mediaAskState(turns)` finds the newest such outbound and
  says whether the customer replied since without media (`outstanding`). Three adapters read the
  case file, the price screen's thread and raw `messages` rows into the same turns, so one
  function serves every reader. `mediaAskLine` is the one case-file line; `mediaAskRefusal` the
  tool's refusal.
- **`server/spine/agents/scoper.ts`.** `propose_reply` refuses a body that asks for media while an
  ask is outstanding, whatever the intent label (the refusal says to proceed with
  `confirm_received` / `clarify_scope` and tag `needs_quote`); `renderCaseFile` carries the
  `MEDIA ASKED ONCE` line while it is outstanding. **Why the tool and not only the precondition:**
  a precondition refusal is a pending draft for Ben — the second ask would still be composed and
  land in his queue — and the captain's rule is that it is not asked; the tool boundary is where
  the Scoper's other "may it propose this" rules already live.
- **`server/spine/send-preconditions.ts`.** `media_already_asked`, for every intent, as the belt
  for any other proposer; `decide` turns it into `pending — precondition: media_already_asked`.
- **The gap travels.** `server/agents/quote-prep.ts` `get_thread` returns `mediaAsk` (asked at,
  replied without, and a note to price from their words with printed assumptions) — one field in
  the data the clerk already reads, no prompt change. `buildPricePayload` adds `customerMedia`
  (`sentPhotos`, `sentVideo`, `askedAt`, `repliedWithoutMedia`). `PriceAndSendPage.tsx` shows a
  **No photo** pill (with *· asked, none sent* when so) on a draft with no customer media; a tap
  opens the existing Ask-her-first sheet pre-filled with the rules layer's photo ask. Ben still
  queues it; nothing is sent without him.

## Addition 1 — thank once (Priya, 495577b5)

Nothing tracked that a media item had been acknowledged: the 18:09 send said *got the photo, that
is really helpful* and the 18:10 pass composed *Thanks for the photo, that is helpful* for the
same image; only the DRAFT tier stopped it. Now, in `media-ask.ts`: `acknowledgesMedia(body)`
(a thank-you or a receipt near a media noun, never an ask) and `mediaAckState(turns)`: the newest
inbound media item and whether one of our outbounds after it acknowledges media
(`alreadyThanked`); a newer photo resets it. The Scoper's tool refuses a body that thanks again
(*Refused: we already thanked them for the photo or video … start with the substance*), and the
precondition belts it as `media_already_acknowledged`. Deterministic, off the thread; the model
is never asked to remember.

## Addition 2 — where the promise line is drawn

`customerPromisedMore` (`triage.ts`, used by `triageRules`, the case file's
`lastInboundPromisedMore`, and `decide`'s `waiting_for_promised`) matched a pause as a promise:
`RE_PROMISED_MORE` listed "one sec / hang on / bear with / give me a minute / let me check / in a
mo / just a sec / few mins" beside "will send / back soon". The line is now drawn on the words:

- **Still a promise (the desk waits):** a named deliverable on its way — `will send / get / grab /
  take / find / forward`, `I'll send / get you / get / grab / take / find / forward / pop`,
  `sending it / them / now / over`, `send it over now / shortly / in a sec`, `let me get / grab /
  take / find` — or a deferred return: `back soon`, `be back`, `shortly`. Janet's incident sentence
  ("back soon with the measurement") and "I will send the measurements tomorrow" still wait.
  "hang on, I'll take a photo" waits too (the deliverable is named).
- **A pause, not a promise (the desk answers):** `one sec / second / minute`, `give me a … minute`,
  `hang on`, `bear with`, `let me check`, `in a minute / sec / bit / mo`, `just a sec / mo`, `two
  secs`, `a few mins`. Exported as `RE_PAUSE_ONLY` so the test pins what is deliberately not a
  promise. "one second let me check" no longer returns `waiting_for_promised`.

The P7 test's phrase lists in `triage.test.ts:109-113` were moved to match (one line each way;
the sibling adds tests elsewhere in that file).

## Consequences, stated plainly

- **Asking once means some quotes are built on less information** and priced on printed
  assumptions. More will need revising. Ben sees *No photo · asked, none sent* on the screen and
  can ask before he prices.
- **On `ask_gap` at SEND, what changes:** a SECOND photo ask no longer goes out (before, it did,
  unseen: run_b2836d5b). A first photo ask goes out exactly as before. A Scoper turn after the
  refusal proceeds with a `confirm_received` or `clarify_scope`; `clarify_scope` is neverSend
  (pending for Ben), and `confirm_received` sends only where the last inbound brought media or a
  postcode (the unchanged precondition). So the customer who declines a photo mostly gets a
  reply that waits for Ben — the tier act, not this branch (see Not done).
- **New sends that did not exist before:** on `confirm_received` at SEND, a thank-you for a photo
  we already thanked for now cannot send; nothing that was previously held becomes sendable.
  A bare pause now reaches the Scoper, whose proposal is decided on its own tier, so a customer
  mid-typing may get the Scoper's reply crossing theirs instead of silence.
- **With `firstContactAutoAck.askForMedia` on**, the ack's folded sentence counts as the one ask.
- **Fewer rules-layer asks.** `maybeAskFromExit` fires on `rules` + `none`; a second message
  no longer lands there, so the exit's content-free `ask_media` / `ask_postcode` fire on first
  messages only, which is what they were written for.
- **One more Sonnet call per "thanks!"** whose triage Haiku used to lane `rules`; the Scoper's own
  "say nothing" rule answers it.
- **The burst-inside-the-hold case** (a second message while the ack is held): the delay-0 pass
  now runs the Scoper instead of laning `rules`; its reply (if at SEND) lands, the stale ack is
  binned by it. Before: nothing for ten minutes, then the holding line (S15 §4.6).

## What was NOT changed

Tiers, the sampler, autonomy, media settings, `describe-video.ts`, the first-contact ack's
wording, prices, money rules, the guards, the templates, the Scoper's prompt files, the triage
prompt, the D11 lease refusal, the D1 stamp. No migration, no `app_settings` flag.

## Not done

- **The clerk does not re-run after a Scoper pass on a thread already tagged `needs_quote`**
  (BACKLOG **D14**, new). In run_b2836d5b's exact shape (`needs_quote` + `needs_photos` on the
  row, model → `scoper`), the Scoper now proceeds without a photo, but nothing schedules the clerk
  because the tag is not fresh and the D1 stamp then covers the turn. Fixing it means changing
  what the stamp means or letting the exit request the clerk on a re-asserted tag, both of which
  re-open the D7 loop family; that is a decision above this pane. The sandbox walkthrough uses
  the fresh flow (the tag lands on the Scoper's proceeding reply), where the clerk does run.
- **Not seen live.** No database and no model key here: the walkthrough is yours; the tests prove
  the mechanism. The triage child row for `run_e5372115…` (`proposal.source`, `proposal.reasons`)
  is the one read that would confirm Haiku's answer word for word.
- **The photo ask copy is duplicated on the client** (`PHOTO_ASK_PREFILL`; BACKLOG **D15**).
- **`fm-ensure-agents-md.sh` was not run.** It would promote the checked-in `CLAUDE.md` into an
  `AGENTS.md` plus a pointer file — a rename of the file every open branch (including the
  sibling's) edits. The T20 paragraph went into `CLAUDE.md` as every T-task before it.
- **The "answered call" money-lexicon path (S15 §4.4)** and the missed-call callback debt are
  untouched; not in this brief.

## Tests

- `server/spine/reach-the-scoper-t20.test.ts` — 33 tests: Fault A (rules, merge, end to end
  through `triage` with a fake Haiku answering `rules`, two-message first contact, the call
  pair), the media-ask reader and its three adapters, the Scoper's tool through the real belt
  with a scripted model (refuses the second ask, accepts the proceed, allows the first ask and
  the re-ask after new media, the case-file line), the precondition belt and `decide` at SEND,
  thank once (reader, tool, belt), the promise line both ways with `decide`, the price payload.
- `client/src/pages/admin/__tests__/PriceAndSendPage.test.tsx` — two tests: the pill and the
  pre-filled sheet posting to `/ask`; no pill when photos exist.
- `eval-cases/ask_gap/media-ask-once.json` — two cases graded by `--adapter triage`:
  `ag-t20-media-asked-once` → `precondition: media_already_asked`;
  `ag-t20-first-media-ask-still-sends` → may send.
- `server/spine/triage.test.ts:109-113` — the P7 phrase lists moved to the new line.

## Gate (measured)

| Check | Start `941f467` | This branch |
|---|---|---|
| Rebase onto `f152d18` (T18 + T21 in) | — | Two conflicts, both foreseen in this report: `triage.ts` `reasons:` (T18's multi-line array kept, `...laneNotes` added between their spread and `rules.reasons`) and the two CLAUDE.md paragraphs (both kept). T21's `answeredByCall` lines (import, 134-162) and T18's lexicon / prompt / `droppedOutOfScope` lines merged untouched beside mine. Every pin re-run after the rebase: 14 server suites, 342 tests green — mine (`reach-the-scoper-t20`), T18's gas pins in `triage.test.ts` (`routes gas work to Ben as regulated_trade`, `PIN: a gas job never reaches the Scoper whatever the model says`, `the model cannot send a water heater to Ben as out_of_scope`), T21's `answered-by-call`, plus `send-preconditions`, `scoper`, `price-screen`, `decide`, `asks`, `date-question-retired`, `post-call-ladder`, `draft-guards.capability`, `intake`, `sandbox-routes`, `sandbox-scenarios`; client `PriceAndSendPage`, `QuoteIntakeCard`, `SandboxPage` 131 green |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` | 1,880 errors at `f152d18` | 1,880 errors; zero in any touched file; the only set differences (12 lines each way) are tsc reordering union members inside otherwise identical pre-existing errors (no new file + error-code pair) |
| `vitest run --project server` (placeholder `DATABASE_URL`) | 43 failed / 1,666 passed at `f152d18`: `eve-pricing-engine` 37, `segment-classifier` 4, `contractor-pay` 1, and `call-script/__tests__/performance.test.ts` 1 | 42 failed / 1,700 passed: `eve-pricing-engine` 37, `segment-classifier` 4, `contractor-pay` 1 — a strict subset of the baseline's. The one difference is the heap benchmark "repeated classifications without memory growth" (a raw `heapUsed` delta with no GC hook, named load-flaky in the brief): on the first measurement it failed 3/3 at HEAD and passed at the old base, on this one it failed at the base and passed at HEAD; with `NODE_OPTIONS=--expose-gc` it passes at HEAD (growth −9.6 MB). Run-to-run noise, not this branch. 33 new tests green |
| `vitest run --project client PriceAndSendPage.test.tsx` | — | 65 passed (63 + 2 new) |
| `scripts/eval-comms.ts --adapter triage --trials 1 --quick` | — | exit 0, regression red 0 |
| `scripts/eval-comms.ts --adapter replay --trials 1 --quick` | — | exit 0, regression red 0 |
| `esbuild server/index.ts --bundle` | — | bundles (4.3 MB) |

(The baselines were measured on a `git archive` of the start commit in the scratchpad with
`node_modules` linked, not on the shared checkout. **Disk incident, reported to firstmate at the
time:** a full archive of this repository is about 800 MB (`valentine-page` 497 MB, `client`
215 MB), and two of them filled the machine's disk to 100 % for a few minutes during the second
measurement; the second vitest baseline extraction died there. Both copies were removed, 3.1 GB
was free again, and the baseline was re-measured on a 247 MB copy without `valentine-page`,
`client/public` and `attached_assets`, which vitest does not read. Other lanes may have seen
ENOSPC in that window.)

## Files

`server/spine/media-ask.ts` (new) · `server/spine/triage.ts` · `server/spine/agents/scoper.ts` ·
`server/spine/send-preconditions.ts` · `server/spine/price-screen.ts` · `server/agents/quote-prep.ts`
(the `get_thread` data only) · `client/src/pages/admin/PriceAndSendPage.tsx` ·
`server/spine/reach-the-scoper-t20.test.ts` (new) · `server/spine/triage.test.ts` (P7 lists) ·
`client/src/pages/admin/__tests__/PriceAndSendPage.test.tsx` · `eval-cases/ask_gap/media-ask-once.json`
(new) · `docs/comms-build/BRIEF-T20-reach-the-scoper.md` · this file · `docs/comms-build/BACKLOG.md`
(D14, D15) · `CLAUDE.md` (one paragraph).
