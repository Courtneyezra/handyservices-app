# B3 — `date_question` retired as a Ben trigger (DONE)

Brief: `docs/comms-build/BRIEF-B3-date-question-retired.md`. PRD v3 §7 **[OWNER]**, build row 3.
Branch `fm/date-question-r3` off `main` at **`1fd113c3`** (PRD v3). No `app_settings` flag
touched, no migration, no `db:push`, no intent moved to SEND, nothing about prices touched.

**This worktree has no `.env` and no database.** Everything below is unit tests, the deterministic
eval adapters and the build gate. Nothing here says anything about live behaviour; "before/after on
the real thread" was not possible and is not claimed. The 163-hits-in-7-days figure is the PRD's.

## The §7 table, as built

| Situation | Was | Now |
|---|---|---|
| Before a quote exists | `date_question` exception → lane `ben` → `customer.exception` (no intents) → flag. No agent ran. | No exception. `TriageResult.dateAsked` (additive signal). Lane `scoper`, pack `customer.default`, the Scoper runs and is told to say **"Dates come with your quote."** and carry on scoping. No lead-time guess, no hold, no flag. |
| A live (unpaid) quote exists | Same flag; the Scoper never ran, so `dateQuestionNeedsBen`'s picker exemption was unreachable from triage. | Lane `post_quote`, pack `customer.post_quote`, the Scoper points at the picker (`point_to_picker`, DRAFT). No flag. |
| After booking, wanting to change | Flag | **Unchanged — flag.** §13 is open; this is the interim (see Not done). |

## What changed, file by file

**`server/spine/types.ts`** — `TriageResult.dateAsked?: boolean`, additive, the same shape as
`customerPromisedMore`. Not a tag on purpose: triage's autonomous tier writes tags to the
conversation and never removes one, so a tag would say "a date was asked" on every later run.

**`server/spine/triage.ts`**
- `afterBooking(cf)` — a paid quote, or stage `booked` / `won`. The one path that keeps the
  exception.
- `triageRules`: `dateAsked` is read off the same text the old rule used (body or call
  transcript). `date_question` is pushed only when `afterBooking`; otherwise the reason line
  records "date lexicon: a signal for the Scoper, not Ben's (PRD §7)" and nothing else happens.
- The model prompt no longer lists "dates or availability (date_question)"; it now says
  `date_question is NOT yours to add` and why.
- `mergeTriage`: a model-only `date_question` is stripped **unconditionally** unless the rules
  raised it (booked job). The P7 promised-more branch was a special case of this and is subsumed;
  its test still passes, and `decide` still returns `waiting_for_promised` for that thread.
  `dateAsked` is carried through the merge.

**Packs** — `date_question` removed from `exceptionsToBen` in `customer.default` (and so
`customer.post_quote`, which spreads it), `rules.first_contact` and `rules.followup` (mirrors; the
only reader of `exceptionsToBen` is the Scoper). It **stays** in `customer.exception`, the pack a
booked-job flag still resolves to. `point_to_picker` added to `customer.default`'s
`allowedIntents` at the pack's DRAFT default (`tierByIntent` untouched), so the §7 second row holds
on whichever customer pack a live-quote thread resolves (a `rescope` at a stage other than
`quote_sent` lands on `customer.default`). `customer.post_quote` dedupes the spread.

**`server/spine/agents/scoper.ts`**
- `isPostQuotePack` no longer keys on `point_to_picker` (else the post-quote fragment and the
  levers would bolt onto every default run); `answer_from_quote`, the id and the stage still do.
- `renderCaseFile` adds one `DATE ASKED:` line when `triage.dateAsked`, stating which §7 row
  applies for this case file (no quote → the line; live unpaid quote → the picker on `/quote/<slug>`).
- `propose_reply` description: the money half is verbatim; the date half now says what to do
  instead of "call flag first". The `point_to_picker` refusal no longer tells the model to flag.
- `flag` description: dates removed from the list; `date_question` reserved for a booked job's
  date change. The exception stays in the tool's enum for that interim case.
