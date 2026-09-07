# T16 — the sandbox's four front doors, the messaging window, and the full funnel: DONE report

Brief: `BRIEF-T16-sandbox-scenarios.md`. Branch `fm/sandbox-scenarios-t16`, written from `0d7bb6c`
(T13 merged), then **rebased onto `ed0fef2` (T14, the describer's model fix) on 7 Sep** after PR 15
conflicted with it. Both behaviours are kept: T14's vision-health verdict still feeds the sandbox
banner (`videoStatus` → `vision-health.ts`, the `VISION FAILING` line in `videoWarning`) and its
route, next to the doors, the window and the funnel. The only textual conflicts were two docs
(`CLAUDE.md`'s comms bullets, `BACKLOG.md`'s lane number: T14 keeps Lane 11, this task is Lane 12);
the four code files git merged on its own were checked line by line for both sides. One byte of
mine was fixed on the way (a stray NUL in a fallback expression in `loadState`). The build gate
below was re-measured against `ed0fef2`, not the old numbers.

**This was built without being run.** The pane had no `.env`, no database, no model key and no dev
server, so no door was ever opened live, no pass ever ran, no template cache was ever read.
Everything below rests on unit tests and the build gate. **Nothing in this report claims the page
works end to end.** The section right below is how you find out, and it is the deliverable.

Your question about the ack after the photo is answered in **§ The ack question** below (short
version: it is correct, and the page now says whether production would actually send it).

---

## How to check this (copy and paste)

You need the repo on this branch, your usual `.env`, and an admin login. Every step is on
`/admin/sandbox` only. Nothing you do here can reach a phone: the thread is on the reserved number
`+447700900942`, every pass is a dry run, and the two things that used to be skipped because they
leave the thread (Ben's Pushover, the job pack) are now **recorded and painted red**, never done.

```bash
git fetch origin && git checkout fm/sandbox-scenarios-t16 && npm run dev
```

Open http://localhost:5001/admin/sandbox. If a thread is there, press **Reset thread**.

### 1. The webform door (the ack is a template, because a form opens no window)

1. Under **Open a thread through one of the four front doors**, click **Webform**. The card's
   bottom line tells you what *your* server would do: whether the first-contact ack is ON for
   webform, and whether `web_enquiry_ack_context` is `approved`, `pending` or `missing` in your
   template cache. Read it; it decides what you see next.
2. Leave the name (Priya Shah) and the enquiry as they are. Press **Open through this door**.
3. What you should see:
   - a customer bubble on the left labelled **📝 webform** with the enquiry;
   - the thread header's window strip in **amber**: *WhatsApp window: SHUT — last customer
     WhatsApp never* and *Only an approved Meta template may go on WhatsApp*;
   - on the right, a blue **Door: Webform** box. Under *The first-contact ack ladder* a table of
     template names with their Meta status; the one with a ✓ is the rung that carries the ack.
     If `web_enquiry_ack_context` is approved, the mirrored bubble on the left reads
     *rules layer ack · template web_enquiry_ack_context · mirrored · never sent* and quotes the
     enquiry back ("we got your message: …"). If it is pending, the next approved rung is picked
     (probably `call_request`), and the table says so. If none is approved and an SMS sender is
     configured, the bubble is labelled *by SMS* and carries the ack in our own words. If none and
     no SMS sender: **Nothing placed on the thread** in amber, which is what the customer gets live;
   - a green or amber gate line: *On this server the first-contact ack is ON for webform:
     production sends exactly this, 60 to 150 s after the message* or *OFF: production would send
     nothing here*;
   - below that, the desk's first pass (trigger `inbound_message`): with the ack mirrored, the
     triage should say `lane scoper`, and the Scoper's proposal is a dashed amber NOT SENT bubble.
     With nothing mirrored it says `lane rules` (first contact still), which is also what happens
     live until Ben answers.
4. Now type as the customer on WhatsApp: `Thanks. It's a 4 inch fan in the ceiling, NG7 2AB.`
   The window strip turns **green OPEN**. The Scoper replies.

### 2. The post-call door (WhatsApp agreed on the phone)

1. **New scenario** → **Post-call (WhatsApp agreed)**. The card's bottom line says whether
   `post_call_continuation` and its generic twin are approved, whether the continuation switch is
   on, and whether the spine is on. Leave the defaults (Alex Morgan, "the bathroom extractor fan",
   *agreed*). Press **Open through this door**.
2. What you should see:
   - a grey bubble **📞 phone call**: *Inbound call (…), job enquiry: …; WhatsApp agreed*, exactly
     the line the board shows for a real call;
   - the window strip **SHUT** (a call never opens it);
   - the Door box, *The call, as call-thread.ts writes it*, then *Continuation: AGREED_ON_CALL →
     template post_call_continuation* and the ladder table. If it is approved, the mirrored bubble
     reads *Hi Alex, good to speak just now about the bathroom extractor fan. This is the number
     to send over any photos or videos…*. **If neither template is approved with Meta, the box
     says NO APPROVED TEMPLATE — nothing can send, and nothing is placed.** That is the live
     behaviour: there is no lawful way to deliver it, and no legacy fallback;
   - the gate line: whether production would send it, and whether it auto-sends under the
     first-contact exception or waits in Ben's queue;
   - the first pass ran with trigger **`call_ended`**. Read the triage line: with the continuation
     mirrored it is `lane scoper` (the Scoper reads the transcript); with nothing mirrored it is
     `lane rules` (first contact). Live, the same.
3. Change **WhatsApp on the call** to *declined* and open again: *NOT_AGREED:CUSTOMER_DECLINED_MESSAGING
   — tagged no_auto_messages*, nothing placed. That is `decideOutreach`'s own answer.

### 3. The SMS door (no window, replies by SMS, a push towards WhatsApp)

1. **New scenario** → **Inbound SMS**, defaults (Dave, gutters). Open.
2. What you should see: a bubble **💬 SMS**; the strip *SHUT — last customer WhatsApp never* with
   *The customer last wrote by SMS: replies go by SMS*; the mirrored ack labelled *by SMS* (if
   `askForMedia` is on and the SMS and WhatsApp senders are one number, it ends "WhatsApp a quick
   photo … to this number"); the composer's channel toggle is now on **SMS** and **Attach** is
   disabled (a UK long code cannot receive a photo).
3. Reply as the customer by SMS: `its the back gutter, water pouring over near the drainpipe`.
   The Scoper's reply should be SMS-shaped: short, asking them to *describe* rather than attach,
   and it may invite a switch to WhatsApp once with a wa.me link (`prompts/scoper.core.md`). If it
   asks for a photo as if this were WhatsApp, that is a finding; note the run id.
4. Click **WhatsApp** on the toggle and send `here you go` with a photo attached: the strip turns
   **OPEN** and the reply is a WhatsApp one.

### 4. The inbound WhatsApp door (the baseline, and your ack question)

1. **New scenario** → **Inbound WhatsApp**, name Sam. Open. Nothing is seeded: the first message
   is first contact.
2. Attach a photo and send it with no text. The mirrored bubble is *Hi Sam, thanks for sending
   those over…* (intent `ack_photos`) and the blue box now carries a gate line saying whether
   production would send it on this server. See § The ack question.

### 5. The window as a control (any door)

1. On a thread whose strip is **OPEN**, type `25` in the *Move the thread back* box (it is the
   default) and press **Fast-forward**. The strip turns **amber SHUT — last customer WhatsApp
   25.0 h ago**. Every timestamp on the thread moved back 25 hours; the database now holds
   exactly what it would hold tomorrow.
2. Press **Run a clock pass**. This is a pass with no new customer message, what a sweep does.
   Read the decision: with the window shut a SEND-tier reply goes *template only* or *pending*
   with the reason in words; the *Window* field in the detail says *shut (template required)*.
3. Send a WhatsApp message as the customer: the strip is **OPEN** again.
4. With a quote out (§6), fast-forward **72** hours: the quote is past its 48 h expiry, and the
   next pass reads it as expired.

### 6. The funnel, first contact to acceptance

1. Open the **Webform** door (§1) and reply as the customer until the desk has what a quote
   needs: the job, a photo (Attach), the postcode. Watch the right-hand detail after each pass for
   a blue box *Tags put on the thread by this pass: needs_quote* — that is the Scoper saying "ready
   to price". (Live, the exit writes that tag and asks for the clerk's pass at once. The sandbox
   never runs the exit, so this one bookkeeping step is mirrored, and it says so.)
2. Press **Run a clock pass**. The triage line should read `lane quote_clerk`, the pack
   `customer.default → agent quote_clerk`, and the Quote clerk's tools stream in the live panel.
   Then, if the clerk says `quote_ready`, a note *sandbox: Route A runs…*, the estimator's tools,
   and at the end a **red box: Ben's phone would have buzzed — NOT sent**, with the exact
   Pushover: *💷 Quote ready to price: Priya Shah*, the lines, the suggested total, the link. A
   *Route A* box underneath names the draft slug and the estimate. This takes a minute or more
   (the clerk and the estimator are both real model belts).
3. The funnel strip above the composer now highlights **Priced draft · Ben pinged** and says the
   draft is *NOT in Ben's price queue* (open `/admin/price` in another tab to confirm it is
   absent; the sidebar badge must not count it).
4. Press **Ben prices and sends** (leave the total box empty to take the engine's suggestion, or
   type your own). The strip moves to **Quote sent**; a bubble *Ben's send · freeform · mirrored ·
   never sent* carries *Hi Priya! Here's your quote for £…* with the link. If the window was shut
   at that moment, the bubble is either the `quote_ready_link` template or absent, and the strip
   says *priced but NOT with the customer* with how to reopen the window.
5. Ask a question about the quote as the customer: `Does that include the making good?` The
   pass runs on `customer.post_quote`; the four 💷 chips are live too.
6. Press **Customer accepts (pays deposit)**. A red box: *🎉 Quote accepted*, the deposit at your
   settings' percentage; the header pill turns green *accepted*; the strip highlights
   **Accepted**; stage `won`. The note says what live does next (the job-pack delivery questions
   from the slow sweep, which skips this thread).
7. Ask another question after acceptance: `Do I need to be in?` The pass runs on
   `customer.default` (the quote is paid); a date question now goes to Ben (the booked-job rule).
8. **What happened on this thread**, bottom right, lists every step above in order.

### 7. Prove nothing was sent

`/admin/comms` and `/admin/desk` must not show the sandbox thread. `/admin/price` must not list
the sandbox draft. Ben's phone must not buzz at any point, including at steps 6.2 and 6.6 (the red
boxes are the proof of what did not happen). If you open the Pushover link in a red box
(`/admin/price/<slug>`) and press send there, the server answers 409 *This quote is on the comms
sandbox number* and sends nothing. Anything arriving on a real phone: stop and report, as always.

