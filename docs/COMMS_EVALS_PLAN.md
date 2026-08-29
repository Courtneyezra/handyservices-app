# Comms Evals Plan

**Date:** 22 Aug 2026
**Reference:** [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) (Anthropic Engineering)
**Scope:** the comms agent (`server/agents/comms.ts` on `server/agents/runner.ts`) — triage, drafting, ask-Ben, sweeps, direct-send gating, quote-prep handoff.

---

## 1. Where we actually are

We are not starting from zero. An audit (22 Aug) found:

**Assets (keep, reuse):**
- **~470 deterministic assertions** across 10+ suite scripts (`_adversarial-test.ts` 116, `_pipeline-e2e-test.ts` 112, `_first-contact-ack-test.ts` 104, `_call-thread-test.ts` 73, `_post-quote-test.ts` 49, …).
- **A real grader library**: `server/agents/draft-guards.ts` (13 pure detectors — money, discount, date-promise, liability, capitulation, capability-claim, voice breach), the lever/opening classifiers + `checkVoice` in `scripts/_backtest-corpus.ts`, and `shared/chat-voice.ts` (`chatVoiceViolations()` returns a machine-readable violation list — the natural grader interface). Every rule is corpus-justified (e.g. em dashes: Ben 3/1,532 vs templates 195/350).
- **A real eval dataset builder**: `_backtest-corpus.ts` extracts 120 decision points (90 first_reply / 16 timing_hold / 14 price_objection) from `whatsapp-export/wa-dump.json` (10,267 real messages), cached in `.agent-backtest-cache.json`, with Ben's actual replies as reference solutions.
- **Test-number discipline**: Ofcom drama range `+447700900xxx`, one number per suite, parallel-safe.

**Gaps (this plan closes them):**

| Gap | Why it matters (per the article) |
| --- | --- |
| Case definitions fragmented: inline arrays in 2 idioms + one corpus cache | Tasks should be data, not code — experts can't contribute, no shared harness |
| 3 suites have **no grading at all** (`_voice-scenarios` advisory, `_wa-replay-test`, `_full-flow-demo` eyeball-only) | Precisely the open-ended outputs that need model-based grading |
| No structured result artifact — everything is `console.log` + exit code | No run-over-run comparison, no scoreboard, no regression detection |
| Single trial per case, no pass@k / pass^k | Agent is non-deterministic; customer-facing = we care about **pass^k** (consistency), not lucky passes |
| No capability/regression split | Guard suites should sit at ~100% (regression); backtest lever-agreement is a capability metric that should start low and climb |
| Token `usage` computed by runner but dropped | No cost-per-run number; the $20/day incident showed why this matters |
| Config isolation (`useProcessLocalCommsConfig`) only in worktree angry-merkle, uncommitted | The 21 Aug incident: suites on main can still degrade production AND get live-flipped mid-run. **Unsafe to scale eval volume until landed** |
| `shared/chat-voice.ts` only in worktree confident-joliot | Best grader in the codebase isn't on main |

---

## 2. Target architecture

Three layers, mapping the article's framework onto what exists:

```
cases (data)          →  eval-cases/*.json         one case = task + fixture + grader spec
harness (runner)      →  scripts/eval-comms.ts     seeds fixture, runs N trials, applies graders,
                                                   writes eval-results/<run-id>.json + report
graders (logic)       →  1) deterministic: draft-guards, chat-voice, lever classifiers, DB-state checks
                         2) LLM judge: voice/quality rubric, calibrated against Ben's real replies
                         3) human: Ben approve/edit/reject in /admin/comms = free ongoing labels
```

### 2.1 Case format (tasks as data)

One JSON file per case family, cases shaped like:

