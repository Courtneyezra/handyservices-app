# D7 — the runaway cadence loop (DONE)

Brief: `docs/comms-build/BRIEF-D7-cadence-loop.md`. Start commit `1fd113c3` (PRD v3). Branch
`fm/cadence-loop-d7`, an isolated worktree with **no `.env` and no database**: everything below is
from the code, the unit tests and the build gate. Nothing here is a claim about live behaviour, and
there is no before/after on the real thread because none is possible from here.

## What shipped

One file of code, one test, three docs.

| File | Change |
|---|---|
| `server/spine/request-run.ts` | `QuoteRunState.pendingDraft` (optional). `shouldRequestQuoteRun` refuses when it is set, after the tag and "something on the way" checks and before the pending-pass check. Two helpers: `pendingDraftAnswersLatestInbound` (pure) and `pendingAgentDraftAwaitsBen` (db: pending `spine` / `comms_agent` drafts on the thread id or its E.164 phone, judged against `latestInboundFor`). `sweepQuoteRunState` = the default state plus that field; **only `sweepUntriggeredQuotes`'s default `ensure` uses it.** |
| `server/spine/cadence-loop-d7.test.ts` | The regression test (9 tests). The loop shape through the net's real `ensureQuoteRun` and a fake db: 5 of 9 fail at `1fd113c3` (the net requests a run on every pass), all pass after. |
| `docs/comms-build/BRIEF-D7-cadence-loop.md` | The diagnosis in full. |
| `docs/comms-build/BACKLOG.md` | One row appended at the bottom of Lane 3 (D10): the loop shape this does not close. |

Not touched: `comms-sweep.ts` (line 154 or any other line), `first-contact-ack.ts`, `triage.ts`,
`scoper.ts`, `index.ts`, `agent-runs.ts`, anything about money, any flag, any migration.

## The diagnosis, short form (the brief has the long one)

**The row's hypothesis was wrong about which line.** `comms-sweep.ts:154` cannot repeat on a
thread with no new customer turn: `sweepOnce` stamps `metadata.lastAutoTriageAt` before it asks
(line 145), nothing else in `server/` or `scripts/` writes or strips that key, and the next pass
skips the thread while the stamp is newer than `lastCustomerContactAt`. Its pending-draft match
is sound for this thread shape too (`447…@c.us` and `+447…` reduce to the same digits). Line 154
fires at most once per customer turn.

**The repeat engine is the other cadence requester**, and it is also in the slow sweep:
`sweepUntriggeredQuotes` (`comms-sweep.ts:68` → `request-run.ts`) runs every pass in shadow or
live, and `shouldRequestQuoteRun` only asks "is something on the way?" (a live estimate, a Route A
draft, a pending pass). A pass that produces neither — the Scoper on the customer / post_quote
lane, or the P19 Ben-lane clerk whose intake is short of `quote_ready` — leaves the thread as it
found it, `runDue` clears `nextTriageAt`, and the next pass asks again. One run per pass = 288 a
day at most; the row's peak was 285. The 561 Scoper / 181 clerk split on one thread is the model's
per-pass verdict picking the lane (a `rescope` tag is never removed, lanes an unpaid-quote thread to
`post_quote` → Scoper → `point_to_picker`; an exception lanes it to Ben → the P19 clerk).

**The 591 refusals are the symptom.** The Scoper's DRAFT-tier proposal reaches `exit` case
`pending` → `queueDraft` with the source dedupe, which refuses while the 3 Sep 10:06 `spine` draft
is pending. The run was paid for before that.

**Why only that thread.** The net needs an unarchived customer thread with a quote tag and no
estimate / Route A draft. Threads that reach `quote_ready` get an estimate and drop out; threads
whose customer writes are answered on the inbound path. A thread whose tag stands and whose pass
can never price is the one that loops.

**Why it stopped after 4 Sep — not established.** From the code: the tag removed by hand, the
thread archived, a pass reaching `quote_ready`, or the worker's slow sweep not running. Which one
is in the ledger, not the code. None is a fix, so it could recur; after this change it cannot in
the pending-draft shape.