**What a fault looks like:**
- A red *Agent run failed* with a 400 or a key error: the model belt, not this branch (see T6).
- A door opens but the Door box is missing: the `/start` response did not carry `entry`; check
  the server log for `[Sandbox] start failed`.
- The window strip says OPEN right after opening the webform or post-call door: `lastInboundAt`
  was set where it must not be; stop and report (`insertInbound` sets it for WhatsApp only).
- The sandbox draft in `/admin/price`, or the price screen sending it: stop and report.
- The mirrored bubble's wording differs from what the template cache holds: the template's body
  changed at Twilio and the cache is stale; sync templates on `/admin/staff`.

**To clean up:** **Reset thread** deletes every row on the sandbox number: messages, runs, drafts,
nudges, quotes, and now the seeded call, the estimate rows and any job pack (none is written).

---

## The ack question

You reported: *"a first ack message was sent once image was sent"* on a fresh sandbox thread.

**That is correct behaviour, and it is what production does — provided the first-contact ack is
switched on.** The chain, from the code:

1. `server/conversation-engine.ts` receives the WhatsApp inbound with `NumMedia > 0` and calls
   `scheduleInboundTriage(…, { hasMedia: true })`.
2. `server/first-contact-ack.ts` `runFirstContactAck` picks the intent:
   `input.hasMedia ? 'ack_photos' : 'ack_enquiry'` (line 785). A photo-first contact is
   acknowledged as *"Hi, thanks for sending those over. — Is it OK if we give you a quick call to
   run through it? Or just reply here with the details."* The window is open (a WhatsApp inbound
   opens it), so it goes freeform, queued as a draft and released 60 to 150 seconds later by the
   comms sweep (the realism hold).
