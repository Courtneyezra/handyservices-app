# Phase 1 / C — verdict capture + agent runs drawer — DONE

Worktree `/Users/courtneebonnick/v6-wt-config`, branch `p1-verdicts`, started from `c89b25e` (comms-v3).

## Migrations to apply (in order)

1. `migrations/20260902_draft_verdicts.sql` — creates `draft_verdicts` (+ two indexes) and adds
   `message_drafts.original_body text null`. Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

Matching Drizzle: `shared/schema.ts` → `draftVerdicts` table, `DRAFT_VERDICTS` / `VERDICT_REASONS`
constants and types, `messageDrafts.originalBody`. `db:push` was not run.

## Files changed

**Server**
- `server/verdict-stats.ts` — new, pure: `aggregateVerdicts`, `bucketForSources`, `intentFromReason`,
  `topReason`, `isVerdictReason`, `isDraftVerdict`. No db.
- `server/verdict-stats.test.ts` — new, 14 vitest cases over a fake dataset (counts, unedited rate,
  unsafe, reason counters, per-source / per-intent / per-approver, empty input, helpers).
- `server/verdicts.ts` — new: `recordVerdict` (never throws), `approvalVerdict`, `runIdOfDraft`,
  `verdictStats(days)` (join to `message_drafts` for source + `[intent]`), `verdictsRouter` with
  `GET /stats?days=30`.
- `server/agent-runs.ts` — new: `listAgentRuns(conversationId)` over `agent_runs` by raw SQL,
  `GET /api/agent-runs?conversationId=&limit=`. Returns `{ runs: [], available: false }` when the
  table does not exist (Postgres 42P01) instead of a 500.
- `server/message-drafts.ts` — PATCH keeps the first-edit body in `original_body` (COALESCE, so a
  second edit never overwrites it). `POST /:id/approve` accepts `{ reason }` (default `'fine'`,
  400 outside the vocabulary) and writes a verdict — `'edit'` when `original_body` differs from
  `body`, else `'approve'` — for every claim that succeeded (`NOT_PENDING` writes nothing).
  `POST /:id/reject` now REQUIRES `{ reason }` (400 with the allowed list otherwise) and writes a
  `'reject'` verdict. `by` is always `human:<id>` via `humanApprover`.
- `server/agent-staff.ts` — `/api/agents/staff` now also returns `verdictWindow` and, per member,
  `verdicts` (30-day slice by draft source: comms ← `comms_agent` + `first_contact_ack`,
  recovery ← `recovery`, ops-manager ← `ops_manager`) plus badge stats "Approved unedited (30d)"
  (good ≥ 90%, warn < 80%) and "Marked unsafe (30d)" when > 0. Verdict stats failure (table not
  yet migrated) is caught and the directory still renders.
- `server/index.ts` — mounts `/api/verdicts` and `/api/agent-runs` behind `requireAdmin`.

**Client**
- `client/src/components/comms/VerdictReasonChips.tsx` — new: the five chips
  (fine / tone / wrong move / unsafe / missing info); tapping a chip submits.
- `client/src/components/comms/AgentRunsDrawer.tsx` — new: collapsible "What the agent did" with
  run count; runs newest first, one summary line (agent · decision/lane · age · cost, guard count
  badge, status dot), tap to expand trigger/lane/decision/model/duration/usage/cost, guards hit,
  proposal body + remaining JSON, error, run id. Empty state; separate "not switched on" state.
- `client/src/lib/due-label.ts` — new: `dueLabel(dueAt)` → "due in 2h" / "overdue by 40m" / null.
- `client/src/pages/admin/CommsPage.tsx` — `DraftApprovalCard`: approve-as-is stays one tap
  (reason `fine`); approve after an edit shows the chips first ("You changed it — why?"); reject
  shows the chips first ("Why reject?"). `DueChip` on drafts and on the flag note, rendered only
  when `dueAt` is on the payload. `AgentRunsDrawer` mounted in `ThreadPanel` above the live-run strip.
- `client/src/components/ops/DraftApprovalCard.tsx` — the ops-dock / Desk card also hits
  `/api/drafts/:id/reject`, so it gained the same reject chips; approve sends `reason: 'fine'`.
- `client/src/pages/admin/AgentStaffPage.tsx` — `WorkerHeartbeatStrip` above the roster (alive /
  STALE / no heartbeat, last beat age, host, build, which process served the page); `VerdictBlock`
  in the dossier (unedited %, approved / edited / rejected, unsafe, reason breakdown, samples,
  the §4 gate in one line). Types `StaffVerdicts`, `WorkerHeartbeat`.

