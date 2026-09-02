# Phase 0 / A — the single exit — DONE (2 Sep 2026)

Worktree `/Users/courtneebonnick/v6-wt-exit`, branch **`p0-exit`** (the brief said `comms-v3/exit`; a flat branch named `comms-v3` already exists so git refuses that name — the orchestrator created `p0-exit` from `comms-v3` @ c7e8410 and I worked there). Two commits on top of c7e8410. Not merged, not rebased, not pushed.

## Files changed

New
- `server/approver.ts` — `Approver` union (19 automated values + `human:${string}`), `isApprover` (runtime twin), `isAutomatedApprover` (enum + legacy `comms_agent:` / `hours_gate:` / `first_contact_ack:` / `v2_pipeline:` prefixes), `isAgentApprover`, `humanApprover`, `approverLabel`, `newRunId(prefix)` → `<prefix>_<uuid>`.

The gate
- `server/outbound.ts` — `SendCustomerMessageInput.approver: Approver` and `runId: string` are REQUIRED. First thing in `sendCustomerMessage`, before the opt-out rule: if `approver` is not a valid `Approver` or `runId` is not a non-empty string → `console.error`, `logSystemEvent({ kind: 'send_refused', … })`, return `{ ok:false, error:'MISSING_RUN_ID_OR_APPROVER', attempts:[], fellBack:false }`. Approver + runId also added to the existing "WhatsApp failed, SMS carried it" event detail.
- `server/system-events.ts` — new kind `send_refused`. `client/src/pages/admin/ActivityPage.tsx` lists it (red pill).

approveAndSendDraft
- `server/message-drafts.ts` — `AUTOMATED_APPROVER` regex deleted; `approveAndSendDraft(draftId, approver: Approver, runId = newRunId('draft'))`; stores the enum string in `approved_by`; passes `approver, runId` into all 5 internal sends; the "don't double-report agent sends" exclusions use `isAgentApprover`; Pushover headline uses `approverLabel`; the approve route stamps `human:<email|id|admin>`.
- Importers: `server/agents/comms.ts` (`agent.comms` for the first-contact allowance path, `agent.comms.autosend` otherwise), `server/agents/comms-sweep.ts` (approver strings ONLY: `agent.comms.autosend`, `rules.hours_gate`, `rules.first_contact`), `server/agents/sla-sweep.ts` (`agent.sla_chase` + comments), `server/first-contact-ack.ts` (`rules.first_contact` ×2). `promise-tracker.ts`, `auto-ack-window.ts`, `outbound.ts`, `agent-staff.ts` only mention `approveAndSendDraft` in comments — nothing to change there.

Direct callers (34 call sites in 16 files, every one now carries `approver` + `runId`)
- `agent-staff.ts` → `system.staff`, ONE `runId` per send-quote click hoisted above the burst loop
- `cron.ts` → `system.cron` · `customer-notifications.ts` → `system.notification` · `daily-planner-routes.ts` ×3 → `system.daily_planner` · `invoice-generator.ts` → `system.invoice` · `invoices.ts` → `system.invoice` · `landlord-portal.ts` → `system.landlord_portal` · `lead-automations.ts` ×5 → `system.lead_automation` · `live-call-actions.ts` → `system.live_call` · `quick-replies.ts` ×2 → `system.quick_reply` · `quotes.ts` ×3 → `system.quotes` · `services/webform-chase-service.ts` ×2 → `system.webform_chase` · `voice-notes.ts` → `system.voice_note` · `whatsapp-template-sync.ts` → `system.template_sync`
- `whatsapp-api.ts` ×3 — the enum has no entry for this file: `/send` (the composer) and `/send-template` are a person's own click on a `requireAdmin` route → `human:<email|id|admin>`; the async status-callback SMS recovery → `system.notification`.
- Every runId without an agent run in scope is `newRunId('sys')` inline.

Readers of the stored approver (kept old rows AND new values working)
- `server/comms-ledger.ts` `senderFromApprovedBy` — maps `human:*`, `agent.*`, `rules.*`, `system.*` first, then the legacy prefixes.
- `server/inbox-board.ts` chip — `isAgentApprover` / `approverLabel` instead of `startsWith('comms_agent')` and `split('@')`.
- `server/auto-ack-window.ts` — new `AUTO_ACK_APPROVER = 'rules.first_contact'`; the machine-sent query is now `approved_by = 'rules.first_contact' OR LIKE 'first_contact_ack:%'`.