3. The spine's own triage agrees: `triageRules` lanes a thread with no outbound to `rules` with
   intent `ack_photos` when the last inbound carries media (`server/spine/triage.ts` line 181).
4. The sandbox's T6 mirror places exactly that ack so the next message reaches the desk.

So an image-only first contact is not acked differently from a text one by design; only the
opening line changes ("thanks for sending those over" instead of "thanks for getting in touch").
Two things were not visible before and are now:

- **The gate.** Live, that ack goes only when `comms_agent.firstContactAutoAck.enabled` is true and
  `whatsapp` is in its channels. The sandbox mirrored it regardless (T6, on purpose, so the desk
  could get a turn) but did not say whether production would. The mirrored box now reads the
  config on the server you are running and says *ON: production sends exactly this* or *OFF:
  production would send NOTHING here today; the sandbox mirrored it so the desk gets its turn*.
  Read that line on your server. If it says OFF, the thing you saw is a sandbox convenience, not a
  live behaviour, and a real photo-first customer today gets nothing until a person or the rules
  layer's asks answer them.
- **The hold.** Live it lands 60 to 150 seconds after the photo; the sandbox places it at once.
  The box says so.

Nothing about the ack's own logic was changed (out of scope). One consequence worth your judgement
rather than mine: because the ack asks "is it OK if we give you a quick call?", a customer who
sends a photo and gets that line has not yet been asked anything about the job; the Scoper's turn
comes on their next message. That is the live shape (T6 finding D1 explains why), not a defect.

