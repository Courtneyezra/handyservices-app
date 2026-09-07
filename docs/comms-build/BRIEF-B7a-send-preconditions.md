# B7a — Send preconditions: generated words, a rule-checked move

## The decision that paid for this brief

Three decisions, one owner.

PRD v3 §5.1 (`docs/comms-build/PRD-COMMS.md:169-171`): what may eventually send with no approval —
ask for a photo, video or postcode · ask a scoping question about the job · acknowledge what
arrived · point at the quote page. §5.2: what may never send at any level — any figure not from a
lookup, any date or time, any duration, any commitment or promise, any admission of fault, any
claim we cannot evidence.

6 Sep 2026, the owner, on §5.3 option (a): *"We can't have predetermined templates as this would
make the conversation unnatural."* Templates are rejected. **The words stay generated.**

7 Sep 2026, the owner: *"We dont need it queued it can send directly. if outputs moving forward
need improving we we add a secondary llm to reflect."* The second-model move check is **deferred**.
He said "build" to this task.

So this is the cheap substitute for the reader he deferred, and it is what makes deferring it
reasonable: plain deterministic logic, no model call, that refuses the situations where the wrong
move lives.

## Why the move, not the words

Read `eval-cases/guards/incident-v2-unguarded.json` first. The five sends the text rail does not
hold (`9bdaa1853b`, `5e5f585796`, `e83dd6aaaf`, `bc77d44614`, `ef67198bd0`) each carry
`guardsMustNotTrip: true` and `mustFlag: true`. Their text is clean: a postcode ask, a garden-access
question, a loft question, a re-scope offer, a call offer. What is wrong is the **move**: each
ignores a price objection, a price question or a callback request in the customer's turn. No
reply-text guard can hold a clean sentence, and one that did would fail the case. BACKLOG D2, as
written, asks for a property the cases forbid.

Every one of the five is a money or post-quote situation. A scoping question on a fresh pre-quote
thread, which is what the business did successfully before any of this, is not where they live.
The rules below fence exactly that boundary.

## What to build

### 1. Send preconditions (pure, deterministic, no model)

New `server/spine/send-preconditions.ts`:

```ts
export function sendPrecondition(input: { intent: string; caseFile: CaseFile; triage: TriageResult; proposal: Proposal; now: Date }): string | null
```

Returns the refusal reason (a short code) or null. `decide` calls it **only** when the resolved
tier is SEND on an agent-facing customer pack (`customer.*`; the rules packs are content-free and
SEND by construction, and must be untouched), as the last check before `send`; a non-null reason returns
`{ kind: 'pending', reason: 'precondition: <code>' }`. DRAFT-tier behaviour is untouched, so
nothing changes anywhere until a person sets a tier.

The rules, all read off the case file and the triage result, never off the words:

| applies to | rule | why |
|---|---|---|
| every customer intent at SEND | the pass is reactive (`isReactive`, 45 min since the last inbound) | the first slice answers; it never speaks first |
| every customer intent at SEND | the newest conversation item is not our own outbound (message, call or pending draft) | never two of ours in a row without the customer writing between |
| every customer intent at SEND | the body is not empty | BACKLOG D4's blank message can never be a send |
| `ask_gap` | no quote on the case file at all, paid or not | four of the five known move failures are post-quote money shapes |
| `ask_gap` | `triage.dateAsked` is false | a date ask deserves "dates come with your quote", a different reply |
| `ask_gap` | the last inbound body contains no question mark | a question deserves an answer, not a gap ask; costs coverage, measured in the DONE report |
| `confirm_received` | the last inbound carries media or matches `UK_POSTCODE_RE` | acknowledge something that arrived, checked by the fact that it arrived; never a bare "we've got it" |
| `point_to_quote_page` | a quote exists and the body contains its slug | the reply must actually point at the page |
| `point_to_picker` | a quote exists and is unpaid, and the body contains its slug | same; the Scoper's tool gate already refuses the intent otherwise |
| any other intent | refused (`no_rule`) | fail closed: an intent nobody has written a rule for does not send |

