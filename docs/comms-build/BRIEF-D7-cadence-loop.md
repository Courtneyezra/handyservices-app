# D7 — the runaway cadence loop

## The ledger row that paid for this brief

BACKLOG D7, found in the live ledger on 6 Sep 2026. Over the previous 7 days the Scoper ran 608
times, 598 on the `cadence` trigger, 561 of those on ONE thread (`8e0382…`, last customer message
3 Sep 10:00), proposing `point_to_picker` every time. 591 exits were `queueDraft refused`: a single
pending draft from 3 Sep 10:06 blocks the source dedupe, so every run is thrown away. Same thread:
181 clerk runs, 807 triage rows. Peak 285 runs/day. The row names legacy `comms-sweep.ts:154` as
the trigger. Not established: why it stopped after 4 Sep.

PRD v3 §5.5: the loop sent nothing to a customer. It is a compute, ledger-noise and invisible-spend
defect. "Fix it where it runs." A door rule is a proposal, not a requirement, and is not built here.
D6 (a cheap "is there anything to say?" step) is a design step and is not this task. Cost
recording (`cost_pence` 0) is sibling task B2.

## Diagnosis from the code (no database in this worktree)

The row's "trigger is line 154" is a hypothesis. The code says something more specific.

### (a) Every path that produces a `cadence` run

`grep -rn "'cadence'" server` finds exactly two requesters. Everything else that asks for a run
uses `inbound_message`, `media_received`, `call_ended`, `flag_expiry` or `manual`:

| # | Requester | Clock | Guards before it asks |
|---|---|---|---|
| 1 | `server/agents/comms-sweep.ts:154` — `sweepOnce`, live mode: `requestRun(c.id, 'cadence', { delayMs: 0 })` | slow sweep, every 5 min | candidate window (customer spoke in the last 48 h, quiet ≥ 3 min) · **`lastAutoTriageAt` after `lastCustomerContactAt` → skip** · last message must be inbound · **pending `message_drafts` row for the phone → skip** · `claimTriageTurn` CAS · then stamps `lastAutoTriageAt` |
| 2 | `server/spine/request-run.ts:203` — `ensureQuoteRun`'s default `request`: `requestRun(id, 'cadence', { delayMs: 0 })` | see callers | `shouldRequestQuoteRun`: a quote tag (`needs_quote` / `rescope`) · no live estimate · no live Route A draft · no pass pending (`nextTriageAt` within 10 min) |

`ensureQuoteRun` is called from five places. Four fire once per cause and cannot repeat without a
new cause: `triage.ts:325` (a quote tag that was not on the row just landed), `exit.ts:280` (a
proposal tag `needs_quote` that was not on the row), `intake.ts:476` (portal override to
quote_ready), `agents/comms.ts:928` (legacy `set_board_state`). The fifth is the **net**:
`sweepUntriggeredQuotes`, called by `sweepOnce` at `comms-sweep.ts:68` on **every slow-sweep pass**
in shadow or live, *before* the legacy `config.enabled` gate. Its candidates are every unarchived
customer thread carrying a quote tag, oldest `updated_at` first, up to 5 requests per pass.

`runDue` (the fast tick, live only) does not originate cadence runs: it executes whatever
`nextTriageAt` row is due, with the trigger the requester wrote, and clears the row on success. A
run that throws leaves its lease to expire and is retried at the 4-minute lease, but the D7 runs all
reached `finishAgentRun` with an exit detail, so they completed and were each requested afresh.

### (b) Why the guards did not stop a 5-minute repeat

**Requester 1 cannot repeat on a thread with no new customer turn.** `sweepOnce` writes
`metadata.lastAutoTriageAt = now` before it asks (line 145), and nothing else in `server/` or
`scripts/` writes, strips or overwrites that key (every conversation metadata write is a
`coalesce(metadata,'{}') || …` merge or a `metadata - 'key'` strip of other keys). On the next pass
`sweepMs > custMs` and the thread is skipped, until `lastCustomerContactAt` moves — and its writers
are inbound messages, inbound calls and webform leads, none of which run on a clock. The
pending-draft match is also sound for this thread shape: `conversations.phone_number` is
`447…@c.us`, the spine exit queues drafts with `caseFile.phone` = `+447…` (case-file.ts:99-101,
then `normalizePhoneNumber`), and both reduce to the same digit string under `regexp_replace`.
Line 154 fires at most once per customer turn per thread. It is not the 285-a-day engine.