---

## What shipped

### 1. The four doors (`server/spine/sandbox-scenarios.ts`, `POST /api/comms-sandbox/start`)

Each door resets the thread and seeds the shape the live writer produces, then mirrors the first
thing the customer would receive and reports the plan: which pipe, which rung of which ladder, the
Meta status of every name tried, the config gates on this server, and the live reason string.

| Door | Seeded as | The first reply, decided by | Mirrored as |
|---|---|---|---|
| Inbound WhatsApp | a clean thread with the pushname (no seed) | T6's mirror on the first message, now via `planFirstContactAck` with the gate | freeform ack |
| Post-call, WhatsApp agreed | a `calls` row (transcription, `classification` jsonb, duration) and its `call_<id>` message row through the real `describeCall`; `lastInboundAt` untouched | `decideOutreach` (allowUndiscussed off) → `pickContinuationTemplate` / `normalizeJobRef` → the cache by name → `checkDraft` on the slotted body → generic → `NO_APPROVED_TEMPLATE` | the template body, or nothing |
| Webform | an inbound row `channel webform` with the enquiry, the form name as `contactName`; `lastInboundAt` untouched | `composeFirstContactAck` + `templatePreferenceFor` walked against the cache with the same three values `first-contact-ack.ts` passes (`{{1}}` name, `{{2}}` the enquiry snippet, `{{3}}` shortly / in the morning) → SMS → queued | the template body on WhatsApp, or the composed ack by SMS, or nothing |
| Inbound SMS | an inbound row `channel sms`; `lastInboundAt` untouched | `composeFirstContactAck` by SMS (`smsOnly`), plus `mediaAskSentence('sms')` when `askForMedia` is on and the senders match | the composed ack by SMS |

Then the desk's first pass runs where live runs one: `inbound_message` for webform and SMS,
`call_ended` for a call. `spineAgentsFor` (the `accepts` predicate) has no caller in the runner,
so a `call_ended` pass routes by lane exactly as live: the transcript reaches the Scoper once an
outbound exists, and the clerk when a `needs_quote` tag lands.

`POST /message` gained `channel` (`whatsapp` | `sms`): an SMS never moves `lastInboundAt`, and a
photo on SMS is refused in words. The first-contact mirror (T6) now runs through the same planner
with the contact name, the intent triage chose, and the gate.

**Deliberately mirrored, not imported:** the enquiry snippet and the template-variable walk are
not exported by the live modules; `sandbox-scenarios.ts` carries line-for-line copies that say so
(BACKLOG T16-b). Every other decision is the live function.

### 2. The window (`windowReport`, `POST /age`, `POST /run`)

The thread header shows the window as `buildCaseFile` will read it: `canSendFreeform` on the
sandbox number (the live check, with the row-derived read as a cross-check), the last customer
WhatsApp, the channel last used, and what that permits. `/age { hours }` moves every timestamp on
the thread back (messages, the conversation's four clocks, calls, quotes including `expiresAt` and
`depositPaidAt`, runs, flags, estimates): the rows are what the live database holds N hours
later. `/run { trigger: 'cadence' | 'manual' }` is a pass with no new message; an inbound trigger
is refused there because it would fake a customer message.

### 3. The funnel

