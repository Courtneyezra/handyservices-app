# Comms Map — traced from code + owner review, 24 Aug 2026

Visual version: "Switchboard Atlas" — https://claude.ai/code/artifact/58270200-42bc-4284-9131-54d570d32c2b
This doc is the condensed greppable record. Everything traced from source on this date.

---

## PART A — REVIEW VERDICTS (24 Aug)

### CONDEMNED — delete

| Subsystem | Where | Note |
|---|---|---|
| ElevenLabs AI receptionist | `server/eleven-labs/*`, 3 routing branches | replaced by the ladder |
| Realtime media-stream transcription | `twilio-realtime.ts:1320` | post-call transcription is more accurate |
| Live SKU detector ("The Brain") | `skuDetector.ts:723` | |
| Live call-script coach (Tube Map) | `server/call-script/` | |
| Live metadata/postcode extraction | `twilio-realtime.ts:544-611` | folds into the post-call pass |
| Lead qualification scoring | `call-analyzer.ts:67` | |
| VA call scorecard | `call-scoring.ts:258` | |
| **auto-video-service** | `services/auto-video-service.ts` | **DELETE FIRST — default-on, ungated, live** |
| Missed-call WhatsApp fallback | `index.ts:1385` | replaced by the ladder |
| Tenant/landlord AI platform | `server/ai/*` (orchestrator + 4 workers), `tenant-chat.ts` | + the fork at the top of BOTH message webhooks |
| Tenant/landlord notifications | `services/tenant-notifications.ts`, `services/landlord-notifications.ts` | 17 send sites |
| Chrome extension ingest | `whatsapp-extension/`, `whatsapp-ext-routes.ts`, `whatsapp-ingest.ts` | **HARVEST BEFORE DELETING** — see below |
| Lead action plan (agentic) | `services/agentic-service.ts` | dead OpenAI account |

### REBUILD

- **Call recording**: add a **>10s duration threshold** before keeping/transcribing. None exists today —
  recording + transcription start unconditionally. (`MIN_OUTBOUND_SECONDS_TO_OPEN_CARD = 10` at
  `call-thread.ts:299` already uses the same bar for outbound.)
- **Post-call transcription**: promote `call-batch-transcribe.ts:31` to the SOLE transcript source.
  Move nova-2 → **nova-3**. Keep the per-channel-then-merge approach — dual-channel recording
  (`recordingChannels: 'dual'`, `index.ts:834`) gives perfect speaker attribution, better than any
  diarization. Do NOT use Whisper (worse on 8kHz, slower, dead account).
- **Lead extraction/dedupe**: keep the capability, rebuild post-call on Claude.
  MUST attach to the existing thread by phone number — see thread/lead model below.
- **Meta webhook**: add `X-Hub-Signature-256` verification + message dedupe.
- **Shared ingest**: absorb the extension's dedupe + `resolveRole()` contractor fork + lead creation.

### KEEP

Call classifier · outreach decision (pure rules) · the whole draft queue + guard chain ·
comms/quote-prep/verifier/recovery/ops-brief/offer-shadow agents · `outbound.ts` choke point ·
Pushover layer.

---

## PART B — THE THREAD / LEAD MODEL (confirmed from schema)

- `conversations.phoneNumber` is **UNIQUE** (`schema.ts:1600`) → **one thread per number, forever**,
  shared across call + SMS + WhatsApp.
- `conversations.leadId` (`schema.ts:1603`) is a **nullable pointer to the most recent lead**.
- Leads are the per-job records. A repeat customer = **1 thread, N leads**; the thread pointer tracks
  whichever lead was created last. Calls carry their own `leadId`.
- **Rebuild rule**: creating a lead from a call must look up the thread by number, create/merge the
  lead, and repoint `leadId`. It must NOT create a second thread.

---

## PART C — THE LADDER (agreed target)

Replaces three separate recovery paths (busy / out-of-hours / missed) with one function.

```
busy | out-of-hours | unanswered
  → brief voice message ("we'll text you now") → hang up
  → LADDER:
       24h window open?      → freeform WhatsApp
       else approved template available? → send Meta template
       else (or landline / not WA-capable) → SMS
       else → queue draft for Ben + Pushover
```

