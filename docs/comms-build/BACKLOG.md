# Comms desk — execution queue

Written 5 Sep 2026. The remaining comms work, cut into steps small enough that one agent pane takes
exactly one of them, finishes it, and stops. Nothing here is a phase; each row is a single commit
with its own gate and its own `P*-DONE.md`.

Read `HANDOVER.md` for where the system stands and `CUTOVER.md` for the switches. This file is the
only thing an orchestrator needs to pick the next step.

## The contract for one step

One pane takes the top unblocked row and does all of this, in order:

1. **Write the brief first.** `docs/comms-build/BRIEF-<id>-<slug>.md`, same shape as
   `BRIEF-P19-clerk-on-ben-lane.md`: the thread or the defect that paid for it, what to build,
   hard constraints, the build gate, definition of done. If the row below is not enough to write
   that brief, the step is *research*, and the deliverable is the brief, not code.
2. **Its own worktree and branch.** Never `main`, never another pane's branch.
3. **Build it.** Only what the brief says. A second defect found on the way becomes a new row at the
   bottom of this file, not a second commit.
4. **The gate** (CLAUDE.md): zero NEW tsc errors against the pane's start commit (~1,882
   pre-existing — measure by stashing, do not assume the number), vitest 42 pre-existing failures
   unchanged, esbuild bundles `server/index.ts`. Never `db:push`; migrations are idempotent SQL
   applied with `npx tsx scripts/_apply-migration.ts migrations/<file>.sql`.
5. **Never flip an `app_settings` flag.** The spine is LIVE. Flags are the owner's, via
   `scripts/_spine-mode.ts`.
6. **`docs/comms-build/<id>-DONE.md`**: what shipped, before/after on the real thread where one
   exists, the gate results as measured, and a **Not done** section. Anything in Not done that
   still matters gets appended here as a row.

A pane that cannot finish its row writes the DONE report anyway, saying where it stopped and what
it learned. A half-done row stays at the top of the queue.

---

## Lane 1 — clear the decks (do these first, they are small and they block reads)

| # | Step | Entry point | Blocked by | Done when |
|---|---|---|---|---|
| **C1** | Land the P15 migration. `migrations/20260907_p15_variations_and_expenses.sql` is modified and uncommitted (dollar-quoting removed because `_apply-migration.ts` splits on semicolons). Apply it, confirm `dispatch_variations.dispatch_id` is nullable, the `has_parent` check exists and `job_material_expenses` exists, then commit. | that file | — | The two P15 "Open" items (booking with no dispatch row; missing expenses table) are closed by the schema, and the change is on `main` |
| **C2** | Commit or discard `scripts/_comms-desk-replay.ts`. It is modified in the working tree with no owning brief; every replay in every future DONE report runs through it. | that file | — | Working tree clean of comms files; the script runs read-only against one known thread |
| **C3** | Merge audit. Four worktrees carry comms branches (`v6-wt-int` comms-v3, `v6-wt-worker` p17-eval-reds, `v6-wt-exit` p18-split, `v6-wt-config` p15-part4-completion). Say for each: merged, or what is still out. | `git worktree list` | — | A table in the DONE report: branch → merged into main / outstanding commits / delete it |

## Lane 2 — P14, one screen one record (the plan is written, the briefs are not)

`PLAN-P14-price-screen-v3.md` is agreed shape, four parts. Each part is one pane. Do not collapse
two parts into one commit: part 1 must render the existing P12 page unchanged before part 2 touches
the UI.

