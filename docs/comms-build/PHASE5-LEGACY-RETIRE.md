# Phase 5 — retiring the legacy comms agent (runbook)

Written 3 Sep 2026 on `p5-legacy-prep` (Phase 5 / B, first pass). Production spine is in **shadow**
mode; the legacy agent (`server/agents/comms.ts`) still answers customers. Nothing below is done
yet. Everything the first pass could do without retiring it IS done (see PHASE5-DONE.md): the
`resolve_question` tool, `autosend.intents`, the price-source comment block and the three duplicate
`isTestNumber` copies are gone, the standing orders are archived verbatim in
`docs/archive/legacy-comms-prompt-2026-09.md`, and `scripts/_approver-backfill.ts` is ready (dry run).

## 0. Go / no-go queries (all must pass before step 1)

Run against production read-only. Each is one SQL statement; the threshold is the decision.

| # | Question | Query | Go when |
|---|---|---|---|
| G1 | Spine live ≥ 7 days | `SELECT min(at) FROM system_events WHERE kind='config_change' AND source='spine' AND detail->'after'->>'mode'='live' AND at > (SELECT max(at) FROM system_events WHERE kind='config_change' AND source='spine' AND detail->'after'->>'mode' IN ('off','shadow'))` | result ≤ now() − 7 days (no off/shadow flip since) |
| G2 | Zero unsafe verdicts on the spine | `SELECT count(*) FROM draft_verdicts v JOIN message_drafts d ON d.id=v.draft_id WHERE v.reason='unsafe' AND d.source='spine' AND v.created_at > now() - interval '14 days'` | 0 |
| G3 | Holding-line rate | `SELECT count(*) FILTER (WHERE d.source='rules_layer' AND d.reason LIKE '[silence]%') AS holding, count(*) FILTER (WHERE d.status='sent' AND d.source IN ('spine','rules_layer','comms_agent')) AS sent FROM message_drafts d WHERE d.sent_at > now() - interval '7 days'` | holding / sent ≤ 10% (a burst answered only by a holding line is the failure the spine exists to end) |
| G4 | Ben's queue | `SELECT count(*) FILTER (WHERE status='pending') AS pending, count(*) FILTER (WHERE status='pending' AND due_at < now()) AS past_due FROM message_drafts WHERE source IN ('spine','comms_agent')` | past_due = 0 and pending ≤ 10 at 09:00 |
| G5 | Legacy agent has no runs | `SELECT count(*) FROM agent_runs WHERE agent='comms' AND started_at > now() - interval '7 days'` | 0 (in live mode every path returns before `runCommsAgent`; a non-zero count is a caller nobody found) |
| G6 | Flags not rotting | `SELECT count(*) FROM agent_questions WHERE status IN ('open','flagged') AND due_at < now() - interval '1 day' AND expired_at IS NULL` | 0 |
| G7 | Shadow agreement (archive the last report) | `npx tsx scripts/_shadow-report.ts --days 14 --out docs/comms-build/shadow-report-final.md` | decision agreement ≥ 80%, guard agreement ≥ 95% |
| G8 | Rollback exercised once | CUTOVER.md rollback drill logged as a `system_events` row (`source='spine'`, summary contains `rollback drill`) | present |

## 1. Files to delete (pure removal once §0 passes)