Outside 24h it MUST be an approved Meta template — freeform is rejected (error 63016). The current
default fallback (`index.ts:1385`) sends freeform after a call, which can never succeed because a
call does not open the window. The first-contact ack already implements this exact cascade
(`first-contact-ack.ts:738-800`) — the ladder is consolidation, not new work.

---

## PART D — WHAT EXISTS TODAY (the spine)

- **Inbound converges**: all channels → `conversations` + `messages` (key `${digits}@c.us`).
  SMS and WhatsApp share one thread; `channel` column is the only discriminator.
  Only inbound **WhatsApp** opens the 24h window (`schema.ts:1613` documents this correctly).
- **Triage fan-out**: `comms-lanes.ts:44` — blocking opt-out gate → first-contact ack →
  ack-reply tagger → debounced comms agent.
- **Draft queue**: `message_drafts`, sent only via `approveAndSendDraft` (`message-drafts.ts:224`).
  Re-checks opt-out at send time, enforces window/template, splits `---` bursts.
  Five approvers, all stamped in `approvedBy`.
- **Choke point**: `sendCustomerMessage` (`outbound.ts:154`) — the ONLY opt-out enforcement.
  Fail-closed (purpose defaults to `marketing`), landline→SMS, WA-first with SMS fallback.

### Opt-out is mandatory (asked in review)
UK PECR requires honouring marketing opt-outs (ICO enforcement). Meta separately degrades sender
quality rating for messaging opted-out users → throttling → number block. `service_reply` purpose
is the narrow legitimate exception, already implemented at `outbound.ts:193-203`.

### "AUTO·GATED" vs "AUTO·UNGATED" (asked in review)
GATED = fires automatically but a config flag can stop it. UNGATED = fires automatically and
nothing can stop it.

---

## PART E — CHOKE-POINT BYPASSES (~24 modules)

`sendWhatsAppMessage` (`meta-whatsapp.ts:522`) has NO opt-out check. Direct callers:
`cron.ts:298` (day-before, **no kill switch**), all of `lead-automations.ts`,
`webform-chase-service.ts:277,450`, `customer-notifications.ts:228` (**no kill switch**),
`invoices.ts:548`, `quotes.ts:2933,3048` (raw twilioClient SMS, no thread row),
`daily-planner-routes.ts` ×3, `landlord-portal.ts:477`, `agent-staff.ts:693,733,759`,
`quick-replies.ts:238`, `whatsapp-template-sync.ts:436`, `conversation-engine.ts:458`,
`email-service.ts:783` (booking confirmation), plus the condemned tenant/auto-video sites.

Condemning the tenant stack + auto-video removes 6 of these. The rest need migrating.

---

## PART F — KILL SWITCHES

| Flag | Code default | Gates |
|---|---|---|
| `comms_agent.enabled` | false | sweeps + inbound triage |
| `comms_agent.autosend.enabled` | false in code, **LIVE DB = true** | the direct-send switch |
| `comms_agent.firstContactAutoAck.enabled` | false | auto-ack, 4 channels |
| `comms_agent.quotePrep.enabled` | true | auto quote-prep |
| `post_call_video_request.enabled` | false | video request + callback fallback |
| `automations.master_enabled` | false | 5 lead automations + webform chase |
| env `FIRST_CONTACT_ACK_NO_HOLD=1` | unset | skips 60-150s hold |
| env `COMMS_CONFIG_OVERRIDE` | unset | process-local override, dangerous in prod |

**NO SWITCH after the deletions**: day-before reminders (`cron.ts:128`) and customer job
notifications (`customer-notifications.ts:228`) — both legitimate, both need a flag adding.

---

## PART G — BROKEN / DEAD (separate from condemned)

- `/api/twilio/voicemail`: **no handler exists**, referenced from 4 branches → 404, call drops.
  Moot once the ladder lands.
- ~9 files on the dead OpenAI account (out of credits 12 Aug). Most are condemned; lead extraction
  moves to Claude.
