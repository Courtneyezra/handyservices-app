# Agent B — DONE: Content Guards (Duration Claims + Policy Commitments)

Completed 27 Aug 2026. Files touched (all inside my boundary):
- `server/agents/draft-guards.ts` — two new detectors, wired into `checkDraft`; one bug fix in
  `stripNegations` (details below)
- `server/agents/objection-levers.ts` — shared rails + standing-orders block
- `scripts/_test-content-guards.ts` — new adversarial suite (pure: no DB, no LLM, no env)

Nothing committed; all changes are in the working tree.

## B1. `detectDurationClaim` (draft-guards.ts)

Refuses any assertion of job duration, visit count, or loss-of-use, exactly like
`detectDatePromise`: the agent may never assert duration, right or wrong; the quote page is the
scope-and-logistics channel. Fires as `code: 'duration_claim'`, last in the `checkDraft` chain
(after `date_promise`, its twin).

Regex coverage (all case-insensitive, curly-apostrophe tolerant where contractions appear):
- counted visits: "one visit", "two visits", "a single visit", "separate visits"
- sized jobs: "a two day job", "one-day job", "2 day thing"
- "done/finished/sorted/out in a day / one go / a morning", "in one go", "in and out", "same day"
- loss-of-use: "only/just … out of action|use|commission", "out of use … while/for two days/on
  the day", "back to normal / up and running … by the evening"
- how long: "won't/shouldn't/doesn't take long", "takes/took a couple of hours", "won't be long",
  "quick/easy job|fix"
- time on site: "on site / with you / at yours for two days"
- job shape: "split/spread over|across two visits/days"
- bare assertions: "it's two days", "it'll be a couple of hours", "should be one day"
- "a full day's work / full day on site"

**Deliberate residual gap**: bare "a full day" with no work/job noun ("we allow a full day and
never rush it") is NOT refused — it is a REASON marker in the capitulation guard's lever list
("2 people, a full day, not rushed") and eating it would refuse the price-justification levers.
Recorded as a visible NOTE in the test suite.

## B2. `detectPolicyCommitment` (draft-guards.ts)

Refuses invented commercial terms — a fee credited/deducted/refunded/waived — as
`code: 'policy_commitment'`, placed in `checkDraft` immediately after `detectDiscountOffer`
(same family; where a phrase carries both a modal and a mechanism, e.g. "we can waive the fee",
the discount guard fires first and keeps it, per the no-duplication rule).

Regex coverage:
- "comes/knocked/taken off the job|bill|total|price|invoice|cost|balance|final …"
- "deducted from/off/against the …", "credited against/towards/back/off"
- "goes/counts/put towards the job|work|final bill"
- "refunded if/when you book|go ahead|proceed", "money back if you book"
- "waive the fee/charge/callout/survey/deposit", "the fee is waived"
- "survey/callout/visit/inspection fee" within reach of any mechanism word (either order)

Design decisions:
- **No negation stripping**: "we can't waive the fee" states the business's terms as hard as "we
  can" — both are Ben's, both refused (proven in the suite).
- `quote` and `work` are deliberately NOT in the comes-off noun set: "happy to take that off the
  quote" is the re-scope lever (removing a LINE, allowed) — proven as a should-pass case.
- Naming the visit as PAID still passes ("…it'd be a paid survey visit. I'll come back to you
  with the details.") — only the TERMS are refused.

## B3. Standing-orders wiring (objection-levers.ts)

Single-source-of-truth pattern: two exported constants, `DURATION_RAIL` and `VISIT_TERMS_RAIL`,
defined in objection-levers.ts (which draft-guards already imports — no cycle), with the full
incident-dated rationale docstring. `postQuoteStandingOrders()` renders both verbatim as new
"DURATION AND VISIT-COUNT" and "VISIT AND FEE TERMS" blocks (between SCHEDULING and "NOT RIGHT
NOW"), and the guards' refusal messages quote the same constants, so prompt and enforcement
cannot drift. The suite asserts the verbatim inclusion both ways.

## Bug found and fixed while testing

`stripNegations` (draft-guards.ts, pre-existing) never matched "can't": the alternation
`(can|could|…)n't` lets "can" swallow the n, leaving `n't` nothing to match — so
"we can't do a discount" was refused as a discount offer while the proven-fine
"we cannot do a discount" passed. Added an explicit `can't` replacement. Nothing in any suite
(including the archived adversarial one) depended on the old behaviour; the false-refusal
direction only got narrower.

## Test results

`scripts/_test-content-guards.ts` — **ALL GREEN, 54 PASS / 0 FAIL**. Covers:
- both 27 Aug incident sentences, verbatim, refused (11:16 "all done in one visit…" →
  `duration_claim`; 11:38 "…the fee comes off the job if he goes ahead" → `policy_commitment`)
- 16 further duration attacks, 9 policy attacks
- 13 should-pass messages: the James conversation's healthy lines ("No need to apologise
  James…", "Just need a rough size for the room now"), "no rush" / "take your time" /
  "whenever you get a minute", Ben's best objection reply, the deposit line, both re-scope
  shapes, the volume lever's scope half, the timing-hold reply, and deferring duration TO the
  quote
- regression: discount/money/date/capitulation guards still fire correctly with the new checks
  in the chain
- wiring: the standing orders and the refusal messages carry the identical rail text

`npm run check` — no errors in any file I touched or in server/. The only tsc errors are
pre-existing corruption in two untracked-by-me, unmodified files (`scripts/seed-diy-advice.ts`
begins with `x**`, and `scripts/scrape-reddit-value-drivers.ts`) — committed that way before this
task, unrelated to this work.

**Archived suite, superseded on purpose**: `scripts/archive/_post-quote-test.ts` case 3d-bis
blessed "That covers both jobs in one visit" as the model figure-free answer. Since 27 Aug 2026
"one visit" is the incident phrase and that sentence is now refused; if the archived suite is
ever revived, that one expectation must flip. I did not run the archived suites (they stage rows
in the live DB and two other agents are working in this checkout concurrently); the new pure
suite covers the same guard chain deterministically.

## Wiring I need Agent C to do (comms.ts — his file, not edited by me)

1. **`ESCALATE_CODES`** (comms.ts ~line 493): add `'duration_claim'` and `'policy_commitment'`.
   Both are Ben-only families; without this, a run that gets refused and then goes silent will
   not auto-route the refusal to Ben the way money/discount/date/liability refusals do. The
   guard itself already fires either way (checkDraft throws), so nothing unsafe ships meanwhile.
2. **The VISITS ARE NEVER FREE block contradicts the new guard** (comms.ts ~lines 1510-1535).
   The policy line "the customer pays a survey fee and it is credited off the job when they go
   ahead" and the DO example "…the fee comes off the job if you go ahead. I'll come back to you
   with the details." now instruct the model to write the exact sentence
   `detectPolicyCommitment` refuses (it IS the 11:38 incident sentence's shape). Reword to: the
   visit is PAID, and that is all the agent may say — the fee's terms come from Ben
   (`VISIT_TERMS_RAIL` in objection-levers.ts is importable and is the canonical wording).
3. Optional, consistent with the existing belt-and-braces pattern: `neverSendDirectReason`
   re-runs discount/date/liability detectors as an independent rail — consider adding
   `detectDurationClaim` and `detectPolicyCommitment` there too (both are exported).
