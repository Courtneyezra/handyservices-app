# B3 — retire `date_question` as a Ben trigger (PRD v3 §7)

PRD build row 3. Owner-decided (`PRD-COMMS.md` §7, **[OWNER]**), so the *what* is not up for
debate; this brief is the *how*. Start commit `1fd113c3` (PRD v3). Branch `fm/date-question-r3`.

## What paid for it

`date_question` was Ben's second-largest trigger: **163 hits in 7 days** (PRD §6.2), every one a
thread where no agent ran and Ben got a flag for a question the system already has an answer to.
Dates are not Ben's (§3): before a quote the answer is "dates come with your quote"; after a quote
the answer is the date picker on the quote page.

## The §7 table, and what each row means in code

| Situation | Behaviour | Where |
|---|---|---|
| Before a quote exists | "Dates come with your quote", carry on scoping. No lead-time guess, no hold, no flag | triage lanes the Scoper; the Scoper says the line and asks its next scoping question |
| A live (unpaid) quote exists | Point at the picker | triage lanes `post_quote`; `point_to_picker` at DRAFT |
| After booking, wanting to change | **OPEN** (§13) | **interim: unchanged, still Ben** (`date_question` exception, `customer.exception` pack) |

## Where the trigger lives today (verified against the code)

- `server/spine/triage.ts:136` — `looksLikeDateQuestion(text)` pushes the `date_question`
  exception; any exception forces `lane: 'ben'` (`:139`). `decide.ts:85` flags on any exception
  regardless of pack, and `packs.ts:154` resolves `customer.exception` (no intents) on any
  exception, so a "non-Ben exception" cannot exist: the signal has to leave `exceptions`.
- `triage.ts:202` — the model prompt tells Haiku to add `date_question` for "dates or
  availability". `mergeTriage` (`:253`) drops a model-only `date_question` only when the customer
  promised more (P7).
- `server/spine/packs/customer-default.ts:20` — `exceptionsToBen` lists it; `customer.post_quote`
  spreads that list; `rules.first_contact` and `rules.followup` repeat it (nothing reads the rules
  packs' list: the only reader is the Scoper, `scoper.ts:264`).
- `server/spine/agents/scoper.ts` — `dateQuestionNeedsBen` (`:269`), the post-condition that turns
  a pack exception into a flag (`:481`), the `propose_reply` and `flag` tool descriptions,
  `CORE_FALLBACK`, `prompts/scoper.core.md` ("TWO THINGS ARE BEN'S… A DATE") and
  `prompts/scoper.post_quote.md` ("With no live quote, flag('date_question')").
- `server/evals/triage-lexicon.ts:39` — the replay lexicon raises it from the customer's text, and
  `lexiconLane` sends any exception to Ben. Eval fixtures asserting Ben for a date question:
  `date_question/dq-001, 002, 003, 005, 007`, `point_to_picker/pp-004`,
  `incident_regressions/ir-006`.

## What to build

1. **Triage.** A date question is a per-run *signal*, not an exception: `TriageResult.dateAsked`
   (additive, like `customerPromisedMore`). No tag: tags persist on the conversation and would
   mislead every later run. The exception survives on exactly one path, the §13 interim: the
   customer already has a **paid** quote (or the thread is at stage `booked` / `won`) and asks about
   a date. The model is no longer told to raise `date_question`; the merge strips a model-only
   `date_question` unconditionally (the P7 branch becomes a special case of this), so the model
   cannot force Ben for a date on its own.
2. **Packs.** `date_question` leaves `exceptionsToBen` in `customer.default` (and, by the spread,
   `customer.post_quote`), and in the two rules packs that merely mirrored it. It stays in
   `customer.exception`, which is the pack a booked-job date flag still resolves to.
   `point_to_picker` joins `customer.default`'s `allowedIntents` at the pack's existing DRAFT
   default so the §7 second row holds whichever customer pack a live-quote thread resolves
   (a `rescope` with a stage other than `quote_sent` lands on `customer.default`). No intent moves
   to SEND. `isPostQuotePack` stops keying on `point_to_picker` so the post-quote fragment and the
   levers are not bolted onto every default run.
3. **Scoper.** Prompt and tool descriptions per the §7 table. The exact line is
   *"Dates come with your quote."*; the 1–3 bubble shape is that line followed by the next scoping
   ask. The case-file render says when a date was asked and which row applies. The
   `point_to_picker` tool gate (`dateQuestionNeedsBen`) stays as the belt: no live unpaid quote,
   no picker. The Scoper may still `flag('date_question')` for the interim case only.
4. **Evals.** The replay lexicon raises `date_question` only `afterBooking`; the fixtures above
   move to the §7 behaviour, and the booked-job ones gain `quote.paid` so both the replay and the
   triage adapters see the interim.
5. **Tests** (vitest, no DB): pre-quote date question → lane not Ben, no exception, `dateAsked`,
   the run resolves `customer.default` and the Scoper; live unpaid quote → `post_quote`,
   `dateQuestionNeedsBen` false; paid quote → still Ben; "Dates come with your quote" and the
   3-bubble variant pass `date_promise`, `soft_commitment` and the full `customer.default` guard
   set; P7 promised-more + date words → `waiting_for_promised`, not a flag; the model cannot add
   `date_question` on its own.

## Hard constraints

- **Nothing about prices.** `RE_MONEY`, `money_question`, the money guards, price prompt text and
  `first-contact-ack.ts` are under review and untouched. Where one sentence carried both "money"
  and "dates", only the date half changes.
- `date_promise` (§5.2) stays in every guard set; `exceptionForGuard('date_promise')` still flags
  our own text that promises a date.
- No intent to SEND, no `app_settings` flag, no migration, no `db:push`.
- The §13 case is not built. Interim = today's behaviour for a paid/booked thread.
- Diff stays inside `triage.ts`, `types.ts`, the packs, `scoper.ts` + its two prompt files, the
  eval lexicon/adapter, the fixtures and tests. Siblings D7 and B2 are on `index.ts`,
  `comms-sweep.ts`, `request-run.ts`, `agent-runs.ts`, `runner.ts`; not touched here.

## Build gate

CLAUDE.md: zero NEW tsc errors against `1fd113c3` (diff the error lists, not the counts), the
vitest failing set unchanged plus the new tests green, esbuild bundles `server/index.ts`. This
worktree has no `.env` and no database: the model-backed eval (`eval-comms.ts --adapter spine`)
cannot run here and the DONE report says so.

## Definition of done

`B3-DONE.md` with the gate numbers as measured, the fixture changes listed, a **Not done** section
naming the §13 interim, the unrun spine eval, and anything else left, and a PR against `main`.
