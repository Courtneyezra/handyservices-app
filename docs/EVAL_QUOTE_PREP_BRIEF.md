# Brief: Quote-Prep Readiness Eval Harness

**Owner:** bottom-right pane agent. **Dispatched:** 29 Aug 2026 by orchestrator pane.
**Goal:** build the eval harness that grades the quote-prep clerk's readiness verdicts
(`quote_ready` / `needs_info` / `visit_first`) so rule changes can be regression-checked
before they touch production. This is the baseline gate for the upcoming T6 readiness/
escalation changes — build the exam BEFORE the rules change.

## Model it on what exists — do not invent a new architecture

- **Harness to copy:** `scripts/eval-comms.ts` (fixture seeding, multi-trial, graders,
  results JSON + markdown scoreboard with run-over-run deltas, usage/cost persistence).
- **Case schema:** `shared/eval-types.ts` — extend additively for quote-prep cases.
- **Agent under test:** `runQuotePrep(conversationId)` in `server/agents/quote-prep.ts`.
  DO NOT modify its behaviour, prompt, or validator in this task.
- **Shadow verifier:** `server/agents/quote-verifier.ts` — record its output as an
  advisory column where it runs; it gates nothing.
- **Plans:** `docs/COMMS_EVALS_PLAN.md` (architecture + grading philosophy),
  `docs/QUOTE_ASSEMBLY_PLAN.md` (incidents + lanes).

## Phase 0 safety check (before seeding anything)

Verify the process-local config isolation used by eval-comms (`COMMS_CONFIG_OVERRIDE`)
is active for your runs so nothing auto-triggers real comms sends off the seeded threads.
If isolation cannot be confirmed, STOP and report back instead of proceeding.

## Deliverables

1. **`shared/eval-types.ts`** — additive `EvalQuotePrepCase` (or equivalent): fixture +
   `expectedReadiness` + expected-gap spec + graders + `kind` (regression|capability) +
   `provenance`.
2. **`eval-cases/quote-prep-readiness.json`** — 20–30 cases:
   - **Real incidents first:** Rebecca (+447452983308, combined re-quote silently
     skipped) and Carolyne (+447941828889, `visit_first` with Ben-audience gaps).
     Pull the real threads from the dev DB (see `scripts/_query-comms-debug-*.ts` for
     the read pattern) and convert to self-contained fixtures — the case JSON must not
     depend on live DB rows at run time.
   - **Balanced synthetic sets:** ~5 clear `quote_ready`, ~5 `needs_info`, ~5
     `visit_first`, PLUS near-miss cases that must NOT tip over (minor unknown that
     should ride as a printed assumption, not trigger `needs_info`; surface-level issue
     that should not trigger `visit_first`). One-sided sets train over-escalation.
3. **`scripts/eval-quote-prep.ts`** — the harness:
   - Seeds each fixture under Ofcom drama numbers `+447700900xxx`. Pick an UNUSED block
     (check existing suites for collisions; one number per case family, parallel-safe).
   - Runs `runQuotePrep` per trial. `--trials N` (default 1; 3 for scoreboard runs).
     `--only <id>`, `--family <name>` filters.
   - **Graders:** `readiness-verdict` (expected vs actual lane), `gap-alignment`
     (expected questions present, correct audience customer/ben, sane impact labels),
     `line-quality` (titles <= 60 chars, no prices — mirror the validator rules).
   - Cleanup by phone after every trial. No shared state between trials.
   - **Results:** `eval-results/quote-prep-<timestamp>.json` (per case x trial: grader
     verdicts, full intake, transcript, usage tokens + estimated £) and
     `eval-results/quote-prep-latest.md` scoreboard with deltas vs previous run.
   - Headline metric: **pass^k** for regression cases, pass@k for capability.
4. **Baseline run:** execute the full set with `--trials 3`, commit nothing broken, and
   report the scoreboard summary (per-lane accuracy, failing case IDs, cost).

## Constraints

- New files + additive edits to `shared/eval-types.ts` only. Do NOT touch:
  `server/agents/quote-prep.ts` (behaviour), `server/first-contact-ack.ts`,
  `server/agents/comms-lanes.ts`, `server/post-call-outreach.ts`,
  `server/agents/va-call-tasks.ts`, `server/pushover.ts` — other tasks own those.
- No messages to real numbers, ever. Fixtures only under the drama range.
- Do not delete or rewrite existing suites or eval-comms cases.
- Follow the grading philosophy in COMMS_EVALS_PLAN.md: outcomes over paths,
  deterministic graders first, no LLM judge in this first pass.

## Done means

One command produces the scoreboard; re-running shows deltas; a deliberately wrong
expected-verdict shows up red; Rebecca and Carolyne exist as named regression cases;
baseline scoreboard reported back to the orchestrator pane.
