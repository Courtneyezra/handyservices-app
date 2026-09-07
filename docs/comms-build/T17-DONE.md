# T17 — after the handover: DONE report

Brief: `BRIEF-T17-after-the-handover.md`. Branch `fm/handover-chase-t17`, written on `ed0fef2` and
**rebased onto `ee65a05`** (T16, PR #15) before merge; the gate below is measured against `ee65a05`.
The S15 review's recommendation A, after the captain's *"start handover"*.

What this branch does, in one paragraph: a thread that goes to Ben now has a chase behind it and a
way back. Work sitting with him past its due time (a flagged thread, a pending agent draft, an
unpriced Route A draft) is re-pinged every 4 working hours with a numbered title, and from 12
working hours on the same ping goes to the owner. Any reply a person sends through the desk takes
the thread off Ben's desk itself, from any button, and the exit can raise a new flag for a new
exception on a thread that is already his. The board stops counting the ten-minute holding line as
our reply, so a flagged thread reads as waiting, and its flag draws its note and its clock on the
card. The 09:00 digest names the threads. **No new customer-facing message**: every line here is
internal, and the customer's second line stays the decision it was (below).

**This branch could not be proven live.** No `.env`, database, key or phone here. Every mechanism
is proven by test against the code (the list is at the end); nothing below is a claim about what
production did. The check in the next section is how you prove it.

---

## How to check this (copy and paste)

The chase runs on the **Railway worker** (`COMMS_WORKER=1`), so the ladder itself can only be
watched in production after the merge. The board, the flag on the card, and the way back can be
checked on your dev server against the live database, the way T13 and T14 were.

1. **Get the branch and restart.** In the repo directory:
   ```bash
   git fetch origin && git checkout fm/handover-chase-t17
   ```
   (After the merge: `git checkout main && git pull`.) Stop `npm run dev` (Ctrl-C) and start it
   again: the board's clock and the send gate are server code.

2. **Look at the board first**: http://localhost:5001/admin/comms. On any thread on *Ben's desk*
   that the agent flagged, the card now carries a blue **🚩 pill** naming the reason (for example
   *🚩 money question*) with a chip beside it: **due in 2h**, or **overdue by 26h** in red. Hover
   the pill for the agent's whole note. That thread should also now be counted in the **Unanswered**
   headline and coloured by how long the customer has waited, instead of sitting uncoloured at the
   bottom of its column: the holding line the customer got at ten minutes no longer counts as us
   replying. Open the thread: above the composer there is one blue line, **🚩 Flagged for you ·
   money question · overdue by 26h · [the note] · Reply in the thread and it clears.**

3. **Answer one flagged thread from the desk** (the composer, a quick reply, a template, or
   approving a draft on it; a real customer gets a real message, so pick one you would answer
   anyway). As soon as the send succeeds the card should leave *Ben's desk*: the **Ben to act**
   chip goes, the 🚩 pill goes, the blue line above the composer goes. That is the server clearing
   `needs_ben` inside the send, not the page. Before this branch only the composer's own two buttons
   cleared it, and only in the browser.

4. **Notifications**: http://localhost:5001/admin/notifications. Two new rows: **Chase** (group
   Inbound) and **Escalated** (group Dispatch). Both are on by default and, like every event, every
   recipient is subscribed until unticked. Decide who gets which: Ben wants *Chase*; the owner
   wants *Escalated* and may untick *Chase*. Nothing else on that page changes.

