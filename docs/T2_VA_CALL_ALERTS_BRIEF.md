# Brief: T2 — Harden call-needed alerts + finish the VA tasks portal

**Owner:** top-right pane agent. **Dispatched:** 29 Aug 2026 by orchestrator pane.
**Goal:** Ben (or the VA) must reliably get a "ring this enquiry" alert after every
initial WhatsApp / SMS / webform contact, with everything needed to make the call
directly from the phone — and a mobile-friendly page behind the alert.

## What already exists (verify, then build on)

- `server/agents/va-call-tasks.ts` — task creation on first contact, 15-working-minute
  hold on LLM triage, expiry, auto-complete when a call lands, dismiss on opt-out or
  "text only" replies. Shipped 28 Aug.
- `server/va-call-tasks-routes.ts` — GET list, POST /:id/complete, POST /:id/dismiss.
- `client/src/pages/admin/VaTasksPage.tsx` — portal skeleton (new, unpolished).
- `server/pushover.ts:450-478` — notifyVaCallTask: name, phone, channel, enquiry
  preview, ring-by time, always-tappable tel: link.
- `scripts/_test-va-call-tasks.ts` — existing suite.

## Part 1 — Reliability audit (do this first, report findings)

1. Trace all three channels end to end: does a first contact via WhatsApp, SMS, AND
   webform each create a task and fire the Pushover? Find and fix any channel where the
   lane is skipped (pay attention to the webform path — it may not route through the
   same inbound lane).
2. Expiry/overdue behaviour: what happens at the 15-working-minute mark? Is the overdue
   re-alert firing? Working-hours arithmetic correct at day boundaries (e.g. 19:55
   arrival)?
3. Quiet hours: what does the va_call_task event do overnight — mute or downgrade? An
   out-of-hours enquiry should NOT ring Ben at 2am; confirm the task instead surfaces
   for the morning (align with the morning-release pattern).
4. Deep link: the alert should link to the VA tasks page (not just the thread) and work
   on a phone.

## Part 2 — Portal build-out (mobile-first)

VaTasksPage becomes the page a Pushover opens on a phone:
- Open tasks, newest/most-urgent first: customer name, channel badge, ring-by countdown
  (live), enquiry preview, one-tap call button (tel:), link to full thread.
- Enough context to make the call cold: last few inbound messages, any media thumbnails.
- Complete ("called them") and Dismiss (with reason) actions; auto-refresh or poll.
- Completed/expired sections collapsed below.
- Keep components reusable: a unified "task inbox + review portal" surface (T5+T8) is
  coming next and will likely absorb this page — favour extractable components over a
  monolith.

## Constraints

- You OWN for this task: `server/agents/va-call-tasks.ts`,
  `server/va-call-tasks-routes.ts`, `client/src/pages/admin/VaTasksPage.tsx`,
  `server/pushover.ts` (va_call_task paths only), `shared/pushover-settings.ts` if the
  event config needs adjusting.
- READ-ONLY: `server/agents/comms-lanes.ts` and `server/first-contact-ack.ts` (T1 just
  landed changes there — do not edit; if the webform fix genuinely requires touching
  comms-lanes, STOP and report back with the proposed change instead).
- DO NOT TOUCH: `server/post-call-outreach.ts`, `server/call-thread.ts` (T3 owns),
  `shared/eval-types.ts`, `scripts/eval-*.ts`, `eval-cases/*` (T7 owns).
- Extend `scripts/_test-va-call-tasks.ts` for every fix you make (channel coverage,
  expiry boundaries, quiet hours). Suite must end green.
- No messages/alerts to real recipients during testing — use the test recipient
  mechanism if one exists, otherwise assert on the payload without sending.

## Done means

All three channels provably create task + alert; overdue and quiet-hours behaviour
correct and tested; portal usable one-handed on a phone from a Pushover tap; suite
green. Report: findings from the audit (what was broken), what changed, suite results,
and a screenshot-level description of the portal states.
