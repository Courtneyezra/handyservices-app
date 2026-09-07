# T18 DONE: the out-of-scope boundary is gas only

Branch `fm/scope-gas-only-t18` from `ee65a05`. 7 to 8 Sep 2026. Brief: `BRIEF-T18-scope-gas-only.md`.

## What the captain decided

**"We do handle plumbing so we need to correct the out of scope trigger to gas only."** Of the four
decline categories (gas, roofing at height, structural, major electrical): **"Gas only, the rest is
ours."** Depth: **"Just fix the trigger now"**, no scope document. He was told beforehand that this
makes the assistant offer to quote work his contractors may not be certified or insured for, and
chose it.

## What the new boundary lets the assistant do (stated once, for the record)

With this branch the desk will **scope, ask about, and hand to the clerk to price**, with no flag to
Ben until the quote itself reaches him on the price screen:

- every kind of plumbing: leaks, taps, toilets, **water heaters and hot water cylinders**, radiator
  moves and re-plumbs;
- **roofing and work at height**: ridge tiles, chimney stacks and repointing, anything needing
  scaffold;
- **structural alterations**: load-bearing wall removal, lintels and RSJs, chimney breasts;
- **notifiable electrical**: consumer unit and fuse box replacement, rewires, new circuits.

The clerk can no longer propose a polite decline for any of those (`DeclineReason` is `gas_work`
only), and the `capability_claim` guard no longer holds a reply that says "yes, we can do the
consumer unit / take the wall down / do the rewire". The Scoper's standing orders say the same
boundary in one clause. If he wants to narrow later, these are the four lines to narrow.

What is **still Ben's**, and how it gets there:

- **Gas work**, by ONE path: the rules lexicon `RE_REGULATED` in `server/spine/triage.ts`, which
  runs before the model and stops the model running. It raises `regulated_trade`. Words: gas safe,
  boiler, combi, flue, gas hob / cooker / fire / pipe / pipework / leak / meter / supply / work /
  engineer / appliance / central heating, smell of gas. The triage prompt tells the model to raise
  `regulated_trade` for gas described in other words, so the model is a second detector on the
  same path, never a second path.
- **Asbestos removal**, also `regulated_trade`. It was a Ben flag before, never one of the four
  decline categories he was asked about, so I did not remove it. **His to remove**: one word in
  `RE_REGULATED`, its mirror in `server/evals/triage-lexicon.ts`, and the guard's `REGULATED_WORK`.
- The guard (not triage) also still holds an affirmative about solar panels, F-gas / air
  conditioning and oil tanks or boilers, as it did before. Same reasoning: not asked, not moved.

## The one outcome this task must not produce, pinned

A gas job cannot reach the Scoper:

- `triageRules` raises `regulated_trade` for every gas phrasing in the lexicon and lanes `ben`
  before the model is called (`server/spine/triage.test.ts`, "T18 scope is gas only").
- `mergeTriage` never removes a rules exception, so a model answer of lane `scoper`, no exceptions,
  still merges to `ben` with `regulated_trade` ("PIN: a gas job never reaches the Scoper whatever
  the model says").
- Fixtures `sc-006` (boiler service), `sc-007` (smell of gas at the meter), `sc-008` (water heater
  plus a gas hob) and the existing `ag-004`, `fq-004`, `fq-006`, `rs-005` all grade `lane ben`,
  `mustFlag`, `regulated_trade` on the `triage` and `replay` adapters with no key.

## `out_of_scope` after this branch

- **The model can no longer add it.** `mergeTriage` drops a model-only `out_of_scope` on every
  thread, not only a rescope, and records the reason on the run
  (`model out_of_scope dropped: scope is gas only …`). The prompt says "out_of_scope is NOT yours to
  add", the way it already says so for `date_question`. The rules never raised it, so on a new
  thread nothing raises it. The lane falls back to the rules' lane (the water heater run lands the
  Scoper: fixture `sc-001`, and the "full triage with a model that says out_of_scope" test).
- The kind stays in the vocabulary, the types, the packs' `exceptionsToBen` and
  `parseFlagException`'s fallback, so every flag already on the board still reads back correctly.