5. **What you should see happen to a thread left alone with Ben, on production, after the merge.**
   Take a thread the agent flags on a working day at 09:00 and nobody touches:

   | When (UK) | On the phone | Title starts | Key |
   |---|---|---|---|
   | 09:00 | the flag itself (as today) | 🚩 Agent flagged a thread for you | Flags |
   | 13:00 | the expiry re-ping (as today) | ⏰ Flag past due | Flags |
   | 17:00 | **new:** chase 1 | ⏳ Chase 1: flagged thread still with you, 4 working hours past due | **Chase** |
   | next day 09:00 | chase 2 (the 08–20 clock paused overnight) | ⏳ Chase 2: … 8 working hours past due | Chase |
   | next day 13:00 | **escalated to the owner** | 🚨 Escalated: flagged thread — 12 working hours with nobody moving (chase 3) | **Escalated** |
   | every 4 working hours after | chase 4, 5 … | 🚨 Escalated: … (chase 4) | Escalated |
   | 3 days after the due time | the phone stops; the thread is named in the 09:00 digest instead | ☀️ Comms digest | Flags |

   A **pending agent draft** left alone follows the same ladder from its own due time (4 office
   hours after it was written), except that the first chase lands *at* the due time, because
   nothing pinged for a pending draft before. A **priced Route A draft** waiting to be sent gets
   chase 1 four working hours after the *Quote ready to price* ping it already gets, and its link
   opens the price screen. Each thread is chased for one thing at a time (the flag first, then a
   draft, then a price draft). Every rung stops the moment you act: reply in the thread, approve or
   reject the draft, or send the quote. The sweep pauses outside 08:00–20:00 UK, so nothing lands
   at 2am; anything due overnight arrives at 08:00.

6. **The 09:00 digest** now names threads. Instead of *2 flags past due and unanswered* it reads
   *2 flags past due and unanswered: Sam +447700900123 (26h), Jo +447700900456 (3h)*, with the
   same for drafts, and a new line for priced drafts waiting to be sent (the price queue). Four
   names a line, then *and N more*.