## What the fix does and does not change

- A thread whose last pass left a pending agent draft the customer has not written past is not
  asked for another cadence run by the net. It is asked again when Ben acts on the draft (the
  next net pass, ≤ 5 min) or the customer writes (the inbound path, which supersedes the draft).
- The four direct requesters (`triage.ts:325`, `exit.ts:280`, `intake.ts:476`,
  `agents/comms.ts:928`) are byte-for-byte unchanged and never read the field: a fresh
  `needs_quote` still schedules the clerk at once, even when the same run just queued the Scoper's
  draft. Blocking that would delay Ben's priced draft until he approves an acknowledgement, which
  is a change to when work is prepared and was not this task.
- Nothing about what a run may say. Nothing customer-visible. No flag, no rate limiter, no door
  rule, no migration. The legacy sweep at line 154 keeps its own guards.
- An unreadable `message_drafts` read fails closed for that pass (no run) and the net never throws.

## The gate, as measured

| | Before (`1fd113c3`) | After |
|---|---|---|
| `tsc --noEmit -p .` errors | 1,880 | 1,880 |
| New tsc errors (diff by file, line, col and code) | — | **0** (11 lines differ only in the order of union members inside the message text; same locations, same codes) |
| vitest (`vitest run`) | 66 failed · 1,241 passed · 8 skipped (1,315) in 101 files | 67 failed · 1,249 passed · 8 skipped (1,324) in 102 files |
| Failing set diff | — | +1: `call-script/__tests__/performance.test.ts › should handle repeated classifications without memory growth` — a `process.memoryUsage().heapUsed` benchmark that imports nothing under `server/spine`; run in isolation against the start-commit tree it passed once and failed once, i.e. load-flaky on a machine running three worktrees' gates at once. Every other failing test is identical to the baseline. |
| New tests | — | 9 passed (`server/spine/cadence-loop-d7.test.ts`) |
| esbuild `server/index.ts --bundle` | — | bundles (4.2 MB) |

Two notes for the next pane, because CLAUDE.md's numbers are from a different machine:
`tsc` needs `NODE_OPTIONS=--max-old-space-size=8192` here or it dies in GC and `grep -c` reports
0 errors; and without `.env` the vitest baseline is **66** failures, not 42 (the extra 24 are
`DATABASE_URL must be set` at import time, e.g. `exit.test.ts`, `request-run.test.ts`).

## Not done

- **The other shape of the same loop (BACKLOG D10, appended).** A quote-tagged thread whose pass
  leaves *no* pending draft — the P19 Ben-lane clerk (flag deduped, artifact-only proposal queues
  nothing), or any pass that flags or decides `none` — is still re-requested by the net every 5
  minutes while the tag stands and no estimate / Route A draft exists. That was 181 of the 742
  runs on `8e0382…`. It needs a "has anything changed since the last pass?" signal the direct
  requesters do not trip; the obvious one is a per-thread last-pass stamp against the last inbound
  and last tag write. Not built here: the row's Done-when names the pending-draft shape, and
  reading `agent_runs` for it would put this PR in B2's file.
- **Which requester wrote the 561 rows, and why the loop stopped on 4 Sep**, are ledger questions.
  The code admits only one requester that can fire on a clock with no new turn, and the D10 note
  above lists the four ways it stops; the ledger (`agent_runs.trigger`, the thread's tags and
  `archived_at`, `quote_estimates`) settles it.
- **Cost on Scoper rows** (`cost_pence` 0) is B2's.
- **No before/after on the real thread.** No database here.
- **`AGENTS.md` not created.** The firstmate helper would rename `CLAUDE.md` to `AGENTS.md` and
  leave a pointer, a repo-wide move that three parallel PRs would each make and then conflict on.
  The two durable notes from this pane (tsc heap, the no-`.env` vitest baseline) are in the gate
  section above for whoever does that move once.