- **Not reclassified**: threads already flagged `out_of_scope` (PRD §6.2 counted 253 hits on 6
  threads in 7 days, unverified here). Whether those six get a Scoper pass now is **the captain's
  call**; a `manual` run on each would do it, nothing automatic does.

## Why the model got it wrong, for the record

`out_of_scope` was raised by the model alone, from the prompt's phrase "work we do not do", with no
lexicon or list behind it. On `run_5fbca897-177d-4eaa-8a89-47e0156e3fa3` it wrote *"Water heater
leaks are plumbing/regulated trade outside Handy Services scope"*: it inferred the business's scope
and folded plumbing into "regulated trade". `RE_REGULATED` never matched plumbing; the model did
that on its own. The fix is that the prompt now states the boundary as a closed sentence and the
model's `out_of_scope` is discarded, so the only scope judgement in the pipeline is a regex Ben
can read.

## How to check this (copy and paste)

You need the repo on this branch, your usual `.env`, and an admin login. Everything is on
`/admin/sandbox`; nothing here can reach a phone.

```bash
git fetch origin && git checkout fm/scope-gas-only-t18 && npm run dev
```

Open http://localhost:5001/admin/sandbox. If a thread is there, press **Reset thread**.

1. Click **Inbound WhatsApp**, keep the defaults, press **Open through this door**. The first pass
   lands `lane rules` (first contact) and the rules-layer ack is mirrored.
2. Type as the customer:
   `The extractor fan in the bathroom is really noisy and the water heater under the kitchen sink is leaking. Can you come and have a look at both?`
3. What you should see on the right, in the newest pass: the triage line says **`lane scoper`**
   with **no exceptions**, and the Scoper's proposal is a dashed amber NOT SENT bubble asking about
   the fan or the leak. Before this branch the same message read `lane ben`, `FLAG for Ben —
   out_of_scope`, and no reply. If the model still returns `out_of_scope`, the triage `reasons`
   list shows *model out_of_scope dropped: scope is gas only* and the lane is still `scoper`.
4. Now type: `Can you service the boiler while you are here?`
   The triage line says **`lane ben`**, exceptions **`regulated_trade`**, reason *gas lexicon
   (regulated_trade): the one work we do not do*, and the decision is **FLAG for Ben —
   regulated_trade**. No Scoper proposal. That is the one path for gas, and it ran before the model.
5. Optional, the moved trades: **Reset thread**, open the door again, and type
   `We want the load-bearing wall between the kitchen and dining room knocked through with an RSJ`
   or `Old fuse box needs replacing with a consumer unit and a rewire upstairs`. Both now land
   `lane scoper` with no exception. Before, both were `regulated_trade`.

Without a key: `npx tsx scripts/eval-comms.ts --adapter triage --family scope` prints
`8 green · 0 red`.

## What shipped

- `server/spine/triage.ts`: `RE_REGULATED` narrowed to gas (plus asbestos); the rules reason names
  the gas lexicon; `TRIAGE_SYSTEM` has a SCOPE sentence and "out_of_scope is NOT yours to add";
  `mergeTriage` drops a model-only `out_of_scope` on every thread and records why.
- `server/evals/triage-lexicon.ts`: `REGULATED` mirrors the new lexicon (the replay adapter's).
- `server/agents/draft-guards.ts`: `REGULATED_WORK` loses consumer unit, fuse box, rewire,
  load-bearing, structural, rsj, chimney breast; gains gas leak / engineer / appliance.
- `server/spine/agents/scoper.ts` flag tool description and `server/spine/prompts/scoper.core.md`
  FLAG CHARTER: gas is the only work we do not do; plumbing, roofing, structural and electrical are
  ours.
- `server/agents/quote-prep.ts`: `DeclineReason = 'gas_work'`; labels, templates, evidence,
  validator messages, tool schema enums and the clerk's DECLINE section rewritten (roofing,
  structural, electrical named as work we do; `visit_first` when unpriceable remotely). Mirrors:
  `server/pushover.ts`, `shared/eval-types.ts`, `shared/intake-readiness.ts` blurb,
  `server/agents/quote-estimator.ts`.
