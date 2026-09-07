# T18: the out-of-scope boundary is gas only

Branch `fm/scope-gas-only-t18` from `ee65a05`. 7 Sep 2026.

## The decision (the captain's, 7 Sep)

Asked directly: **"We do handle plumbing so we need to correct the out of scope trigger to gas only."**
Offered the four current decline categories (gas, roofing at height, structural, major electrical)
he chose **"Gas only, the rest is ours."** Asked how deep to go: **"Just fix the trigger now"**, no
scope document. He was told before choosing that this makes the assistant offer to quote work his
contractors may not be certified or insured for, and chose it anyway.

## The run that prompted it

`run_5fbca897-177d-4eaa-8a89-47e0156e3fa3`: a noisy bathroom extractor fan and a leaking water
heater. Triage flagged `out_of_scope` to Ben with the model's reason *"Water heater leaks are
plumbing/regulated trade outside Handy Services scope."* Nothing in the code says that: the prompt
said "work we do not do" and the model guessed what that was, and folded plumbing into "regulated
trade". PRD v3 §6.2 records `out_of_scope` as the most frequent exception by a factor of five
(253 hits in 7 days, unverified here), so the wrong boundary is Ben's largest queue item.

## Established before coding

- `out_of_scope` is raised by the **model only**: `triage.ts` prompt (`TRIAGE_SYSTEM`); `triageRules`
  never pushes it; `mergeTriage` drops a model-only `out_of_scope` on a rescope (P9) and otherwise
  keeps it. No lexicon exists for it (confirmed by grep: only `parseFlagException`'s legacy fallback
  and the types/vocab mention it).
- `regulated_trade` is raised by the rules lexicon `RE_REGULATED` =
  `gas safe|boiler|gas hob|flue|consumer unit|fuse box|rewir(e|ing)|asbestos|load-bearing|structural|rsj|chimney breast`,
  mirrored by `server/evals/triage-lexicon.ts` (`REGULATED`, plus `gas cooker`) and by the
  `capability_claim` guard's `REGULATED_WORK` nouns (`draft-guards.ts`). It does **not** catch
  plumbing or water heaters; the model conflated the two on its own.
- `DeclineReason` (`server/agents/quote-prep.ts`): `gas_work | roofing_height | structural |
  major_electrical`, with labels, templates, evidence regexes, the clerk's system prompt and tool
  schema, mirrored in `pushover.ts`, `shared/eval-types.ts`, `quote-estimator.ts`,
  `shared/intake-readiness.ts` blurb, `docs/DECLINE_CRITERIA.md`, and graded by
  `eval-cases/quote-prep-readiness.json` (`qp-dc-00[1-4]`, model-backed).
- Readers of either exception: every customer pack's `exceptionsToBen` (unchanged: they declare
  what is Ben's, and existing flags must still parse), the Scoper's flag tool description and
  `scoper.core.md` FLAG CHARTER ("out-of-scope or regulated work"), `decide.ts` (not touched:
  sibling's file), `parseFlagException` fallback (unchanged).
- Fixtures asserting `regulated_trade`: `ag-004` (boiler), `fq-004` (gas hob), `fq-006` (Gas Safe
  claim), `rs-004` (asbestos), `rs-005` (boiler swap). None assert `out_of_scope`.

## The change

1. **One path for gas: `regulated_trade`, raised by the rules lexicon first.** The rules run
   before the model and stop it running when they find an exception, so a gas job is Ben's before
   any model sees it. The prompt tells the model to raise `regulated_trade` for gas work described
   in other words. `out_of_scope` is no longer the model's to add: `mergeTriage` drops it on every
   thread (the way it already drops `date_question`), with the reason recorded. Rules never raised
   it, so for a new thread it cannot be raised at all. Existing flags keep the kind.
2. **`RE_REGULATED` narrows to gas** (and its eval and guard mirrors): gas safe, boiler, combi,
   flue, gas hob/cooker/fire/pipe/leak/meter/supply/work/engineer/appliance, smell of gas.
   Consumer unit, fuse box, rewire, load-bearing, structural, rsj, chimney breast come out.
   **Asbestos stays** in the lexicon and guard: it was a Ben flag, never one of the four decline
   categories the captain was asked about, and removing a licensed-removal flag he did not rule on
   is not mine to do. Stated in the DONE report as his to remove.
3. **Prompt**: the exceptions line names gas as the only work we do not do; the `out_of_scope`
   paragraph becomes a short SCOPE statement (gas out, everything else in, `out_of_scope` not the
   model's to add) and keeps the rescope rule. The Scoper's flag tool and FLAG CHARTER say the same
   in one clause. No knowledge base.
4. **`DeclineReason` = `gas_work` only**, with the clerk's DECLINE section rewritten: roofing,
   structural and notifiable electrical are named as work we do (visit_first when they cannot be
   priced remotely). Mirrors updated. `DECLINE_CRITERIA.md` gets a dated note, not a rewrite.
5. **Fixtures**: new `eval-cases/scope/` family with the water heater run, a plumbing job, a roofing
   job, a structural job, an electrical job (all lane `scoper`, no exception) and gas jobs (lane
   `ben`, `regulated_trade`), graded by the `replay` and `triage` adapters with no key.
   `qp-dc-002/003/004` re-expected as in-scope verdicts (model-backed, cannot be run here).
6. **Tests**: triage rules and merge (the gas pin: rules `regulated_trade` survives a model that
   says scoper; a model-only `out_of_scope` on a water heater lands the Scoper), the guard, the
   clerk's validator, and the updated prompt assertions.

## Not in this brief

Prices, money rules, the first-contact ack, tiers, send preconditions, sampler, autonomy, media,
sandbox, `decide.ts`, the SLA sweep, the exit, the desk page (T17's files). No migration, no flag.
Existing threads already flagged `out_of_scope` are not reclassified.
