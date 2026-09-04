# P19 — the Quote clerk keeps working when the thread is Ben's (DONE)

Brief: `docs/comms-build/BRIEF-P19-clerk-on-ben-lane.md`. Branch `p19-clerk-on-ben-lane` off `main`
at `26dcdb06`. No `app_settings` flag touched (the spine is LIVE), no migration, no send.

## The defect, and the one line that fixed it

One rule was doing two jobs:

1. *Ben must be the one who talks to this customer.* — right, and unchanged.
2. *Therefore no agent may do any internal work on this thread.* — wrong.

`mergeTriage` does `if (exceptions.length) lane = 'ben'`, `agentForLane('ben')` returns `null`, and
`runOnce` then ran **no agent at all**. So a thread carrying `photos_received`, `postcode_received`
and `needs_quote` sat for 43 minutes with everything a quote needs, re-flagging every five minutes,
until the customer rang in and the agent still could not give her a price.

The lane is untouched. What changed is one branch in `runOnce`: on a lane that runs no agent, if the
lane is Ben's and the thread is tagged `needs_quote` / `rescope`, the Quote clerk runs anyway — for
its artifact. `decide()` never sees a difference.

## What was built

**`server/spine/index.ts`** — the whole change is here.

- `benLaneClerkWanted(caseFile, triage)` — pure. Ben's lane, a customer thread, no spam / opt-out,
  and a `needs_quote` or `rescope` tag on either the thread or this pass.
- `benLaneClerkVerdict(…, inFlight)` — pure. The above **and** nothing already on the way: no live
  estimate, no un-superseded Route A draft. Same two conditions, and the same words, as
  `shouldRequestQuoteRun`.
- `benLaneArtifactOnly(proposal)` — pure. Strips `body` and `flag`. The clerk composes words on
  exactly one path (readiness `decline`, the fixed polite-no); on Ben's lane that sentence is his.
- The wiring: `laneAgentName ?? (benLaneClerk?.run ? 'quote_clerk' : null)`. `recordedAgent` still
  resolves from the **lane**, so the run stays `triage` and the flag row's `source: spine:triage`
  does not move.

**`server/spine/request-run.ts`** — `quoteWorkInFlight(conversationId)` lifted out of
`defaultQuoteRunState` (which now calls it). One definition of "a quote is already coming", read by
both the scheduler and the in-pass guard.

**`server/spine/exit.ts`** — the flag row's `context` is written only when the proposal actually has
words. An artifact-only proposal used to have produced `"Proposed (not sent): "` with nothing after
it. Identical for every proposal that has a body.

**`server/agents/quote-prep.ts`** — `runOpts.persist` threaded to `runAgent` (default `true`), so
the read-only replay can run the real clerk without leaving `agent_runs` rows.

## The four hard constraints

**1. The decision cannot move.** `decide()`'s exceptions branch sits above everything except the two
drops, so `lane === 'ben'` returns `flag` before it reads `proposal`. Pinned three ways: a
`toEqual` between the decision with the clerk artifact and the decision without it
(`decide.test.ts`), the same comparison end-to-end through `runOnce` on a frozen clock
(`ben-lane-clerk.test.ts`), and a source-order assertion that the Ben branch precedes the first
`proposal` read (`architecture.test.ts`).

**2. `visit_first`.** Skipped on the Ben lane — `surveyOfferFor` is never called, so no
customer-facing survey offer is ever composed on a run that was never going to speak. Both halves
tested: that the branch is skipped, and that a survey-offer proposal reaching `decide` on the Ben
lane would still flag anyway.

**3. No five-minute clerk loop.** The guards *do* cover it, and this closes the loop that kept it
open. The thread was re-run every five minutes by `sweepUntriggeredQuotes` → `ensureQuoteRun`,
which asks for a pass precisely because the thread is tagged `needs_quote` with **no live estimate
and no draft** — and nothing ever produced one, because no agent ran. The first Ben-lane clerk pass
now produces both, and the sweep stops asking. `benLaneClerkVerdict` is the belt: a pass arriving
from any other trigger while a draft exists does not run the clerk again. `runRouteAChain`
supersedes the previous estimate before claiming a new one, so `claimEstimate` alone would not have
stopped it.

  *Residual, stated plainly:* a clerk that returns `needs_info` produces no estimate and no draft,
  so the sweep keeps requesting a pass and the clerk re-runs on the five-minute cadence. That is
  pre-existing and identical on the `quote_clerk` lane; the estimator — the expensive half — is not
  in it. Not changed here.

