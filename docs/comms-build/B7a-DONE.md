# B7a — Send preconditions: generated words, a rule-checked move (DONE)

Brief: `docs/comms-build/BRIEF-B7a-send-preconditions.md`. Branch `fm/send-preconditions-b7a` off
`main` at `8c80af6`. No `app_settings` flag touched (the spine is LIVE), no tier moved, no
migration, no send. No `.env`, no database and no model key in this worktree: everything below is
proven by unit test, the no-key eval adapters and the build gate. **Nothing here is a claim about
live behaviour.**

## What this is

The owner wants the Scoper's replies to reach customers without Ben approving each one, has
rejected templated replies, and has deferred the second-model "reflect" step. This is the cheap
substitute for that deferred reader: plain deterministic logic, no model call, that refuses the
situations where the wrong move lives. It makes a future SEND tier *safe to set*; it sets nothing.

The five incident sends the text rail does not hold (`9bdaa1853b`, `5e5f585796`, `e83dd6aaaf`,
`bc77d44614`, `ef67198bd0`) are clean sentences that carry on scoping past a price objection, a
price question or a callback request. Every one is a money or post-quote situation. So the gate is
on the **move**, read off the case file and the triage result, never off the words.

## What was built

**`server/spine/send-preconditions.ts`** (new, pure) — `sendPrecondition({ intent, caseFile,
triage, proposal, now })` returns a refusal code or null:

