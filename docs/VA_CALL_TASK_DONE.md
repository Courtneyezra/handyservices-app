# VA Call Tasks — DONE (28 Aug 2026)

Implementation of `docs/VA_CALL_TASK_BRIEF.md`: speed-to-lead call tasks on text-channel
enquiries. A first-contact (or returning-after-60d) WhatsApp/SMS/webform enquiry opens a
"ring this person within 15 working minutes" task, pings the on-call human via Pushover with
a `tel:` link, and holds deep LLM triage until the task resolves. The feature sends **nothing**
to the customer, ever — the test suite asserts that property directly.

Status: **all green**. `npx tsx scripts/_test-va-call-tasks.ts` → 52 passed, 0 failed.
`npm run check` → clean (the two pre-existing corrupted scripts, `scripts/seed-diy-advice.ts`
and `scripts/scrape-reddit-value-drivers.ts`, produced no errors in this run either).

Per instructions: **nothing committed**, **`npm run db:push` NOT run**.

---

## Files changed

### Schema & migration
- `shared/schema.ts` — appended `vaCallTasks` table (13 columns, strictly additive) with
  `idx_va_call_tasks_conversation`, `idx_va_call_tasks_due`, and the partial unique index
  `uq_va_call_tasks_open ON (conversation_id) WHERE completed_at IS NULL AND dismissed_at IS NULL`
  (DB-enforced one-open-task-per-conversation — the race-free shape, per the 27 Aug
  triple-send post-mortem). Exports `VaCallTask` / `InsertVaCallTask`.
- `migrations/20260828_va_call_tasks.sql` — idempotent `CREATE TABLE IF NOT EXISTS` + the
  three indexes.

### Core module
- `server/agents/va-call-tasks.ts` (new) — all the logic in one place:
  - `computeVaCallDueAt` — reuses `addWorkingHours` (promise-tracker) with 15/60h:
    08:00–20:00 Europe/London, out-of-hours defers to next 08:00+15m, DST-safe.
  - `maybeCreateVaCallTask` — the gates, in order: feature flag (fail-closed), channel
    exemption (`post_call`), `screenInbound`, `blockedByOptOut(phone,'service_reply')`,
    `readContactHistory` + `classifyHistory` (same first/returning gate as the
    first-contact ack, reusing its exported helpers), no prior `channel='call'` message
    across all of the contact's conversations, then insert with `.onConflictDoNothing()`
    (partial unique index absorbs races), hold triage to dueAt, `notifyVaCallTask`,
    `logSystemEvent`.
  - Triage hold/release — latest-writer-wins jsonb merge on
    `conversations.metadata.nextTriageAt` (same write shape as comms-lanes `arm()`);
    release is an unconditional now-write. Self-healing: the hold value IS the dueAt, so
    even a failed release resumes triage when the window lapses. First-contact ack is NOT
    held (it fires from its own lane before this one).
  - `completeVaCallTasksForCall` — CAS on the open state with a `createdAt < callAt`
    backfill guard.
  - `runVaCallTaskLane` — no open task → try create; open task + "text only" reply
    (same `classifyAckReply` classifier `tagAckReply` trusts) → dismiss
    `customer_prefers_text` + release; otherwise re-assert the hold.
  - `expireOverdueVaCallTasks` — sweep-discipline (select 10, cap 3, CAS update is the
    claim); `dismissedBy='system:expired'`, reason `'call window lapsed'`, triage
    released, ONE overdue ping (structurally guaranteed — the CAS can be won once),
    `logSystemEvent`, **no auto-send to the customer**.
  - `completeVaCallTask` / `dismissVaCallTask` / `dismissOpenVaCallTasksForPhone` /
    `findOpenVaCallTask` / `listVaCallTasks`.

### Wiring (one call each, all fail-safe try/catch + lazy import)
- `server/agents/comms-lanes.ts` — VA lane runs at the end of `runInboundLanes`,
  deliberately **after** `await arm(...)` (latest-writer-wins on `nextTriageAt`); GATE 0
  opt-out branch also dismisses any open task for the number.
- `server/call-thread.ts` — step 3c in `ingestCallRow`: any call landing on the thread
  auto-completes the open task.
