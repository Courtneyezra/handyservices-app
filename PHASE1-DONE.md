# Phase 1 / A — write-at-source ledger + agent_runs — DONE (2 Sep 2026)

Worktree `/Users/courtneebonnick/v6-wt-exit`, branch **`p1-ledger`**, one commit on top of c89b25e (comms-v3). Not merged, not pushed. No dev server, no DB queries, no app_settings.

## Migrations to apply (in this order — one file)

- `migrations/20260902_agent_runs_ledger.sql` — creates `agent_runs` (+ 2 indexes), adds `run_id text` to `message_drafts`, `agent_questions`, `nudge_queue`, `comms_events` (+ indexes on `message_drafts.run_id`, `comms_events.run_id`). Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS). Drizzle schema in `shared/schema.ts` matches (`agentRuns`, plus `runId` on the four tables).

Nothing else changes the database. Code that reads the new columns tolerates their absence only in the sense that every ledger write is try/catch'd — apply the migration before deploying or every send will log a warning per event.

## Files

New
- `server/agent-cost.ts` — pure pricing: Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25 per MTok; cache reads 10%, cache writes 125% of input; 1 USD = 0.78 GBP; `computeCostPence`, `computeCostUsd`, `priceForModel`. No db, so the runner can import it.
- `server/agent-runs.ts` — `startAgentRun` / `finishAgentRun` (insert + update `agent_runs`, each appends the matching `run_started` / `run_finished` ledger event). Never throw. Loaded by the runner via dynamic import.
- `server/ledger.ts` — the write-at-source ledger: `appendEvent(e, { db? })` (insert, `onConflictDoNothing` on `uq_comms_events_ref`, never throws, injectable db), `LEDGER_EVENT_TYPES` (adds `draft_approved, draft_edited, flag_raised, flag_closed, flag_expired, run_started, run_finished, sample_reviewed`), typed helpers (`ledgerDraftCreated/Approved/Edited/Sent/Rejected/Failed`, `ledgerMessageOut`, `ledgerFlagRaised/Closed/Expired`, `ledgerFlagClosedForConversation`, `ledgerRunStarted/Finished`), the shared attribution vocabulary (`actorFromDraftSource`, `actorFromApprovedBy`, `roleProfileFor`, `INTERNAL_DIGITS`), and `ledgerDriftCheck(days=7)`.
- `server/agent-cost.test.ts` (8 tests), `server/ledger.test.ts` (7 tests, fake db).
- `migrations/20260902_agent_runs_ledger.sql`.

