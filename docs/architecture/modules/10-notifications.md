# Module 10: Notifications Layer

**Status:** Wave 3 — authoritative
**Primary flag:** `FF_NOTIFICATIONS_V2`
**Depends on:** `state-machine.md` (§6 outbox), `feature-flags.md`
**Consumed by:** modules 01, 05, 06, 07, 08, 09, 12

---

## 1. Purpose

Centralised messaging across WhatsApp, SMS, email, and web push. Replaces
ad-hoc `twilioClient.messages.create(...)`, `email-service.send()`, and
bespoke WhatsApp callouts with a single notifications API. Adds durable
delivery tracking, per-event fallback chains, and versioned templates.

Modules emit *intents* (`event`, `recipient`, `payload`); this layer
picks the channel, renders the template, dispatches, retries, and audits.
After Phase 8, no module touches Twilio / Meta / SMTP / web-push directly.

---

## 2. Architecture

```
[Module triggers state transition]
     ▼
notifications.send({ event, recipient, channel?, payload })
     ▼   (in same DB tx as the transition)
notification_outbox row inserted, status='pending'
     ▼   (commits atomically with state change)
notifications-tick worker (60s)
     ▼
channels/<adapter>.ts ──▶ Twilio / Meta / SMTP / Web Push
     ▼
delivery callback → notification_delivery_log + outbox.status update
```

Single entry point: `server/notifications/index.ts`.

---

## 3. Channels supported

| Channel | Adapter | Default for |
|---|---|---|
| WhatsApp | Twilio WABA primary, Meta fallback | Contractor |
| SMS | Twilio | Customer |
| Email | Wraps `email-service.ts` | Transactional / records |
| Web push | Wraps `web-push.ts` | In-app contractor pings |
| WhatsApp Web.js | Legacy passthrough | Ad-hoc admin only |

Per-event defaults and fallbacks in §5.

---

## 4. Files

```
NEW   server/notifications/index.ts              (orchestrator + send())
NEW   server/notifications/templates.ts          (registry)
NEW   server/notifications/outbox.ts             (queue helpers)
NEW   server/notifications/channels/{whatsapp,sms,email,push,whatsapp-webjs}.ts
NEW   server/notifications/delivery-tracking.ts  (Twilio status callbacks)
NEW   server/notifications/quiet-hours.ts        (defer rules)
NEW   server/jobs/notifications-tick.ts          (60s worker, retries)
EXT   shared/schema.ts                           (notification_outbox, _log)
```

---

## 5. Event catalogue (v1)

| Event | Trigger | Default | Template | Fallback |
|---|---|---|---|---|
| `quote_sent` | `draft → quoted` | SMS + Email | `quote-sent` | — |
| `payment_succeeded` | `quoted → booked_pending_routing` | Email | `booking-confirmed` | SMS |
| `routing_offer` | `offer_round_1 / 2` | WhatsApp | `offer-sent` | SMS |
| `routing_offer_open` | `offer_round_3` broadcast | WhatsApp | `offer-broadcast` | SMS |
| `pack_offered` | `reserved_for_pack` solver assembly | WhatsApp | `pack-offer` | SMS |
| `dispatch_locked` | `→ dispatched` (contractor) | WhatsApp + Email | `dispatched` | — |
| `customer_dispatch_confirmation` | `→ dispatched` (customer) | SMS + Email | `customer-dispatched` | — |
| `dispatch_reminder_24h` | `scheduled - 24h` cron | WhatsApp + SMS | `reminder-24h` | — |
| `dispatch_reminder_morning` | `scheduled - 2h` cron | WhatsApp | `reminder-morning` | SMS |
| `customer_arrival` | `→ in_progress` check-in | SMS | `en-route` | — |
| `completion_review` | `→ completed_pending_review` | SMS + Email | `review-prompt` | — |
| `payout_initiated` | `→ paid_out` | WhatsApp + Email | `payout-sent` | — |
| `cancellation_comp` | adjustment auto-approved (Module 07) | WhatsApp | `comp-applied` | SMS |
| `dispute_opened` | `→ disputed` | Email | `dispute-opened` | — |
| `pack_release_warning` | day_commitment thin (Module 06) | WhatsApp | `pack-thin` | SMS |
| `availability_request` | weekly cron (Module 04) | WhatsApp | `weekly-availability-prompt` | SMS |
| `cert_expiring` | 30d before cert expiry | Email | `cert-expiry` | WhatsApp |

The catalogue is closed for v1 — adding an event requires a template and
fallback entry. Modules cannot send "raw" messages.

---

## 6. Outbox pattern (atomic with state machine)

Every send is enqueued in the same DB tx that commits the state
transition (`state-machine.md` §6).

```ts
await db.transaction(async (tx) => {
  await bookingStateMachine.transition(tx, quoteId, 'offer_round_1', 'dispatched', ctx);
  await notifications.enqueue(tx, {
    event: 'dispatch_locked',
    recipient_id: contractorId,
    payload: { jobId, address, payPence, startTime },
  });
});
```

