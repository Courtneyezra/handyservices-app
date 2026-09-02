# PHASE 5 / B — prepare the legacy retirement — DONE (first pass)

Worktree `/Users/courtneebonnick/v6-wt-worker`, branch `p5-legacy-prep`, based on `12905d3` (comms-v3, Phases 0–4; production spine in SHADOW).
Not pushed, not merged. No dev server, no DB access, no migrations, `app_settings` untouched. **The legacy agent still runs**: `runCommsAgent`, its sweeps and crons are unchanged in behaviour; only dead branches were removed.

## Migrations to apply

None.

## Files

New
- `server/approver-backfill.ts` — the pure mapping (`mapApprover`, `planBackfill`, `renderPlan`): enum values and `human:<id>` unchanged; `comms_agent:autosend` → `agent.comms.autosend`, `comms_agent:sla_chase` → `agent.sla_chase`, `hours_gate:morning_release` → `rules.hours_gate`, `first_contact_ack:*` → `rules.first_contact`, `v2_pipeline:*` → `agent.comms.autosend` with a note; rejection markers (`*:superseded`, `hours_gate:stale_by_morning`, `ack_hold:superseded`, `comms_agent:superseded_by_clerk_gaps`) → the rule that decided; bare emails / `admin` → `human:<value>`; anything else left alone and counted as `unmapped`.
- `scripts/_approver-backfill.ts` — dry run by default (prints the plan table with counts per mapping); `--apply` runs the UPDATEs in one `db.transaction` and writes a `system_events` row (`source='approver-backfill'`, mapping counts + unmapped values in `detail`). **Not run.**
- `server/approver-backfill.test.ts` — 6 tests over the mapping and the plan.
- `docs/archive/legacy-comms-prompt-2026-09.md` — `SYSTEM` (comms.ts lines 1804–2108 at 12905d3) and `postQuoteStandingOrders()` (objection-levers.ts 342–432) copied VERBATIM from the committed source via `git show`, plus the lever/band/rail data they render, under a header naming the spine prompts that replaced them.
- `docs/comms-build/PHASE5-LEGACY-RETIRE.md` — the day-of runbook: go/no-go queries (G1–G8: live ≥ 7 days, zero unsafe, holding-line rate, Ben's queue, zero legacy runs, no rotting flags, shadow agreement, rollback drill), the file list, the non-legacy symbols to move first, importers, config keys, the /admin/staff card, the architecture-test edits, the backfill step, and the order of operations.

Modified (dead code only; behaviour unchanged)
- `server/agents/comms.ts` — `resolve_question` tool deleted with its `markQuestionResolved` import, the `answeredQuestions` block in `get_thread` (and its query), the SYSTEM paragraph about the retired relay, the staff-card blurb and the tool-name entry in the live-run filter; `autosend.intents` removed from `CommsAgentConfig` and `DEFAULT_CONFIG` (a stored row that still carries the key is merged over defaults and ignored); the `quotePriceSourceRefusal` comment block removed.
- `server/phone-utils.ts` — ONE `isTestNumber` (accepts null). `server/rules-layer.ts` and `server/spine/request-run.ts` re-export it; `server/agents/comms-lanes.ts` and `server/agents/comms-sweep.ts` import it instead of their private copies.
- `client/src/components/comms/LiveRunPanel.tsx`, `client/src/components/ops/OpsRunSteps.tsx` — the `resolve_question` label entries removed.
- `scripts/_first-contact-ack-test.ts`, `scripts/eval-comms-db.ts`, `scripts/eval-quote-prep.ts` and eight `scripts/archive/*.ts` — `intents: []` stripped from their config seeds (so the type change adds no excess-property errors anywhere, archive included).
- Kept on purpose: `COMMS_CONFIG_OVERRIDE` (suites), `DRAFT_INTENTS` (verdict stats still bucket legacy reasons), `objection-levers.ts` data (the spine renders it).

## Verification

- **tsc**: baseline (`12905d3`, throwaway worktree, private tsbuildinfo) 1883 errors → after **1883**; zero new. Gone: 0 line(s) (see below; removing dead code removed errors, which the brief allows).
- **vitest** (`PHASE0_MERGED=1`): baseline 42 failed / 826 passed (52 files) → after **42 failed / 832 passed (53 files)**; the same 42 (eve-pricing-engine 37, segment-classifier 4, contractor-pay 1). Architecture, rules-layer and silence-breaker suites still green after the `isTestNumber` move.
- **esbuild**: `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external` succeeds.
- **Legacy agent still works**: no change to `runCommsAgent`'s control flow, tools other than the deleted legacy one, sweeps, crons or config reads; `autosend.intents` was documented as a DEAD FIELD read by nothing (confirmed by grep before removal).
- NOT verified: a real dry run of the backfill (no DB from this pane). The plan query is one `GROUP BY approved_by`.

Errors gone vs baseline:
    

## Not done, and why

- The operator "flag" for `autosend.intents` the brief mentions does not exist in a live script: the only script that set it is `scripts/archive/_comms-agent-config.ts` (archived), which had its seed stripped like the others.
- Nothing from PHASE5-DELETE.md's first row (V2, workers, memory) — a different pane's list; this pass is the legacy-agent preparation only.
- The backfill is not run and must not be until §7 of the runbook (after the legacy agent is gone and the spine is live).

## Decisions the design left open

- Rejection markers stored in `approved_by` (`*:superseded`, `hours_gate:stale_by_morning`, `ack_hold:superseded`) map to the deciding rule/agent rather than being left unmapped: a rejected draft still needs a machine-readable "who decided", and the row's `status='rejected'` already says it was not a send.
- `comms_agent:first_contact` and plain `comms_agent:*` (unknown suffix) map to `agent.comms`; `v2_pipeline:*` to `agent.comms.autosend` with an explicit note in the plan and the system event, per the brief.
- The archive copies the SOURCE of the two prompt builders (template literal + function), not a rendered instance, because the render depends on `loadVoice()` reading a file at runtime; the data it interpolates is included so the archive reads standalone.
- The runbook lists G1–G8 as SQL against the tables that exist today; G7 reuses `scripts/_shadow-report.ts`.
