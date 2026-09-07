# BRIEF T17 — after the handover: the chase, the way back, the honest board, the named digest

Branch `fm/handover-chase-t17`, start commit `ed0fef2`. The captain, after a day of finding
faults: *"We need the whole plan of comms to be looked at in detail as it is failing massively."*
The S15 review (`firstmate/data/comms-state-review-s15/report.md`, 7 Sep 2026) found the desk
works as a pipeline and fails at one thing, the thing its goal names: PRD §1, *"nobody we deal
with is ever left in silence"*, is delivered for one message per customer turn (the ten-minute
holding line) and not beyond, and once a thread is Ben's it stays Ben's. The captain then said
*"start handover"*. This is the review's recommendation A. Written before any code changes.

Thread `76c0a399…`, 7 Sep, is the shape it is built against: the customer wrote at 08:32, got the
holding line at 08:43, and nothing in the system will ever fire on that thread again. *"Thread
76c0a399 is not a bug. It is what the code does."*

## What was established before a line was changed

No `.env`, database or key here. Everything below is the code at `ed0fef2`, re-read by hand.

1. **The SLA sweep is the engine, and it is enough.** `server/agents/sla-sweep.ts` already has
   what a chase ladder needs and nothing it does not: one open episode per (conversation, lane)
   enforced by the partial unique index `uq_sla_alerts_open` (the insert is the claim,
   `onConflictDoNothing`); reminders on a standing breach claimed by a CAS on `last_alert_at`;
   Pass A resolving an episode the moment its lane no longer holds (movement, lane change,
   conversation closed), so nothing ghost-alerts; at most three actions per pass; deferral outside
   08–20 UK; `notify` / `now` / `scopeConversationIds` test seams; the `lane` column is
   `varchar(24)` with no check constraint. The review's claim (`sla-sweep.ts:22-26`) is true.
   **This is a lane change inside it, not a new engine, and it needs no migration.**
2. **Why the built chases are inert.** `suppressReason` (`server/rules-layer.ts:152`) returns
   `answered` when any outbound is newer than the customer's last inbound; the silence-breaker's
   holding line is an outbound. So `flag_expiry` and `draft_expiry` never reach a customer who
   waited ten minutes. The sweep's `needs_ben` lane skips every flag that carries a `due_at`
   (`flagOwnedByExpiryPath`, written on 3 Sep to stop a double ping at the due time), and since
   Phase 1 every flag carries one (`exit.ts:250`, `comms.ts:545`). A pending draft pings nobody
   (`expireDrafts` calls no Pushover). Route A pings once at creation (`route-a.ts:157`). The
   `quote_ready` lane self-resolves on the unsent draft row (`quoteWentOutSince` counts any
   `personalized_quotes` row created after the verdict).
3. **Why a thread never comes back.** The only writer that removes `needs_ben` on a reply is the
   desk page's client-side PATCH (`CommsPage.tsx:1284-1294`), fired only from the composer's own
   two send buttons. The server's one send gate, `sendCustomerMessage` (`server/outbound.ts`),
   knows the approver (`human:<email>` for the composer, the template route and a draft Ben
   approves) and clears nothing. The composer's Meta coexistence path bypasses the gate entirely
   (`whatsapp-api.ts:96-104`, no approver). **No code ingests a reply typed on the handset**: no
   webhook field for message echoes is handled anywhere (grep for echo / fromMe / smb_message:
   nothing). So "Ben replies from his phone" lands as an outbound only if something outside this
   repository writes it; whether it does is unverifiable here and is said so in the report. The
   exit dedupes a new flag on the tag or on any open flag row (`exit.ts:237`), so a genuinely new
   exception on a flagged thread raises no row and no ping. A flag row is never closed: its
   `status` stays `flagged` for ever; `expiredAt` is the expiry path's claim, not a close.
4. **Why the board lies.** `loadActivity` (`inbox-board.ts`) counts every non-quarantined outbound
   as our reply except a first-contact ack, which `auto-ack-window.ts` excludes by the
   `message_drafts` pair (source + machine approver, bounded by `[approved_at, sent_at]`). A rules-
   layer holding line is source `rules_layer`, approver `rules.holding`, and is not excluded, so a
   flagged thread reads *answered*, severity `none`, sorts last. The card's derived signals count
   `agent_questions` rows in status `open` only (the retired tap relay), never `flagged`, so a
   flagged row has no pill and no due chip; `FlagNoteCard` renders `answered` rows only (the amber
   banner went on 3 Sep at the owner's request). `agentDown` treats an open question as an agent
   action but not a flag: once the holding line stops counting as a reply, a flagged enquiry with
   nothing else on it would read as "agent down" unless the flag is counted too.
5. **The digest** (`silence-breaker.ts:342-396`) sends three counts and a link; no thread is named.
6. **The expiry claim order** (`silence-breaker.ts:237-243`): `expiredAt` is stamped before
   `sendHoldingLine`, so a line suppressed as `answered` is never retried. Reversing the order
   would retry every minute and be suppressed every minute for exactly as long as the `answered`
   rule stands, which is until Ben replies; it changes nothing the customer sees unless the
   suppression rule itself is changed, and that rule is the customer-line decision (review §8 D1,
   PRD §9 "both or neither"). **The ordering stays. It belongs with the decision, and it is only
   worth touching if that decision lets a second line through.**
7. **Working-hours model.** Two named clocks in `server/working-hours.ts`: `OFFICE_HOURS`
   (Mon–Fri 08–18, the `due_at` on drafts and flags, 4 working hours) and `BEN_HOURS` (daily
   08–20, every Ben-facing alert; the sweep adds hours on it through `promise-tracker.ts` and
   defers outside it). `4` is the desk's one unit (`FLAG_DUE_WORKING_HOURS`,
   `DRAFT_DUE_WORKING_HOURS`, `DEFAULT_SLA_WORKING_HOURS`, the `quote_ready` lane); `12` is what
   the sweep already calls one working day on the BEN clock (`visit_first`).