```jsonc
{
  "id": "adv-042-discount-extraction",
  "family": "adversarial",            // adversarial | post-quote | voice | backtest | lifecycle | first-contact
  "kind": "regression",               // regression (hold ~100%) | capability (improvement target)
  "trigger": "inbound",               // inbound | sweep | window-closing | call
  "fixture": {                        // thread state to seed (messages, quotes, calls, media)
    "phone": "+447700900931",
    "thread": [ ... ],
    "quotes": [ ... ]
  },
  "trials": 3,                        // pass^k target for regression, pass@k for capability
  "graders": [
    { "type": "guard", "expect": "refused", "code": "discount_offer" },
    { "type": "outcome", "expect": "escalated" },          // checks agent_questions / tags / board state
    { "type": "chat-voice" },                              // chatVoiceViolations(draft) === []
    { "type": "judge", "rubric": "voice-v1", "min": 3 }    // only where deterministic can't reach
  ],
  "reference": "Ben's actual reply or a written ideal",     // proves the task is solvable
  "provenance": "wa-dump thread 2026-05-14 / incident X / invented"
}
```

Grading philosophy (straight from the article, and already our instinct):
- **Outcomes over paths.** Grade what ended up in the DB (draft queued? escalated? tags right? nothing auto-sent?) and the draft text — never the tool-call sequence.
- **Deterministic first.** `checkDraft()` + `chatVoiceViolations()` + outcome checks cover most cases. The LLM judge exists only for "does this sound like Ben / is this the right move" where regex can't reach.
- **Balanced sets.** For every "must refuse X" case, a matching "must NOT refuse benign near-X" case (the backtest's `overEscalation` metric generalised). One-sided guard evals train an agent that escalates everything.
- **Partial credit** on multi-component cases (triage right but draft weak ≠ total failure) via per-grader results, not a single boolean.

### 2.2 Harness (`scripts/eval-comms.ts`)

- **Isolation**: calls `useProcessLocalCommsConfig()` before anything (hence Phase 0). Fresh fixture per trial — seed thread under the case's drama number, run, grade, delete by phone. No shared state between trials (article step 4).
- **Trials**: `--trials N` (default 1 for cheap iteration, 3 for scoreboard runs). Report both pass@k and pass^k per case; **pass^k is the headline** for anything on the autosend whitelist path.
- **Results artifact**: `eval-results/<timestamp>.json` — per case × trial: grader verdicts, draft text, outcome snapshot, full runner transcript, **and `usage`** (tokens + estimated £). Plus a markdown scoreboard (`eval-results/latest.md`) with deltas vs the previous run — the missing regression signal.
- **Modes**: `--family adversarial`, `--only <id>`, `--quick` (deterministic-graded cases only, no LLM judge), `--changed` (cases touching guards edited in the working tree).
- **Cost control**: per-run token budget printed up front from case count × trials × observed avg; abort threshold. (The runner already computes usage per turn — persist it.)

### 2.3 LLM judge (new, and deliberately small)

Only two rubrics to start:

1. **Voice-v1** — "does this read like Ben": register, burst length, one question max, no system-tells, lever choice sensible. Structured dimensions scored separately, 1–5 each, with an explicit "cannot judge" escape hatch. Judge model: haiku-4-5 via `server/llm.ts` (cheap, and we're judging text, not reasoning).
2. **Move-quality-v1** — for backtest decision points: "is the agent's move at least as good as Ben's actual reply?" — pairwise comparison against the reference, which is stronger than absolute scoring.

**Calibration before trust** (article: model graders require calibration): run each rubric over ~40 drafts Ben has already approved/edited/rejected in `/admin/comms`; judge must agree with Ben's verdict ≥85% before its scores gate anything. Until calibrated, judge scores are advisory columns in the report, not pass/fail. Re-calibrate quarterly against fresh approvals — Ben's approve-unedited/edit/reject stream is a free, continuous label source we already planned to watch for the autosend trust ladder.

---

## 3. Phased build

### Phase 0 — Prerequisites (safety first, no new evals)
1. **Land `useProcessLocalCommsConfig`** from worktree angry-merkle (branch `claude/dreamy-lamarr-4da59b`) onto main, including the 10 suite updates. Non-negotiable before increasing eval volume — main's suites can still hit the 21 Aug failure mode.
2. **Land `shared/chat-voice.ts`** + its vitest from worktree confident-joliot.
3. Commit `0232a0f`-era uncommitted comms work if any remains dangling.

*Exit criteria: all suites run against process-local config; `chatVoiceViolations` importable on main.*

### Phase 1 — Harness + results artifact (1–2 sessions)
1. Build `scripts/eval-comms.ts` + case schema (`shared/eval-types.ts`).
2. Wire the existing grader library in as grader types (`guard`, `chat-voice`, `outcome`, `lever`).
3. Persist results JSON + markdown scoreboard with run-over-run deltas; persist `usage`.
4. **Seed with ~30 cases converted from the two highest-value suites**: adversarial guard sections (regression, trials=3, pass^3) and post-quote money/objection proofs. Don't convert everything — the article says start with 20–50 from real failures; the inline suites keep running as-is until their families are migrated.

*Exit criteria: one command produces a scoreboard; re-running shows deltas; a deliberately broken guard shows up red.*

### Phase 2 — Score the unscored (1 session)
1. `_voice-scenarios`' 5 scenarios and `_wa-replay-test`'s 6 threads become cases with `chat-voice` + `lever` graders and (advisory) `judge:voice-v1`.
2. Add the **incident regression family**: one case per past comms incident with a written repro — Alicia (survey-gate), the 21 Aug A97–A100 autosend, first-contact ack refusal, dunning final-notice. Bug reports → eval cases is the article's step 1, and our incident memory is a ready-made backlog.
3. Add **absence cases**: benign messages that must NOT escalate/refuse (mine `overEscalation` hits from backtest results).

### Phase 3 — Judge + calibration (1–2 sessions, gated on Phase 1)
1. Implement the two rubrics; run calibration against ≥40 real Ben verdicts pulled from the drafts table.
2. Publish agreement rate in the scoreboard. Promote to gating only at ≥85%.

### Phase 4 — Capability track (ongoing)
1. Promote the backtest to the harness: 120 decision points, `--trials 1`, capability kind. Headline metrics: **lever agreement %, beat-or-match %, over-escalation %** — expected to start well below 100 and climb; this is the improvement target, not a gate.
2. Expand the corpus extractor to more decision-point types (window-closing, media-grounded replies using the vision context, opt-out edge cases).

### Phase 5 — Operate (standing)
- **Eval-driven development**: any change to `comms.ts`, `draft-guards.ts`, prompts, or `brand-voice/*.md` runs `--quick` regression before commit; full run (trials=3 + judge) before enabling any config flag (sweep, autosend intent, first-contact ack).
- **Saturation watch**: capability metrics stuck at ~100% → graduate that family to regression and cut harder cases from the corpus.
- **Read transcripts**: every scoreboard run, eyeball ≥3 failing and ≥2 passing transcripts (already persisted per trial) — graders drift, and "poor-climbing scores require transcript investigation."
- **Trust ladder tie-in**: the autosend whitelist expansion rule becomes concrete — an intent is whitelist-eligible only when its family holds pass^3 = 100% on regression AND Ben's unedited-approval rate for that intent clears a bar over a trailing window.

---

## 4. What we're explicitly NOT doing

- **Not building a generic eval platform.** One harness, one agent, JSON files in-repo. No dashboards, no DB tables for eval results (files + git diff are the comparison tool).
- **Not LLM-judging what regex can grade.** The deterministic library is the moat; the judge covers only voice/quality residue.
- **Not simulating multi-turn customer personas yet.** `_pipeline-e2e-test` and `_outcome-replay-test` already cover lifecycle deterministically; persona simulation is a later capability-track idea, not a Phase 1 requirement.
- **Not deleting the existing suites** until their families are migrated and the scoreboard has caught at least one real regression.

## 5. Open decisions

1. **Where fixtures live**: inline in case JSON (self-contained, verbose) vs referencing `.agent-backtest-cache.json` (compact, but a build step). Lean: inline for invented cases, corpus-ref for backtest family.
2. **CI**: suites currently need the dev DB + API keys. Defer CI wiring; run locally pre-commit until the harness is stable.
3. **Judge model**: haiku-4-5 (cheap) vs sonnet-5 (matches the agent). Start haiku; calibration agreement decides.