`notification_outbox` columns:
`id`, `event`, `recipient_id`, `recipient_phone`, `recipient_email`,
`channel`, `template_id`, `template_version`, `payload jsonb`,
`status` (`pending|sent|delivered|failed|deferred`), `attempts`,
`last_error`, `defer_until`, `parent_outbox_id`, timestamps.

Worker `notifications-tick.ts` runs every 60s alongside
`booking-state-tick.ts`:

- Selects `status IN ('pending','deferred')` past `defer_until`.
- Renders template, dispatches via channel adapter.
- Success → `status='sent'`, log delivery row.
- Adapter error → `attempts++`, backoff (1m, 5m, 30m).
- After 3 failures → fire fallback (§9). Fallback also fails →
  `status='failed'`, ops alert.

---

## 7. Templates

Stored as TS modules in `server/notifications/templates.ts`. One renderer
per channel variant. Bumping `version` records that version on every
outbox row using it.

```ts
export const offerSent = {
  id: 'offer-sent',
  version: 3,
  whatsapp: (v: OfferVars) =>
    `New job: ${v.title}\n${v.address}\n£${(v.payPence/100).toFixed(2)} · ${v.startTime}\nAccept: ${v.link}`,
  sms: (v: OfferVars) => `Handy: ${v.title} ${v.startTime} — ${v.link}`,
};
```

Variables are typed (one TS interface per template). The renderer
escapes user-supplied substrings. A/B testing is out of scope for v1;
the registry allows variant routing on `payload.user_segment` later.

---

## 8. Delivery tracking

- **Twilio status callbacks** hit `POST /api/notifications/twilio-status`
  → outbox row advances `queued → sent → delivered | failed`.
- **Email opens** via 1×1 pixel — off by default; flag-gated per event.
- **Web push acks** captured by the service worker, posted to
  `/api/notifications/push-ack`.
- Terminal events stream into `notification_delivery_log` (channel,
  status, raw provider payload) for analytics and support replay.

---

## 9. Channel fallback chains

When the primary does not reach `delivered` within 5 minutes (or returns
a hard error), the worker enqueues the same payload on the fallback
channel using that channel's template variant.

```
WhatsApp pending > 5 min  →  SMS fallback fires
SMS hard-fails            →  Email fallback (if defined)
```

The fallback row links via `parent_outbox_id` for audit. Per-event
config in §5. If `routing_offer` SMS-fallback fires >15% of the time,
we have a WhatsApp deliverability problem to fix upstream.

---

## 10. Quiet hours

Customer-facing WhatsApp and SMS are not sent between **21:00 and 07:00**
local recipient time. The worker stamps `defer_until = next 07:00 local`;
the message goes out at 07:01.

Quiet hours **do not apply** to:

- Contractor offers (`routing_offer`, `routing_offer_open`,
  `pack_offered`) — time-critical, consented to in supply onboarding.
- Same-day completion confirmations and arrival pings.
- Disputes and any event flagged `urgent: true`.

Rules live in `quiet-hours.ts`, keyed by `(event, recipient_role)`.
Timezone derives from `recipient.timezone` (default `Europe/London`).

---

## 11. Tests

- **Outbox atomicity** — row inserted in same tx as state change; tx
  rollback removes it; worker never sees uncommitted intents.
- **Channel adapter** — Twilio mock returns success / 4xx / 5xx; status
  and backoff verified.
- **Fallback chain** — WhatsApp timeout → SMS row enqueued with
  `parent_outbox_id`; SMS success logged.
- **Quiet hours** — enqueued 22:30 → `defer_until` next 07:00; dispatches
  at 07:01; urgent events bypass.
- **Template rendering** — variables substitute; injection in
  `payload.title` escaped; missing required vars throw.
- **Idempotency** — worker on a `sent` row is a no-op; duplicate Twilio
  callbacks converge.

---

## 12. Rollback

Flip `FF_NOTIFICATIONS_V2 = 0`:

- Modules continue calling legacy paths (`twilioClient`, `email-service`,
  `whatsapp-api`) — v1 code stays in place during Phase 8 shadow soak,
  removed only after Phase 9.
- `notifications.send()` no-ops; the worker idles on an empty queue.
- v2-only events (`pack_release_warning`, `cancellation_comp`,
  `availability_request`, `cert_expiring`) don't fire — acceptable;
  critical paths still send via legacy.
- Schema stays — additive, harmless when empty.

---

## 13. Cross-references

- `state-machine.md` §6 — outbox is the pattern for transactional side
  effects.
- `feature-flags.md` — `FF_NOTIFICATIONS_V2`; Phase 8 shadow-mode rollout.
- Modules 01, 05, 06, 07, 08, 09, 12 — emitters call
  `notifications.send()`, never Twilio/SMTP directly.
- `master-plan.md` Phase 8 — cutover precedes legacy-bridge retirement.