- Dunning: complete, zero callers since 13 Aug. Needs a `sentAt` gate before revival.
- `day-before-confirm.ts`: contractor confirms + ops alert never wired (0 callers).
- Unauthenticated shadowed `POST /api/whatsapp/send` at `meta-whatsapp.ts:804` — unreachable only by
  mount order (`index.ts:406-407`). Delete.
- Two different `findApprovedTemplate` functions: live-Twilio (`whatsapp-templates.ts:83`) vs
  DB-cache (`whatsapp-template-sync.ts:257`). Can disagree.
- Template SID `HX3ecffe34...` hardcoded in 4 files.
- Dead: conference-bridge, hold-music, `sendVASms`, `agent_notify_sms`, `autosend.intents`,
  whatsapp-web.js runtime, `.bak` files.
- 58,216 phantom outbound `messages` rows quarantined, excluded from contact history.
- Inbound WhatsApp has NO Pushover event (only inbound SMS does).

---

## PART H — THE CLIENT MODEL (added in review: "lead with thread + properties + balances")

The entity the review asked for is a **client**, and it already exists: `service_clients`
(schema.ts:2759) is LIVE with 1,157 rows. `service_properties` (schema.ts:2779) has 450, linked by
`clientId`; 19 clients own >1 property. Live linkage coverage (24 Aug):

| Table | clientId coverage |
|---|---|
| service_properties | 100% (by design) |
| leads | 1,283/1,610 (80%) |
| personalized_quotes | 617/785 (79%) |
| invoices | 170/264 (64%) |
| contractor_booking_requests | 39/42 (93%) |
| **conversations** | **NO COLUMN — the missing edge** (only 46/1,246 have even lead_id) |
| **calls** | **NO COLUMN** |

Rules:
- Client = the account. Repeat customer = 1 client, 1 thread, N leads, N properties.
- **The gap is one migration**: add `client_id` to `conversations` + `calls`, backfill by phone
  (189 threads match a client phone today). Post-call rebuild resolves client first: client by
  phone → attach thread → create/merge lead, all under one client_id.
- **Balance is DERIVED, never stored**: `sum(balance_due) where client_id = x AND sent`. A stored
  balance drifts from invoices (base-price incident lesson).
- Denormalized customerName/Phone on invoices/quotes are CORRECT (frozen documents). clientId for
  identity/rollups; copied fields for display.
- Legacy `properties`/`tenants` (12+15 rows) die with the condemned tenant stack.

### ⚠ £21,610 "owed" was never billed
ALL 115 invoices with status='overdue' have `sent_at = NULL` (verified 24 Aug). Overdue is computed
from createdAt — same defect that killed dunning 13 Aug. Any balance view MUST gate on `sentAt`
("owed" = billed and unpaid). Separately: that ~£21k is either unbilled completed work or work
billed outside the system — needs its own investigation before any chasing.

## PART I — BUILD ORDER (by risk, not size)

1. ✅ DONE 24 Aug `97bda3c` — **Deleted `auto-video-service.ts`** (+ extractor, trigger, test endpoints).
2. ✅ DONE 24 Aug `bb37624` — **The ladder**: calls go va-forward or say-line+hangup+text-back
   (first-contact ack machinery; `missed_call_ack` template turned out ALREADY APPROVED
   `HX0ae187...`; firstContactAutoAck live=true). ElevenLabs routing, voicemail 404s, freeform
   fallback all gone. Engine simplified: no busy short-circuit, no activeCallCount dependency.
3. ✅ DONE 24 Aug `b548763` — **Extension harvested then deleted**: dedupe (Meta: BEFORE state
   mutation), resolveRole fork, lead creation now in BOTH webhooks via `whatsapp-ingest.ts`
   helpers (`resolveInboundRole`, `linkOrCreateLeadForInbound`). ~~Meta signature check still open.~~
   (Closed 25 Aug — see Part J.1.)