**Requester 2's net repeats by construction.** `shouldRequestQuoteRun` knows only "is something on
the way" (a live estimate, a Route A draft, a pending pass). A pass that runs and produces neither
— the Scoper on the customer / post_quote lane, or the P19 Ben-lane clerk whose intake is not
`quote_ready` — leaves the thread exactly as it found it: tag still on, no estimate, no Route A
draft, `nextTriageAt` cleared by `runDue`. The next slow-sweep pass (≤ 5 min later) asks again.
That is one cadence run per pass, 288 a day at most; the row's peak is 285. `index.ts:94-99` even
says so of the Ben-lane clerk ("re-runs on the untriggered-quote sweep's five-minute cadence")
and guards the *estimator chain* against it, not the run.

The lane split fits the same thread. With `needs_quote` on the row, `triageRules` lanes to
`quote_clerk` without a model (triage.ts:164). With only `rescope` on the row (never removed once
written; the rule re-tags it only from the message text), the rules lane a thread with an unpaid
quote to `post_quote` → the Scoper (`agentForLane`), whose reply to a date question on a live
quote is `point_to_picker` — the row's intent. When the Haiku triage raises an exception the lane
is Ben's and P19 runs the clerk for its artifact (`benLaneClerkWanted` accepts `rescope`). 561
Scoper runs and 181 clerk runs on one thread is the model's per-pass verdict deciding which of the
two ran; both were requested by the net.

The 591 `queueDraft refused` exits are the symptom, not the cause: the Scoper's DRAFT-tier proposal
goes through `exit` case `pending` → `queueDraft` with the default source dedupe, which refuses
while the 3 Sep 10:06 `spine` draft is pending. The run was already paid for by then.

**Masking condition (why this thread).** The net needs all of: unarchived, `role_profile` customer
or null, a quote tag, no live estimate, no live Route A draft. Threads that reach `quote_ready` get
an estimate on the first pass and drop out; threads whose customer writes get their draft
superseded and answered on the inbound path. A thread whose quote tag stands but whose pass can
never produce an estimate (a `rescope` on the Scoper's lane; a clerk intake that stays short of
`quote_ready`) is the one that loops. The pending draft made every Scoper run *visibly* wasted; it
did not cause the repeat.

**Why it stopped after 4 Sep — not established.** From the code, any one of: the tag removed by
hand, the thread archived or moved to `closed` / `won` (archive only, for the net; stage is not in
its query), a pass reaching `quote_ready` (estimate + Route A draft), or the worker's slow sweep not
running. Which one needs the ledger. Because none of them is a fix, it can recur.

## What to build

Give the net the rule `sweepOnce` already has at `comms-sweep.ts:128`: **a pending agent draft
that the customer has not written past means the desk has already spoken for this turn and is
waiting on Ben; a clock must not ask again.**

- `QuoteRunState` gains `pendingDraft` (a pending `spine` / `comms_agent` draft on the thread,
  created at or after the customer's latest inbound, or the thread has no inbound at all).
- `shouldRequestQuoteRun` refuses when it is set, with a reason that reads in the log.
- Only the **net** (`sweepUntriggeredQuotes`) loads that field. The four direct requesters fire
  once per cause and are unchanged: the exit queues the Scoper's pending draft *before* it asks for
  the clerk on a fresh `needs_quote`, and blocking that would delay Ben's priced draft until he
  approves an acknowledgement — a change to when work is prepared, which is not this task.
- Nothing about what a run may say changes. Nothing customer-visible changes. No new flag, no rate
  limiter, no door rule, no migration.

## Hard constraints

- Do not touch: `first-contact-ack.ts`; the hold/stale paths in `comms-sweep.ts` (~300-345);
  anything about money or prices; `finishAgentRun` / `cost_pence` (B2); `triage.ts` /
  `customer-default.ts` / `scoper.ts` (B3).
- No `db:push`, no migration, no `app_settings` flag.
- Keep the diff to `server/spine/request-run.ts` plus a test and these docs, so the three sibling
  PRs rebase cleanly.

## The build gate

Zero NEW `tsc` errors against start commit `1fd113c3` (measured by diffing the error lists), the
vitest failing set unchanged plus the new test passing, `npm run build`'s esbuild step bundles
`server/index.ts`. No database, no model, no network: nothing here claims anything about live
behaviour.

## Definition of done

1. A vitest test that models the loop (quote tag on the thread, a pending draft the customer has
   not written past, the net runs again) fails on the start commit and passes after the change.
2. `docs/comms-build/D7-DONE.md` with the diagnosis, the gate numbers as measured, and a **Not
   done** section naming what the ledger alone can settle and the loop shape this does not close.