- `server/agents/comms-sweep.ts` — one line in the fast tick runs
  `expireOverdueVaCallTasks()`.

### Config, notification
- `server/agents/comms.ts` — `vaCallTask: { enabled: boolean }` section added to
  `CommsAgentConfig`, default **false**, merged at all three sites (env override, DB
  stored config, `setCommsAgentConfig` patch) so `COMMS_CONFIG_OVERRIDE` is respected.
- `shared/pushover-settings.ts` — new event key `va_call_task`
  ("Call task — ring a new enquiry within 15 min", group Inbound, priority 1). Existing
  recipients (incl. Ben) are auto-subscribed: a missing key means ON.
- `server/pushover.ts` — `notifyVaCallTask(alert)`: who/number/channel, enquiry preview,
  "Ring them by HH:MM" (Europe/London) or overdue warning, comms-thread deep link in the
  body, and a **forced `tel:` supplementary link** regardless of the configured linkType —
  the ping's entire purpose is a phone call. Respects toggles and quiet hours; no-ops
  without `PUSHOVER_APP_TOKEN`.

### API & admin UI
- `server/va-call-tasks-routes.ts` (new) — GET list, POST `/:id/complete`,
  POST `/:id/dismiss` (reason required). Humans can only settle tasks, never mint one.
- `server/index.ts` — mounted at `/api/va-call-tasks` behind `requireAdmin`.
- `client/src/pages/admin/VaTasksPage.tsx` (new) — `/admin/va-tasks`: open tasks strictly
  dueAt-ascending, overdue rows highlighted, "Xm left / Xm over" countdown, `tel:` links,
  channel pills, thread deep links, Mark called / Dismiss (with reason prompt), recently
  resolved list with called/expired/dismissed outcomes. 15s auto-refresh.
- `client/src/App.tsx` — lazy route registered under ProtectedRoute(admin) + SidebarLayout.

### Tests
- `scripts/_test-va-call-tasks.ts` (new) — 52 checks across 6 stages: working-minutes
  arithmetic (incl. out-of-hours deferral), every trigger-gate refusal + genuine creation +
  returning-after-90d, mid-window lane behaviour (hold re-assert, prefers-text dismissal),
  call-ingest auto-completion + backfill protection + opt-out dismissal, sweep expiry (with
  the no-send property asserted against messages AND drafts, and a fixture-scoped one-ping
  check), and the real admin router on a loopback express server. Test isolation:
  `PUSHOVER_APP_TOKEN` deleted, `COMMS_CONFIG_OVERRIDE` process-local (also proves the kill
  switch by flipping it mid-suite), Ofcom reserved sub-range +44770090098x (unused by any
  other suite), full cleanup before staging and in `finally`.

---

## Schema / migration status — OWNER ACTION NEEDED

- `npm run db:push` was **NOT run** (shared production DB; deferred per instructions).
- However: the test suite applies `migrations/20260828_va_call_tasks.sql`'s DDL as an
  idempotent targeted run (`CREATE TABLE IF NOT EXISTS` via `db.execute`, the established
  comms_events precedent) — so **the `va_call_tasks` table and its indexes now exist in the
  shared DB**. This is purely additive; nothing existing was touched. The formal
  `db:push` / drizzle sync remains for the owner to reconcile at the next approved push.

## How to enable

1. The feature is **OFF by default** (`comms_agent.vaCallTask.enabled: false`). Enable via
   the stored comms config (`setCommsAgentConfig({ vaCallTask: { enabled: true } })` or the
   app_settings row), or per-process via `COMMS_CONFIG_OVERRIDE`.
2. Pushover: the `va_call_task` event is auto-ON for existing recipients (incl. Ben);
   tunable per-recipient in `/admin/notifications`. Switching the recipient to a VA later
   is a config swap, no code.
3. The admin list lives at `/admin/va-tasks`.

## Deferred / notes

- `npm run db:push` — owner approval (above).
- Nothing committed to git (per instructions).
- VA-as-recipient, escalation chains, and any auto-messaging on expiry are explicitly out
  of scope per the brief (expiry releases triage and lets the comms agent resume with
  context; it never texts the customer about the missed call window).