- The post-condition that turned a pack exception into a flag no longer special-cases
  `date_question` (it is not in any customer pack's list).
- `CORE_FALLBACK` (the prompt used only if the `.md` is missing) says the same.

**Prompts** — `scoper.core.md`: "TWO THINGS ARE BEN'S" becomes "ONE THING" (the price decision,
untouched) plus a `DATES ARE NOT BEN'S` block with the three rows and the exact line; the flag
charter drops "dates" and gains "a booked date the customer wants changed"; the "suggested time"
sentence no longer ends in "flag it". `scoper.post_quote.md`: "With no live quote,
flag('date_question')" replaced by the line. No price sentence was changed.

**Evals** — `server/evals/triage-lexicon.ts`: `lexiconExceptions(text, { afterBooking })` raises
`date_question` only after booking; `lexiconDateAsked(text)` is the signal. `scripts/eval-comms.ts`
replay adapter passes `afterBooking: !!c.quote?.paid`. Fixtures:

| case | was | now |
|---|---|---|
| `dq-001-can-you-come-tuesday` | exceptions + mustFlag + date_promise | `noExceptions`, `guardsMustTrip: [date_promise]` (our reply promising a date is still caught; the customer asking is not an exception) |
| `dq-002-what-time-arrival`, `dq-003-another-day-incident`, `ir-006-harbans-am-pm` | exceptions + mustFlag, no quote | gain `quote: { paid: true }` — they are booked jobs, the §13 interim, and keep flagging |
| `dq-005-when-can-you-fit-me-in-good-reply` | exceptions + mustFlag (the right move "still passes Ben") | `lane: post_quote`, `intent: point_to_picker`, `mustNotEscalate`, `noExceptions`, `guardsMustNotTrip`, `voiceClean` |
| `dq-007-what-day-plus-back-soon` | exceptions + mustFlag | `noExceptions`, `guardsMustTrip: [date_promise]` |
| `dq-008-pre-quote-dates-come-with-your-quote` | — | **new**: the §7 row-1 reply, `mustContain` the exact line, `mustNotEscalate`, `guardsMustNotTrip` |
| `pp-004-saturday` | `lane: ben`, mustFlag, exceptions | `lane: post_quote`, `intent: point_to_picker`, `mustNotEscalate`, `noExceptions`, `guardsMustNotTrip`, `voiceClean` |
| `pp-006-booked-job-move-the-date` | — | **new**: the interim must-flag case (`quote.paid`, `lane: ben`, `exceptions: [date_question]`, `date_promise` on our agreeing reply). `case-schema.test.ts` requires one must-flag case per intent family and `pp-004` had been it. |

`dq-006` and the `absence` family are unchanged and still green.

## Tests

New: `server/spine/date-question-retired.test.ts` (26 tests) — the three rows through
`triageRules` → `resolveStaticPack` → `agentForLane` → `decide`; `dateQuestionNeedsBen` false on
both customer packs with a live quote; `point_to_picker` at DRAFT on both packs and nothing at
SEND; the booked-job interim (paid quote, stage `booked`, stage `won`) still `ben` /
`customer.exception` / `flag`; the model cannot add `date_question` (pre-quote, beside a promise,
and on the interim path the rules' exception is kept); the prompt no longer asks for it;
"Dates come with your quote." and the two-bubble variant pass `detectDatePromise`,
`detectSoftCommitment`, `detectDurationClaim`, `checkDraft`, the Scoper's own `checkProposedBody`
and the full `customer.default` guard set, while "Tuesday morning works, see you then." still trips
`date_promise` and escalates; the core and post-quote prompts say the line and no longer list
dates as Ben's; the case-file render states the row.

Updated: `triage.test.ts` (the old "routes dates to Ben" becomes the §7 pair; the P7 merge test's
"a real date question keeps its exception" clause becomes "no exception, and the run waits"),
`scoper.test.ts` (case 4 rewritten to the §7 behaviour; the fixture pack mirrors the real one),
`triage-lexicon.test.ts` (signal vs after-booking exception).

**How they were run.** `server/spine/triage.ts` imports `server/db.ts`, which throws at import
without `DATABASE_URL`. So in this worktree every spine test file that imports triage
(`triage.test.ts`, `scoper.test.ts`, `triage-widening.test.ts`, and the new file) fails at import
in a plain `vitest run` — exactly as in the baseline. For verification they were run with a dummy
`DATABASE_URL=postgres://nobody:none@127.0.0.1:1/none`; `pg` opens no connection until a query,
and none of these tests queries. Result: **11 files, 169 tests, all passing** (the new file, the
three updated ones, `decide`, `date-lexicon`, `triage-widening`, and every file under `server/evals`).

Deterministic eval adapters (`scripts/eval-comms.ts --adapter replay|triage`, same dummy URL for
the triage adapter's import), families `date_question`, `point_to_picker`,
`incident_regressions`, `absence`: **every case green, zero red** on both adapters.

**Not run: the model-backed `spine` adapter** (`EVAL_LIVE=1` + an API key). The families'
promotion column therefore still reads "skipped" here. Whether Sonnet actually writes
"Dates come with your quote." when told to is unproven until someone runs it.

## Build gate, as measured

| | at `1fd113c3` (before) | after |
|---|---|---|
| `tsc --noEmit -p .` errors | **1,880** | **1,880** — zero new by file:line (`comm` on the location lists). 12 lines differ in message text only (tsc reorders union members between runs) in `comms.ts`, `call-thread.ts`, `contextual-pricing/routes.ts`, `first-contact-ack.ts`, `inbox-board.ts`, `lead-stage-engine.ts`, `leads.ts`, none touched. |
| `vitest run` (no `.env`, as the baseline) | **65 failed / 1,242 passed / 8 skipped**, 25 files | **67 failed / 1,240 passed / 8 skipped**, 27 files |
| esbuild `server/index.ts` bundle | — | builds (4.2 MB, exit 0) |

`tsc` needs `NODE_OPTIONS=--max-old-space-size=8192` on this machine; at the default heap it dies
with a GC error and prints zero errors, which is how the first baseline attempt read "0".

The vitest failing **set** differs from the baseline by exactly three lines:
1. `server/spine/date-question-retired.test.ts` — the new file, failing at import for
   `DATABASE_URL` like its siblings; 26/26 pass with the dummy URL (above).
2. `performance.test.ts › should handle repeated classifications without memory growth` and
   `› should extract info in < 5ms` — `server/call-script`, untouched, imports nothing from the
   spine; raw heap-growth and wall-clock assertions with no forced GC. The first passed in the
   baseline run and failed in three isolated reruns afterwards; the second flipped between the two
   post-change full runs. Environment flake on a loaded, briefly disk-full machine.

The baseline is 65, not the 42 CLAUDE.md quotes, because 33 of the failure lines are
`DATABASE_URL must be set` from files that import `server/db.ts`: this worktree has no `.env`.

## Not done

- **§7 row 3 (changing a booked date) is OPEN in §13 and is not built.** The interim keeps
  today's behaviour: `afterBooking` (paid quote, or stage `booked` / `won`) + a date question →
  `date_question` → Ben. It is the old trigger narrowed to booked jobs, nothing new. When §13 is
  decided, `afterBooking` in `triage.ts`, the interim clause in the Scoper's `flag` description,
  `lexiconExceptions`' `afterBooking`, and fixtures `dq-002/003`, `ir-006`, `pp-006` are the places.
- **The model-backed eval was not run** (no key, no network here). Row 1's wording is enforced by
  prompt and by the guards, not yet observed from the model.
- **No live before/after.** Nothing was replayed against a real thread and nothing is claimed
  about the live queue.
- `AGENTS.md`: not created. `fm-ensure-agents-md.sh` would promote `CLAUDE.md` into `AGENTS.md`
  plus a pointer file, a repo-wide restructuring that three parallel crewmate PRs would each carry
  and conflict on. Left for one deliberate pass. The one durable environment note (spine tests
  need a `DATABASE_URL` to import; tsc needs an 8 GB heap) is in this report.
- `decide.exceptionForGuard('date_promise')` still maps our own date-promising text to a
  `date_question` flag. That is the §5.2 guard, not the retired trigger, and is meant to stay.