4. ✅ DONE 24 Aug `b662073` — **Tenant/landlord AI stack removed** (server/ai/*, tenant-chat,
   both notification modules, both webhook forks; −4,339 lines). Landlord portal + tenant-issues
   admin routes left deliberately.
5. ✅ DONE 24 Aug `d4fbf68` — **Live pipeline stripped**: twilio-realtime.ts → 300-line
   MediaStreamRecorder; >10s threshold; nova-3 batch transcript = SOLE source → classify →
   outreach → `call-lead.ts` lead upsert (Claude, customer-lane, one-thread rule). Deleted:
   WisprFlow, scorecard, lead scoring, call-analyzer, agentic-service (all 5 sites), whole
   ElevenLabs stack incl. unauthenticated /api/eleven-labs/* tool routes.
6. **Wire thread→client** (Part H): migration + phone backfill + client-first post-call lead step;
   account view = derived balance gated on sentAt.
7. **Amnesty**: migrate surviving direct senders onto `sendCustomerMessage`; add kill switches to
   day-before reminders and customer job notifications.

⚠ All five commits are LOCAL — not deployed to Railway as of 24 Aug evening.

---

## PART J — CLEANUP PASS (25 Aug 2026)

Security hardening and dead code cleanup after steps 1-5.

### ✅ DONE 25 Aug — Security & Alerting

1. **Meta X-Hub-Signature-256 verification** — `meta-whatsapp.ts` webhook now verifies
   `X-Hub-Signature-256` header using `META_APP_SECRET` (HMAC-SHA256). Raw body capture added
   to `index.ts`. Env var required in production via `env-validation.ts`. Graceful degradation
   if not set (logs warning, allows request).

2. **Deleted unauthenticated POST /api/whatsapp/send** — `meta-whatsapp.ts:821-840` removed.
   Was shadowed by mount order but remained a security risk. Use `sendWhatsAppMessage()` or
   draft queue instead.

3. **Pushover for inbound WhatsApp** — `notifyIncomingWhatsApp()` added to `pushover.ts`.
   Both webhooks now alert: `whatsapp-api.ts` (Twilio) and `meta-whatsapp.ts` (Meta Cloud API).
   Customer messages only (contractors excluded).

4. **Removed hardcoded template SID HX3ecffe34** — `TWILIO_VIDEO_REQUEST_CONTENT_SID` now
   required in production via `env-validation.ts`. Hardcoded fallback removed from:
   - `lead-automations.ts:128`
   - `post-call-outreach.ts:45`
   - `whatsapp-api.ts:134`

### ✅ DONE 25 Aug — Schema & Choke Point Migration

5. **Wire thread→client** (Step 6) — `clientId` column added to `calls` and `conversations`
   tables (`shared/schema.ts`). Indexes added. `roleProfile` column added to conversations for
   lane routing. New `comms_events` ledger table for audit-grade who-said-what tracking.

6. **Amnesty** (Step 7) — Direct senders migrated onto `sendCustomerMessage` choke point:
   - `cron.ts` — day-before reminders + kill switch `day_before_reminders`
   - `customer-notifications.ts` — job notifications + kill switch `customer_notifications`
   - `invoices.ts` — invoice delivery via choke point
   - `quotes.ts` — quote notifications via choke point
   - `daily-planner-routes.ts` — planner notifications
   - `landlord-portal.ts` — landlord notifications
   - `agent-staff.ts` — agent notifications
   - `quick-replies.ts` — quick reply sends
   - `conversation-engine.ts` — conversation sends
   - `lead-automations.ts` — lead automation sends
   - `webform-chase-service.ts` — webform chase sends

7. **Consolidate findApprovedTemplate** — `whatsapp-templates.ts` deleted entirely. All callers
   now use `whatsapp-template-sync.ts:findApprovedTemplate()` (DB-cache backed, single source).

8. **Delete dead code**:
   - `server/index.ts.backup2` — deleted (1,172 lines)
   - `server/whatsapp-templates.ts` — deleted (102 lines, consolidated into template-sync)
   - `scripts/archive/_wa-export-web*.ts` — whatsapp-web.js scripts deleted (288 lines)
   - `package.json` — removed `whatsapp-web.js` dependency

### NEEDS HUMAN REVIEW

- **£21,610 unbilled invoices** — 115 invoices with sent_at = NULL but status = 'overdue'.
  Needs investigation before any automated chasing.
- **sentAt gate to dunning** — still needs implementation before dunning revival.
