# End-to-end pipeline audit — first contact to job complete

**Status:** research, 19 Aug 2026. Measured, not estimated. Every number below comes from a
re-runnable script named against it.

**The question:** what does a contractor need to do a job without ringing Ben, and where in the
pipeline does that information get lost?

**The answer, in one line:** it is mostly not lost in the handoff to contractors. It is never
captured at intake.

---

## Step 0 — name the pipe

Per `docs/AGENT_DECISION_FRAMEWORK.md`, no number counts until we say who writes to it.

| Table | Written by | Trustworthy for |
|---|---|---|
| `calls` | Twilio inbound webhook + realtime stream handler | inbound telephony only — see §1 |
| `messages` / `conversations` | our own automation, unattended; inbound arrived but was never read | **nothing about human behaviour.** Comms goes live Aug 2026 — data before that is void |
| `contractor_availability_dates` | contractor app (`notes='contractor-app'`) AND admin paths (null) | author is distinguishable — see `_app-adoption-audit.ts` |
| `personalized_quotes` | Ben via the builder | what Ben typed, not what the customer said |

Scripts: `scripts/_intake-capture-audit.ts`, `scripts/_app-adoption-audit.ts`.

---

## 1. Measured capture — 70 days to 19 Aug 2026

### Calls

| direction | calls | with recording | with transcript | avg secs |
|---|---|---|---|---|
| inbound | 385 | 374 (97%) | 324 (84%) | 69 |
| **outbound** | **0** | — | — | — |

All-time the `calls` table holds **1,455 inbound and 17 outbound**, and all 17 outbound are dated
6 Jan 2026 — a test day. In production, no outbound call has ever been captured.

**Inbound works because** the inbound TwiML handler always emits a media fork before it dials,
regardless of destination (`server/index.ts:932`):

```xml
<Start><Stream url=".../api/twilio/realtime" track="both_tracks"> … </Stream></Start>
```

**Outbound is invisible because** the SIP-originated handler (`server/index.ts:1039`,
`POST /api/twilio/sip-outbound`) returns bare TwiML:

```xml
<Response><Dial callerId="…" answerOnBridge="true"><Number>…</Number></Dial></Response>
```

No `<Start><Stream>`. No `record`. No `action=` status callback. No DB write of any kind. The leg
Ben *originates* from Groundwire was never wired into the recording path — this is not a setting
that needs switching on.

### Messages — DO NOT DRAW CONCLUSIONS FROM THIS DATA

| direction | msgs | threads |
|---|---|---|
| inbound | 520 | 293 |
| outbound | 165 | 58 |

**These rows do not describe anyone's behaviour.** Confirmed with the operator 19 Aug: the number
wired to comms had Twilio disconnected, so every inbound message landed and **was never seen by a
human** — they were lost, not ignored. Every outbound row is **automation firing unattended**, not
Ben replying.

So the 1:3 ratio is not "we capture the customer and not Ben". It is a dead channel. Ben has never
been on this number, and there is **no measurement of his reply behaviour anywhere** — not a bad
measurement, none at all.

This is step 0 of the agent framework failing in real time: the pipe was our own automation, so the
numbers measured us, not the work. Any latency, responsiveness or window-pressure analysis built on
this table is void. (One was, during this session, and it was wrong.)

### Conversations

486 total: 47 empty shells, 368 thin (1–2 messages), 71 with 3+ messages. **Same caveat** — these
are artifacts of a dead channel plus the quote-send flow, not a picture of real conversations.

### Real customers went unanswered — but far fewer than the raw count suggests

An earlier draft of this doc said "~520 enquiries arrived and nobody read them". That overstated
it. Measured properly with `scripts/_unanswered-inbound.ts` (90 days, test data excluded):

| | threads |
|---|---|
| inbound with zero replies | 341 |
| …but a call or quote followed, so they were picked up by phone | 311 |
| …inbound sales pitches, not work | 2 |
| **real enquiries with no sign of any contact** | **28** |

So the channel being dead did **not** mean customers were abandoned — Ben was catching almost all
of them on the phone. The residue is 28, which is a hand-triage list, not a campaign.

The residue is not low-value, though. It includes a warm lead we had already phoned and promised a
list to and never sent, a remedial job in Hucknall, and a property-manager enquiry with a specific
Nottingham address quoting a tenant-reported fault — the PROP_MGR segment we build quoting for,
unanswered 54 days. Several more are media-only: customers who sent photos, which is the scarcest
asset in the whole pipeline (§1, quotes) sitting unread.

