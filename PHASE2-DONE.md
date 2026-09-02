# PHASE 2 / B — the Scoper — DONE

Worktree `/Users/courtneebonnick/v6-wt-worker`, branch `p2-scoper`, based on `b48178e` (comms-v3 with Phase 0 + Phase 1 + `server/spine/types.ts`).
Not pushed, not merged. No dev server, no DB reads or writes, `app_settings` untouched. Ships DARK.

## Contract changes (additive only)

- `server/spine/types.ts`: `Proposal.tags?: string[]` added. Nothing renamed, nothing removed, no existing field changed.
- `server/approver.ts`: `'agent.scoper'` added to `AUTOMATED_APPROVERS` (the design's exit approver for the Scoper at SEND tier).
- `server/llm.ts`: `SCOPER_MODEL = 'claude-sonnet-5'` exported (the reasoning tier, design §3.8). `FAST_MODEL` untouched.

## Migrations to apply

None. Phase 2/B adds no columns or tables.

## Files

New
- `server/spine/agents/scoper.ts` — `createScoperAgent(deps)` → a `SpineAgent` named `scoper`, tier `DRAFT`; `scoperAgent` is the production instance. Runs on `server/agents/runner.ts` (Sonnet 5 via `SCOPER_MODEL`, system block cached by the runner's `cache_control`, run id threaded through `runId`/`caseFileRef`/`promptHash`/`packId`). Belt and NOTHING else: `propose_reply(intent, body[], reasons[], citations?, tags?)` (one call ends the run), `flag(exception, note)`, `set_contact_name(name)`, `schedule_recontact(date, note)`, `get_quick_replies()`. No `get_thread`, no `get_customer_context`: the CaseFile is the user turn (`renderCaseFile`). Intents are validated against `pack.allowedIntents` at the tool boundary; exceptions against the fixed `ExceptionKind` vocabulary; tags against `PROPOSABLE_TAGS` (`needs_quote`, `trust_concern`). Every body runs `checkDraft` (money, discount, date, duration, capability, liability, policy terms, capitulation, unseen-implication, voice) plus the chat-voice guard and a one-question rule before it can become a proposal.
- `server/spine/prompts/scoper.core.md` — the standing orders, 7.5k chars (~1.9k tokens; target ≤ 2.5k, legacy ~6k tokens): behaviour, hard rules, flag charter, draft-and-flag, complaints, first reply, media order, `needs_quote` via `quote_on_its_way`, Ben in the thread, customer tags, deliverability-first, greet once, names, belief hygiene, inclusion questions, "not right now", format.
- `server/spine/prompts/scoper.post_quote.md` — the post-quote fragment (corpus facts, money/dates post-quote, no graceful exit, draft-and-flag both ways). Selected when the pack is `customer.post_quote` / stage `quote_sent` / allows `answer_from_quote` or `point_to_picker`. The lever vocabulary, price bands, duration and visit-terms rails are rendered from `server/agents/objection-levers.ts` (single source of truth, unchanged) by `renderLeverVocabulary()`.
- `server/spine/config.ts` — `getSpineConfig()` reads `app_settings.spine`, default `{ enabled: false, agents: {}, shadow: false }`, fail-closed on any error, `SPINE_CONFIG_OVERRIDE` env seam, `useProcessLocalSpineConfig()` for suites (same shape as `comms_agent`). `isSpineEnabled('scoper')`.
- `server/spine/agents/index.ts` — the registry: `SPINE_AGENTS`, `getSpineAgent(name)`, `registerSpineAgent(agent)`; re-exports the Scoper and the adapter.
- `server/spine/agents/scoper-adapter.ts` — the thin seam: `runScoperIfEnabled({ caseFile, triage, pack, runId? })` returns `{ skipped }` while `spine.enabled` is false, else a legacy-shaped `{ actions[], autosent: false, proposal, runId }` via `proposalToLegacyOutcome`. `runCommsAgent` is untouched and still the live path.
- `server/spine/agents/scoper.test.ts` — 18 tests: the eight synthetic case files with a stubbed runner (no network), plus tool-boundary and prompt/contract tests.

Modified: only the three additive edits above. `server/agents/comms.ts` is untouched (the split is a copy into the new prompt files, not a move; the legacy prompt keeps running until Phase 3).

## Verification

- **tsc gate**: baseline (`b48178e`, throwaway worktree, private tsbuildinfo) 1,883 errors → after **1,883 errors, zero new** (comparison strips `(line,col)` and normalises the relative-path prefix the two worktree locations render differently). One new error appeared on the first run (`[...set]` under the repo's ES5 target in scoper.ts) and was fixed with `Array.from` before commit.
- **vitest**: baseline 42 failed / 608 passed / 8 skipped (29 files) → after **42 failed / 626 passed / 8 skipped (30 files)**; the same 42 (eve-pricing-engine 37, segment-classifier 4, contractor-pay 1). 18 new tests green.
- **esbuild**: `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external` succeeds (3.6 MB); `server/spine/agents/index.ts` bundles on its own too.
- The eight cases and what each proves structurally (the stub plays a competent model; what is asserted is the belt): (1) first contact with photos → `ask_gap`, placeholder name surfaced in the case file, run id + `persist:false` reach the runner; (2) mid-scope → `quote_on_its_way` carries `tags: ['needs_quote']`; (3) money question → a `£300` body and a `10% off` body are both refused at the tool, and the flag is attached structurally even though the script never called `flag`; (3b) model that proposes nothing → flag-only proposal; (4) date question → `point_to_picker` refused with no live quote and a date-promise body refused, flag attached; with a live quote `point_to_picker` passes and no flag is forced; (5) complaint → liability-admitting apology refused, `flag('complaint')`, bodies pass `detectLiabilityAdmission`; (6) returning customer → pushname and "Just Me" refused by `set_contact_name`, stated "Mike" carried on `Proposal.contactName`; (7) opted-out → `null` before any model call (tag or triage exception); (8) post-quote objection → graceful exit refused (capitulation), discount refused, past date refused, recontact PROPOSED with a figure-free message carrying the quote link and the run id, flag + content-free half returned.
- NOT verified: a real model call, a real `nudge_queue` write, prompt-cache hit rates, the live `quick_replies` read. All forbidden from this pane.

## Not done, and why

- **No live wiring.** Nothing calls `scoperAgent.run` on a customer thread: `requestRun`, `buildCaseFile`, `triage`, `resolvePack`, `checkProposal`, `decide`, `exit` are pane A's (`SpineApi`). The adapter refuses while `spine.enabled` is false, so even an early wire-up does nothing.
- **Media is text-only in the user turn.** The runner's `goal` is a string; the CaseFile's `media[]` is rendered as ids + descriptions (Phase 4's `describe_video` fills the descriptions). Image blocks would need a runner change (pane A) and are not needed for DRAFT tier.
- **`quote_on_its_way` must be in `customer.default.allowedIntents`** for the quote-clerk hook to fire. `types.ts` lists it under the rules layer and §3.4 lists it under `rules.first_contact`; the brief wants the Scoper to propose it. My test pack includes it; pane A's pack must too, or the belt will refuse it (by design).
- **`holding` is the nominal intent of a flag-only proposal** (`body: []`). If pane A's pack omits `holding`, the spine should treat a proposal with an empty body as flag-only regardless of intent.
- **Guard bridge**: pane A's `server/spine/guards.ts` does not exist in this worktree, so the tests run the `draft-guards.ts` detectors directly (the same functions the bridge will wrap).
- The legacy `SYSTEM` in `comms.ts` is NOT shortened or edited (the brief says split into files; the copy is split, the legacy string stays as the live prompt until Phase 3 deletes `comms.ts`).

## Decisions the design left open

- **Structural flags.** A triage exception in `pack.exceptionsToBen` is ALWAYS a flag on the returned proposal, attached after the run if the model forgot (`autoFlagNote` from triage reasons). The one carve-out: `date_question` when a live unpaid quote exists and the pack allows `point_to_picker`.
- **The model still runs on exception threads** (rather than short-circuiting) so it can propose the content-free half ("draft and flag"). The belt guarantees the half is content-free.
- **Side effects are carried, not written.** `set_contact_name` and tags land on the Proposal (`contactName`, `tags`) for the spine to store; the agent writes nothing. `schedule_recontact` is the deliberate exception per the brief ("PROPOSE into nudge_queue as today"): a `proposed` row, lever `recontact`, `runId` stamped, with a fixed figure-free message carrying the quote link. Injectable for tests.
- **Runner failures degrade safely**: a thrown runner returns null, or a flag-only proposal when triage had a Ben exception.
- **Body limits**: max 3 bubbles, hard ceiling 40 words per bubble (prompt asks for 25), one `?` per reply, chat-voice guard. `checkDraft` is called with `intent: 'price_objection'` when the customer's last message reads as one (`detectPriceObjection`), never from the model's declared intent.
- **Case file render omits the quote total** on purpose: the belt cannot say it, so the model never sees it. Lines, viewed, expiry and paid state are given.
- **Approver**: `agent.scoper` added now so `Decision { kind:'send', approver }` can name it when Phase 3 promotes an intent; nothing sends under it yet.