| # | Step | Entry point | Blocked by | Done when |
|---|---|---|---|---|
| **P14.1** | Pack-first read. `loadPriceScreen` prefers `job_packs`; the quote row is a logged fallback for pre-P13 drafts. Payload gains `pack: { job, required, missing, changeLog, lockedAt }`; every existing field keeps its shape. Settle the rescope question here: `upsertFromEstimate` must supersede lines, not append, when a title changes. | `server/spine/price-screen.ts` | C1 | The P12 page renders unchanged against the new payload; tests on Sarah's and MJ's packs |
| **P14.1b** | Back-fill Sarah's pack the way P13b did MJ's. Her draft predates P13, so without this she stays on the fallback and P14.1's test is half a test. | `server/spine/job-pack-backfill.ts` | P14.1 (or before it) | Sarah's slug loads pack-first |
| **P14.2** | The "What the contractor will get" panel plus inline edit. `POST /price/:slug/pack/job` → `fileAnswer(source: ben)` with a change-log row. Panel component shared with the portal's `JobPackSection` (read-only there, editable here). Line-level fields that would 422 at dispatch show as red chips on the line. | `server/spine/price-screen.ts`, `client/src/pages/admin/price` | P14.1 | Ben can fix a job field on the price screen and the contractor portal shows it |
| **P14.2b** | Emit `job_pack_changed` when Ben's inline edit touches a day-relevant field after acceptance, on P13's hourly batch rule. This is the P13 gap the plan names. | `server/spine/job-pack-notify.ts` | P14.2, and the Meta template `job_pack_changed_v1` being approved (else it queues for Ben, which is acceptable) | A post-acceptance edit reaches the contractor or queues with a reason |
| **P14.3** | "Ask first" reads from `missing`; send is blocked **only** by line-level required fields, matching dispatch; the confirm screen lists the job fields still outstanding and says the rules layer will ask. | `server/spine/job-pack-asks.ts`, price screen | P14.2 | A quote with missing job fields sends; one with a missing line field cannot |
| **P14.4** | Hold moves to the pack. `pack.hold` replaces `pricing_suggestions.hold`; the intake card, the portal review page and the desk read one place. Add the change-log strip at the top of the screen. | `server/spine/price-screen.ts`, `job-pack-writers.ts` | P14.3 | No reader of `pricing_suggestions.hold` remains |

## Lane 3 — defects with a named owner (each is one pane, no plan needed)

