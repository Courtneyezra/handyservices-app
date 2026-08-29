# Brief: T5 — Ben's unified mobile portal (task inbox + quote review)

**Owner:** third-column bottom pane agent. **Dispatched:** 29 Aug 2026 by orchestrator
pane. **Goal:** the page a `quote_prep_ready` Pushover opens on Ben's phone: a unified
task inbox front door plus a quote review view with everything needed to approve/act
one-handed. This surface will eventually absorb the VA call tasks page (T2, in flight in
another pane) — build for that.

## Product shape

**Front door — task inbox** (`/admin/inbox` or similar):
- One list, newest/most-urgent first, of things needing a human: quote-prep verdicts
  (quote_ready / needs_info / visit_first), Ben-flagged threads, (later: VA call tasks,
  decline proposals). Each row: customer name, lane badge, age, one-line summary.
- Mobile-first: thumb-reach actions, large tap targets, works one-handed from a
  Pushover tap. Auto-refresh or poll.

**Review view** (tap a row):
- The WhatsApp/SMS conversation (last messages, scrollable), media thumbnails that
  open full-size (photos/videos already land on the thread — read them, don't build
  new intake).
- The clerk's output: **lane verdict + gap breakdown** — each gap with its audience
  (customer/ben) and impact label, and the proposed questions. **NO numeric confidence
  score anywhere** — lanes not scores (docs/AGENT_DECISION_FRAMEWORK.md line ~123).
- Proposed quote lines where they exist (titles only — clerk produces no prices).
- Actions: approve / send questions / mark visit-first / VA override (reassign lane),
  reusing whatever action endpoints already exist for the quote review flow (study
  `QuotePrepPanel` and its routes first). Ben's click is always the send trigger —
  this portal must never introduce an auto-send.

## Where the work lives

- New page(s) + components under `client/src/pages/admin/` and
  `client/src/components/` — favour small extractable components (TaskRow, LaneBadge,
  GapList, ThreadPreview, MediaStrip) over a monolith; T2's VaTasksPage will be folded
  in here after both land.
- Server: prefer existing GET/POST endpoints. If you need new read endpoints, add a NEW
  route file (e.g. `server/portal-routes.ts`) wired in `server/index.ts` — keep the
  index.ts diff to the single wiring line.
- Route registration in `client/src/App.tsx` (it already has uncommitted edits — add
  your route, change nothing else).

## Constraints

- DO NOT TOUCH: `client/src/pages/admin/VaTasksPage.tsx`, `server/va-call-tasks-routes.ts`,
  `server/agents/va-call-tasks.ts`, `server/pushover.ts`, `shared/pushover-settings.ts`
  (T2 owns); `server/post-call-outreach.ts`, `server/call-thread.ts` (T3 owns);
  `shared/eval-types.ts`, `scripts/eval-*.ts`, `eval-cases/*` (T7 owns);
  `server/agents/quote-prep.ts`, `server/agents/comms.ts`, `server/agents/comms-lanes.ts`,
  `server/agents/comms-sweep.ts`, `server/first-contact-ack.ts` (other streams own).
- Pushover deep-link change (making quote_prep_ready alerts open this page) is
  DEFERRED — report the desired URL format back to the orchestrator; do not edit
  pushover.ts.
- Decline-proposal review (T6a) lands later — leave an obvious seam (e.g. the lane badge
  and actions components take a lane string, unknown lanes render harmlessly).
- No messages to real recipients from any action while testing; test against dev DB
  threads. Typecheck/build must stay green (`npm run build` or the project's check).
- If an action endpoint you need doesn't exist and would require editing an owned file,
  STOP on that action and report back; ship the read-only view regardless.

## Done means

Inbox + review view usable one-handed on a phone; lane + gap breakdown rendered with
audience/impact, no numeric score; media visible; actions wired to existing endpoints
(or reported as missing); components extractable; build green. Report: routes added,
components created, endpoints used/missing, desired Pushover deep-link URL, and a
screenshot-level description of both views.
