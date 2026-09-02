# Phase 2 / A — spine core — DONE (2 Sep 2026)

Worktree `/Users/courtneebonnick/v6-wt-exit`, branch **`p2-spine`**, one commit on top of b48178e (comms-v3). Not merged, not pushed. No dev server, no DB queries, no app_settings writes.

**Ships dark.** Everything under `server/spine/` runs only when `app_settings.spine` is `{ enabled: true }` (read through the same fail-closed pattern as `comms_agent`; default and unreadable-row both mean off) AND the process is the comms worker. With the flag off every entry point is byte-for-byte legacy, with one deliberate exception the brief asked for (Ops Manager, below).

## Contract

`server/spine/types.ts` is **unchanged**. Everything I needed beyond it is additive and lives in new modules: `vocab.ts` (runtime twins of the type unions, `satisfies`-checked), `ExitOutcome` / `ExitDeps` (exit.ts), `RunOnceOpts` / `RunOnceResult` (index.ts), `TriageDeps` / `TriageModelSchema` (triage.ts), `SpineConfig` (config.ts).

## Migrations to apply

None. Phase 2 adds no columns: `agent_runs` (Phase 1) already has `pack_id`, `pack_version`, `case_file_ref`, `decision`, `lane`, `proposal`, `guards_hit`; flags reuse `agent_questions.due_at` / `run_id` and drafts reuse `message_drafts.due_at` / `run_id` (Phase 1 migrations). Case files are persisted to disk (`server/storage/case-files/`, gitignored), not the database.

## Files