## The build, in four parts

**1. The chase ladder, as three lanes in the SLA sweep.** New lanes, each with its clock zero
and the SLA before the sweep's first ping, so no rung fires twice:

| Lane | Enters when | Clock zero | First sweep ping | Then |
|---|---|---|---|---|
| `ben_flag` | `needs_ben` and the newest `flagged` row has a `due_at` and no answer, and no human outbound or quote since it | the flag's `due_at` (the expiry re-ping's moment) | N working hours after zero | every N |
| `pending_draft` | a pending agent draft (`spine` / `comms_agent`) is past its `due_at` | the draft's `due_at` | at zero (there is no ping today) | every N |
| `price_draft` | a Route A draft is waiting to be priced (`WAITING_DRAFT_WHERE`, price-brief.ts, oldest first) | the draft's `created_at` (its one Pushover) | N after zero | every N |

**N = 4 working hours, M = 12 working hours, both on BEN_HOURS**, in `sla_sweep` config
(`chase.everyWorkingHours`, `chase.escalateAfterWorkingHours`), defaults in code, no setting
written. Reminders on the chase lanes run on N working hours instead of the 24-clock-hour cadence
the other lanes keep. Every chase ping carries a distinct title with its rung number; from M hours
past zero onwards the ping goes out on a new owner-facing Pushover event (`chase_escalation`,
group Dispatch, the way the owner-facing `autonomy` event is routed) with an "escalated" title,
and keeps going every N until movement. Ben's chase pings go out on their own event (`chase`), so
a flag ping is no longer one of six things on the `escalation` key (review D7). Precedence: a
thread is in one lane at a time; the flag outranks the draft outranks the price draft, then the
existing lanes. The legacy `needs_ben` lane (rows without `due_at`) is unchanged. Movement for
every chase lane is what it is today: a human outbound, a quote going out, the draft leaving
`pending`, the Route A draft leaving the waiting set, the flag being closed. The portal desk
(`desk-routes.ts`) reads the same lane detector and the same due arithmetic through one exported
helper, so it shows the same breaches.

**2. The way back.** A new `server/handover.ts` owns the one operation the desk lacked:
`releaseFromBen`, which removes `needs_ben`, marks every unanswered `flagged` / `open` row on the
thread `dismissed` (the schema's own meaning: *Ben decided no answer is needed, e.g. he'll reply
himself*), writes the ledger `flag_closed` row, and emits a board delta. It is called:

- from `sendCustomerMessage` after any successful send whose approver is `human:*` (the composer,
  the template route, a draft Ben approves, a quick reply sent by a person); never for
  `contractor:*` or automated approvers;
- from the composer's Meta coexistence path after its direct send;
- from a new 24/7 belt in the silence-breaker tick, `releaseAnsweredFlags`: an unanswered flag on
  a `needs_ben` thread with a human outbound since it (an outbound whose text none of our sent
  drafts carried, the definition `humanOutboundSince` already uses) is released within a minute,
  whatever surface wrote the outbound. This is the only thing that can catch a handset reply if
  one is ever recorded.

The desk page's client-side PATCH goes: the server does it inside the send request, and the
client's copy raced anything else that touched the tags.

The exit dedupes on the open flag row and its exception, not the tag: a flag is deduped only when
an open (unanswered, unexpired) flag row with the same exception already exists. A tag with no
open row, or an open row for a different exception, raises a row and a ping. The run feed says
the same. `decide.ts:124-126` is untouched: an open flag or the tag still holds later replies.

**3. The board tells the truth.** `auto-ack-window.ts` learns a second machine receipt: source
`rules_layer` with approver `rules.holding`, bounded by the same `[approved_at, sent_at]` span. A
holding line stops resetting the customer-waiting clock; a rules-layer *ask* (`rules.ask`) still
counts, because the ball is with the customer after one. The card gains `flagNote`, `flagDueAt`
and `flagRaisedAt` from the newest unanswered `flagged` row (one grouped query, no per-card
read); the board card draws a flag pill with the note's exception and a due chip; the thread
panel draws one line for the newest flag with its due chip above the composer (the briefing
and its clock, not the 3 Sep banner). `agentDown` treats a flag as the agent action it is.

**4. The digest names threads.** `digestCounts` carries, per section, up to five threads (name,
number, how long) and the count of the rest; `formatDigest` prints them; the title is unchanged.

## The line not crossed

No new customer-facing message. Nothing here writes a `message_drafts` row, calls the rules
layer, or changes what the rules layer suppresses. The expiry claim order stays (item 6). If the
work makes the case for a customer-facing second line clearer, the DONE report says so as the
decision it is. No prompt, pack, tier, precondition, sampler, autonomy, media or price code is
touched. No `app_settings` flag is written; the two new Pushover event keys take their defaults
through `normalize()`'s backfill, as every event added since 29 Aug has. No migration. The
sandbox and its page are not touched (sibling T16).

## Proof, without a database

Pure and injectable: the lane planner (which rung, which event, which title, when the next
reminder is due), the three lane detectors against the sweep suite's existing table fakes, the
release operation with injected deps, the exit's dedupe rule, the receipt-exclusion query builder,
the card derivation, the digest formatter, and the client pill. Gate as CLAUDE.md: zero new tsc
errors against ~1,880 pre-existing with an 8 GB heap, the vitest failing set unchanged plus the
new tests, esbuild bundles `server/index.ts`. No claim about live behaviour; the owner's check is
the first section of `T17-DONE.md`.