7. **Replying from your phone.** The HANDOVER page said replying from the business number is how
   the desk closes flags. **It is not, and this branch does not make it so.** Nothing in this
   codebase records a message typed in the WhatsApp Business app on the coexistence number (there
   is no handler for Meta's message-echo webhook), so such a reply never appears on the thread and
   never clears the tag. If you reply from the phone, reply from the desk too, or expect the chase
   to keep going. If you believe your phone replies DO show on the thread, tell me: then the belt
   in the sweep clears the tag within five minutes of seeing one, and the finding above is wrong.

8. **The sandbox** (`/admin/sandbox`) is untouched and stays out of all of this: the sweep skips
   the drama number as it always did.

9. **On the first run after the merge**, expect a burst: every flag whose due time passed in the
   last 3 days, every pending agent draft past due in the last 3 days, and every Route A draft
   created in the last 3 days gets its first chase, three per five minutes, in the order the sweep
   finds them. Older ones are digest-only. If the burst is unwelcome, untick *Chase* on
   the Notifications page for an hour; the episodes still record, and the reminders resume on the
   working-hours cadence when it is back on.

For a developer, after a day: `select lane, count(*) from sla_alerts where resolved_at is null and
lane in ('ben_flag','pending_draft','price_draft') group by 1;` shows the ladder's open episodes;
`select id, answered_by, answered_at from agent_questions where status = 'dismissed' order by
answered_at desc limit 20;` shows the flags a human reply closed; `select summary from
system_events where source = 'handover' order by created_at desc limit 20;` shows each release.

---

## What was built

### 1. The chase ladder — three lanes in the SLA sweep (`server/agents/sla-sweep.ts`)

Established first, as the brief asked: the sweep already had the episode table (`sla_alerts`, one
open episode per conversation and lane by partial unique index; the insert is the claim), the
reminder CAS on `last_alert_at`, Pass A resolving an episode the moment its lane no longer holds,
the three-actions-per-pass drain, the 08–20 deferral, and the `notify` / `now` / scope test seams.
So this is a lane change. **No new engine, no migration, no setting written.**

| Lane | Enters when | Clock zero | First sweep ping | Then |
|---|---|---|---|---|
| `ben_flag` | `needs_ben` and the newest `flagged` row has a due time and no answer, and no human outbound or quote since it was raised | the flag's `due_at` | 4 working hours after zero | every 4 |
| `pending_draft` | a pending agent draft (`spine` / `comms_agent`) has a due time | the draft's `due_at` | at zero | every 4 |
| `price_draft` | a Route A draft is waiting (`WAITING_DRAFT_WHERE`, price-brief.ts, the one rule) | the draft's `created_at` | 4 after zero | every 4 |

The 3 Sep `flagOwnedByExpiryPath` guard stays: a flag with a due time is still not the old
`needs_ben` lane (whose first ping would double the expiry re-ping); it is the new lane, whose
first ping is 4 working hours later. Precedence within a thread: flag, then draft, then price
draft, then the existing verdict lanes. Chase lanes remind every `chase.everyWorkingHours` (4) on
BEN_HOURS instead of the daily clock-hour cadence; from `chase.escalateAfterWorkingHours` (12)
past zero the ping rides the new owner-facing `chase_escalation` Pushover key; before that, the
new `chase` key. Every ping carries a numbered, distinct title (`chaseRung`). A chase whose zero
is older than `chase.maxAgeDays` (3) is backlog for the digest, not a live chase: the first deploy
must not fire the whole history at one phone. All four numbers sit in `sla_sweep` config with
defaults in code.

**N and M, and why.** 4 working hours is the desk's one unit already: `FLAG_DUE_WORKING_HOURS`,
`DRAFT_DUE_WORKING_HOURS`, `DEFAULT_SLA_WORKING_HOURS`, the `quote_ready` lane. 12 working hours is
what the sweep already calls one working day on the 08–20 clock (`visit_first`). Both run on
BEN_HOURS through `promise-tracker.addWorkingHours`, the sweep's own clock, so the cadence and the
sweep's deferral window agree by construction. On the incident's shape (a flag due Monday 12:42)
that gives chase 1 at 16:42, chase 2 at 08:42 Tuesday, and the owner at 12:42 Tuesday.

The portal desk (`server/desk-routes.ts`) reads the same candidate rule and the same due
arithmetic through two new exports (`slaCandidateConditions`, `laneDueAt`), so it shows the same
breaches the phone gets. `notifyChase` in `server/pushover.ts` is the one new notifier.

### 2. The way back (`server/handover.ts`, new)

`releaseFromBen` removes `needs_ben`, marks every unanswered `flagged` / `open` row on the thread
`dismissed` (the schema's own meaning: *Ben decided no answer is needed, e.g. he'll reply
himself*), writes the ledger `flag_closed` row for each, and tells the board. Idempotent, never
throws. It is called from:

- `sendCustomerMessage` (`server/outbound.ts`) after every successful send whose approver is
  `human:*`, at all three success exits (WhatsApp, SMS, WhatsApp-then-SMS). That is the composer,
  the template route, a draft Ben approves, a quick reply a person sends. Contractor and automated
  approvers do nothing.
- the composer's Meta coexistence path in `server/whatsapp-api.ts`, which bypasses the gate.
- the sweep's `needs_ben` scan, as a belt: when the detector finds a human outbound since the flag
  (the definition it already used: an outbound whose text none of our sent drafts carried) it
  calls a `humanReplied` hook, and the sweep releases the thread. Any surface that records an
  outbound is covered within a pass, whether or not it went through the gate.

The page's client-side PATCH that used to clear the tag is gone (`CommsPage.tsx`): the server
does it inside the send, and the page's copy raced anything else that touched the tags.

The exit (`server/spine/exit.ts`) dedupes a flag on the **open flag row and its exception**
(`flagAlreadyOpen`), not the tag: an open row for the same exception is a duplicate; the tag with
no open row, or an open row for a different exception, raises a row and a ping. The run feed says
the same. `decide.ts` steps 6 and the `asks.ts` hold are untouched: an open flag or the tag still
holds later replies. This changes when the flag clears, not whether it holds.

### 3. The board tells the truth (`server/auto-ack-window.ts`, `server/inbox-board.ts`, `CommsPage.tsx`)

A rules-layer holding line is now a machine receipt like a first-contact ack: source `rules_layer`
with approver `rules.holding`, bounded by the draft's own `[approved_at, sent_at]`, excluded from
the desk's last-outbound clock. A rules-layer *ask* still counts as a reply (the ball is with the
customer after one), and a holding line Ben approved by hand still counts (his approver, not the
machine's). The holding-line half of the read is bounded to 60 days. The card carries `flagNote`,
`flagDueAt`, `flagRaisedAt` from the newest unanswered flagged row (one grouped query), only while
`needs_ben` stands; the board card draws the pill with the due chip ahead of the to-do pills so
the cap of three never hides it; the thread panel draws one line for the newest flag. `agentDown`
counts a flag as the agent action it is, so a flagged enquiry with nothing else on it does not
read as "agent down" now that the holding line no longer counts.

### 4. The digest names threads (`server/agents/silence-breaker.ts`)

`digestCounts` carries up to four threads per section (first name, number, how long), oldest
first, plus a new line for Route A drafts waiting to be priced; `formatDigest` prints them with
*and N more*. Stays under Pushover's 1,024-character body.

## The line not crossed, and the decision this makes clearer

No `message_drafts` row is written anywhere in this branch, nothing calls the rules layer, and
`suppressReason` is untouched. **The customer still hears from us once per turn.** What this
branch changes is that the silence after that line is no longer also silence on Ben's phone and
the owner's, and no longer invisible on the board.

**The expiry claim order stays** (`silence-breaker.ts:237-243`, `expiredAt` stamped before the
send). Reversing it would retry the flag-expiry holding line every minute and see it suppressed
as `answered` every minute, for as long as the silence line is the newest outbound, which is until
Ben replies. It changes nothing the customer sees unless the `answered` rule itself lets a second
line through, and that rule *is* the customer-line decision (S15 review §8 D1; PRD §9 "both or
neither"). So it belongs with that decision, not here. If the decision is a second line at N
hours, the claim order is the first thing to change alongside the suppression rule, and the chase
ladder above is the internal half PRD §9 requires to exist first. That half now exists.

## Rebased onto T16 (`ee65a05`): what was kept where

T16 landed on `main` after this branch started. Three files overlapped; both sides were kept in
each, and no behaviour from either side was dropped:

- **`WAITING_DRAFT_WHERE`** (`server/spine/price-brief.ts`): T16 added the sandbox exclusion to
  the one definition. My `price_draft` chase lane and the digest's priced-drafts line read that
  string verbatim (`sql.raw(WAITING_DRAFT_WHERE)`) and define nothing of their own, so they
  inherit the exclusion: a Route A draft on the sandbox number can never enter the ladder or the
  digest. The sweep also skips the drama range before reading any lane, as it always did. Pinned
  by a new source test in `sandbox-exclusions.test.ts` (same shape as T16's pin on the price
  queue). No conflict here; the file was not touched by this branch.
- **`docs/comms-build/BACKLOG.md`**: both branches appended a "Lane 12". T16 keeps Lane 12; this
  branch's follow-ups are **Lane 13** (references renumbered here, in CLAUDE.md, and in the
  T17 bullet).
- **`CLAUDE.md`** and **`server/spine/sandbox-exclusions.test.ts`**: merged cleanly by git, both
  sides present (T16's bullet and block, then T17's).
- `server/spine/exit.ts` was not changed by T16, so `PROPOSAL_TAG_ALLOWLIST` and its mirror are
  untouched by this branch; the only exit change is the flag dedupe rule.

## Changed from the brief

- The belt for replies outside the gate rides the sweep's own `needs_ben` scan (a hook from the
  detector), not a separate 24/7 pass in the silence-breaker: it costs no extra query, and the
  detector already computes exactly the fact it needs. Consequences: it runs 08–20 and over the
  sweep's 100-candidate scan, both pre-existing bounds. The direct hook on the gate is immediate.