New — `server/spine/`
- `config.ts` — `getSpineConfig` / `isSpineEnabled` / `setSpineConfig` / `useProcessLocalSpineConfig`. Key `spine`, defaults `{ enabled:false, sweepLimit:3, debounceMinutes:10, triageModel:'claude-haiku-4-5', city:'nottingham' }`. Fail closed.
- `vocab.ts` — `AUDIENCES, STAGES, TIERS, TRIGGERS, AGENT_NAMES, LANES, EXCEPTIONS, INTENTS (+ per-pack slices), GUARD_NAMES` and `isIntent/isLane/...` guards.
- `request-run.ts` — `requestRun(conversationId, trigger, { delayMs?, runId? })` writes the debounce row (`metadata.nextTriageAt` — the SAME key the legacy fast tick reads — plus `nextTriageTrigger`, `nextTriageRunId`); `runDue(limit)` is worker-only and flag-only: shared claim → lease the due time (CAS on its exact value) → `runOnce` → clear on success. **`claimTriageTurn` / `releaseTriageTurn` / `TRIAGE_TURN_MINUTES` moved here** from comms-sweep.ts, which re-exports them.
- `case-file.ts` — `buildCaseFile(conversationId)` per `CaseFile`: timeline (messages with quarantined excluded + calls with transcripts + pending drafts + open flags, oldest first), media items (image blocks on demand via `loadCaseFileImageBlocks` → media-context.ts; video descriptions null until Phase 4), window (`canSendFreeform`), client (`service_clients`), live quote (quote-context.ts), open promise (promise-tracker's `metadata.openCommitment`), open flags (`agent_questions` flagged + due_at), tags/stage, last `agent_runs` row. `hash` = sha256 of the key-sorted serialisation; persisted once to `server/storage/case-files/<hash>.json` (`CASE_FILE_DIR` env override); `loadCaseFile(hash)` reads it back for replay.
- `triage.ts` — `triageRules(caseFile)` (pure) then `triage(caseFile, deps)`: opt-out → dropped; spam (first-contact-ack's `SPAM_PATTERNS`) → dropped; money / date / complaint / refund / callback / regulated lexicons (the replay script's regexes) → Ben with the exception named; `trust_concern` tag → Ben; no outbound ever → rules lane (`ack_enquiry` / `ack_photos`); `needs_quote` → quote clerk; unpaid quote → post_quote; contractor audience → contractor; else scoper. Model call (Haiku via `claudeJsonWithUsage`) ONLY when the rules found no exception; zod-validated (`TriageModelSchema`); the model may add exceptions, never remove one, never set `won`; parse failure or throw → rules result with the reason appended. Writes tags (union, never removes) and stage (never `won`) on the conversation, and an `agent_runs` row (agent `triage`, with usage/cost) via Phase 1's `startAgentRun`/`finishAgentRun`. Non-UK numbers are not dropped.
- `packs.ts` + `packs/*.ts` — `rules.first_contact` (SEND), `rules.followup` (SEND, proactive hours only), `customer.default` (DRAFT), `customer.post_quote` (DRAFT, + `price_objection` guard), `customer.exception` (READ, no intents), `contractor.default` (DRAFT), `internal.ben` (everything, no guards). `resolvePack(caseFile, triage)`; `tierFor(pack, intent)`; `validatePack` runs at module load and refuses any customer-pack intent whose name smells of money or dates.
- `guards.ts` — `checkProposal(proposal, pack, caseFile)`: GuardName → draft-guards.ts detector; `capitulation` only after a price objection and `unseen_implication` only once the quote is viewed (same rules as `checkDraft`); `price_objection` reads the customer's last message; `customer_pii` / `money_to_customer` for the contractor pack. `ESCALATE_GUARDS` mirrors comms.ts's `ESCALATE_CODES` (+ price_objection, money_to_customer).
- `decide.ts` — pure. Order: drop (opted_out / spam) → flag (any exception, `due_at` 4 office hours or 20 min for callback) → none (no proposal) → flag (proposal's own flag) → pending (intent not in pack) → guard hit (Ben-only → flag with the mapped exception; other → pending) → tier READ/PROPOSE → none → open exception on thread → pending → hours (reactive within 45 min of an inbound if the pack allows, else the pack's proactive window in UK time; pending until the next slot) → deliverability (window open, or a pack template for the intent, or an SMS thread) → SEND with the pack's approver, else pending. `approverFor(pack, intent)`: `rules.ask` / `rules.holding` / `rules.first_contact` / `rules.followup` / `agent.scoper` / `agent.contractor_liaison`.
- `exit.ts` — `exit(run, deps?)`: send → `queueDraft` (source `spine`) + `approveAndSendDraft(id, approver, runId)`; pending → `queueDraft` with `dueAt` + `runId`; flag → `agent_questions` row (`[exception] note`, status flagged, `due_at`, `run_id`, source `spine:<agent>`) + `needs_ben` tag (priority high, urgent for callbacks) + ONE Pushover, deduped on the tag / open flags; drop/none → ledger only. Every outcome appends `run_decided` (new ledger event type) with the run id. Dependencies injectable.
- `index.ts` — agent registry (`registerAgent`, `getAgent`, placeholder `rules` agent returning null), `agentForLane`, `runOnce(conversationId, trigger, agents?, { runId?, dryRun? })` orchestrating case file → triage → pack → agent → guards → decide → exit and completing the `agent_runs` row with decision / lane / guards_hit / proposal; the `spine: SpineApi` object; re-exports.
- Tests: `triage.test.ts` (17), `decide.test.ts` (13), `exit.test.ts` (6). All without a database.

Changed
- `server/agents/comms-sweep.ts` — claim/release definitions removed and re-exported from the spine; `tickDueTriage` delegates to `runDue(3)` when the flag is on, else unchanged.
- `server/agents/comms-lanes.ts` — `arm()` calls `requestRun(id, 'inbound_message')` when the flag is on (the opt-out gate, first-contact ack, ack-reply tagging and VA call-task lanes are untouched); else the legacy arm, unchanged.
- `server/agents/ops-manager.ts` — `runCommsAgent` import removed; `run_comms_agent` now calls `requestRun(id, 'manual', { delayMs: 0 })` and returns `{ queued, reason, note }`.
- `server/approver.ts` — adds `agent.scoper`, `agent.quote_clerk`, `agent.recovery`, `agent.contractor_liaison`, `rules.followup` (additive).
- `server/llm.ts` — adds `claudeTextWithUsage` / `claudeJsonWithUsage` (usage + model returned); `claudeText` / `claudeJson` behave exactly as before.
- `server/ledger.ts` — adds event type `run_decided` + `ledgerRunDecided`; `actorFromDraftSource` maps `spine` / `spine:<agent>` to `agent:*`.
- `server/message-drafts.ts` — `DraftSource` gains `'spine'` (a service reply on a live inbound thread, like `comms_agent`).
- `server/__tests__/architecture.test.ts` — `server/spine/exit.ts` added to the `approveAndSendDraft` allowlist (it is the spine's exit).
- `.gitignore` — `server/storage/case-files/`.

## Verification

- **tsc** — `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | sort` on b48178e and on the finished tree: **1882 errors both**; diff by (file, error code) with line numbers stripped: nothing new, nothing gone. (The first pass had 5 new TS2802 errors from `[...set]` spreads in my files — the project sets no `target` — fixed with `Array.from`.) One tsc at a time throughout.
- **vitest** — `DATABASE_URL=postgres://u:p@127.0.0.1:1/x npx vitest run`: baseline 43 failed / 607 passed (the 42 known + `call-script/__tests__/performance.test.ts`, a wall-clock assertion that tripped while tsc ran alongside it); finished tree **42 failed / 644 passed**, the same three known files (eve-pricing-engine, segment-classifier, contractor-pay) and nothing else; my 36 new tests pass; the architecture test is green after the allowlist entry.
- **esbuild** — `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external` succeeds (3.6 MB, same as baseline).
- Not run: anything against a database, the dev server, any model call.

## Not done, and why

- **No agents ported.** The Scoper, Quote clerk and Recovery agents are the other Phase 2 panes'; they plug in through `registerAgent`. Until they do, a run whose lane needs an agent decides on triage alone (error noted on the run) — with the flag on that means: exceptions flag Ben, first contacts and everything else record a `none` decision and nothing is sent. The rules layer keeps sending its own acks/asks/holding lines from `server/rules-layer.ts` outside the spine, as the brief specifies (placeholder `rules` agent returns null).
- **Templates at the exit.** A SEND whose pack routes through a template (`decide` says deliverable via template) is queued as a freeform draft; `approveAndSendDraft` then refuses it with `OUTSIDE_WINDOW` if the window is shut, so nothing wrong is sent, but the template ladder is not walked by the exit yet. The rules agent is a placeholder, so no SEND reaches this path in Phase 2.
- **Video descriptions** in the case file are null (Phase 4).
- **`agent_runs` has no parent-run column**; the triage run and the agent run of one spine pass are separate rows sharing `case_file_ref`.
- **Ops Manager is not byte-for-byte legacy with the flag off**: its delegation tool used to run the comms agent synchronously and return the outcome; the brief asked for its direct `runCommsAgent` import removed and `requestRun` only, so it now queues (delay 0) and the legacy fast tick runs the agent within ~15 s. Everything else in legacy mode is unchanged.
- **Shadow mode** is available as `runOnce(..., { dryRun: true })` (computes and records everything, skips the exit) but nothing schedules it — optional per §10.

## Decisions the design left open

1. **Same debounce row for both modes.** `requestRun` writes `metadata.nextTriageAt`, the key the legacy tick already reads. With the flag off the row is consumed by the legacy agent; with it on, by `runDue`. One debounce, one claim, no dual-write.
2. **The claim moved, not copied**: comms-sweep re-exports the spine's `claimTriageTurn`, so legacy and spine runs share one floor per conversation.
3. **Triage skips the model whenever the rules found an exception or a drop** (§3.3 "any exception routes to Ben before any agent runs" read as: before any token is spent too). Cost: one Haiku call per non-exception run only.
4. **The model may only add exceptions, never remove one, and never set `won`** (`mergeTriage`).
5. **Flag rows carry `[exception] note`** as the question text so the case file can read an exception kind back; legacy flags fall back to the thread's tags (`trust_concern`, `callback_requested`) else `out_of_scope`.
6. **Reactive window = 45 min** from the last inbound (comms.ts's `REACTIVE_WINDOW_MINUTES`), reactive allowed only where the pack says `reactiveAlways` (`rules.followup` is never reactive).
7. **Deliverable** = window open, or a pack template for the intent, or an SMS thread. Landline detection stays inside `approveAndSendDraft`.
8. **PROPOSE tier → `none`** decision ("proposal recorded"). `Decision` has no propose kind and types.ts is frozen; the proposal itself is on the `agent_runs` row.
9. **`decide` treats an intent outside the pack as pending** (Ben sees it), not a flag: an agent overstepping its vocabulary is a bug to notice, not a customer exception.
10. **Guard → exception mapping**: money/discount/price_objection/money_to_customer → `money_question`; date_promise → `date_question`; the rest → `trust_concern`.
11. **`customer.default` includes `holding`** (as the design table lists it), at DRAFT like the rest.
12. **Case files persist to disk by hash, never rewritten**; identical content across runs is one file. `CASE_FILE_DIR` overrides the location.
13. **The triage `agent_runs` row uses trigger `triage`** (not the run's trigger) so it is distinguishable from the agent run it precedes.
