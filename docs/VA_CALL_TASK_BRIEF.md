# Build Brief: VA Call Tasks (speed-to-lead calling on text-channel enquiries)

You are working alone in this checkout (no other agents this time). Do NOT git commit — leave
changes in the working tree. Owner decisions below are final; where something is unspecified,
follow existing codebase patterns and keep scope tight.

## Why

Text-channel enquiries (WhatsApp, SMS, webform) convert best when a human CALLS the customer
quickly. The first-contact ack already asks "Is it OK if we give you a quick call?" and
`tagAckReply` already detects "yes call me" / "text only" replies — but nothing ever tells a
human to pick up the phone, and nothing tracks whether they did. Inbound VOICE enquiries are
exempt: voice contact already happened.

## Owner decisions (final)

- Recipient: **Ben for now** via Pushover (new event type; a VA becomes a config swap later).
- While a task is open: **ack sends as today, deep LLM triage is HELD** until the task resolves
  or expires (mechanism below).
- Timer: **15 working minutes** (08:00–20:00 Europe/London). Out-of-hours enquiries are
  DEFERRED (dueAt = next 08:00), never skipped.
- Channels: **all three** — whatsapp, sms, webform. They already share one front door
  (webform: server/leads.ts:106-128 normalises the phone, merges the conversation, stores a real
  inbound message, and hands to the comms lanes).

## Spec

### Trigger (create a task)
On inbound via whatsapp/sms/webform when ALL hold:
- First contact or returning-after-60d — the SAME gate the first-contact ack uses (see
  `server/first-contact-ack.ts`: `isFirstContact`, `returningAfterDays`, geo + spam screening).
  Reuse its exported helpers; do not duplicate the screening logic.
- No message with channel 'call' anywhere in the thread (any direction).
- Not opted out (`blockedByOptOut`, purpose 'service_reply').
- No open task already exists for the conversation.
- Feature flag on (see Kill switch).

Best single hook point: the comms lanes entry (`server/agents/comms-lanes.ts`,
`scheduleInboundTriage`) — all three channels funnel through it, and the opt-out gate (GATE 0)
already runs there. Create the task after GATE 0 passes, alongside the immediate lanes.

### The task record
New table `va_call_tasks` in `shared/schema.ts` (additive schema change only):
`id, conversationId, phone, contactName, channel ('whatsapp'|'sms'|'webform'), reason (short
text), createdAt, dueAt, completedAt, dismissedAt, dismissedBy, dismissReason, notifiedAt`.
Apply with the repo's normal drizzle flow (check how `migrations/` entries were produced for
recent tables and follow that practice; schema change must be strictly additive — this DB is
shared with production).

### Timer semantics
- dueAt = createdAt + 15 working minutes inside 08:00–20:00 Europe/London; if created outside
  hours, dueAt = 15 min after next 08:00. REUSE `addWorkingHours` from
  `server/agents/promise-tracker.ts` (exported; if not, export it) — do not write a second
  working-hours clock.
- Expiry: a sweep (see below) marks the task expired (use dismissedBy = 'system:expired' on
  dismissedAt — no new status column needed) and RELEASES triage. Do NOT auto-send any new
  customer message on expiry — the comms agent resumes with full context and decides.

### Holding triage while the task is open
The debounced triage lane already runs off `conversations.metadata.nextTriageAt`
(`arm()` in comms-lanes.ts). When a task is created, push `nextTriageAt` to the task's dueAt so
the LLM does not run a full text intake while a call is imminent. On task completion/dismissal/
expiry, pull `nextTriageAt` back to now-ish so triage resumes promptly. The first-contact ack
is NOT held — it goes out as today (it sets up the call). Be careful with the existing
`triageHeldUntil` atomic claim and `nextTriageAt` CAS semantics added 27-28 Aug in
comms-sweep.ts — read `claimTriageTurn` before touching anything.

