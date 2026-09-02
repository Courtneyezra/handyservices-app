# P9 — a scope increase is not "out of scope"

Branch `p9-rescope-triage` from `comms-v3` at `b01e8ee`, worktree `/Users/courtneebonnick/v6-wt-exit`.
Brief: `docs/comms-build/BRIEF-P9-rescope-triage.md`. Incident: Sarah (4c0e227b…), 4 Sep — a £569
quote for 3 doors, back wanting all 9 with six photos; Haiku triage returned `out_of_scope`
(lane ben), so in live mode Ben would get a flag and the customer no reply.

## Fix

1. **Triage** (`server/spine/triage.ts`)
   - Rules-first pre-check `looksLikeRescope(text)`: a scope word (`RE_RESCOPE_WORD`: all N /
     all of them / more / extra / another / additional / as well / also / instead (of) / rather
     than / swap / change X to / add / the rest / every / both / the lot / "N more"…) AND a job
     noun (`RE_JOB_NOUN`: doors, windows, lights, taps, radiators, shelf, wardrobe, kitchen, tiling,
     job…). Both halves must match, so "all good thanks" and "another day" (RE_DATE's) do not fire.
     In `triageRules`, after the exception block and the `needs_quote` check and before the
     post-quote lane: `cf.quote` present + a customer message that looks like a rescope → tag
     `rescope`, lane `scoper`, no exception. Exceptions still run first (a price question, a
     boiler, asbestos on a rescope still go to Ben).
   - `mergeTriage`: when the rules tagged `rescope` and found no `out_of_scope`, a model-only
     `out_of_scope` is dropped (the existing "dropped exception → rules' lane" fallback then keeps
     the Scoper lane). A rules exception is never touched.
   - `TRIAGE_SYSTEM`: `out_of_scope` is defined precisely (a trade we do not cover, outside the
     service area, or regulated → `regulated_trade`) and "NEVER means more work than the quote
     covered"; a customer adding to / extending / changing scope on an existing or expired quote is
     scoping, lane `scoper`, tags `rescope` + `needs_quote`, no exception.

2. **Scoper standing orders** (`server/spine/prompts/scoper.core.md`): a RESCOPE paragraph — do not
   flag it as out of scope; in one run acknowledge what arrived by count, confirm the new scope in
   one plain line, say the quote is being redone, tag `needs_quote`, intent `confirm_received`;
   never a figure, the old number, "on top of", or a date; a real exception riding along is
   flagged and the scope still acknowledged; the "never when a live quote is out" rule for
   `quote_on_its_way` does not apply to a rescope.

3. **The tag actually reaches the thread** (`server/spine/exit.ts`) — a defect found on the way:
   `Proposal.tags` (`needs_quote`, `trust_concern`; the belt has offered them since Phase 2) were
   never written to the conversation by anything on the spine, so a Scoper's `needs_quote` could
   never make the clerk re-run. The exit now writes the allow-listed proposal tags additively after
   every decision except `drop` (`ExitDeps.addTags`, never removes) and, when `needs_quote` is NEW
   on the thread, requests the clerk's run at once (`ExitDeps.requestClerkRun` →
   `requestRun(id, 'cadence', { delayMs: 0 })`; the next pass lanes `quote_clerk` on the tag and
   Route A takes it from there). `ExitOutcome.tagsAdded` records it. In shadow the exit does not
   run, so nothing is written there (by design of shadow).

4. **Eval family** `eval-cases/rescope/cases.json` (6; families load from the directory, no
   registry): Sarah's case scrubbed (must not escalate, no exception, no figure / old number /
   "on top of"), one line → three, a swap, asbestos (must flag, `regulated_trade`), a gas boiler
   swap (must flag, `regulated_trade`), and a rescope that asks a price (must flag,
   `money_question`). `npx tsx scripts/eval-comms.ts --family rescope --adapter triage`: 6 green.

5. **Tests**: `triage.test.ts` (+7: the regex pair, Sarah's case → scoper + rescope + no exception,
   no quote → no rescope tag, exceptions still win on a rescope, `needs_quote` already on the
   thread still lanes the clerk, the merge drops a model-only out_of_scope only on a rescope,
   the prompt text); `exit.test.ts` (+3: a pending draft with `needs_quote` writes the tag and
   requests the clerk run; an existing tag neither re-writes nor re-triggers and unknown tags are
   ignored; flag-only carries tags, drop writes nothing, a failing write never breaks the exit).

## Files

Changed: `server/spine/triage.ts`, `server/spine/triage.test.ts`, `server/spine/exit.ts`,
`server/spine/exit.test.ts`, `server/spine/prompts/scoper.core.md`. New: `eval-cases/rescope/cases.json`, `P9-DONE.md`.
No migrations.

## Verification

| Gate | Result |
|---|---|
| tsc vs `b01e8ee` | 1,868 → 1,868; (file, error code) multiset identical |
| server vitest | baseline 42 failed / 1,003 passed (70 files); after 42 failed / 1,012 passed; failing set identical. The call-script timing benchmark flaked once under tsc load and passes alone (25/25) |
| `npm run test:client` | 60 passed (one PriceAndSend test flaked under load, passes alone) |
| esbuild `server/index.ts` | bundles |
| eval harness | `rescope · triage` 6 green / 0 red |

No dev server, no database, no `app_settings`, no push.

## Not done, and why

- **The spine eval adapter was not run** (needs `EVAL_LIVE=1` and the model key; rule 2), so the
  family's `passed` stays false for promotion until the orchestrator runs it, like every family.
- **The `rescope` tag is set by triage and read nowhere else yet**: the Scoper reads it in its
  standing orders through the case file's tags; no board pill. Pane C's vocabulary could add one.
- **Expired quotes**: the pre-check keys on `cf.quote` being present, which `loadQuoteContexts`
  supplies for live and expired quotes alike; a *paid* quote also matches (the customer adding to a
  booked job is still a rescope for the clerk). If a paid job should route differently, that is a
  one-line condition.

## Decisions

- Rules first, model second: the pre-check makes the lane deterministic before Haiku speaks, and
  the merge refuses the specific misreading rather than trusting the prompt alone.
- Only a model-only `out_of_scope` is dropped on a rescope; every rules exception still wins, so
  asbestos, a boiler or a price question on a rescope reaches Ben exactly as before.
- The tag write lives at the exit (the one place a spine decision touches the world), not in the
  Scoper, so every agent's proposal tags behave the same and shadow stays dry.