Changed
- `shared/schema.ts` — `agentRuns` table; `runId` on `messageDrafts`, `agentQuestions`, `nudgeQueue`, `commsEvents`; indexes.
- `server/agents/runner.ts` — `runAgent` takes `runId, trigger, conversationId, phone, packId, packVersion, caseFileRef, promptHash, transcriptRef, persist`; creates the `agent_runs` row before the first model call (id = `opts.runId ?? newRunId('run')`), completes it in a `finally` with usage / cost / duration / error / transcript_ref / turns whatever way the run ends (done, turn cap, truncation, thrown tool). Result gains `runId, model, costPence, durationMs`. Persistence is a lazy import so the runner stays db-free to import.
- `server/outbound.ts` — `sendCustomerMessage` appends `message_out` on every successful send (all three exits: explicit SMS, WhatsApp, SMS fallback) and `draft_sent` when the new optional `draftId`/`draftSource` inputs are set. Keys on the messages row id (= Twilio SID on both pipes), so the backfill converges on the same row.
- `server/message-drafts.ts` — `queueDraft({ runId })` stores it and appends `draft_created`; `approveAndSendDraft` appends `draft_approved` after the claim, `draft_edited` if the body differs from the outcome ledger's frozen proposal, `draft_rejected` on the opt-out refusal, `draft_failed` on total delivery failure, and passes `draftId`/`draftSource` to every send; PATCH `/:id` appends `draft_edited` with the previous body; POST `/:id/reject` appends `draft_rejected`.
- `server/agents/comms.ts` — `runCommsAgent(id, trigger, { runId? })` mints the run id BEFORE the tools exist and passes it to `runAgent`; `queue_draft` → `queueDraft({ runId })` and `approveAndSendDraft(id, by, runId)`; `flag_for_ben`, the stall-loop flag, `routeRefusalsToBen` and the blocked-prep flag in `maybeAutoQuotePrep` all carry it; `schedule_recontact` writes `nudge_queue.run_id`; `set_board_state` removing `needs_ben` appends `flag_closed`; `flagThreadForBen` takes `runId`/`source`, stores `run_id`, appends `flag_raised`, returns `questionId`; the handoff calls `runQuotePrep(id, { trigger: 'comms_handoff', parentRunId })`. The old `randomUUID()` SSE run id is gone — the SSE stream and the ledger now share one id.
- `server/agents/quote-prep.ts` — `runQuotePrep(id, { runId?, trigger?, parentRunId? })`, returns `runId`.
- `server/agents/recovery.ts` — tools built per run (`buildTools(runId)`); both `nudge_queue` inserts write `agent_run='recovery'` and `run_id`; `runRecovery({ runId?, trigger? })`.
- `server/agents/sla-sweep.ts` — one `newRunId('sweep')` per pass; the chase's `queueDraft` and `approveAndSendDraft` carry it (`chase` callback type gains optional `runId`).
- `server/agents/promise-tracker.ts` — one `newRunId('sweep')` per `flagOverdueCommitments` pass, passed to `flagThreadForBen` with `source: 'promise_tracker'`.
- `server/agents/ops-manager.ts` — one run id per turn, `trigger: 'ops_manager_turn'`, `buildTools({ runId })` so its `flag_for_ben` carries it.
- `server/agent-staff.ts` — `finalizeQuoteSent` appends `flag_closed` (`system:quote_sent`) when it retires `needs_ben`.
- `server/comms-ledger.ts` — imports the attribution vocabulary from `ledger.ts` (one copy), re-exports `ledgerDriftCheck`, and the backfill now writes `run_id` from `message_drafts.run_id`. `syncCommsLedger` unchanged otherwise (still the backfill / reconciliation).

## How I verified

- **tsc gate** — `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | sort` on the start commit (c89b25e) and on the finished tree: **1886 errors both**. Diffed with line numbers stripped: the only differing lines are 11 pre-existing errors whose union-type members tsc prints in a different order run to run (same file, same code, same message otherwise). Zero new errors, zero removed. One tsc at a time throughout.
- **vitest** — `DATABASE_URL=postgres://u:p@127.0.0.1:1/x npx vitest run`: baseline 42 failed / 512 passed / 8 skipped (23 files); finished tree 42 failed / 527 passed / 8 skipped (25 files) — the same three failing files (eve-pricing-engine, segment-classifier, contractor-pay), plus my 15 new tests passing. One intermediate run showed a 43rd failure in `call-script/__tests__/performance.test.ts` ("full flow < 5ms", measured 11ms) while tsc was running concurrently; it passes 3/3 in isolation and imports nothing I touched — a wall-clock assertion, not a regression.
- **Mechanical checks** — every `queueDraft` / `flagThreadForBen` / nudge insert / `approveAndSendDraft` inside the five agent files carries a run id (grep); `sendCustomerMessage` appends on all three success exits; no `randomUUID` run id left in `runCommsAgent`.
- Not run: anything against a database (the migration is applied by the orchestrator), the dev server, any agent.

## Not done / not in scope, and why

