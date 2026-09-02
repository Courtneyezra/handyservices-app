# Phase 5 / A — delete the V2 pipeline and its dependencies — DONE (3 Sep 2026)

Worktree `/Users/courtneebonnick/v6-wt-exit`, branch **`p5-delete-v2`**, one commit on top of 12905d3 (comms-v3). Not merged, not pushed. No dev server, no DB access, no app_settings. The legacy comms agent (`server/agents/comms.ts`, its sweeps, cron) is untouched: production stays in shadow mode.

## Deleted (git rm)

Brief's list
- `server/pipeline/v2.ts`
- `server/workers/{vision,reply,scoping,pricing,research}.ts` (directory removed)
- `server/memory/index.ts` (directory removed)
- `shared/conversation-memory.ts`
- `server/llm/openrouter.ts`, `server/llm/router.ts` — nothing outside the deleted set imported either (`server/llm.ts`, the Claude helper, stays)
- `scripts/_smoke-vision-video.ts`, `scripts/_test-reply-worker.ts`
- `scripts/_case-study-7460080647.ts` — the trace script the 31 Aug commit (50eaf64 "feat(trace): add detailed trace logging to worker runs") added
- `conversation_memory` from `shared/schema.ts` — the table, its `memory_readiness` enum (used by nothing else) and the two inferred types, replaced by a three-line note

Dependencies the grep found (they import the set above; leaving them would break tsc)
- `scripts/_e2e-agent-pipeline.ts`, `scripts/_compare-pipelines.ts`, `scripts/_smoke-agent-v2.ts` — V2 driver scripts importing the workers, the memory module and OpenRouter
- `server/learning/{analytics,edit-tracker,index}.ts` — read `conversation_memory` (Ben-edit learning over V2 memory); mounted nowhere, imported by nothing

## Renamed
- `server/pipeline/` → **`server/ops/`** (`actions.ts`, `queries.ts`: live ops code). Importers fixed: `server/quotes.ts`, `server/assignment-proposals.ts`, `server/job-assignment.ts`, `server/agents/ops-manager.ts` (two imports), `scripts/_verify-pipeline-queries.ts`. tsc and esbuild stayed clean, so the rename stands. `server/pipeline-sweeper.ts` (a different file) is untouched.

## Moved
- `docs/AGENT_FRAMEWORK_V2_PLAN.md`, `docs/AGENT_FRAMEWORK_V2_ARTIFACT.md` → `docs/archive/`, each with a one-line header: archived, superseded by `COMMS_AGENTS_V3_DESIGN.md`, the pipeline was deleted in Phase 5.

## Migration (hand-applied only)
- `migrations/20260903_drop_conversation_memory.sql` — contains ONLY the commented-out `DROP TABLE IF EXISTS conversation_memory;` (and the enum's `DROP TYPE`), with the note that the orchestrator runs it by hand after `SELECT count(*), max(updated_at) FROM conversation_memory;` confirms nothing worth keeping. Never auto-applied.

## Architecture test
- `server/__tests__/architecture.test.ts` gains block **(f)**: every deleted path must not exist (13 paths), nothing under `server/` imports openrouter / the workers / the memory module / conversation-memory / `pipeline/v2` / `llm/router`, `conversationMemory` is gone from the schema, and the ops code lives at `server/ops` with no importer of the old path. Ungated (true on this branch).

## OpenRouter mentions
- Tracked docs and env examples: none carried `OPENROUTER_API_KEY` except the two V2 docs now in `docs/archive/` (left as archived history) and the incident record in `COMMS_AGENTS_V3_DESIGN.md` §1.2 (kept: it is what happened). `docs/comms-build/PHASE0-OPS.md` had no mention.
- `server/worker-gate.ts` keeps its one-line incident comment ("production's sweeps were dead (no OPENROUTER_API_KEY)") — history, not configuration.
- **`.env.example.local` is gitignored** (`*.local`), so it is not in the commit; it carried a real-looking OpenRouter key on line 98, which I removed from the local file. **Recommend revoking that key at OpenRouter** regardless — an example file is not a secret store.

## Verification
- **tsc** — base 12905d3: 1882 errors; finished tree: **1876**. Diff by (file, code): nothing new; the six that went were all in deleted files (`_compare-pipelines`, `_e2e-agent-pipeline` ×2, `_smoke-agent-v2`, `learning/edit-tracker`, `pipeline/v2`). One tsc at a time.
- **vitest** — `DATABASE_URL=… PHASE0_MERGED=1 npx vitest run`: base 42 failed / 826 passed; finished tree **42 failed / 842 passed**, same three pre-existing files; the architecture suite runs 35 tests including the 17 new (f) assertions.
- **esbuild** — `server/index.ts` bundles.
- Legacy agent: `server/agents/comms.ts`, `comms-sweep.ts`, `sla-sweep.ts`, `promise-tracker.ts`, `cron.ts` untouched; `runCommsAgent` callers unchanged.

## Not done, and why
- The second and later Phase 5 rows (legacy agent, sweeps, `resolve_question`, `autosend.intents`, `COMMS_CONFIG_OVERRIDE`, legacy approver prefixes, retired staff cards) wait for spine live ≥ 7 days per `PHASE5-DELETE.md`; not in this brief.
- The table is not dropped by this branch (by design: commented-out DDL, hand-applied).
- `scripts/_verify-pipeline-queries.ts` keeps its name (it verifies the ops queries; only its import moved).

## Decisions the brief left open
1. Deleted the three V2 driver scripts and `server/learning/*` beyond the brief's list: each imports the deleted set or reads the deleted table, had no importer of its own, and would have broken tsc otherwise. Listed above so the reviewer can veto any of them.
2. Kept historical mentions of the OpenRouter key where they document the 31 Aug incident; removed it only where it was configuration.
3. The rename to `server/ops/` was done because both gates stayed clean, as the brief allowed.