Triage by hand. Do not bulk-message: most are weeks old and would need an approved template
anyway, and the Aug dunning incident is the precedent for automated sweeps over unverified history.

### Quotes

229 created. **45 (20%) carry customer photos. 6 (2.6%) carry assumptions.**

The `quoteAssumptions` feature (built 11 Aug) is de facto unused. And for four out of five jobs
there is no customer photo to show a contractor, because none was ever captured. No agent fixes
that — it is a capture problem at first contact.

---

## 2. The twelve stages

`Fixed` = deterministic code or config, no model. `Rules` = a lookup table. `Agent` = genuinely
unstructured input that needs a model in one bounded step.

| # | Stage | State | Fix type |
|---|---|---|---|
| 1 | Inbound call → transcript | works (97% / 84%) | — |
| 2 | **Outbound call → transcript** | **never captured** | **Fixed** |
| 3 | Ben's replies → thread | mostly off-system | **Fixed** (routing/policy) |
| 4 | Qualification completeness | ad-hoc; 20% photo rate | **Rules** — per-SKU intake checklist |
| 5 | Transcript → structured facts | transcripts unread after quoting | **Agent** — post-call extractor |
| 6 | Quote build | assumptions used on 2.6% | **Fixed** — prefill from §4 table |
| 7 | Quote → dispatch | drops assumptions, videos, `contextSignals` | **Fixed** |
| 8 | Dispatch → contractor app | drops phone, warnings, access | **Fixed** |
| 9 | Job brief | does not exist | **Agent** |
| 10 | On-site inbound (photos, voice notes) | unstructured WhatsApp | **Agent** — message filer |
| 11 | Completion → property record | nothing flows back | **Agent** — site memory |
| 12 | Completion → pricing truth | nothing flows back | **Agent** — assumption reconciler |

Eight of twelve are deterministic. The agent work is real but it is the minority, and all of it
sits downstream of capture. Building stage 5, 9 or 12 before stage 2 means building on a corpus
missing half the conversation.

### Known field-level drops (stages 7–8)

- `quoteAssumptions` and per-line assumptions — never carried into dispatch
- customer **videos** — own column (`schema.ts:1208`), only `customerPhotoUrls` is copied
  (`contractor-dispatch.ts:1855`)
- `contextSignals` — urgency, motivation, past-let-down, property type; never carried
- **customer phone on a booked job** — `JobDetail.phone` is diary-only
  (`contractor-app-routes.ts:733`); the booked-job payloads return none
- `job_sheets.accessInstructions` / `parkingNotes` — written by `booking-engine.ts:900`,
  **read by no client**
- `serviceProperties.accessNotes` — commented "flows onto every job sheet at this address"
  (`schema.ts:2501`); read only by `booking-engine`
- per-task `warning` is `WARNINGS_BY_CATEGORY[cat]`, a per-category constant — every tiling job
  in the system carries identical warning text, which trains contractors to skip the warning box

---

## 3. Stage 2 — SHIPPED 19 Aug 2026, and the trap in it

> **Status: implemented.** `server/index.ts` (`sip-outbound` + new `sip-outbound-status`) and
> `server/twilio-realtime.ts`. Not yet proven against a live call — see "verify on first call".

The obvious fix is to copy the inbound `<Start><Stream>` onto `sip-outbound`. **Do not do that
naively.** It produces backwards data, which is worse than none.

### The track-inversion trap

`TwilioRealtimeHandler` hardcodes speaker labels to Twilio track direction
(`server/twilio-realtime.ts:175-180`):

```ts
this.initializeDeepgram('inbound',  'Caller');
this.initializeDeepgram('outbound', 'Agent');
```

On an inbound PSTN call that is correct: the `inbound` track is the customer.

On a **SIP-originated outbound call the leg originates from Ben**, so the `inbound` track is
*Ben's* audio and the `outbound` track is the *customer's*. Reusing the handler unchanged labels
Ben as "Caller" and the customer as "Agent" on every outbound call. Every downstream consumer —
metadata extraction, segment detection, call scoring, and any future intake agent — would read
the speakers inverted.

### What the change actually needs

1. `sip-outbound` emits `<Start><Stream>` with an explicit role parameter, e.g.
   `<Parameter name="legRole" value="agent_originated" />`, plus the dialled number so the
   handler knows who the customer is (the `From` on this leg is a SIP URI, not a phone number).