### Fulfilment (auto-complete)
Any call logged on the thread AFTER task creation completes it. Hook where calls are ingested
into threads (`server/call-logger.ts` → `ingestCallIntoThread` in `server/call-thread.ts`):
if an open task exists for the conversation, set completedAt and release triage (call
transcript is now in-thread; the agent triages with that context).

### Auto-dismiss
- Customer replies "text only" — extend/reuse the existing `tagAckReply` detection in
  comms-lanes.ts; dismiss with dismissReason 'customer_prefers_text' and release triage.
- Opt-out recorded for the phone → dismiss.
- Manual dismiss from admin (route below).

### Notification
- New Pushover event key `va_call_task` in `shared/pushover-settings.ts` + a
  `notifyVaCallTask()` in `server/pushover.ts` following the existing function shapes
  (tappable `tel:` link + thread deep link, respect per-recipient event toggles and quiet
  hours). Ben's existing recipient gets it by default ON.
- On expiry, log a system event (`logSystemEvent`) — do not re-ping endlessly. ONE overdue
  re-ping max, if trivial to add; otherwise skip re-pings entirely for v1.

### Sweep
Expiry/overdue handling belongs in `server/agents/comms-sweep.ts`'s existing tick (follow the
`fallbackOverdueCallbacks` / `flagOverdueCommitments` pattern; cap actions per pass; errors
leave state for retry). Keep the new logic in a new file `server/agents/va-call-tasks.ts` with
one wiring call in the sweep, like promise-tracker did.

### API + minimal admin UI
- Routes on the existing admin surface (follow `server/agent-staff.ts` router conventions or a
  small new router mounted like the others): list open/recent tasks, mark-called (manual
  complete), dismiss (with reason).
- Client: minimal page `/admin/va-tasks` (follow an existing simple admin page's structure,
  e.g. the plainer pages in client/src/pages/admin/): pending + overdue lists sorted by dueAt,
  overdue highlighted, per-row buttons Mark called / Dismiss, phone as tel: link, link into the
  comms thread. Keep it plain shadcn/Tailwind consistent with the rest. Register the route
  wherever admin routes are registered (wouter).

### Kill switch
Config flag consistent with the others (see `getCommsAgentConfig` /
`comms_agent.firstContactAutoAck.enabled` pattern): `comms_agent.vaCallTask.enabled`,
**default false** in code. Respect `COMMS_CONFIG_OVERRIDE` test isolation.

## Guardrail alignment (do not regress 27-28 Aug work)
- Creating/holding/releasing triage must respect `claimTriageTurn` (comms-sweep.ts) — no new
  check-then-act races. Use CAS/jsonb-merge patterns for metadata writes.
- No new path may send a customer message except the existing choke points. This feature sends
  NOTHING to the customer itself.
- Test isolation: `COMMS_CONFIG_OVERRIDE`, Ofcom numbers +447700900xxx (use a sub-range not
  used by _test-send-path-guards / _test-autonomy-guards / _test-content-guards — check them),
  disarm Pushover in tests by deleting PUSHOVER_APP_TOKEN, clean up fixtures in finally.

## Quality bar
- Rationale-heavy, incident-dated comments in house style.
- `scripts/_test-va-call-tasks.ts`: trigger gates (first contact yes / mid-thread no / call in
  thread no / opted out no), working-hours dueAt arithmetic incl. out-of-hours deferral,
  triage hold + release on each resolution path, auto-complete on call ingest, auto-dismiss on
  text-only reply, sweep expiry (dismissedBy system:expired + triage released + no customer
  message), one-ping behavior, API routes happy path. All green.
- `npm run check` passes (the only allowed failures are the two pre-existing corrupted scripts:
  scripts/seed-diy-advice.ts, scripts/scrape-reddit-value-drivers.ts).
- Do NOT run `npm run db:push` yourself — prepare the schema + migration files and note in the
  DONE file that the push is pending owner approval (shared prod DB).

## When finished
Write `docs/VA_CALL_TASK_DONE.md`: files changed, schema/migration status (NOT pushed), test
results, how to enable (flag + Pushover event), and anything deferred. That file is the
completion signal.
