# D1 — the clerk re-runs every sweep on a thread that cannot progress

## The ledger figures that paid for this brief (7 Sep 2026, read-only, quoted; no ledger here)

One conversation, `76c0a399…`, ran the quote clerk / quote-prep path **284 times** between 6 Sep
08:02 and 7 Sep 13:58 and was still running: **492 of the day's 557 recorded pence** (≈ 88% of
recorded Anthropic spend), ≈ 490,000 output tokens on `claude-sonnet-5`, one run about every six
minutes — the slow sweep's cadence. A second thread, `8e038292…`, has the same shape (140 runs) but
stopped on 6 Sep, when D7 landed (`0822b27`, 6 Sep 20:48 +0700 = 13:48 UK). `76c0a399…` ran
straight through D7's landing, so whatever D7 stops, this is not it.

The thread's state: last customer message 7 Sep 08:32, *"Hi Ben, I am sorry but I do not want to
pay just to get a quote. Thanks for your time."* Tags `needs_ben`, `survey_offered`, `needs_survey`,
`structural_work`, `complex_scope`, `rescope`, `overdue_follow_up`; stage `scoping`. The captain's
"do both" authorised the fix; the conversation itself is his to close and is not touched here.

BACKLOG D1 filed the symptom on 5 Sep ("the clerk re-runs every sweep when it returns
`needs_info`"); D7's report filed the mechanism as D10 ("the half of the D7 loop a pending draft
does not cover"). This brief confirms which from the code, at start commit `63390fa`.

## Diagnosis from the code (no database, no key in this worktree)

### (a) Every path that can run the clerk on a `cadence` trigger

`grep -rn "'cadence'" server` still finds exactly two requesters, as D7 found:

| # | Requester | Clock | Why it does not repeat on this thread |
|---|---|---|---|
| 1 | `server/agents/comms-sweep.ts:154`, `sweepOnce` live mode | slow sweep, 5 min | stamps `metadata.lastAutoTriageAt` at line 145 before it asks; skips at line 116 while the stamp is newer than `lastCustomerContactAt`; the pending-draft skip at 128-134. Fires at most once per customer turn (D7 proved this; unchanged since). |
| 2 | `server/spine/request-run.ts:216`, `ensureQuoteRun`'s default `request` | see callers | `shouldRequestQuoteRun` (153-169): quote tag · no live estimate · no live Route A draft · **D7: no pending agent draft** · no pending pass |

`ensureQuoteRun` has five callers. Four fire once per cause (`triage.ts:350`, `exit.ts:132` via
`requestClerkRun`, `intake.ts:476`, `agents/comms.ts:904`). The fifth is the **net**,
`sweepUntriggeredQuotes` (`request-run.ts:312`), called by `sweepOnce` at `comms-sweep.ts:68` on
**every slow-sweep pass** whenever the spine is not off. Its candidates
(`defaultQuoteTagCandidates`, 292-301) are every unarchived customer thread with `needs_quote` or
`rescope`, oldest `updated_at` first, five requests per pass. Every run on `76c0a399…` after the
customer's last message was requested by the net: nothing else can ask on a clock.

### (b) What the pass does on this thread, and why nothing records that it looked

With `rescope` on the row and no `needs_quote`, `triageRules` (`triage.ts`) reads the last
customer message. *"…do not want to **pay** just to get a quote…"* matches `RE_MONEY`
(`triage.ts:36`, `pay`) → exception `money_question` → `lane: 'ben'` (`triage.ts:160-162`).
`agentForLane('ben')` is null (`index.ts:55-63`), so `runOnceBody` asks
`benLaneClerkDecisionFor` (`index.ts:277`, body at 122-131): `benLaneClerkWanted` (85-95) says
yes — customer thread, `rescope` is in `QUOTE_TAGS` — and `benLaneClerkVerdict` (103-109) reads
`quoteWorkInFlight`: no live estimate, no Route A draft (the thread never reached `quote_ready`),
so **the Quote clerk runs on Sonnet** (`agentName = 'quote_clerk'`, `index.ts:278`).

Its proposal is reduced to the artifact (`benLaneArtifactOnly`, 324), the artifact's readiness is
not `quote_ready` (an intake on a thread whose customer has declined cannot be), and on Ben's lane
the `visit_first` branch is skipped by design (362-364). `decide` returns `flag` on the exception
before it looks at any proposal (`decide.ts:86`). The exit's `flag` case sees `needs_ben` already
on the row (`exit.ts:237`) and writes no new flag row. **No draft is queued, no estimate is written,
no Route A draft exists, no tag changes.** The run is recorded in `agent_runs` (`recordedAgent` is
`triage`, `index.ts:281`, which is why the ledger shows the clerk's cost on the quote-prep path)
and `runDue` clears `nextTriageAt` (`request-run.ts:382-385`). The thread is left byte-for-byte as
the pass found it. Five minutes later the net asks the same five questions and gets the same five
answers.

Nothing in `request-run.ts` reads `agent_runs`, and no pass writes anything the net reads. That
is the whole defect: **the net has no "has anything changed since the last pass?" signal.**

### (c) Why `needs_ben` and `survey_offered` do not stop it

`needs_ben` is read in exactly three places: `decide.ts:124` (a customer-tier proposal on a
Ben-tagged thread goes `pending`), `exit.ts:237` (flag dedupe) and `asks.ts:55`. All three run
**after** the clerk has been paid for. The net's candidate query and `shouldRequestQuoteRun` never
look at it. `survey_offered` has no reader anywhere in `server/` (grep), so it is a label.

### (d) D1 or D10?

**Both rows describe this loop; D10 names the mechanism.** D1's words ("re-runs every sweep when it
returns `needs_info`") are the symptom as seen from the clerk; D10's ("a pass that leaves no
pending draft — the P19 Ben-lane clerk, whose flag is deduped and whose artifact-only proposal
queues nothing") is the exact path above. The thread that ran through D7's landing is the proof
that the pending-draft guard does not reach it. This fix closes D1's Done-when ("a `needs_info`
thread runs the clerk once per new customer turn, proven by test") and D10's ("no new customer turn
and no tag change since its last pass produces no further pass, whichever lane the pass took").

- **Initiating trigger:** `sweepUntriggeredQuotes` on every slow-sweep pass.
- **Masking condition:** a pass whose artifact never reaches `quote_ready` and whose lane leaves no
  pending draft (Ben's lane here; the Scoper deciding `none` is the same shape).
- **Symptom:** one Sonnet clerk run per pass, recorded under `triage`, ~284 a day.

### (e) A finding that shapes the fix: the in-pass direct requesters are refused in live mode

`triage.ts:350` and `exit.ts:132` call `ensureQuoteRun` **from inside the pass**. In live mode
`runDue` has already set `metadata.nextTriageAt` to the run's lease (`request-run.ts:365-370`, four
minutes ahead) before `runOnce` starts, so `shouldRequestQuoteRun` answers "a pass is already
pending" (`request-run.ts:164-167`: a due time in the future is within the 10-minute window) and
the request is refused; `runDue` then clears the row at 382-385. A quote tag that lands during a
pass is therefore picked up by the **net**, not by the direct requester. The marker below must not
suppress that: the snapshot of quote tags it records is the row's tags **as the pass found them**
(`caseFile.tags`), so a tag the pass itself wrote shows as new on the next net check.

## What to build

The smallest durable marker, in the shape `lastAutoTriageAt` and D7's `pendingDraft` already use:

- **Writer (the scheduler, `runDue` in `request-run.ts`):** after `runOnce` returns, the UPDATE
  that clears the lease also writes `metadata.lastSpinePass = { at, trigger, runId, quoteTags }`,
  where `at` is the moment the pass was started and `quoteTags` is `QUOTE_TAGS ∩ caseFile.tags`.
  One write, no extra round trip, and only when the lease still matches (a message that re-armed
  the row mid-run leaves no stamp — the new pass will stamp). A thrown run is not stamped, so the
  existing lease-expiry retry is unchanged. `runShadow` stamps the same way so shadow mode cannot
  loop either. Sandbox and hand-run dry runs never stamp.
- **Reader (the net only):** `sweepQuoteRunState` loads `passedThisTurn`, computed by a pure
  function against `latestInboundFor` (the same inbound D7 judges the pending draft against):
  the stamp exists, its `at` is at or after the latest inbound (or the thread has no inbound), and
  no quote tag is on the row now that was absent when the pass ran. `shouldRequestQuoteRun` refuses
  on it with a reason that reads in the log, after the D7 check and before the pending-pass check.
- The four direct requesters never see the field (their loader is `defaultQuoteRunState`,
  unchanged), so a tag landing outside a pass still schedules the clerk at once.

Decided and explained in the DONE report: the guard sits at the **request site** (no run row, no
case file build, no Haiku triage, no Sonnet clerk), not the run site; and the Ben-lane clerk keeps
running when a genuine new customer turn arrives on a `needs_ben` thread, because that is what P19
built and the spend is the clock, not the clerk.

## Hard constraints

- Nothing about what the clerk says or proposes, the survey offer, prices or money, the
  first-contact ack, tiers, send preconditions, the sampler, autonomy or media settings.
- No conversation archived, modified or closed. No `db:push`, no migration, no `app_settings` flag.
- Do not read the ledger (no credentials). No claim about live behaviour.
- Further loop shapes go to BACKLOG rows, not into this diff.

## Build gate (CLAUDE.md, measured)

`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` — zero NEW errors vs `63390fa`
(diff the lists, ~1,880 pre-existing). vitest judged by the failing-set diff with a placeholder
`DATABASE_URL`, not by count. esbuild bundles `server/index.ts`.

## Definition of done

1. A vitest test that models the loop — a quote-tagged thread, a pass that produced no draft and
   no estimate, no new customer turn, the net runs again — **fails on `63390fa`** (the net asks
   again) and passes after; plus: a new customer turn re-enables the net; a quote tag that landed
   during the pass re-enables it; the first pass on a fresh turn is never suppressed; the direct
   requesters are unchanged; `runDue` writes the stamp.
2. `docs/comms-build/D1-DONE.md` with the diagnosis, the gate as measured, a **Not done** section
   and a copy-and-paste ledger check for the captain after deploy.