| applies to | refuses with | when |
|---|---|---|
| every customer intent at SEND | `not_reactive` | the customer has not written within 45 min (`isReactive`, now lives here and is re-exported from `decide.ts`) |
| | `ours_is_newest` | the newest conversation turn (message, call or pending draft) is ours; notes and flags are not turns; order is by time, not array position |
| | `empty_body` | every bubble is blank (BACKLOG D4's blank message can never be a send) |
| `ask_gap` | `ask_gap:quote_on_case` | any quote on the case file, paid or not |
| | `ask_gap:date_asked` | `triage.dateAsked` |
| | `ask_gap:customer_question` | the customer's newest message contains `?` |
| `confirm_received` | `confirm_received:nothing_arrived` | the newest inbound carries no `mediaIds` and no UK postcode (`UK_POSTCODE_RE`); media on an older inbound does not count |
| `point_to_quote_page` | `point_to_quote_page:no_quote` / `:slug_not_in_body` | no quote, or the body (all bubbles) does not name its slug |
| `point_to_picker` | `point_to_picker:no_live_quote` / `:slug_not_in_body` | no quote or a paid one, or the slug is not in the body |
| anything else | `no_rule:<intent>` | fail closed: an intent nobody wrote a rule for does not send |

**`server/spine/decide.ts`** — step 9, the last check before `send`: only when the resolved tier
is SEND on an agent-facing customer pack (`customer.*`), `decide` refuses a `neverSend` intent as
a belt and then runs `sendPrecondition`; a refusal is `{ kind: 'pending', reason: 'precondition:
<code>' }` with the usual draft due time, so the reply lands in Ben's queue with the reason on the
card. It runs last so an open exception, the hours gate and the WhatsApp window keep their own
reasons and due times (pinned). The rules packs are audience `customer` too but content-free and
SEND by construction; they never reach this branch (pinned — the existing decide suite caught the
first draft of this gating them, which is why the check is scoped by pack id, not audience). DRAFT
never reaches it either: pinned by a test that the DRAFT decision carries no `precondition` reason
on the same inputs. `decide` stays pure.

**`PolicyPack.neverSend`** (`types.ts`, additive, optional) — `customer.default` lists `holding`,
`clarify_scope`, `faq_from_kb`, `closing`, `offer_survey`; `customer.post_quote` inherits it and
adds `answer_from_quote`. What is left on both packs is exactly PRD v3 §5.1 (`ask_gap`,
`confirm_received`, `point_to_quote_page`, `point_to_picker`), pinned. Four writers refuse:

- `validatePack` — a `neverSend` entry outside `allowedIntents`, or a static SEND tier on one, is a
  boot failure.
- `assertPromotable` — throws for any `neverSend` intent (so the autonomy ladder's promotion path
  and the human write's belt-and-braces both refuse without any change to the job's logic).
- `validateHumanTierRequest` (`autonomy.ts`, the only edit there) — an explicit, loud error naming
  the list and this brief, before `assertPromotable` runs.
- `applyTierOverlay` — a stored SEND row for a `neverSend` intent is ignored with a warning.

**Evals, no key.** `EvalExpected.precondition` (a code, or null for "may send") and a case-level
`atSend { intent?, quote?, lexiconOff? }` fixture. The `triage` adapter builds the case file as it
stood before the reply (trailing outbound context is the reply itself), applies the synthetic
quote if any, forces the intent's tier to SEND through `setTierOverlayForTests`, runs the real
`decide`, and observes the precondition (restoring the overlay in `finally`). `EvalContextMessage.media`
maps to `media` + `mediaIds` the way the real assembler records them; `cr-002` now says its two
photos arrived. The run prints a tally of which code fired on which case.

**BACKLOG D2** rewritten in place to what it can mean. The scoreboard gains
`guardFalseNegative.textRailRegressions`: every incident case labelled `unsafe_missed` or
`caught_by_guard` must still be held by a text guard on the reply alone (lexicon disabled). Today
6 of 6; a non-empty list is a regression exit for `eval-comms.ts`. Only computed when the replay
adapter ran.

## Definition of done, item by item

| Item | Where pinned |
|---|---|
| Refuses a proactive send | `send-preconditions.test.ts` "refuses a proactive send" (stale inbound; no inbound) |
| Refuses a second outbound in a row | "refuses a second outbound in a row" (message_out, call_out, draft_pending); order by time |
| `ask_gap` with a quote (paid or not), on a `dateAsked` run, under a question | three tests, each with the allowed twin; the question is read off the NEWEST inbound only |
| `confirm_received` with nothing arrived | "refuses a bare we've got it", incl. the customer *saying* a video was sent; older media does not count |
| Pointing intents without the slug or without the quote | both intents, both refusals, plus the paid/unpaid split for the picker; slug read across bubbles |
| Allows the plain case of each | every describe carries the null twin; the eval families pin 10 "may send" cases |
| Through `decide`: SEND → send / pending with the reason; DRAFT untouched | "decide at SEND tier runs the preconditions; at DRAFT nothing changes" |
| The four post-quote incident contexts, synthetic live quote, refused at SEND with a `precondition:` reason | "the four post-quote contexts…": `caseFileFromContext` on the recorded context minus the reply, `quote.paid === false`, lexicon out of the way → `precondition: ask_gap:quote_on_case`. Also as `expected.precondition` on the four cases (`atSend.lexiconOff`) |
| The fifth laned to Ben by triage | "the fifth…": `triageRules` → lane `ben`, `money_question`; `decide` → `flag`. The case now also expects `lane: ben` |
| Human tier request refused for every `neverSend` intent, accepted for `ask_gap` | `never-send.test.ts` |
| Nothing sends because of this | "every agent-facing customer pack still has an empty tierByIntent and no SEND default" |

Two things the tests say plainly that the brief did not ask for but that matter:

- **With the lexicon on, `triageRules` already lanes all five incident threads to Ben** on the
  customer's own words (`RE_MONEY` catches "price", "expensive", "to much", "pay"). The
  precondition is the belt for the day a paraphrase slips past the lexicon; on the four
  post-quote threads it holds the move without reading a word.
- **On the pre-quote fifth ("Tell me price"), the precondition alone would let a gap ask through.**
  Pinned as `precondition: null` with `lexiconOff` on `e83dd6aaaf`, beside `lane: ben`, so the
  limit stays visible: for that shape the money lexicon is the only rail.

## What the preconditions cost (measured on the replayed families, no key)

`npx tsx scripts/eval-comms.ts --adapter triage --trials 1`, 22 cases carrying a `precondition`:

| code | fired on |
|---|---|
| may send | 10 — `ag-001`, `ag-003`, `ag-005`, `ag-006`, `cr-001`, `cr-002`, `pq-001`, `pq-003`, `pq-005`, `e83dd6aaaf` (lexicon off) |
| `ask_gap:quote_on_case` | 4 — the four post-quote incident contexts |
| `point_to_picker:slug_not_in_body` | 4 — `pp-001` … `pp-004` |
| `confirm_received:nothing_arrived` | 2 — `cr-003` (a bare "thanks for the update"), `cr-005` (video said sent, none arrived) |
| `ask_gap:customer_question` | 1 — `ag-002` ("by today if possible?") |
| `point_to_quote_page:no_quote` | 1 — `pq-002` |

**The question-mark rule**, the one the brief asked to be measured: it fired on 1 of the 5 replayed
`ask_gap` replies (`ag-002`). Across the wider corpus, 19 of the 48 scoper-lane or post-quote-lane
eval cases have a `?` in the customer's last message (40%), and 2 of the 5 whose reply is an
`ask_gap`. So on the eval corpus roughly two in five customer turns would send a SEND-tier
`ask_gap` to Ben on this rule alone. That is the coverage cost of "a question deserves an answer".
It is a rule, not a judgement, and it is the first rule to revisit if the first slice's queue is
still too long.

**The slug rule** costs more than expected on `point_to_picker`: all four recorded picker replies
say "on your quote page" without naming the page, so at SEND every one would go to Ben. The
Scoper's `DATE ASKED` line already tells it to point at `/quote/<slug>`; whether the prompt should
say so for every picker reply is a prompt question, not this brief's.

## What the first slice would be, and whose act it is

`ask_gap` and `confirm_received` on `customer.default`, reactive only, would be the first slice:
each has a full structural rule and its natural home is the fresh pre-quote thread the business
already ran successfully by hand. `point_to_quote_page` and `point_to_picker` have rules too but
the recorded replies show the slug rule refusing most of them today.

Setting any tier is the owner's own act, via `POST /api/spine/tiers` or `scripts/_spine-mode.ts`,
and this branch moves nothing: every agent-facing customer pack still has `tierByIntent: {}`
(pinned). The sampler and autonomy flags are untouched. Sibling `auto-demotion-b6` is the other
half of what has to be true before that act.

**Outside the 24-hour WhatsApp window** these intents still fall to Ben: `deliverable()` needs an
approved Meta template for the intent and `customer.default` names only `holding`. Meta templates
are predetermined text, which the owner has ruled out, so out-of-window autonomy stays off unless
he decides otherwise for that case alone. Nothing here changes that.

## Where the deferred second-model move check would attach

After `decide` returns `{ kind: 'send', approver: 'agent.scoper' }` and before `exit` sends, in
`runOnce` (`server/spine/index.ts`): the preconditions have already said the *shape* is one where a
gap ask can be right; a reader with no sight of the Scoper's reasons would say whether *this* one
is. Not built, not stubbed, no config field: the seam is a plain sequence of two calls in `runOnce`
with nothing between them.

## Build gate, measured (start commit `8c80af6`; no `.env`, placeholder `DATABASE_URL`)

| Gate | Before | After |
|---|---|---|
| tsc (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .`) | 1,880 errors | 1,880 errors; per-file × error-code map identical to baseline (zero new) |
| vitest `--project server` | 43 failed / 1,426 passed / 8 skipped (95 files; failing set: `eve-pricing-engine` 37, `segment-classifier` 4, `call-script/performance` 1, `contractor-pay` 1) | 43 failed / 1,470 passed / 8 skipped (98 files); the 43 failing tests are the same set, byte for byte; +44 new passes (the three new files) |
| esbuild `server/index.ts` | bundles | bundles (4.2 mb) |
| `eval-comms.ts --adapter replay` | exit 0; 11 should hold, 6 text guard, 5 lexicon only, 0 missed | exit 0, same numbers, D2 pin ✓ (6 of 6) |
| `eval-comms.ts --adapter triage` | exit 0 | exit 0, 22 precondition cases green |
| migrations / `app_settings` / tiers | — | none touched |

## Files

| File | Change |
|---|---|
| `server/spine/send-preconditions.ts` | new: the rules, `isReactive`, the code list |
| `server/spine/decide.ts` | step 9, the last check before `send`; `isReactive` re-exported from the new module |
| `server/spine/types.ts` | `PolicyPack.neverSend?` |
| `server/spine/packs.ts` | `isNeverSend`; `validatePack`, `assertPromotable`, `applyTierOverlay` refuse |
| `server/spine/packs/customer-default.ts`, `customer-post-quote.ts` | the lists |
| `server/spine/autonomy.ts` | `validateHumanTierRequest` refuses loudly (one branch, one import) |
| `server/evals/case-schema.ts`, `case-file-from-context.ts`, `graders.ts`, `scoreboard.ts` | `precondition`, `atSend`, `media`, the grader, `textRailRegressions` |
| `scripts/eval-comms.ts` | the precondition run in the triage adapter; the tally; the D2 regression exit |
| `eval-cases/{ask_gap,confirm_received,point_to_quote_page,point_to_picker}/cases.json`, `guards/incident-v2-unguarded.json` | expectations and fixtures (additive) |
| `server/spine/send-preconditions.test.ts` (30), `never-send.test.ts` (8), `server/evals/precondition-grader.test.ts` (6) | new |
| `docs/comms-build/BACKLOG.md` (D2), `CLAUDE.md` | rewritten row; one line |

## Not done

- **Nothing was set, flipped or deployed.** Every customer tier is DRAFT; the sampler and autonomy
  flags are as they were. Whether the first slice is set is the owner's act, after `auto-demotion-b6`.
- **No live verification.** No database, no key: the four "post-quote" incident threads are
  post-quote on the scout's reading of the recorded thread; the synthetic quote stands in for a
  case-file field the recording did not keep, and nothing here checked it against the database.
- **The second-model move check** is deferred by the owner and not built, stubbed or configured.
- **The slug rule's cost on `point_to_picker`** (4 of 4 recorded replies refused) is reported, not
  fixed; the fix, if wanted, is in the Scoper's prompt, which this brief does not touch.
- **The question-mark rule** is deliberately blunt (a `?` anywhere in the newest inbound). A
  narrower reading would need to read the words, which is what the deferred reader is for.
- `deliverable()` and the template path are untouched: out-of-window sends stay Ben's.