| # | Step | Entry point | Blocked by | Done when |
|---|---|---|---|---|
| **D1** | The clerk re-runs every sweep when it returns `needs_info` (P19, Not done). Add a "the clerk already looked at this turn" marker keyed on the last inbound, so a `needs_info` intake is not re-derived every five minutes. | scheduler side of `server/spine/index.ts`, `request-run.ts` | — | A `needs_info` thread runs the clerk once per new customer turn, proven by test |
| **D2** | **Rewritten 7 Sep (B7a).** As first written ("the five named cases are held by the text guard with the triage lexicon disabled") this row was unachievable: the five (`9bdaa1853b`, `5e5f585796`, `e83dd6aaaf`, `bc77d44614`, `ef67198bd0`) each carry `guardsMustNotTrip: true` in `eval-cases/guards/incident-v2-unguarded.json` — their text is clean, and a text guard that held them would fail the case. What is wrong in each is the *move*: a gap ask carried on past a price objection, a price question or a callback request, four of them on post-quote threads. The text rail already holds every incident case where our own words were unsafe (P17: 6 of 6 `unsafe_missed` / `caught_by_guard`). So the rail to build is on the move, not the words: `server/spine/send-preconditions.ts` refuses a SEND-tier `ask_gap` whenever a quote is on the case file, and the money lexicon in `triageRules` lanes the pre-quote "Tell me price" shape to Ben before any agent runs. | `server/spine/send-preconditions.ts`, `scripts/eval-comms.ts` (`textRailRegressions`), `server/spine/send-preconditions.test.ts` | — | (1) The scoreboard pins that every incident case the text rail does hold (`unsafe_missed`, `caught_by_guard`) stays held by a text guard with the lexicon disabled — `guardFalseNegative.textRailRegressions` empty, a regression exit otherwise (true today: 6 of 6). (2) The five are refused before the send: four by the precondition via a live quote on the case file, the fifth laned to Ben by the money lexicon — proven by unit test over the case contexts through `caseFileFromContext` plus a synthetic quote, and by `expected.precondition` on the cases (`--adapter triage`, no key) |
| **D4** | **Empty body can reach the wire.** `scoper.ts:497` returns `{intent:'holding', body:[]}` on the side-effects-only path. `decide.ts:100` only catches an empty body when `proposal.artifact` is set, so this one falls through to the tier ladder; `holding` is allowed in `customer.default` and is NOT caught by `FORBIDDEN_INTENT_SMELL` (`packs.ts:31`), so autonomy can promote it to SEND. Guards all pass on `''`, `deliverable()` passes, and `sendCustomerMessage` has no empty-body refusal. Harmless today (everything is DRAFT — it queues an empty draft); a sent blank message the day `holding` earns SEND. Fix: refuse an empty body in `decide` regardless of `artifact`, belt it at the exit, and consider adding `holding` to the never-promotable set. | `server/spine/decide.ts`, `exit.ts`, `packs.ts` | — | An empty-body proposal can never be `kind:'send'`, proven by test at both layers |
| **D5** | **Move the move-check before the send.** `verifier.ts` already answers `moveRight` / `voiceRight` / `unsafe` separately — the exact split the decomposition wants — but it only runs in the morning sampler, only on sends already made, and only when `spine.sampler.enabled` is true (off). So nothing asks "was this the right move for where this thread is?" before a draft reaches Ben. Run the same rubric on the proposal, advisory at first, and put its answer on the draft. | `server/spine/agents/verifier.ts`, `index.ts` | — | Every draft carries a move-quality opinion; the eval families show the judge's `moveRight` agreeing with Ben's `wrong_move` chip |
| **D6** | **A "does anything need saying?" step.** Today the only deterministic no-reply rules are opt-out, spam and P7 `waiting_for_promised`; the general case is decided implicitly by the Scoper choosing not to call `propose_reply` — a Sonnet call spent to conclude silence. Add a cheap explicit decision ahead of the agent. Saves the call as well as closing the gap. | `server/spine/index.ts`, `triage.ts` | — | Threads needing nothing resolve without a Scoper run, and the reason is on the run record |
| **D7** | **A runaway cadence loop, found in the live ledger 6 Sep.** Last 7 days: the Scoper ran **608** times, **598** on cadence, **561** of those on ONE thread (`8e0382…`, last customer message 3 Sep 10:00), proposing `point_to_picker` every time. **591** exits were `queueDraft refused` — a single pending draft from 3 Sep 10:06 blocks the dedupe, so every run is thrown away. Same thread: 181 clerk runs, 807 triage rows. Peak 285 runs/day. Trigger is legacy `comms-sweep.ts:154` requesting spine cadence runs. Scoper rows record `cost_pence` 0, so the Sonnet spend is invisible. Not established: why it stopped after 4 Sep, so it may recur. This is BACKLOG D6 ("is there anything to say?") as a live incident, and it is the most expensive thing the desk is currently doing. | `server/agents/comms-sweep.ts`, `server/spine/index.ts` | — | A thread with a pending draft and no new customer turn produces no further Scoper run; Scoper runs record real cost |
| **D8** | ~~Rung zero surprised us~~ — **WITHDRAWN, and the reason matters.** The original card said thread `8e0382…` got three holding lines "overnight" at 04:05, 06:09 and 09:14. That was a **timestamp artifact**: `messages`, `message_drafts`, `comms_events` and `agent_questions` store naive UTC (`timestamp without time zone`) and a non-UTC client shifted them by seven hours. Real times 11:05 / 13:09 / 16:14 UTC (12:05 / 14:09 / 17:14 UK), and **each one followed a fresh customer message** (customer wrote 10:53, 12:52, 16:03). So: three daytime holding lines to a customer who kept writing, which is the silence-breaker working as designed, not an out-of-hours defect. **Replacement work:** (a) decide whether three "we've got it" lines in a working day is a defect at all — a judgement nobody has made; (b) the real lesson, which is that **every ledger query must read those columns with an explicit `at time zone 'UTC'`** or it will silently lie. | `server/rules-layer.ts`, any ledger query | — | The UTC rule is written into the reflection prompt and the runbook; a decision is recorded on repeated holding lines |
| **D9** | `money_to_customer` in `guards.ts:86` returns `null` on both branches — a dead detector that nonetheless sits in `ESCALATE_GUARDS` (`guards.ts:18`). Either implement it or remove it; a guard that cannot fire is worse than no guard because it reads as cover. | `server/spine/guards.ts` | — | The guard either detects something or is gone from both lists |
| **D3** | Watch the soft-commitment guard's refusal rate on a week of live drafts (`/admin/activity`) and tune or leave it with evidence. A guard that fires too often costs redrafts. | `/admin/activity`, `server/spine/guards.ts` | 7 days of live drafts since P17 merged | A number in a DONE report, and either a tune or a written "leave it" |
| **D10** | **The half of the D7 loop a pending draft does not cover.** D7's diagnosis (`BRIEF-D7-cadence-loop.md`): the repeat engine was not `comms-sweep.ts:154` (its `lastAutoTriageAt` stamp fires it once per customer turn) but the untriggered-quote net (`request-run.ts sweepUntriggeredQuotes`, every slow-sweep pass), which only asks "is something on the way?" and so re-requests a quote-tagged thread whose pass produced no estimate and no Route A draft, every 5 minutes, for as long as the tag stands. D7 stops it when the last pass left a pending agent draft (the 561 Scoper runs). It does **not** stop the other shape on the same thread: the P19 Ben-lane clerk (181 runs), whose flag is deduped and whose artifact-only proposal queues nothing, or any pass that flags or decides `none`. Needs a "has anything changed since the last pass?" signal the direct requesters (a tag landing, a portal override) do not trip — a per-thread last-pass stamp compared with the last inbound / last tag write is the obvious one; agent_runs is B2's file. | `server/spine/request-run.ts` (`shouldRequestQuoteRun`, `sweepUntriggeredQuotes`) | D7 merged | A quote-tagged thread with no new customer turn and no tag change since its last pass produces no further pass, whichever lane the pass took |