**4. No customer message, in any mode.** The decision is `flag`; the exit's flag branch queues no
draft and calls no send. Proven by driving the real `exit()` over the run `runOnce` produced with
fake deps: `queueDraft` and `approveAndSendDraft` are never called, and the flag row's context is
`null`. The proposal that leaves the run has `body: []` in every case, decline included. As a third
belt, a Ben-lane pass resolves `customer.exception`, whose `allowedIntents` is empty.

## Tests

| File | What it adds |
|---|---|
| `server/spine/ben-lane-clerk.test.ts` (new, 14) | the pure verdict; `runOnce` on the Ben lane runs the clerk, feeds Route A and returns the same flag byte for byte; no words; `visit_first` skipped; the re-run guard; fail-closed on a failed read; a clerk that throws; the real exit queues and sends nothing |
| `server/spine/decide.test.ts` (+3) | the artifact does not move the decision; a survey offer on the Ben lane still flags; a decline body cannot send |
| `server/spine/triage.test.ts` (+2) | the callback exception still beats `needs_quote`; the model cannot take the thread off Ben |
| `server/spine/architecture.test.ts` (+3) | `agentForLane` names no agent for `ben` / `dropped`; `decide` settles the lane before it reads a proposal; `triage.ts` knows nothing about any of this |

## Build gate

| Gate | Result |
|---|---|
| tsc vs `26dcdb06` | **1958 → 1958**, zero new |
| vitest | **44 failed / 1473 passed → 44 failed / 1495 passed**; the 44 failing files are byte-identical to baseline, +22 new passes |
| esbuild | bundles (4.2 mb) |
| migrations | none needed |
| `app_settings` | untouched |

## The replay — `f7ebd4f6-71ce-470a-b914-77e4aca3eeed`, read-only

`npx tsx scripts/_p19-replay-thread.ts <conversationId>`: real case file, real triage (persist,
tag-write and relay notice all off), real clerk (`persist: false`). Route A is described, not run —
the chain writes rows and pushes to Ben's phone, and the replay must not touch the world.

```
── triage ──
src=model  lane=ben  intent=quote_on_its_way  exc=["callback_requested","date_question"]
pack       customer.exception v1

── BEFORE (main @ 26dcdb06) ──
agentForLane('ben') = null  → no agent runs, no proposal
decision   { "kind": "flag", "exception": "callback_requested",
             "dueAt": "2026-09-04T11:19:39.609Z", "note": "Customer explicitly requested a callback…" }

── AFTER (P19) ──
in flight  liveEstimate=false  liveDraft=false
clerk      RUNS — ready to price: the clerk prepares while the thread stays Ben's

ARTIFACT   1 line(s), readiness quote_ready, 0 gap(s)
  postcode NG7 2DP   type homeowner   urgency high
  1. Build flat-pack bedside table  [flat_pack]
     VASAGLE (Songmics Home) End Table, model LET619, still boxed with polystyrene packaging
     assumes: all parts and fixings are present in the box as per manufacturer packing list
     assumes: standard hand tools are sufficient, no power tools beyond what we bring
     assumes: customer has cleared a space for the table to be assembled and placed
  body sent to the customer: []          ← the clerk prepares, it never speaks

Route A    readiness quote_ready → estimator → engine → draft quote with every customer-visible
           price NULL → Pushover "Quote ready to price"

decision   { "kind": "flag", "exception": "callback_requested",
             "dueAt": "2026-09-04T11:19:39.609Z", "note": "Customer explicitly requested a callback…" }

── before → after ──
decision   IDENTICAL ✓
artifact   NEW: 1 line(s), readiness quote_ready, 0 gap(s)
to customer none, either way
```

Same flag, same exception, same due time, same note. Plus a scoped, categorised, quote-ready intake
that was not there before — the thing that would have been on Ben's phone at 09:20 instead of the
customer ringing in at 09:59 to ask for a price nobody had.

## Not done

- The clerk still re-runs on the sweep cadence when it returns `needs_info` (above). Fixing it means
  a "the clerk already looked at this turn" marker, which is a change to the scheduler, not to this
  lane, and it costs the estimator nothing.
- Nothing was flipped and nothing was deployed. The change is dark until this branch merges and
  ships.