2. `TwilioRealtimeHandler` takes `legRole` and swaps the two `initializeDeepgram` /
   `initializeWisprFlow` label arguments when it is `agent_originated`.
3. `createCallRecord` writes `direction='outbound'` and sets the customer phone from the dialled
   number, not from `From`.
4. Add `action="…/api/twilio/dial-status"` so outbound legs get a completion callback and a
   duration, the same as inbound.
5. Suppress the inbound-only enrichment on outbound legs: `lookupExistingLead` by the *dialled*
   number, and the call-script coaching session is meaningless when Ben placed the call.

### Recording notification — DECIDED

**Ben tells the customer verbally that the call is recorded**, as part of his opener. No `<Say>`
or whisper in the TwiML. This is a process control, not a technical one: if Ben stops saying it,
nothing in the system notices. Worth revisiting if outbound volume grows or the calling is ever
delegated beyond Ben.

### Why not `/api/twilio/dial-status`

The existing dial-status handler treats an unanswered dial as a missed **inbound** call: it flags
the row `MISSED_CALL` / urgency 1 with a `va_no_answer` tag, then routes the caller onward to
voicemail or an ElevenLabs agent. Pointed at an outbound leg that would fill the action centre
with fake missed calls and connect *Ben* to our own AI receptionist whenever a customer didn't
pick up. Hence a separate `sip-outbound-status` endpoint that only records the outcome
(`OUTBOUND_ANSWERED` / `OUTBOUND_NO_ANSWER`) and returns an empty `<Response/>`.

### Blast radius checked

- `agentOriginated` defaults to `false`, so every existing inbound path is byte-identical.
- `call-thread.ts:221` defaults `createConversation` to inbound-only, and gates
  `lastCustomerContactAt` and stage advance on inbound — an outbound call cannot create a
  conversation shell or advance a customer's stage.
- `first-contact-ack.ts` does not read `calls` at all, so no auto-ack can fire on an outbound row.
- Both consumers match direction with `.startsWith('out')`, so the new `'outbound'` value and the
  legacy `'outbound-dial'` rows behave the same.

### Verify on first call

TwiML well-formedness and verb order were checked offline; the rest needs one real call:

1. Ben dials a test number from Groundwire.
2. `calls` gains a row with `direction='outbound'` and `phone_number` = the **dialled** number.
3. The transcript names **Ben as "Agent"** and the other party as "Caller". If they are the wrong
   way round, `legRole` is not reaching the handler — check the `start` event's
   `customParameters` in the `[Twilio] Stream started` log line.
4. On hang-up, `outcome` is `OUTBOUND_ANSWERED` and `duration` is non-zero.
5. Let one ring out unanswered: `OUTBOUND_NO_ANSWER`, and **no** missed-call flag appears in the
   action centre.

---

## 4. Per-SKU intake checklist (stage 4)

The highest-leverage non-agent item, and the reason the 20% photo rate is fixable. Per the
productization research, ~50 SKUs cover 87% of line items. For each: what photos, what
measurements, what access questions. Write it once as a table and:

- Ben (or the call HUD) is prompted with the right three questions during the call;
- the quote builder prefills `quoteAssumptions` for that SKU instead of leaving it blank 97% of
  the time;
- the job brief agent's job shrinks from "infer what matters" to "check these are answered".

Deterministic, inspectable, fails loudly. Rung 3 of the ladder, not rung 5.

---

## 5. Recommended sequence

1. ~~**Stage 2** — outbound capture~~ **done 19 Aug**, pending live verification per §3. Should
   roughly double the intake corpus. Everything else is downstream.
2. **Re-measure.** Re-run `_intake-capture-audit.ts`. If Ben keeps calling from his personal
   mobile, the corpus will not move and that is a policy problem no code fixes.
3. **Stages 7–8** — carry the fields that already exist. A day's work, zero marginal cost, and it
   shrinks every agent below it.
4. **Stage 4** — the SKU intake table.
5. **Stage 10** — contractor message filer (READ/FILE, highest value/risk ratio available).
6. **Stages 5 + 9** — post-call extractor and job brief, on a corpus that is by then worth
   reading.
7. **Stages 11–12** — the learning loop, once enough completed jobs exist to mine.

Not on the list at any point: allocation, availability commits, pricing, or customer auto-send.
All COMMIT tier.

---

## Appendix — scripts

```bash
npx tsx scripts/_intake-capture-audit.ts
```

```bash
npx tsx scripts/_app-adoption-audit.ts
```