## Lane 4 — Phase 5, delete the legacy agent (ordered; `PHASE5-DELETE.md` is the list)

Gate on the whole lane: spine live ≥ 7 days with zero `unsafe` verdicts, rollback exercised once,
Ben's queue healthy. Live since 3 Sep 00:31 → **eligible 10 Sep** at the earliest.

| # | Step | Entry point | Blocked by | Done when |
|---|---|---|---|---|
| **F1** | Delete V2 and memory: `server/pipeline/v2.ts`, `server/workers/*`, `server/memory/*`, `shared/conversation-memory.ts`, `server/llm/openrouter.ts` (+ `router.ts` if only V2 used it), the two smoke scripts, `docs/AGENT_FRAMEWORK_V2_*.md` → `docs/archive/`. Confirm `conversation_memory` is unused, then drop the table in a migration. | those paths | Confirm zero importers first — that confirmation is part of the step | Nothing imports them; the table is dropped; tsc and bundle clean |
| **F2** | Archive the legacy prompt verbatim to `docs/archive/legacy-comms-prompt.md` before anything deletes it. Tiny step, on purpose: it is the one thing that cannot be recovered from the diff once F3 lands. | `server/agents/comms.ts` | F1 | The prompt is in `docs/archive/` |
| **F3** | Delete the legacy agent and its sweeps: `server/agents/comms.ts`, the `comms-sweep.ts` sweeps, `sla-sweep.ts`, `promise-tracker.ts` chases, the cron comms sweeps in `server/cron.ts`, the `resolve_question` tool, `autosend.intents`, the `COMMS_CONFIG_OVERRIDE` seam, and the eval `legacy` adapter. | those paths | F2, **and `runCommsAgent` having zero callers** — verify, do not assume | `grep runCommsAgent` returns nothing outside history; the SLA double-ping noted in P1-silence closes with it |
| **F4** | Backfill `approved_by` to enum values, then delete the `AUTOMATED_APPROVER`-era prefixes in `isAutomatedApprover`, and the `run_comms_agent` legacy branch in `server/agents/ops-manager.ts`. | script + `server/spine/exit.ts` | F3 | No legacy prefix survives in `approved_by` |
| **F5** | Shrink the surface: `/admin/staff` cards for retired agents, `agent-staff.ts` legacy stats, and the architecture test's lists down to the spine's exit only. | `server/agent-staff.ts`, `server/spine/architecture.test.ts` | F4 | The architecture test names one sender |

