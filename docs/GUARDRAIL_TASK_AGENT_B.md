# Guardrail Task — Agent B: Content Guards (Duration Claims + Policy Commitments)

You are one of three agents working IN PARALLEL in this same checkout. Stay inside your file
boundary. Do NOT git commit anything — leave changes in the working tree.

**Your files**: `server/agents/draft-guards.ts`, `server/agents/objection-levers.ts` (you own
these), plus new test scripts in `scripts/`.
**Do NOT edit**: `server/message-drafts.ts`, `server/agents/comms-sweep.ts` (Agent A owns them),
`server/agents/comms.ts` (Agent C owns it — if wiring genuinely requires a change there, note it
in your DONE file instead of editing).

## Context

The comms agent drafts customer messages; `checkDraft()` in `server/agents/draft-guards.ts` is
the deterministic guard chain that refuses dangerous content at draft time (money figures,
discounts, date promises, liability admissions, capability claims, etc.). The agent's system
prompt gets its policy from `postQuoteStandingOrders()` in `server/agents/objection-levers.ts:303`
— prompt and guards are built from shared structures so they cannot drift ("single source of
truth" pattern, see the docstring at objection-levers.ts:299).

On 27 Aug 2026, conversation with +447950552830 ("James", £992 bathroom floor quote) exposed two
content failures that NO existing guard covers:

1. **Duration claim contradicting the quote** (11:16): customer asked "is the toilet going to be
   out of use for two days?" The agent auto-sent: "It's all done in one visit James, so the
   toilet's only out of action while we're actually on site that day." The quote page said it is
   a TWO DAY job. The customer caught the contradiction himself: "It says on the quote it's a two
   day job though?" Chat contradicting the quote page destroys trust in the numbers channel.

2. **Policy commitment the agent had no authority to make** (11:38): the agent auto-sent: "that'd
   be a paid survey visit rather than a free look, the fee comes off the job if he goes ahead."
   "The fee comes off the job" is a money-adjacent commitment (a credit against the bill) that is
   Ben's to make, like discounts. There is a "VISITS ARE NEVER FREE" standing order, but no guard
   against inventing the *terms* of a paid visit.

Read the whole of `draft-guards.ts` first — match its regex-cascade style, its clause-splitting
approach (see `detectCapabilityClaim`), its error-message style (errors tell the model what to do
instead, usually "flag_for_ben"), and its incident-dated comments.

## Deliverables

### B1. `detectDurationClaim`
New detector in `draft-guards.ts`, wired into `checkDraft` like the others:
- Refuses claims about job duration / visit count / how long the customer loses use of
  something: "one visit", "done in a day", "one day job", "two days", "same day", "all done in
  one go", "only out of action while we're on site", "won't take long on the day", "in and out
  in a morning", etc.
- Treat like `detectDatePromise`: the agent may never assert duration; the quote page is the
  scope-and-logistics channel. Error text should instruct: point the customer at the quote for
  duration, or flag_for_ben if the quote seems wrong or the customer disputes it.
- Negations/questions from the agent should not trip it unnecessarily, but err on the side of
  refusing — the escalation path is cheap.
- Be careful of false positives on harmless phrases ("no rush", "take your time", "whenever you
  get a minute") — those must NOT trip the guard. Check every existing sent message in the guard
  test corpora still passes where it should.

### B2. `detectPolicyCommitment`
New detector in `draft-guards.ts`, wired into `checkDraft`:
- Refuses invented commercial terms: "comes off the job", "comes off the bill/total/price",
  "deducted from the job/final bill", "credited against", "knocked off the total if you go
  ahead", "refunded if you book", "waive the fee", plus survey/callout-fee terms stated with a
  mechanism ("the survey fee is deducted...").
- These are Ben-only, same family as discounts. Error text: flag_for_ben with the customer's
  request; do not state visit/fee terms yourself.
- Note the existing discount guard (`detectDiscountOffer`, draft-guards.ts:137-184) — extend
  coverage without duplicating it; if a phrase is already caught there, leave it there.

### B3. Standing-orders wiring
Add matching policy text to `postQuoteStandingOrders()` in `objection-levers.ts` following the
single-source-of-truth pattern (if there are shared structures the guards and prompt both render
from, use them; otherwise add a clearly-linked block): the agent must not assert duration or
visit-count, and must not state fee/credit terms for visits — both go to the quote page or Ben.

## Quality bar
- Match existing code and comment conventions exactly (incident-dated rationale comments, e.g.
  "27 Aug 2026: agent told James one visit while his quote said two days").
- Add adversarial tests in `scripts/_test-content-guards.ts` (read an existing guard test like
  `scripts/_post-quote-test.ts` or `scripts/_test-quoteprep-guard.ts` first and follow its
  style). Include: the two real incident sentences above MUST be refused; a healthy set of
  should-pass messages from the same conversation (e.g. "No need to apologise James, we see way
  worse than this every week!", "Just need a rough size for the room now") MUST pass.
- `npm run check` must pass (tsc). Run your tests and make them pass. If there is an existing
  guard test suite, run it and keep it green.

## When finished
Write a summary (detectors added, regex coverage, test results, any comms.ts wiring you need
Agent C to do) to `docs/GUARDRAIL_TASK_AGENT_B_DONE.md`. That file is your completion signal.