Scripts (tsconfig includes `scripts/**`, so they must compile)
- `scripts/_test-send-path-guards.ts`, `scripts/_first-contact-ack-test.ts`, `scripts/comms-board-clearout.ts` (operator = `human:$USER`, one `RUN_ID` per invocation), `scripts/archive/_opt-out-test.ts`, `_outcome-loop-test.ts`, `_pipeline-e2e-test.ts` — legacy strings → enum values, `sendCustomerMessage` calls stamped.
- `scripts/seed-diy-advice.ts`, `scripts/scrape-reddit-value-drivers.ts` — line 1 `x**` → `/**` (one character each). **Read the tsc section: this matters to every pane.**

## What I verified and how

**tsc.** ⚠️ Finding for the orchestrator: on the base commit `npm run check` is NOT a type-check. Those two scripts have had `x**` on line 1 since cc574b9 (14 Apr 2026); tsc reports only syntactic diagnostics when any file fails to parse, so the repo has been syntax-checked only for 4½ months. With the typo fixed the full project shows **1887 pre-existing semantic errors** (1453 unique file+message lines; 69 in `client/`, the rest in `server/`, `shared/`, `scripts/`, plus 4 that tsc pulls in from `../v6-switchboard/…` through the node_modules symlink). "tsc clean" is therefore not achievable inside this brief. What I proved instead, which is what the brief's tsc rule is for:
- Ran the identical `npm run check` on the base (stash + typo fix only) and on my tree, normalised away line numbers, and diffed: **zero new errors, zero removed** (1887/1453 both sides; the only diff lines are the same errors with union members printed in a different order). A missed or wrongly-typed caller would be a new TS2345/TS2741 and there is none.
- Also ran a server+shared+scripts-only program both sides: same result (the single new error it caught was my own wrong `../server/approver` path in an archive script, fixed).
- Mechanical check: every `sendCustomerMessage({` in `server/` (34) and `scripts/` (6) has `approver` within two lines; `grep AUTOMATED_APPROVER` finds only the new `AUTOMATED_APPROVERS` constant in approver.ts.

**vitest.** `npx vitest run` in the worktree: **42 failed / 456 passed, 6 files failed / 14 passed — identical to the baseline** run on the untouched checkout before any edit (same files, same tests). None touch this work: 3 files (`sparse-day-fees`, `ops-manager-guards`, `per-line-guardrails`) die at import on `DATABASE_URL must be set` (the worktree has no `.env`, and rule 2 forbids me a DB); the rest are pricing-engine / segment-classifier / contractor-pay assertion failures that pre-date this branch. No test exercises `outbound.ts` or `message-drafts.ts`. I did not fix unrelated tests.

Not run, per the rules: dev server, any DB query, app_settings, push.

## Could not do / did not do, and why
- **approver + runId on the outbound `messages` row.** `messages` in `shared/schema.ts` has no metadata/jsonb column (and `sendCustomerMessage` does not write that row itself — `sendWhatsAppMessage`/`sendSmsMessage` do). Per the brief: no schema change this phase. They ARE recorded on `system_events` (`send_refused` row; the WA→SMS fallback row) and the approver lands in `message_drafts.approved_by` for every draft release. Phase 1's write-at-source ledger is where the run id joins the message.
- **tsc fully clean / vitest fully green** — see above; both are pre-existing and out of scope.
- **`comms-sweep.ts`** touched only for the three approver strings. The `v2_pipeline:autosend` line (61) is inside the V2 branch another pane is deleting; the merge will conflict on that one line — take the deletion.

## Decisions the design did not specify
1. `isAutomatedApprover` returns **false** for a legacy bare email / `'admin'` (old human approvals) and for `human:*`; true for the enum, any `agent.`/`rules.`/`system.` prefix, and the four legacy machine prefixes. So old human rows stay human.
2. Meaning of plain `agent.comms`: the comms agent releasing its own draft under the first-contact allowance (was `comms_agent:first_contact_ack`). Kept as `agent.*` rather than `rules.first_contact` so message-drafts' "agent reports its own sends" exclusion still holds and Ben is not pinged twice.
3. The gate checks **validity** (`isApprover`), not just presence: a JS-shaped caller passing a legacy string is refused, loudly. Every TS caller is enum-typed so nothing legitimate trips it.
4. `approveAndSendDraft` takes an optional third `runId` (default `newRunId('draft')`) so a caller with an agent run in scope can thread it through later; none does today.
5. `whatsapp-api.ts` composer + send-template → `human:<id>`; async SMS recovery → `system.notification`. `quick-replies` and `agent-staff` use their enum entries even though a person clicks them, as the brief's enum implies.
6. Rejection stamps (`comms_agent:superseded`, `hours_gate:stale_by_morning`, `ack_hold:superseded`, the reject route's bare email) are untouched — they are not approvals and `CommsPage` keys on them.
7. Fixed the two `x**` scripts. Identical one-character fix auto-merges if another pane does the same.