## Lane 5 — owner gates (not agent work; they unblock rows above)

These are Courtnee's and Ben's, and several rows above wait on them. An agent pane must never do
one of these on its own.

| Gate | Unblocks | State |
|---|---|---|
| `holding_line_v1` Meta approval (SID HX1c733d68035a5fe3c15b90936f80ec8f) | out-of-window holding line by template instead of SMS | submitted 3 Sep, awaiting Meta |
| `job_pack_ready_v1` / `job_pack_changed_v1` submitted to Meta (`TEMPLATES-JOB-PACK.md`) | P14.2b, contractor out-of-window notices | not submitted |
| Neon dev branch + strip Twilio secrets from laptops (`PHASE0-OPS.md` §2–3) | closes the 31 Aug incident class | open |
| Bot disclosure decision (Design §4) | anything reaching SEND | open |
| `sampler.enabled: true` | the morning check strip; needed before autonomy is honest | eligible now |
| `autonomy.enabled: true` — 14 days of verdicts, rate ≥ 50% of drafts | first intent DRAFT → SEND | **≥ 17 Sep** |
| 7 live days, zero unsafe | all of Lane 4 | **≥ 10 Sep** |

## Lane 6 — T5/T6 follow-ups (the comms sandbox, `T5-DONE.md`, `T6-DONE.md`, 6–7 Sep)

| # | Step | Entry point | Blocked by | Done when |
|---|---|---|---|---|
| **T5-a** | A sandbox-safe Route A. The sandbox skips Route A because the live chain writes draft quotes and pushes Ben's phone. A variant that writes only rows on the sandbox number and never notifies would let the owner watch clerk → estimator → priced draft too. | `server/spine/index.ts` (`sandbox` branch), `route-a.ts` | T5 merged | A sandbox pass laning to the clerk shows the chain on the page; no Pushover; reset deletes what it wrote |
| **T5-b** | Replay a real thread in the sandbox: copy one conversation's messages (and its quote, if any) onto the sandbox number, then carry on typing. This is how a live wrong move gets reproduced with the exact wording rather than a paraphrase. Read-only on the source thread. | `server/spine/sandbox-routes.ts` | T5 merged | `POST /api/comms-sandbox/replay { conversationId }` copies read-only and the page shows the copied history |
| **T5-c** | Shadow rows in `gatherEvidence`. The two `agent_runs`-only queries (escalations 14d, incidents 30d) count `proposal.shadow = true` rows — the same leak T5 closed for sandbox rows, pre-existing for shadow. Decide whether a shadow pass is evidence; if not, add the same one-line predicate. | `server/spine/autonomy.ts`, `sandbox.ts` (`notSandboxRunSql` is the shape) | — | A written decision, and the predicate if the answer is no |
| **T6-a** | A belt failure is recorded as a clean `none`. The Scoper catches its `runAgent` failure (so its post-conditions still run) and returns null; until T6 nothing carried the failure up, and even now the row's `decision` is `none` with `error` set. Decide whether such a row is autonomy evidence at all (it currently counts as a quiet pass in `gatherEvidence`), and whether a refused API call should schedule a retry rather than fall silent on a live thread. Found on 7 Sep when the local key had no credit: two Scoper passes in a row went out as "proposed nothing". | `server/spine/agents/scoper.ts` (the catch), `server/spine/index.ts` (`reportFailure`), `server/spine/autonomy.ts` | T6 merged | A written decision; if "not evidence", the same one-line predicate shape as `notSandboxRunSql` on `error IS NULL`; if "retry", a bounded one |
| **T6-b** | Three of the five sandbox chips never reach the Scoper: *Quote too expensive*, *Demands a price* and *Wants a call before paying* hit `RE_MONEY` / `RE_CALLBACK` in `triageRules` and flag to Ben before any agent runs. That is the pipeline's move and the sandbox shows it faithfully, but the chips were meant to reproduce the reject-`wrong_move` verdicts, which were Scoper replies. Either the real customer lines did not trip the lexicon (then the chips need the real wording — T5-b, replay) or the lexicon has since widened (then the wrong-move cases are now Ben's by rule and the chips should say so). | `client/src/pages/admin/SandboxPage.tsx` (`WRONG_MOVE_SHAPES`), the 7 `draft_verdicts` rows | T6 merged | Each chip's tooltip says which lane it will land on, and at least four of the five exercise the Scoper |