- `chase.maxAgeDays` (3) was added for the first-deploy burst; the brief had only the sweep's
  14-day fossil guard.
- The digest gained a fourth line (Route A drafts waiting), because it was already the one place
  the review said should carry them and the query is the price queue's own rule.

## Found on the way, not fixed (BACKLOG Lane 13)

- **Nothing ingests a handset reply.** See check 7. The HANDOVER line was corrected.
- **A pending `spine` draft does not put a card on Ben's desk.** `loadCardDerived` counts held
  drafts from source `comms_agent` only, so the spine's normal DRAFT-tier output reaches the desk
  strip only when the thread is also tagged. The chase lane covers it on the phone; the board does
  not. One line, but it widens what "Ben's desk" means, so it is named rather than slipped in.
- **The composer's Meta path has no approver and no ledger row.** It is covered for the tag here,
  but it still bypasses the gate for everything else the gate does.

## Not done

- Not proven live: no Pushover was sent, no row was written, no board was rendered against data.
- No customer-facing line of any kind (by design; see above).
- No change to the sla_sweep setting, the Pushover config, or any `app_settings` flag. The two
  new event keys take their defaults through `normalize()`'s backfill at read time.
- No migration.
- The sibling's files (the sandbox and its page) are untouched.

## Gate (CLAUDE.md), measured against `ee65a05` after the rebase