- **Tags do not carry a run id.** `conversations.tags` is a text[] with no per-tag provenance and the brief's step 3 lists only drafts / flags / nudges. Tag changes that close a flag are ledgered (`flag_closed`); other tag writes are not.
- **`flag_expired`** — helper exists (`ledgerFlagExpired`); nothing calls it. Expiry with the holding line is pane B's (silence-breaker) work.
- **`sample_reviewed`** — event type declared; no writer (Phase 3 sampler).
- **`decision` / `lane` / `proposal` / `guards_hit` / `pack_id` / `pack_version` / `prompt_hash` / `case_file_ref`** on `agent_runs` — columns exist and `finishAgentRun` accepts them; today's agents have no packs or lanes, so they stay null until Phase 2's spine writes them.
- **Cron wiring for `ledgerDriftCheck`** — pane B's, as the brief says. The function is exported from both `server/ledger.ts` and `server/comms-ledger.ts`.
- **`draft_rejected` for `comms_agent:superseded` / `hours_gate:stale_by_morning` / `ack_hold:superseded`** — those rejections are written directly by the agent and the sweeps, not through `approveAndSendDraft`; the backfill sync still records them. Left for the Phase 5 deletion of those paths rather than adding three more call sites now.
- `scripts/` that call `runRecovery()` / `runQuotePrep()` are unchanged (optional-args, still compile).

## Decisions the design left open

1. **`agent_runs.conversation_id` is `varchar`, not `uuid`.** `conversations.id` is a 32-hex varchar (e.g. `b57b6790401ff28a3db04d58ff1e366f`), which is not a valid uuid literal; a uuid column could never be joined or even inserted. The brief's `uuid null` would have broken every insert.
2. **Cache writes are billed at 125% of the input rate** (Anthropic's standard prompt-caching price). The brief specified only the 10% for reads.
3. **Cost rounding** — `cost_pence` is whole pence, rounded to nearest; sub-penny runs record 0. `computeCostUsd` keeps the precision for anyone summing.
4. **The run id is minted by the agent, not the runner**, wherever the agent's tools write (comms, recovery, ops-manager): the tools are closures built before `runAgent` is called, and a draft written mid-run must carry the id before the run row is complete. The runner accepts `opts.runId` and defaults to `newRunId('run')` for callers that do not mint one (ops-brief, quote-estimator).
5. **Sweeps get a run id too** (`newRunId('sweep')` per pass in sla-sweep and promise-tracker) even though they are not agent runs and write no `agent_runs` row. A chase or flag with no run id is exactly the "did not happen" the design forbids; a sweep-prefixed id is honest about its origin and greppable.
6. **`run_started` / `run_finished` for runs with no customer** (recovery, ops-manager, ops-brief) use `phone = ''` and `role_profile = 'internal'` — `comms_events.phone` is NOT NULL and `''` is already the sync's "no counterparty" value.
7. **`draft_edited` is recorded twice-guarded**: the PATCH route records it as it happens (previous body in `meta.previousBody`); `approveAndSendDraft` compares the final body against the outcome ledger's frozen proposal as a fallback for any other path that rewrote it. The unique ref means whichever lands first wins.
8. **`message_out` keys on the Twilio SID.** `sendCustomerMessage` does not write the messages row (meta-whatsapp.ts / sms.ts do, with `id = sid`), so the exit looks the row up by `id` or `twilio_sid` to fill `conversation_id`/`occurred_at`, and keys the event on the row id. A send with no SID (Meta coexistence transport) is left to the backfill.
9. **quote-prep's parent run** is recorded as `transcript_ref = 'parent:<comms run id>'` — `agent_runs` has no parent column in this phase and adding one was not in the brief.
10. **`nudge_queue.agent_run`** now says `'recovery'` on recovery's rows (it was null; comms already wrote `'comms'`), alongside the new `run_id`.
11. **`ledgerDriftCheck` compares eight pairs** (messages in/out, calls, drafts created/sent/rejected, flags raised, runs started) over a trailing window keyed on the source table's own timestamp vs `occurred_at`; it returns the per-pair delta and `clean: totalAbsDelta === 0`. It does not compare bodies or actors.