---

## Order to run

C1 → C2 → C3 → P14.1b → P14.1 → P14.2 → P14.3 → P14.4 → D1 → D2, with **P14.2b** slotted after
P14.2 once its template is approved, **D3** run whenever a week of live drafts exists, and Lane 4
(F1…F5, strictly in order) starting the day the 7-live-day gate passes — it is independent of
Lane 2, so it can run in a second pane in parallel from 10 Sep.

Lane 2 and Lane 4 must not share a pane or a branch: one is adding to the price screen, the other
is deleting the code the old price path still mentions.

## Lane 7 — B6 follow-ups (automatic demotion while autonomy is off, `B6-DONE.md`, 7 Sep)

| # | Row | Where | Blocked by | Done when |
|---|---|---|---|---|
| **B6-a** | **Two of the three incident tags have no writer.** `INCIDENT_TAGS` is `incident`, `trust_concern`, `complaint` (`server/spine/autonomy.ts`), but nothing in `server/` writes an `incident` tag and triage raises `complaint` as an exception, not a tag (`server/spine/triage.ts` `RE_COMPLAINT`). With the sampler off, the only demotion signal that can reach a *sent* SEND-tier message is therefore `trust_concern`, and only when a later Scoper run proposes it. Decide whether the complaint lexicon should also write a `complaint` tag on the thread (so a complaint after an automatic send demotes the intent next morning), and whether anything should ever write `incident`. B6 deliberately did not widen the list. | `server/spine/triage.ts`, `server/spine/exit.ts` (`PROPOSAL_TAG_ALLOWLIST`), `server/spine/autonomy.ts` | — | A complaint on a thread an intent sent to is counted by `gatherEvidence` as an incident, proven by test; or the row is closed with a written decision that `trust_concern` alone is enough |

## Lane 8 — T9 follow-ups (the price queue, `T9-DONE.md`, 7 Sep)

| # | Row | Where | Blocked by | Done when |
|---|---|---|---|---|
| **T9-a** | **The queue is Route A drafts only.** `WAITING_DRAFT_WHERE` (the confirm screen's rule, reused unchanged) requires `pricing_suggestions is not null`, which Route A always writes (a failed estimator still prices the fallback draft). A draft saved by hand from the intake card (`POST /quote-intake/:id/save-draft`, "never prices") has no suggestions and is therefore invisible to both the "Next quote waiting" button and `/admin/price`. Decide whether an unpriced hand-saved draft is "waiting to be priced"; if yes, widen the one constant (both surfaces move together) and give the queue a way to show a draft with no signals at all. | `server/spine/price-brief.ts` (`WAITING_DRAFT_WHERE`), `server/spine/quote-intake.ts` | — | A written decision; if widened, one edit to the constant and a test on both readers |
| **T9-b** | **The phone bottom tab bar has no Price queue tab.** The owner asked for the queue "on bottom sticky in Ben's app once something has been removed". That bar (`SidebarLayout.tsx`, `isVA` only, five tabs: Desk, Follow-Ups, Pipeline, Quotes, Calls, Stats) is full, and which tab to drop is his call; it also only renders for the VA role, so it is not on Ben's own phone at all. T9 put the queue in the sidebar and as a strip on the price screen instead. | `client/src/components/layout/SidebarLayout.tsx` (the `isVA` nav) | owner: which tab goes, and whether the bar should show for admins | The queue reachable from the bottom bar on a phone, one tab removed by name |
| **T9-c** | **The badge polls.** The sidebar's Price queue count is the shared queue query on a 60 s interval per open admin tab (the Segment Review / Follow-Ups idiom), a full list read each time. Fine at today's volume; if it shows in the DB logs, add a count-only read or push it over the existing comms SSE stream. | `client/src/hooks/usePriceQueue.ts`, `server/spine/price-queue.ts` | T9 merged | A count that costs one `select count(*)` or no poll at all |

