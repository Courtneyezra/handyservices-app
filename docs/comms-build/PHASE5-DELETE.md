# Phase 5 — Delete (orchestrator checklist)

Preconditions: spine mode = live for ≥ 7 days with no `unsafe` verdicts; CUTOVER.md rollback exercised once; Ben's queue healthy.

Delete list (design §10 Phase 5), each with what must be true first:
| Path | Delete when |
|---|---|
| `server/pipeline/v2.ts`, `server/workers/*`, `server/memory/*`, `shared/conversation-memory.ts`, `server/llm/openrouter.ts` (+ `router.ts` if only V2 used it), `scripts/_smoke-vision-video.ts`, `scripts/_test-reply-worker.ts`, `docs/AGENT_FRAMEWORK_V2_*.md` (move to docs/archive) | now (nothing imports them once `conversation_memory` table is confirmed unused; drop table in a migration) |
| `server/agents/comms.ts` (legacy agent), `server/agents/comms-sweep.ts` sweeps, `server/agents/sla-sweep.ts`, `server/agents/promise-tracker.ts` chases, cron comms sweeps in `server/cron.ts` (lines 52/69/87), `resolve_question` tool, `autosend.intents` field, `COMMS_CONFIG_OVERRIDE` seam | spine live ≥ 7 days; `runCommsAgent` has zero callers; the eval `legacy` adapter removed |
| `AUTOMATED_APPROVER`-era legacy prefixes in `isAutomatedApprover` | after a backfill rewrites old `approved_by` strings to enum values (script) |
| `server/agents/ops-manager.ts` `run_comms_agent` legacy branch | with the above |
| `/admin/staff` cards for retired agents; `agent-staff.ts` legacy stats | same |

Order: (1) V2 + memory table, (2) flip-day archive of legacy prompt into `docs/archive/legacy-comms-prompt.md`, (3) legacy agent + sweeps, (4) approver backfill, (5) architecture test lists shrink to the spine's exit only.