| Path | Notes |
|---|---|
| `server/agents/comms.ts` | the legacy agent: `runCommsAgent`, `SYSTEM`, `STAFF`, `sweepCommsAgent`, `windowClosingSweep`, `backlogSweep`, `flagThreadForBen` (see §2 for what moves out first) |
| `server/agents/comms-sweep.ts` | legacy tick + slow sweep. Its non-legacy passengers move first (§2) |
| `server/agents/sla-sweep.ts` | superseded by Phase 1 flag expiry + Phase 3 sampler signals |
| `server/agents/promise-tracker.ts` | chases superseded by the rules layer; `addWorkingHours` callers move to `server/working-hours.ts` `BEN_HOURS` |
| `server/agents/comms-lanes.ts` | the legacy `arm()`; callers call `spine.requestRun` directly |
| `server/agents/objection-levers.ts` | **keep** — the spine renders its data (`renderLeverVocabulary`). Only `postQuoteStandingOrders()` (archived) may go |
| `server/agents/draft-guards.ts` | **keep** — the guard chain is the spine's |
| `scripts/agent-comms.ts`, `scripts/comms-backlog-pass.ts`, `scripts/_test-live-run-events.ts`, `scripts/_test-autonomy-guards.ts`, `scripts/_post-call-continuation-test.ts`, `scripts/_first-contact-ack-test.ts` (the comms import only), `scripts/eval-comms-db.ts` + `scripts/eval-quote-prep.ts` (the `useProcessLocalCommsConfig` seeds) | delete or rewrite against the spine |
| `scripts/archive/*` importing `agents/comms` | delete with the directory |

## 2. Things that live in the legacy files but are NOT legacy (move before deleting)

| Symbol | Lives in | Move to | Importers today |
|---|---|---|---|
| `getCommsAgentConfig` / `setCommsAgentConfig` / `useProcessLocalCommsConfig` / `CommsAgentConfig` | comms.ts | `server/comms-config.ts` (new). Still read by first-contact-ack (`firstContactAutoAck`), comms-sweep morning release (`autosend.enabled`), agent-staff, cron, va-call-tasks, silence-breaker | `server/first-contact-ack.ts`, `server/agent-staff.ts`, `server/cron.ts`, `server/agents/ops-manager.ts`, `server/agents/comms-sweep.ts`, tests |
| `flagThreadForBen`, `NEEDS_BEN_TAG`, `READY_TO_PRICE_TAG` | comms.ts | `server/flags.ts` | `server/spine/agents/quote-clerk.ts` (READY_TO_PRICE_TAG), `server/spine/exit.ts` (insertFlag replicates it), ops-manager |
| `DRAFT_INTENTS`, `intentFromReason` consumers | comms.ts / verdict-stats | keep `intentFromReason` (verdict-stats.ts); drop `DRAFT_INTENTS` once the last legacy draft reason is older than the stats window (30 d) | `server/verdict-stats.ts`, evals |
| `maybeAutoQuotePrep`, `assessRepeatHolding`, `detectHoldingReply` | comms.ts / promise-tracker.ts | spine guards / rules layer (already have equivalents: `holding` intent, 2 h suppression) | none outside legacy |
| fast-tick passengers: `releaseMorningHolds`, `releaseHeldAcks`, `fallbackOverdueCallbacks`, heartbeat, `runSilenceBreakerTick`, `expireOverdueVaCallTasks` | comms-sweep.ts | `server/worker-tick.ts` (new; same `gateCustomerLoop` wrapping; `tickDueTriage` becomes `runDue` only) | `server/index.ts` boot |
| `claimTriageTurn` re-export | comms-sweep.ts | already in `server/spine/request-run.ts`; delete the re-export | `server/meta-whatsapp.ts` (check) |

## 3. Importers to update on the day

`grep -rln "agents/comms'" server scripts client/src` at 3 Sep 2026:
`server/first-contact-ack.ts`, `server/agent-staff.ts`, `server/cron.ts`, `server/agents/ops-manager.ts`, `server/spine/agents/quote-clerk.ts`, and the scripts in §1.
Each imports only the symbols in §2 except cron (the three sweeps, delete the blocks) and ops-manager (`run_comms_agent` already calls `requestRun`; delete the legacy branch and the `runCommsAgent` import).

## 4. Config keys to drop