The first measurement was against `ed0fef2` (tsc 1,880 → 1,880; server 1,615 → 1,645 with the
failing set identical at 43; client 209 green). After T16 landed the branch was rebased and the
whole gate re-measured against the new start commit, each baseline taken on a detached checkout
of `ee65a05` in this worktree:

- `tsc --noEmit` with the 8 GB heap: **1,880 → 1,880** errors, **0 new, 0 gone** by file and
  error code.
- vitest server set with a placeholder `DATABASE_URL`: **1,654 → 1,686 tests** (30 new plus the
  two new source pins); **no new failure**. The one difference is `server/call-script`'s memory
  benchmark, which failed in the baseline and passed in the after-run: it is the benchmark
  CLAUDE.md names as load-flaky, not something this branch touches. A first after-run made while
  three other gate jobs shared the machine showed timeouts in files this branch never touches
  (`asks.test.ts`, the first test of `exit.test.ts`, the call-script speed benchmark); the
  uncontended rerun is the measurement above.
- Client set: **19 files, 225 tests (209 + T16's 9 + this branch's 7), all passing.** The full
  run was made three times while other lanes' gates loaded the machine (load average 340–600);
  each time the only failures were 10-second timeouts or a 1-second `findBy` miss in files this
  branch never touches (`QuoteIntakeCard`, `SampleReviewStrip`, `PriceAndSendPage`, `SandboxPage`),
  and every one of them passes alone. The measurement stands: nothing here fails.
- esbuild bundles `server/index.ts`.
- Four pre-existing tests were **rewritten, not deleted**, because they asserted the very text or
  behaviour this brief changes: `sla-sweep.test.ts` "flag WITH due_at → no needs_ben lane" now
  pins that such a flag is the `ben_flag` chase lane with clock zero at the due time, and "falls
  through to the verdict lanes" now pins that the flag outranks them; `exit.test.ts` "flag on a
  thread already flagged → deduped" now pins the open-row-and-exception rule with two new cases
  beside it (tag alone raises; a new exception raises); `run-events.test.ts` pins the same rule in
  the feed's words; `sandbox-exclusions.test.ts` looked for the literal `detectSlaLane(conv)` and
  now matches the call with its hook argument (the drama-number guard it protects is unchanged and
  still first).

## Proof, by test

- `server/agents/sla-sweep.test.ts` (+12, 2 rewritten): the three lanes and their clock zeros against the
  suite's table fakes; precedence; the belt hook firing on a human outbound and staying quiet on
  our own sent draft; N and M; first chase 4 hours after the due time; chase cadence versus daily;
  the three distinct titles on the incident's own timeline (Mon 12:42 flag → chase 1 at 16:42,
  chase 2 next morning, owner at 12:42 Tuesday); the backlog cut-off.
- `server/handover.test.ts` (new, 10): `isHumanApprover`; release order (ledger while rows are
  still flagged, then rows, then tag, other tags kept); by phone in any spelling; idempotent; a
  row with the tag already gone; unknown thread; a failing write never throws; the gate hook does
  nothing for automated and contractor approvers.
- `server/spine/exit.test.ts` (+2, 1 rewritten): the dedupe rule.
- `server/auto-ack-window.test.ts` (new, 6): the receipt pair, asks excluded, human approvals
  excluded.
- `server/agents/silence-breaker.test.ts` (+1, 1 updated): the named digest, the cap, the length.
- `client/src/pages/admin/__tests__/CommsPage.flag-card.test.tsx` (new, 7): the pill, its chip
  and title, the legacy flag, the empty payload, `flagNotesFor`, the one-line note.