- **Route A runs in the sandbox** (BACKLOG T5-a, closed). `runOnce`'s sandbox branch no longer
  skips a `quote_ready` artifact: the chain runs with `sandboxRouteADeps` (`server/spine/sandbox.ts`):
  the estimator (a real model belt, a real `quote_estimates` row on the sandbox conversation), the
  pricing engine (read-only), the priced draft (a real `personalized_quotes` row on the sandbox
  number, prices null, suggestions on it), the supersede — all live functions on this thread only;
  `notify` records the Pushover verbatim (`quoteReadyNotice`, a pure mirror of
  `notifyQuoteReadyToPrice`'s lines), `writePack` records what the pack would have held,
  `log` records the system-events lines. The run carries `routeA.sandbox`; the page paints the
  notice red. `visit_first` and `decline` run as live (they only build proposals).
- **The exit's tag bookkeeping is mirrored** (`proposalTagsToMirror`, kept equal to
  `exit.ts PROPOSAL_TAG_ALLOWLIST` by a source-reading test): without it a Scoper's `needs_quote`
  was lost and the clerk unreachable from a Scoper pass. It is the only exit step mirrored; the
  page and the event log say when it happens.
- **`POST /price`**: the waiting draft becomes the sent quote the way `confirmPrices` leaves it
  (`is_draft` false, the total on it, a fresh 48 h expiry), and the quote message is placed the way
  `deliverQuoteLink` would deliver it: freeform with the window open, `quote_ready_link` if approved
  when shut, else queued (nothing placed, the strip says how to reopen the window). Stage
  `quote_sent`, tag `quote_sent`, as `markQuoteSent` does.
- **`POST /accept`**: `depositPaidAt`, `depositAmountPence` (the settings' percentage on labour,
  `depositFor`), `paymentType deposit`; the thread to `won` (what `markConversationWonByPhone`
  does); the *Quote accepted* Pushover recorded (`quoteAcceptedNotice`, a pure mirror). The
  response says what live does next.
- The page: a door picker with per-door gate notes read from this server; the window strip with
  its two controls; a channel toggle on the composer; a funnel strip with the two actions; the
  Door box; the Route A box; every "Ben's phone would have buzzed" box in red; an event log
  (`metadata.sandbox.events`, capped, persisted on the thread so a reload keeps it).

### 4. The safety property, re-pinned

- **Layer 1** (`sandbox.test.ts`): a sandbox pass with a `quote_ready` clerk artifact runs the
  chain with the recording deps and never the exit; the control shows a live pass hands the chain
  no deps (the live Pushover and pack writer). `finishAgentRun` still receives `proposal.sandbox`.
- **Layer 2** (`sandbox-routes.test.ts`): the router exposes nine parameterless actions; a
  source-level test strips comments and asserts no `req.*Id`, no `req.params`, none of the twelve
  sender names (`approveAndSendDraft`, `queueDraft(`, `sendCustomerMessage`, the ack lane, the
  outreach, Pushover, the exit), and that every `runOnce` call passes `sandbox: true`.
- **Layer 3** (`sandbox-exclusions.test.ts`): `WAITING_DRAFT_WHERE` (the one definition both the
  price queue and "next waiting" read) excludes the sandbox number; `POST /api/spine/price/:slug/send`
  refuses a sandbox-number draft **before** `confirmPrices`, because that route ends in a real
  Twilio send and `server/outbound.ts` has no test-number guard (also pinned, so the refusal's
  reason stays true).
- Reset now also deletes the seeded `calls` rows (by number), `quote_estimates`, `job_packs` and
  `system_events` rows for the sandbox conversation.

---

## Build gate, as measured

Both sides measured on this Mac with the same placeholder `DATABASE_URL` (a socket that never
connects). **The base is `ed0fef2` (main after T14), measured in a throwaway worktree with this
checkout's `node_modules`**; the old numbers against `0d7bb6c` were the same shape (1,880 / 42 /
0 new) and are not repeated. The vitest diff is test-by-test from the JSON reporters, not counts.