- `docs/DECLINE_CRITERIA.md`: dated note at the top; the 29 Aug table kept as the record.
- Fixtures: new `eval-cases/scope/cases.json` (8 cases: the water heater run, plumbing, roofing,
  structural, electrical → `scoper`, no exception; boiler service, smell of gas, water heater plus
  gas hob → `ben`, `regulated_trade`). `eval-cases/quote-prep-readiness.json`: `qp-dc-002/003/004`
  re-expected as `visit_first` / `visit_first` / `needs_info` in family `near-miss` (model-backed,
  not run here, see Not done).
- Tests: `server/spine/triage.test.ts` (new T18 describe, three existing assertions moved off
  `out_of_scope`), `server/spine/date-question-retired.test.ts` (one assertion),
  `server/agents/draft-guards.capability.test.ts` (in-scope affirmatives no longer claims; gas still
  is), `server/intake.test.ts` and `client/.../QuoteIntakeCard.test.tsx` (reason code `gas_work`).

Not touched: prices, money rules, the first-contact ack, tiers, send preconditions, sampler,
autonomy, media, the sandbox, `decide.ts`, the SLA sweep, the exit, the desk page (T17's files),
the packs' `exceptionsToBen`. No migration, no `app_settings` flag.

## Build gate, as measured

Rebased 8 Sep onto `941f467` (T17 #16 and T19 #18 merged after this branch started; the only
conflict was the CLAUDE.md bullet list, both sides kept; T17's exit and flag changes touch none of
these files, and `pushover.ts` auto-merged). Measured again on this machine against a clean copy of
`941f467` (`git archive`) run side by side, no `.env`, `DATABASE_URL` set to a placeholder.

| Gate | `941f467` | this branch | Verdict |
|---|---|---|---|
| `npx tsc --noEmit -p .` (`NODE_OPTIONS=--max-old-space-size=8192`) | 1,880 errors | 1,880 errors | zero new: the file + code pairs are identical |
| `vitest run --project server` failing set | 42 failed | 42 failed | the same 42 tests; 1,644 passed vs 1,636 (the new T18 tests) |
| touched files, targeted run | | 126 tests, 8 files, all pass | `triage`, `date-question-retired`, `draft-guards.capability`, `triage-lexicon`, `intake`, `intake-readiness`, `case-schema`, `scoper` |
| `vitest run --project client …/QuoteIntakeCard.test.tsx` | | 13 pass | |
| `esbuild server/index.ts --bundle` | | bundles, 4.3 MB | |
| `npx tsx scripts/eval-comms.ts --adapter replay` | exit 0 | exit 0 | regression red 0; `scope` 8 green |
| `npx tsx scripts/eval-comms.ts --adapter triage` | exit 0 | exit 0 | regression red 0; `scope · triage` 8 green. The "missed by both: 11" guard-chain line under this adapter is pre-existing (identical on `941f467`): the triage adapter observes no body, so the D2 pin is the replay adapter's |

After the rebase the gas pin was re-run by name (`-t "PIN: a gas job never reaches the Scoper"`): 1 passed;
the 8 touched test files: 126 passed.

Not run: `--adapter spine`, `scripts/eval-quote-prep.ts` (both need a key).

## Not done

- **Model-backed evals not run.** No `.env`, database or key here. `--adapter spine` and
  `scripts/eval-quote-prep.ts` were not run; the deterministic `replay` and `triage` adapters are
  the proof. The three re-expected readiness fixtures (`qp-dc-002/003/004`) carry verdicts I judged
  from the clerk's own rules (`visit_first` for a three-storey roof and a load-bearing
  knock-through, `needs_info` for a consumer unit plus two garage circuits); they are `capability`
  cases and the first live run of `eval-quote-prep` will say whether the clerk agrees.
- **Not proven live in the sandbox.** The walkthrough above is what the code does; nobody has
  clicked it on a server with a key.
- **Existing `out_of_scope` flags not reclassified** (the captain's call, above).
- **Asbestos, F-gas, solar, oil** left as Ben's (not asked; one-line removals listed above).
- The legacy `server/agents/comms.ts` comment that still says "four no-go trades" is untouched:
  Phase 5 deletes the file.
