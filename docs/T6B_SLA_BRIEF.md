# Brief: T6b — Per-lane SLA escalation sweep (nothing rots silently)

**Owner:** third-column top pane agent. **Dispatched:** 29 Aug 2026 by orchestrator pane.
**Goal:** every quote-prep readiness lane gets a working-hours SLA; when a thread sits in
a lane past its SLA with no movement, Ben gets re-pinged (Pushover) so nothing rots
silently. This is the "stale-tag aging" gap confirmed missing in the loud-lanes audit.

## Context (verified 29 Aug)

- Rebecca guard (combined re-quote silently skipped) SHIPPED — `server/agents/comms.ts`
  flags Ben via flagThreadForBen. Gap consumption SHIPPED. What is NOT built: anything
  that notices a lane verdict going stale.
- Bolt-on point: `server/agents/comms-sweep.ts:411-422` — the existing fast tick. Extend
  this sweep; do not build a new scheduler.
- Working-hours arithmetic already exists for the VA call task 15-working-minute hold —
  find that helper and reuse it (do NOT write a second working-hours implementation; if
  the helper lives in a file you can't touch, extract nothing — import it).

## SLA table (starting values — make them config-driven so Ben can tune)

| Lane / state | SLA | Action on breach |
|---|---|---|
| `quote_ready`, no quote sent yet | 4 working hours | Pushover re-ping Ben ("quote ready, unpriced Xh") |
| Ben-audience gap unanswered (needs_ben) | 2 working hours | Pushover re-ping Ben |
| `needs_info`, customer silent since our questions | 24 clock hours | Gentle canned chase to customer — **flag-gated, default OFF**; while flag is off, Pushover Ben instead |
| `visit_first`, no visit booked | 1 working day | Pushover nudge Ben |

Rules:
- **Idempotent + non-spammy:** one breach alert per thread per lane-entry, then at most
  one daily reminder while still breached. Persist alert state in the DB (column or
  small table — your call, migration under `migrations/`), never in memory.
- Clock starts at lane-entry time (when the verdict/gap was recorded), pauses outside
  working hours for working-hour SLAs. Handle day boundaries (e.g. verdict lands 16:55).
- If a thread's lane changes or the quote sends, breach state resets — no ghost alerts.
- The customer chase (needs_info row) is customer-facing SEND: canned template only, no
  LLM composition, must pass draft guards, respect opt-out GATE 0 and the WhatsApp
  24h-window/SMS fallback like every other send. Ship the flag OFF.

## Pushover

- **Do NOT edit `server/pushover.ts` or `shared/pushover-settings.ts`** — T2 owns them
  right now. Reuse existing exported notify functions/event types. If you genuinely need
  a new event type or function, STOP on that piece and report the exact proposed change
  back to the orchestrator pane; build everything else meanwhile.
- Quiet hours: breach alerts must respect whatever quiet-hours behaviour existing Ben
  alerts use — no 2am re-pings; surface in the morning.

## Constraints

- You OWN: `server/agents/comms-sweep.ts` (the sweep additions), new migration files,
  a new test script `scripts/_test-sla-sweep.ts`, config additions for the SLA values
  and the chase flag (follow the existing comms config pattern).
- READ-ONLY: `server/agents/quote-prep.ts` (T6a will add a decline lane later — leave a
  seam so a `decline` verdict can get an SLA row without rework), `server/agents/comms.ts`,
  `server/agents/comms-lanes.ts`, `server/first-contact-ack.ts`.
- DO NOT TOUCH: `server/agents/va-call-tasks.ts`, `server/va-call-tasks-routes.ts`,
  `client/src/pages/admin/VaTasksPage.tsx`, `server/pushover.ts`,
  `shared/pushover-settings.ts` (T2 owns); `server/post-call-outreach.ts`,
  `server/call-thread.ts` (T3 owns); `shared/eval-types.ts`, `scripts/eval-*.ts`,
  `eval-cases/*`, `eval-results/*` (T7 owns).
- Tests: `scripts/_test-sla-sweep.ts` must cover each lane's breach + non-breach, the
  working-hours pause across a day boundary, idempotency (sweep runs twice, one alert),
  reset on lane change, chase flag off (Pushover instead of customer message), quiet
  hours. Suite must end green. No messages/alerts to real recipients — assert payloads
  or use test recipients; fixture numbers in the +447700900xxx drama range only.

## Done means

Sweep detects breaches for all four lanes with correct working-hours math; alerts are
idempotent and DB-backed; customer chase exists but ships flag-OFF; suite green. Report:
SLA config keys and defaults, DB shape chosen, any pushover.ts changes you need from the
orchestrator, and suite results.