### 2. The `neverSend` list

`PolicyPack` gains one additive field, `neverSend`. `customer.default` and `customer.post_quote`
list `holding`, `clarify_scope`, `faq_from_kb`, `closing`, `offer_survey`, `answer_from_quote`.
`assertPromotable` and `validateHumanTierRequest` refuse SEND for anything in it, so a tier act
cannot release the empty-body `holding` path (BACKLOG D4) or a scope statement. `applyTierOverlay`
ignores a stored SEND row for such an intent, and `decide` refuses it as a belt. `validatePack`
checks the list is a subset of `allowedIntents`.

This is the guard on the owner's own future config act, so it refuses loudly, never silently.

### 3. BACKLOG D2, rewritten to what it can mean

Update the D2 row in this PR; do not delete it. New "done when": the scoreboard pins that every
incident case the text rail does hold stays held with the lexicon disabled (true today; stop it
regressing); and the five are refused before the send by the preconditions, four of them via a
live quote on the case file, with the fifth laned to Ben by the money lexicon. Proven by unit test
using the case-context helper plus a synthetic quote.

### 4. Evals

Extend the eval case schema with a `precondition` expectation (the refusal code, or null for "may
send"), and grade it in the adapter that runs the real `decide` with no model, by forcing the
intent's tier to SEND through `setTierOverlayForTests`. That proves every rule, both ways,
**without a key**, over the existing `ask_gap`, `confirm_received`, `point_to_quote_page` and
`point_to_picker` families plus the five incident cases.

## Hard constraints

1. **Nothing sends because of this.** Every customer pack's `tierByIntent` stays empty, no
   `app_settings` flag moves, no tier changes. Pinned by test.
2. **Do not build the second-model move check.** No judge, no stub, no advisory mode, no config
   field for it. Leave the seam clean and say in the DONE report where it would attach.
3. **The words are not touched.** No template, no fixed prefix, no rewriting of any body. The
   content rail runs as today and is not widened.
4. `decide` stays pure and so does the precondition function.
5. Do not touch the detectors, the sampler, the autonomy job's decision logic, or the tier route.
   The only edit in `autonomy.ts` is `validateHumanTierRequest` refusing a `neverSend` intent.
6. No migration.
7. Do not touch: the first-contact ack, anything about customer prices or money, the sampler's or
   verifier's own logic, the comms sandbox, the cadence work.

## Build gate (CLAUDE.md)

- Zero NEW tsc errors against the start commit `8c80af6` (measured: 1,880 pre-existing;
  `NODE_OPTIONS=--max-old-space-size=8192`).
- vitest failing set unchanged (measured with a placeholder `DATABASE_URL`: 43 tests across 4
  files), plus the new tests passing. Judge by the failing-set diff, never the count.
- `npx tsx scripts/eval-comms.ts --adapter triage` and `--adapter replay` exit 0.
- esbuild bundles `server/index.ts`.
- Never `db:push`; no migration; no flag; no tier.

## Definition of done

- `sendPrecondition` refuses: a proactive send; a second outbound in a row; `ask_gap` with a quote
  on the case file, on a `dateAsked` run, or under a customer question; `confirm_received` with
  nothing new arrived; `point_to_quote_page` and `point_to_picker` without the slug or without the
  quote. And allows the plain case of each. All pinned by test.
- The four post-quote incident contexts, given a synthetic live quote, are refused at SEND tier by
  `decide` with a `precondition:` reason; the fifth is laned to Ben by triage.
- A human tier request is refused for every `neverSend` intent and still accepted for `ask_gap`.
- The DONE report states what the first slice would be and that setting it is the owner's own
  act; how often the question-mark rule fired across the replayed families (the coverage cost);
  and that outside the 24-hour messaging window these intents still fall to Ben because that path
  needs an approved template.
- No `.env`, no database, no model key: verified by unit test and the build gate only, with no
  claim about live behaviour.