## How I verified

- `DATABASE_URL=postgres://u:p@127.0.0.1:1/x npx vitest run`: baseline 42 failed / 512 passed / 8
  skipped (23 files, 3 failed); after: 42 failed / 526 passed / 8 skipped (24 files, 3 failed).
  The failing-file set is byte-identical (diffed the sorted summaries). New file
  `server/verdict-stats.test.ts` 14/14.
- tsc (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`, ~8 min): baseline
  1886 errors on `c89b25e`, 1886 after. Compared as per-file × error-code counts (a plain sorted
  diff shows ~60 lines of churn where tsc prints union members in a different order between runs;
  none are new errors). Per-file diff is empty. The three errors my first pass introduced
  (`[...map]` spreads under the project's ES5 target, TS2802) were fixed with `Array.from`. The
  remaining errors in files I touched (`CommsPage.tsx` MapIterator, `message-drafts.ts` Set
  iteration, `schema.ts` `$inferInsert`) are pre-existing with identical counts.
- No dev server, no DB queries, no `app_settings`, no push. The routes were not exercised against
  a database (rule 2); their SQL is Drizzle query-builder for verdicts and one raw SELECT for
  `agent_runs`, both read-only except the two inserts and the PATCH.

## Not done / not possible here, and why

- **Ledger events `draft_approved` / `draft_edited` / `draft_rejected` are pane A's** (write-at-source
  ledger). I only write `draft_verdicts`; `pushCommsEvent` on the SSE bus is unchanged.
- **`run_id` on the verdict** is read defensively from the draft row (`runId` or `run_id`) because
  pane A adds that column to `message_drafts`. On this branch it is always null.
- **`agent_runs` is not in my `shared/schema.ts`** on purpose: pane A owns the table definition and
  two definitions would collide at merge. The route uses raw SQL and compares
  `conversation_id::text`, so it works whether pane A lands the column as uuid (its brief) or
  varchar (what `conversations.id` actually is — a dashless 32-hex string, NOT a valid uuid; pane A
  should check that before typing the column uuid).
- **`due_at` rendering is untested against real payloads** — the column is pane B's; the chip
  renders only when `dueAt` is present, so this branch shows nothing there today.
- **No e2e of the chips** (no dev server). The flows were traced by reading: PATCH → approve with
  reason; reject with reason; ops card reject with reason.

## Decisions the design / brief left open

1. **`draft_id` is `varchar`, not `uuid`.** `message_drafts.id` is varchar (32-hex, no dashes); a
   uuid column cannot hold it. Everything else in the brief's DDL is as specified, including the
   column named `"by"` (quoted in SQL; Drizzle quotes identifiers so `text("by")` is fine).
2. **`message_drafts.original_body`** — an extra column, not in the brief, so "edit" can be told
   from "approve" at approval time without depending on `agent_outcomes` having captured the
   proposal. Set once on the first PATCH.
3. **A verdict is recorded on every successful claim, not only on a successful send.** A human
   approving a draft that then hits OUTSIDE_WINDOW / SEND_FAILED / OPTED_OUT is still a verdict
   about the words. `NOT_PENDING` (double-click) writes nothing.
4. **Unedited-approval rate = approve ÷ (approve + edit + reject)**, samples excluded. Rounded to
   one decimal. `unsafe` counts rejects, edits AND `sample_not_fine` tagged unsafe (any of them is
   the demotion trigger in §4).
5. **Chip tap submits** (no separate confirm) — one tap for Ben, per §8 "two-tap approve/edit/reject".
   Approve-as-is never shows chips; the server defaults `reason` to `fine`.
6. **Reject without a reason is a 400.** The two UI callers were both updated. Any script or
   external caller POSTing `/reject` bare will now get 400 with the allowed list in the body.
7. **Quote-prep has no verdict slice.** Its outbound messages are queued as `comms_agent` by the
   quote-prep routes in `agent-staff.ts`, so they count under the comms agent. Splitting them
   needs a distinct source, which is pane A / Phase 2 territory.
8. **Existing `agent_outcomes` ledger left untouched.** `recordDraftVerdict` (edit-distance based,
   no reason codes) keeps running alongside; `draft_verdicts` is the Phase 1 stream the gate reads.
   Phase 5 can retire one of them.