| Key | Where | Action |
|---|---|---|
| `app_settings.comms_agent.enabled`, `.sweepLimit`, `.onInbound`, `.inboundDebounceMinutes` | legacy master + debounce | delete from the row and the type; the spine has `spine.enabled` / `spine.debounceMinutes` / `spine.sweepLimit` |
| `app_settings.comms_agent.autosend.enabled` | legacy direct-send + morning release gate | keep ONLY if morning release survives; otherwise delete (Phase 3 pack tiers own sending) |
| `app_settings.comms_agent.firstContactAutoAck`, `.quotePrep`, `.vaCallTask` | not legacy | move to their own keys (`first_contact_ack`, `quote_prep`, `va_call_task`) via `setSetting`-style upsert + one migration script |
| `COMMS_CONFIG_OVERRIDE` env seam | suites | delete with the legacy config (suites move to `useProcessLocalSpineConfig`) |
| `kill_switch.day_before_reminders` etc. | unrelated | keep |

## 5. /admin/staff

`server/agent-staff.ts`: delete `import { STAFF as commsStaff, SYSTEM as commsSystem, … } from './agents/comms'` (line 31), `commsStats()` (77–120: pending/sent/rejected/questions from `source='comms_agent'`, `trustStat('comms')`, the SLA SWEEP / DIRECT SEND / AUTO QUOTE-PREP chips), and the first `staff[]` entry (241–242). Keep the worker heartbeat chip (Phase 0) — move it onto the spine card. The Scoper/clerk/recovery/verifier cards already exist. Client: `client/src/pages/admin/StaffPage.tsx` renders whatever the payload lists; no code change unless it special-cases `comms`.

## 6. Architecture test edits (`server/__tests__/architecture.test.ts`)

- `APPROVE_AND_SEND_ALLOWED`: remove `server/agents/comms.ts`, `server/agents/comms-sweep.ts`, `server/agents/sla-sweep.ts`, `server/agents/promise-tracker.ts`; keep `server/first-contact-ack.ts`, `server/rules-layer.ts`, `server/spine/exit.ts`, `server/outbound.ts`, `server/agent-staff.ts`, `server/auto-ack-window.ts`.
- `EXPECTED_IMPORTERS_AFTER_MERGE`: `['server/first-contact-ack.ts', 'server/rules-layer.ts', 'server/spine/exit.ts']` (shrink to the spine's exit only when first-contact-ack moves onto the rules layer fully).
- Test "(a) V2 routing gone": keep. Add "(e) legacy agent gone": `runCommsAgent`, `sweepCommsAgent`, `windowClosingSweep`, `backlogSweep` appear nowhere under `server/`.
- Test "comms-sweep.ts imports from ../worker-gate": retarget to `server/worker-tick.ts`.
- `PHASE0_MERGED` gate: remove; every test runs unconditionally.

## 7. Approver backfill (after §1, before deleting the legacy prefixes)

1. `npx tsx scripts/_approver-backfill.ts` — read the table; every row must be `unchanged`, a known legacy prefix, `v2_pipeline`, a rejection marker or `bare_human`. Investigate any `unmapped` value before applying.
2. `npx tsx scripts/_approver-backfill.ts --apply` — one transaction; a `system_events` row (`source='approver-backfill'`) records the mapping counts.
3. Then delete `LEGACY_AUTOMATED_PREFIXES` and the `agent.`/`rules.`/`system.` prefix fallbacks in `isAutomatedApprover` (`server/approver.ts`), and `isAgentApprover`'s `comms_agent:` branch. `verdict-stats.ts` `bucketForSources` loses the `comms_agent` bucket after the 30-day stats window.

## 8. Order of operations on the day

1. §0 queries green; file the numbers in PHASE5-DONE (second pass).
2. Move the §2 symbols (one commit, tsc clean, vitest at baseline).
3. Delete the §1 files and the cron blocks; update §3 importers; §5 staff card; §6 tests (one commit).
4. Drop §4 keys (script + migration of the three non-legacy sub-configs).
5. §7 backfill, then the approver.ts prune.
6. `docs/COMMS_MAP_2026-08.md` / `docs/RUNBOOK.md`: replace every "comms agent" operational note with the spine's; keep `docs/archive/legacy-comms-prompt-2026-09.md`.