| Check | Base `ed0fef2` | This branch (rebased) |
|---|---|---|
| `tsc --noEmit` errors (8 GB heap) | 1,880 | 1,880 |
| tsc errors NEW vs base | — | **0** (per-file counts identical; the one line that differs textually is `server/contextual-pricing/routes.ts`, a file neither T14 nor this task touched, printing a long union in a different order) |
| vitest server: failing tests | 42 of 1,615 | 43 of 1,654 |
| vitest server failing-set diff | — | one difference: `server/call-script/__tests__/performance.test.ts › … without memory growth`, the `heapUsed` benchmark that flips under load (it failed while the baseline ran in parallel and passed 25 of 25 re-run alone; see the RUNBOOK's verification rule). 0 other newly failing, 0 newly fixed |
| vitest client | 0 failing, 202 | 0 failing, 218 (the sandbox file 29 → 45 with T14's test kept) |
| sandbox and T14 suites together (`sandbox-*.test.ts`, `vision-health.test.ts`, `describe-video.test.ts`, `SandboxPage.test.tsx`, `useVisionHealth.test.ts`) | — | 117 server + 47 client passing, including the parameterless-routes pin, the no-sender pin and the price-send refusal pin |
| new or extended tests | — | server: `sandbox-scenarios.test.ts` (36 new), `sandbox-routes.test.ts` (+12), `sandbox.test.ts` (Route A ×3 rewritten), `sandbox-exclusions.test.ts` (+3); client: `SandboxPage.test.tsx` (+16) |
| esbuild `server/index.ts` (the build script's flags) | — | bundles, 4.3 MB, exit 0 |
| `db:push` / migration / `app_settings` / any live prompt, pack, tier, precondition, price | none | none |

Files touched: `server/spine/sandbox-scenarios.ts` (new), `sandbox-routes.ts`, `sandbox.ts`,
`index.ts` (the Route A branch and its doc comment), `route-a.ts` (one optional field on the
outcome), `price-brief.ts` (the exclusion), `routes.ts` (the refusal), the four test files above,
`client/src/pages/admin/SandboxPage.tsx` and its test, `CLAUDE.md` (one pointer line),
`docs/comms-build/BACKLOG.md` (Lane 12), this brief and report. `describe-video.ts`,
`agent-cost.ts`, `first-contact-ack.ts`, the sampler and autonomy are untouched.

---

## Not done

- **Never run live.** No door was opened, no template cache read, no pass run, no draft priced,
  no acceptance stamped on this branch. Every claim above is a claim about the tests. The
  walkthrough is the deliverable in its place.
- **The rules layer's asks are not mirrored** (`server/spine/asks.ts`, exit-side): on a door where
  the ack could not go, live would ask for a photo or a postcode from the exit; the sandbox shows
  nothing there. BACKLOG T16-a.
- **Two live helpers are mirrored, not imported** (the enquiry snippet, the template-variable
  walk). Tested against the live behaviour, but a change there would not reach the sandbox.
  BACKLOG T16-b.
- **Ben's send prices the total only.** Live, each line is priced on the price screen and
  `quote_price_verdicts` rows are written; the sandbox sets `basePrice`. The post-quote Scoper
  therefore sees fewer legitimate per-line figures than on a real quote. BACKLOG T16-c.
- **The quick-reply quote-send template** (the third rung of `deliverQuoteLink`) is not
  modelled. BACKLOG T16-d.
- **The post-call door does not write the lead-side bookkeeping** (`videoRequestSentAt`, a lead
  `awaiting_video`); nothing on the thread reads them. BACKLOG T16-e.
- **`archiveStaleWonConversations` does not skip test numbers**; a `won` sandbox thread would be
  archived after 7 days (harmless; Reset deletes it). BACKLOG T16-f.
- **The `age` control moves `depositPaidAt` too** (so an accepted quote ages with the thread) but
  not `metadata.lastSpinePass.at` (D1's stamp); the untriggered-quote net skips test numbers, so
  nothing reads it here.
- **`fm-ensure-agents-md.sh` was not run**, for the reason T5, T6 and T11 gave: it would move this
  project's `CLAUDE.md` into a new `AGENTS.md`, a repo restructuring outside this task. One pointer
  line went into `CLAUDE.md`'s comms section instead.

## New BACKLOG rows

`BACKLOG.md` Lane 12: **T16-a** (mirror the rules layer's asks), **T16-b** (export the two
helpers), **T16-c** (per-line prices on Ben's sandbox send), **T16-d** (the quick-reply rung),
**T16-e** (post-call lead bookkeeping), **T16-f** (the won-thread archiver and test numbers).
Lane 6's **T5-a** is closed by this task.
