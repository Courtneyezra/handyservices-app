# COMMS AGENT MAP — STAGE 1 (as-implemented, 27 Aug 2026)

Research-only mapping of the comms agent system. No code was changed. Every claim
carries a file:line citation against the working tree as of 27 Aug 2026. Where this
document disagrees with the prior partial map (`docs/COMMS_MAP_2026-08.md`), the prior
map's claim was re-verified against source and the correction is noted inline.

Governing docs: `docs/QUOTE_ASSEMBLY_PLAN.md`, `docs/AGENT_DECISION_FRAMEWORK.md`
(risk tiers READ / PROPOSE / DRAFT / SEND / COMMIT are used below as defined there).

Method: direct source reads of `server/outbound.ts`, `server/agents/comms.ts`,
`server/agents/comms-lanes.ts`, `server/agents/comms-sweep.ts`, `server/message-drafts.ts`,
`server/whatsapp-api.ts`, `server/invoice-generator.ts`, `server/index.ts`,
`shared/schema.ts`; three exhaustive greps of the full `server/` tree; and a live-DB
survey (`scripts/_map-metadata-survey.ts`, read-only) for real metadata keys, tags,
stages, priorities and draft statuses.

---

## HEADLINE NUMBERS

| Metric | Count |
|---|---|
| Customer-facing send paths (Artifact 1) | **31** = 23 direct choke-point call sites + 1 queue exit (`approveAndSendDraft`) + 6 draft-queue feeder sources + 1 bypass |
| Active choke-point bypasses | **1** (`server/whatsapp-api.ts:85`, Meta/template branch — opt-out is still enforced upstream; see §1.4) |
| Dormant/dead send paths | **1** (invoice dunning — zero callers, disabled 13 Aug 2026; see §1.5) |
| Orphaned state (named) | **12** = 2 tags (`opted_out`, `do_not_contact`) + 10 metadata keys (8 legacy Agentic-Plan keys + `visitReason` + `leadPlan`) |
| Orphaned state (unnamed) | **~100** one-off model-invented free-text tags nothing reads (§2.5) |

---

# ARTIFACT 1 — SENDER INVENTORY

## 1.1 The choke point and primitives

| Function | Location | Role |
|---|---|---|
| `sendCustomerMessage()` | `server/outbound.ts:154` | **THE CHOKE POINT.** Opt-out check first (`blockedByOptOut`, purpose-aware, ~line 174), landline→SMS routing (~208), WhatsApp→SMS fallback on Twilio codes 63003/63005/63013/63024 (recipient-not-found) and 63007/63015/21910 (sender misconfigured) (~231-281), `service_reply` vs `marketing` purpose separation (PECR). |
| `sendWhatsAppMessage()` | `server/meta-whatsapp.ts:598` | Primitive. No guards of its own; callers decide. Routes to Twilio or Meta Cloud API (`sendViaMetaCloudApi`, meta-whatsapp.ts:449). |
| `sendSmsMessage()` | `server/sms.ts:96` | Primitive. No window semantics for SMS. Deliberately does NOT touch `lastInboundAt`/`canSendFreeform` (sms.ts:167 bookkeeping). |
| `queueDraft()` | `server/message-drafts.ts:57` | Draft-queue entry. Not a send. Opt-out checked at queue time (89-97), dedupe (99-112), status `'pending'` (131), `recordDraftProposal` ledger write (140). |
| `approveAndSendDraft()` | `server/message-drafts.ts:224` | Queue exit. CAS claim `WHERE status='pending'` (229-232), opt-out re-check (241-252), window check with `pending` revert on OUTSIDE_WINDOW (260-269), `---` burst splitting (291-311), sends via `sendCustomerMessage`, quote-slug bookkeeping (flips quote `isDraft`, stage→`quote_sent`, retires tags, 393-424). |

## 1.2 Direct senders through the choke point (23 call sites)

All verified to call `sendCustomerMessage` (migration completed 25 Aug 2026 per
`docs/COMMS_MAP_2026-08.md` Part J; every site re-verified for this map).

| # | File:Line | Trigger | Purpose | Kill switch | Risk tier |
|---|---|---|---|---|---|
| 1 | `server/cron.ts:306` | Cron: day-before job reminder | marketing | env `DAY_BEFORE_REMINDERS_ENABLED` | SEND (autonomous) |
| 2 | `server/customer-notifications.ts:236` | Job status transitions (assigned/on-way/arrived/complete) | service_reply | env `CUSTOMER_NOTIFICATIONS_ENABLED` | SEND (autonomous) |
| 3 | `server/invoices.ts:548` | Admin `POST /api/invoices/:id/send` | service_reply | none | SEND (human-triggered) |
| 4 | `server/quotes.ts:2927` | Admin sends quote link | service_reply | none | SEND (human-triggered) |
| 5 | `server/quotes.ts:3045` | Booking confirmation on schedule-visit | service_reply | none | SEND (human-triggered) |
| 6-8 | `server/daily-planner-routes.ts:914, 1594, 1793` | Slot/booking confirmations | service_reply | none | SEND (human-triggered) |
| 9 | `server/landlord-portal.ts:477` | Tenant onboarding welcome | service_reply | none | SEND (human-triggered) |
| 10 | `server/agent-staff.ts:724, 773, 807` | `sendDraftDirect()` — human-approved agent reply/quote, burst-split | service_reply | none | SEND (human approval is the gate) |
| 11 | `server/quick-replies.ts:208, 235` | Admin canned reply | service_reply | none | SEND (human-triggered) |
| 12 | `server/whatsapp-template-sync.ts:535` | Admin template test send | marketing | none | SEND (human-triggered) |
| 13 | `server/voice-notes.ts:98` | Admin voice-note send | service_reply | none | SEND (human-triggered) |
| 14-18 | `server/lead-automations.ts:131, 227, 315, 392, 531` | Cron: post-call video, quote nudge, quote-viewed, video-awaited, lost-lead recovery | marketing | flag `automations.master_enabled` | SEND (autonomous) |
| 19-20 | `server/services/webform-chase-service.ts:278, 462` | Cron: webform follow-up / re-chase | marketing | flag `automations.master_enabled` | SEND (autonomous) |
| 21 | `server/whatsapp-api.ts:94` | `POST /api/whatsapp/send` normal path | service_reply | none | SEND (human-triggered) |
| 22 | `server/live-call-actions.ts:223` | In-call quote send | service_reply | none | SEND (human-triggered) |
| 23 | `server/invoice-generator.ts:692` | Dunning WhatsApp fallback — **DORMANT, zero callers** (§1.5) | marketing | none needed (unscheduled) | SEND (dormant) |

## 1.3 Draft-queue feeders (6 sources → `approveAndSendDraft`)

`DraftSource` type at `server/message-drafts.ts:25`; `SERVICE_DRAFT_SOURCES = {webform_ack, first_contact_ack, comms_agent, manual}` at line 45 (`post_call_video` and `recovery` are marketing-purpose).

| Source | Feeder | Trigger | Auto-send? | Risk tier |
|---|---|---|---|---|
| `comms_agent` | `server/agents/comms.ts:754-899` (`queue_draft` tool) | Inbound triage / sweeps / quote-prep gaps | Yes, iff `maySendDirect` passes (comms.ts:844-847; gate defined ~302: intent whitelist + UK hour 08-20 + post-quote thread + REACTIVE window + guardsPassed) AND `comms_agent.autosend.enabled`. Else stays pending for Ben. | DRAFT, escalating to SEND on whitelist |
| `first_contact_ack` | `server/first-contact-ack.ts:806` (queue), `:826` (no-hold escape hatch) | First inbound from unknown number, after geography+spam screens | Held 60-150s (`[ack_hold_until:<iso>]` reason prefix), released by sweep (`releaseHeldAcks`, comms-sweep.ts:208-249); immediate iff env `FIRST_CONTACT_ACK_NO_HOLD=1` | DRAFT→SEND (gated by `comms_agent.firstContactAutoAck.enabled`) |
| `post_call_video` | `server/post-call-outreach.ts:541` | After qualifying call (≥5s, no landline, quiet-hours 8-20, no existing thread) | Queued for approval | DRAFT |
| `webform_ack` | webform intake ack | Webform submission | Queued | DRAFT |
| `recovery` | recovery flows | Lost-lead recovery | Queued; marketing purpose so opt-out fully blocks | DRAFT |
| `manual` | Admin UI compose-to-queue | Human | Human approves own draft | DRAFT |

The `checkDraft` guard chain (comms.ts:793-809) refuses money figures, discounts, date
promises and capitulation; refusals carrying ESCALATE_CODES go to `routeRefusalsToBen`
(comms.ts:1134-1159) → `flagThreadForBen`. Sweep-released morning drafts carry the
`[morning_release]` reason marker (comms.ts:885-890) and are staleness-checked before
send (comms-sweep.ts:158-199).

## 1.4 The one active choke-point bypass — VERIFIED, prior claim corrected

`server/whatsapp-api.ts:84-92` (`POST /api/whatsapp/send`): when `via === 'meta'` or a
`templateName` is supplied, the route calls `sendWhatsAppMessage()` directly instead of
`sendCustomerMessage()`.

**Correction to the sender-inventory sweep and prior map:** this is a *choke-point*
bypass, **not** an opt-out bypass. The route runs `blockedByOptOut(phone, 'service_reply')`
at `whatsapp-api.ts:72-80`, *before* the branch. What the Meta/template branch actually
loses by skipping the choke point: the landline→SMS guard, the WhatsApp→SMS error-code
fallback, and the unified send context/ledger. Risk tier: SEND (human-triggered), reduced
guard set.

## 1.5 Invoice dunning — dormant, prior "DANGEROUS" claim corrected

The prior audit (and the fresh sender-inventory sweep) claimed dunning "has no sentAt
check and no kill switch — dangerous." Verified false on both counts:

- `runDunningSequence` (`server/invoice-generator.ts:592`) **does** gate on
  ``sql`${invoices.sentAt} IS NOT NULL` `` at `invoice-generator.ts:607` (comment at
  598-600 references the 115 overdue invoices with `sent_at=NULL` and the 13 Aug defect).
- `runDunningSequence` has **zero callers**. It was unscheduled on 13 Aug 2026 — comment
  at `server/index.ts:283`: Moira/INV-2026-0221 received a "Final Payment Notice" for an
  invoice she never received.

Status: dormant dead code with the gate now built in. Not an active danger; also not
running. If ever revived it should gain a DB kill-switch flag (it currently has none).

## 1.6 Verification against the prior audit's ~24-bypass list

Prior list (`docs/COMMS_MAP_2026-08.md` Part E, 23 claimed after excluding email/condemned):

- **19 migrated** onto `sendCustomerMessage` (25 Aug): cron.ts, lead-automations.ts ×5,
  webform-chase ×2, customer-notifications, invoices, quotes ×2, daily-planner ×3,
  landlord-portal, agent-staff, quick-replies, whatsapp-template-sync, live-call-actions.
- **2 false positives**: `conversation-engine.ts` never sent (no send call exists);
  `tenant-issues.ts:160` is a commented-out placeholder.
- **Condemned code deleted**: auto-video-service (6 sites) and the tenant/landlord AI
  stack (17 sites) removed 24-25 Aug.
- **1 still bypassing**: `whatsapp-api.ts:85` (§1.4).
- **1 dormant**: dunning (§1.5).

`email-service.ts:783` (Resend booking email) is out of scope (email, not WhatsApp/SMS).
Pushover is internal staff alerting only, not customer-facing.

## 1.7 Kill switches

| Switch | Scope | Default |
|---|---|---|
| flag `automations.master_enabled` | lead-automations ×5 + webform chase ×2 | false |
| flag `comms_agent.enabled` | comms agent triage + all sweeps | false |
| flag `comms_agent.autosend.enabled` | agent auto-send whitelist | **false in code, true in live DB** (config drift — flagged in prior map Part F, still true) |
| flag `comms_agent.firstContactAutoAck.enabled` | first-contact ack | false |
| flag `post_call_video_request.enabled` | post-call video + callback fallback | false |
| env `DAY_BEFORE_REMINDERS_ENABLED` | day-before reminders | unset = off |
| env `CUSTOMER_NOTIFICATIONS_ENABLED` | job-status notifications | unset = off |
| env `FIRST_CONTACT_ACK_NO_HOLD` | skips 60-150s ack hold | unset = hold on |
| (missing) | invoice dunning | n/a — dormant, no flag exists |

---

# ARTIFACT 2 — STATE-WRITE TRACE

## 2.1 `conversations.stage`

Live values (DB survey 27 Aug): `closed` 1233, `scoping` 9, `won` 9, `enquiry` 2.
The schema comment at `shared/schema.ts:1630` (`'new','active','waiting','closed'`,
default `'new'`) is **STALE** — real vocabulary is
`enquiry → scoping → quote_sent → closed | won`. `inbox-board.ts:34-38`
(`normalizeStage`) maps legacy values (new→enquiry, active→scoping, waiting+quote_sent
tag→quote_sent).

| Writer | Value written | Trigger | Consumed by |
|---|---|---|---|
| `server/meta-whatsapp.ts:318` | `stageAfterInbound(prev)` | WhatsApp inbound | board `normalizeStage`; sweep filters |
| `server/meta-whatsapp.ts:551, 774` | `stageAfterOutbound(prev)` | WhatsApp outbound / template sent | same |
| `server/conversation-engine.ts:290, 474` | stageAfterInbound / stageAfterOutbound | SMS/call in/out | same |
| `server/sms.ts:197` | `stageAfterOutbound(prev)` | SMS outbound | same |
| `server/conversation-stage.ts:55` | `'won'` | **payment completion only** | `archiveStaleWonConversations` (conversation-stage.ts:76-79, archives won >7d) |
| `server/opt-out.ts:426` | `'closed'` | opt-out endpoint | sweep exclusion (comms-sweep.ts:53; comms.ts:1832, 1888, 1952-1954) |
| `server/agent-staff.ts:571` | `'quote_sent'` | human approves quote send | board column |
| `server/message-drafts.ts:415` | `'quote_sent'` | draft containing quote slug sent | board column |
| `server/agents/comms.ts:1372` | `route.stage` (`'scoping'`) | quote-prep verdict routing | board column |
| `server/agents/comms.ts:715-752` (`set_board_state` tool) | agent-chosen stage | agent decision; `boardStageRefusal` blocks `'won'` | board column |

Consumers that branch on stage: `inbox-board.ts:34-38`; `conversation-stage.ts:58, 79`;
`comms.ts:1832, 1888, 1952-1954`; `comms-sweep.ts:53`; `leads.ts:1136`.

## 2.2 `conversations.tags`

| Tag | Writer(s) | Trigger | Consumer(s) | Status |
|---|---|---|---|---|
| `needs_quote` (READY_TO_PRICE_TAG, comms.ts:1164) | agent `set_board_state` (comms.ts:749); triage | agent judges thread priceable | **`comms.ts:1287`** — gate for `maybeAutoQuotePrep` | CONSUMED. *Was orphaned at Rebecca-incident time; consumer added since.* |
| `needs_ben` (NEEDS_BEN_TAG, comms.ts:1176) | `flagThreadForBen` (comms.ts:414); `routeIntakeVerdict` (comms.ts:1220-1230) | escalations, quote_ready/visit_first verdicts | **`inbox-board.ts:374`** (whoseMove='ben'); dedupe in flagThreadForBen; Pushover ping | CONSUMED. *Was orphaned at Carolyne-incident time; consumer added since.* |
| `quote_ready` (comms.ts:1166) | routeIntakeVerdict | clerk verdict quote_ready | board display; retire-on-quote-sent set (agent-staff.ts:530, message-drafts.ts:412-416) | CONSUMED |
| `visit_first` (comms.ts:1174) | routeIntakeVerdict | clerk verdict visit_first | board display; retire set | CONSUMED |
| `quote_gaps` | routeIntakeVerdict (comms.ts:1223) | clerk verdict needs_info | retire set (agent-staff.ts:530); gaps follow-up flow | CONSUMED |
| `callback_due` | first-contact-ack.ts:1017; post-call-outreach.ts:384 | callback promised on call | `comms-sweep.ts:282` (`fallbackOverdueCallbacks`, 261-317); cleared at call-thread.ts:565 and comms-sweep.ts:307-309 | CONSUMED |
| `no_auto_messages` | post-call-outreach.ts:351 | call-route verdict | auto-send gate at post-call-outreach.ts:280 | CONSUMED |
| `quote_sent` | agent-staff.ts:572; message-drafts.ts:412 | quote delivered | board column mapping | CONSUMED |
| `opted_out` | opt-out.ts:426 | opt-out | **none** — enforcement is `blockedByOptOut(phone, purpose)`, not the tag | **ORPHANED** (display/audit only) |
| `do_not_contact` | opt-out.ts:426 (scope='all') | opt-out | **none** | **ORPHANED** (display/audit only) |
| free-text tags (~100 distinct) | agent `set_board_state` `add_tags` (comms.ts:749) | model invention per-thread | **none** | **ORPHANED** (§2.5) |

Note on write safety: the `set_board_state` tool re-reads tags fresh at comms.ts:739-741
before merging, to avoid clobbering tags written mid-run by other writers.

## 2.3 `conversations.priority`

Live values: normal 1148, high 60, low 39, urgent 6.

| Writer | Value | Trigger |
|---|---|---|
| first-contact-ack.ts:534 | high/urgent (rank-based merge) | ack tagger verdict |
| post-call-outreach.ts:362 | urgent | complaint detected on call |
| post-call-outreach.ts:386 | high | callback promise |
| comms.ts:416 | high (unless already urgent) | `flagThreadForBen` |
| comms.ts:1375 | high iff intake.urgency==='high' | quote-prep verdict |

Consumers: `inbox-board.ts:406` (card display), `inbox-board.ts:438`
(urgent + whoseMove==='ben' ⇒ complaint flag). All writes consumed.

## 2.4 `message_drafts.status` transitions

Live counts (status × source): sent/comms_agent 79, rejected/comms_agent 39,
sent/first_contact_ack 6, sent/post_call_video 4, rejected/first_contact_ack 3,
failed/first_contact_ack 1. No pending or approved rows at survey time.

| Transition | Site | approvedBy / cause |
|---|---|---|
| ∅ → pending | message-drafts.ts:130 (`queueDraft`) | all drafts |
| pending → approved | message-drafts.ts:230 | CAS claim in `approveAndSendDraft` |
| pending → rejected | message-drafts.ts:244 | opt-out re-check fails at send time |
| approved → pending (**revert**) | message-drafts.ts:262 | OUTSIDE_WINDOW, no template |
| approved → sent | message-drafts.ts:348 | send succeeded |
| approved → failed | message-drafts.ts:326, 439 | send failed / exception |
| pending → rejected | message-drafts.ts:489 | admin `POST /:id/reject` |
| pending → rejected | comms.ts:813 | `comms_agent:superseded` (newer draft this run, supersede at 811-815) |
| pending → rejected | comms.ts:1084 | `comms_agent:superseded_by_clerk_gaps` (needs_info verdict rejects pending draft, re-runs agent once with trigger `quote_prep_gaps`, comms.ts:1081-1096) |
| pending → rejected | comms-sweep.ts:182 | `hours_gate:stale_by_morning` (overnight inbound arrived; re-arms triage) |
| pending → rejected | comms-sweep.ts:233 | `ack_hold:superseded` (held ack mooted by real reply) |

Consumers: pending queue (message-drafts.ts:158, 606; inbox-board.ts:779), history
(inbox-board.ts:794), weekly stats (agent-staff.ts:74-78), callback tracking
(first-contact-ack.ts:329, 966), edit gate pending-only (message-drafts.ts:206),
CAS guards (231, 490). Outcome ledger: `recordDraftProposal` at queue time (140, before
any PATCH edits), `recordDraftVerdict` at approve/reject/send.

## 2.5 ORPHANED STATE — dedicated table

| # | State | Writer | Live rows | Why orphaned |
|---|---|---|---|---|
| 1 | tag `opted_out` | opt-out.ts:426 | 15-ish (with spam etc.) | No branch reads it; enforcement is `blockedByOptOut(phone, purpose)` |
| 2 | tag `do_not_contact` | opt-out.ts:426 | few | Same |
| 3-10 | metadata `quoteMode`, `urgency`, `draftReply`, `tasks`, `intent`, `reasoning`, `recommendedAction`, `pricingAnalytics` | **no current writer** (V5 "Agentic Plans" writer removed; `conversation-engine.ts` writes zero metadata — verified by grep) | 916 conversations each (~70% of rows; `pricingAnalytics` 915, sample value `null`) | Only readers are two ops scripts (`scripts/verify_specific_call.ts`, `scripts/repair_missing_conversation.ts`). Dead weight. |
| 11 | metadata `visitReason` | **no writer found in server/** (grep 27 Aug: no matches) | 23 | Writer deleted; nothing reads it |
| 12 | metadata `leadPlan` | **no writer found in server/** | 1 | Same |
| — | ~100 one-off free-text tags (`door_hinge_repair`, `curtain_poles`, `fraud_call`, …) | agent `add_tags` (comms.ts:749) | 1-3 rows each | Unbounded model-invented vocabulary; nothing branches on any of them. `board_clearout_2026_08` (1225 rows) is a deliberate ops marker, not agent-invented, but also has no code consumer. |

**Historical note (the incidents that motivated this artifact):** `needs_quote`
(Rebecca) and `needs_ben` (Carolyne) *were* consumer-less at incident time. Both now
have real consumers (comms.ts:1287; inbox-board.ts:374), and the 27 Aug live-quote-guard
fix (comms.ts:1291-1322) additionally flags Ben instead of silently skipping when a
re-prep is blocked. They are not in the orphan table because they are consumed **today**.

---

# ARTIFACT 3 — STATE MACHINE (as implemented)

## 3.1 Conversation stage machine

```mermaid
stateDiagram-v2
    [*] --> enquiry : inbound webhook upserts conversation<br/>(meta-whatsapp.ts:214→, whatsapp-api.ts:20→conversation-engine.ts:231)
    enquiry --> scoping : stageAfterInbound/Outbound on traffic<br/>(meta-whatsapp.ts:318/551/774, sms.ts:197, conversation-engine.ts:290/474)<br/>OR quote-prep routing (comms.ts:1372)<br/>OR agent set_board_state (comms.ts:715-752)
    scoping --> quote_sent : quote delivered<br/>(agent-staff.ts:571 human approve; message-drafts.ts:415 draft with quote slug)
    quote_sent --> won : PAYMENT ONLY (conversation-stage.ts:55)
    enquiry --> closed : opt-out (opt-out.ts:426) or agent close
    scoping --> closed : same
    quote_sent --> closed : same
    won --> [*] : archived after 7d (conversation-stage.ts:76-79)
    closed --> scoping : agent may reopen via set_board_state<br/>(revival triage excludes closed: comms.ts:1888)
```

Actors per transition:
- **Webhooks** (Meta `meta-whatsapp.ts:214`, Twilio `whatsapp-api.ts:20`): create/upsert at `enquiry`, advance via `stageAfterInbound`.
- **Send paths**: advance via `stageAfterOutbound`; quote sends set `quote_sent`.
- **Comms agent** (`set_board_state`, comms.ts:715-752): any stage EXCEPT `won` — `boardStageRefusal` hard-blocks it.
- **Quote-prep routing** (`routeIntakeVerdict` → applied in `maybeAutoQuotePrep`, comms.ts:1372-1377): sets `scoping`.
- **Payment system** (conversation-stage.ts:55): sole writer of `won`.
- **Opt-out** (opt-out.ts:426): sets `closed`.
- **Ben/admin UI**: via agent-staff routes (quote approve → `quote_sent`).

**Unreachable/blocked transitions:**
- `enquiry/scoping → won` directly: impossible except via payment.
- Agent → `won`: refused (`boardStageRefusal`).
- Nothing ever writes schema-default `'new'` back after normalization; `new/active/waiting` exist only as legacy values mapped by `normalizeStage` (inbox-board.ts:34-38).

**Races:**
- Stage writes are last-writer-wins (no CAS). An inbound `stageAfterInbound` write can
  interleave with an agent `set_board_state` mid-run; tags are protected by the fresh
  re-read at comms.ts:739-741, stage is not. Low observed impact (stage functions are
  monotone-ish), but it is a real race.
- `quote_sent` written from two sites (agent-staff.ts:571, message-drafts.ts:415) —
  idempotent, benign.

## 3.2 Triage debounce lifecycle (metadata.nextTriageAt)

```
inbound webhook
   └─ scheduleInboundTriage (comms-lanes.ts:44)
        └─ runInboundLanes (comms-lanes.ts:57)
             ├─ opt-out gate (:80)
             ├─ ackFirstContact (:100)   ├─ tagAckReply (:104)   [parallel lanes]
             └─ arm() (:107, writes metadata.nextTriageAt at :167-169)
fast tick (every 15s, comms-sweep.ts:324; boot delay 30s)
   └─ tickDueTriage (comms-sweep.ts:115-149)
        ├─ find due rows (nextTriageAt <= now, :121-122)
        ├─ CLAIM: CAS update nextTriageAt → now+4min lease,
        │         WHERE metadata.nextTriageAt = <exact seen value> (:133-134)  ← race-safe
        ├─ runCommsAgent (comms.ts ~465; claude-sonnet-5, maxTurns 10, maxTokens 8000, config comms.ts:1042-1055)
        └─ on success: remove nextTriageAt (:143)
slow sweep (every 5min, sweepOnce comms-sweep.ts:36-106)
   └─ stamps metadata.lastAutoTriageAt (:94) before run; skips if < 20min old (:68)
morning release (releaseMorningHolds :158-199)
   └─ sends `[morning_release]` drafts; if overnight inbound arrived → reject draft
      (hours_gate:stale_by_morning, :182) and re-arm nextTriageAt=now (:185)
ack hold release (releaseHeldAcks :208-249)
   └─ releases `[ack_hold_until:<iso>]` drafts after hold; rejects if superseded (:233)
callback fallback (fallbackOverdueCallbacks :261-317)
   └─ callback_due tag + metadata.callbackDueAt overdue → fallback route, clears both (:307-309)
```

**Race analysis:** the exact-value WHERE on claim (:133-134) makes double-claim
impossible; a re-arm by a new inbound during a leased run simply produces a fresh
`nextTriageAt` that the lease-release `-` removal may delete — mitigated because
`arm()` re-writes on the *next* inbound; worst case is one delayed triage, not a lost
send. Draft double-send is prevented independently by the CAS claim at
message-drafts.ts:229-232.

## 3.3 Draft status machine

```
            queueDraft (md.ts:130)
                 │
              [pending] ◄────────────────────┐
     ┌──────────┼──────────────┐             │ revert: OUTSIDE_WINDOW,
     │          │              │             │ no template (md.ts:262)
  rejected   approved       failed           │
 (md:244,489, (md:230 CAS)  (exception       │
  comms:813,     │           md:439)         │
  comms:1084,    ├───────────────────────────┘
  sweep:182,     │
  sweep:233)     ├──► sent   (md.ts:348)
                 └──► failed (md.ts:326)
```

Terminal: sent, rejected, failed. Only `pending` is editable (md.ts:206) or rejectable
(md.ts:490).

## 3.4 Quote-prep sub-machine (inside maybeAutoQuotePrep, comms.ts:1276-1446)

```
needs_quote tag present? (:1287) ──no──► exit
   │yes
live-quote guard (:1291-1322): quote live AND unexpired AND no new inbound media?
   │blocked──► flagThreadForBen (27 Aug fix — no more silent skip) ──► exit
   │pass
rate limit via metadata.quotePrepAuto (:1324-1345)
   (lastRunAt, mediaCount, postcodeSeen, lastReadiness; newInfo overrides:
    new media, postcode appeared, answeredSinceNeedsInfo)
   │pass
run clerk → verdict ──► routeIntakeVerdict (:1220-1230, pure fn)
   ├─ needs_info   → +quote_gaps, no notify; reject pending draft & re-run agent once
   │                 with trigger 'quote_prep_gaps' (comms.ts:1081-1096)
   ├─ quote_ready  → stage scoping, +needs_ben +quote_ready, notify Ben (:1430-1445)
   └─ visit_first  → stage scoping, +needs_ben +visit_first, notify Ben
writeState quotePrepAuto (:1352-1361); board update (:1372-1377);
shadow readiness scored + logged, NOT gating (:1379-1423);
metadata.quotePrepIntake written (:1427)
```

---

# ARTIFACT 4 — METADATA DATA DICTIONARY

Live survey of `conversations.metadata` (1253 conversations), 27 Aug 2026, via
`scripts/_map-metadata-survey.ts`.

| Key | Live rows | Shape | Writer | Reader(s) | Lifecycle | Status |
|---|---|---|---|---|---|---|
| `nextTriageAt` | 3 | ISO timestamp string | `arm()` comms-lanes.ts:167-169; lease re-write comms-sweep.ts:133-134; reset :185 | `tickDueTriage` comms-sweep.ts:121-122 (due query), :134 (CAS) | armed on inbound → claimed with 4-min lease → **removed** on success (:143). Transient by design. | ACTIVE |
| `lastAutoTriageAt` | 16 | ISO timestamp string | comms-sweep.ts:94 (stamped before slow-sweep agent run — crash guard) | comms-sweep.ts:68 (skip if <20min) | stamped per sweep pass; never removed | ACTIVE |
| `callbackDueAt` | 1 | ISO timestamp string | first-contact-ack.ts:1018; post-call-outreach.ts:387 | comms-sweep.ts:282 (`fallbackOverdueCallbacks`); post-call-outreach.ts:270 | written with `callback_due` tag → cleared when callback made (call-thread.ts:565) or fallback fires (comms-sweep.ts:307-309) | ACTIVE |
| `quotePrepIntake` | 9 | object: `readiness`/verdict, `jobSummary`, `gaps[{question, audience:'ben'\|'customer'}]`, `shadow{band, score, agree}` … (full Carolyne example on file: visit_first verdict, gaps audience 'ben', shadow band 'build' score 94, DISAGREE with clerk) | comms.ts:1354-1356 and :1427 (`maybeAutoQuotePrep`) | inbox-board.ts:391, 518 (card intakeReadiness); agent-staff.ts:867 (admin audit GET) | overwritten each prep run; persists | ACTIVE |
| `quotePrepAuto` | 9 | object: `lastRunAt`, `mediaCount`, `postcodeSeen`, `lastReadiness` | `writeState` comms.ts:1352-1361 | rate-limit check comms.ts:1324-1345 (with newInfo overrides) | overwritten each run; persists | ACTIVE |
| `quoteMode` | 916 | string | **none** (V5 Agentic-Plans writer removed; conversation-engine.ts writes no metadata — verified) | only `scripts/verify_specific_call.ts`, `scripts/repair_missing_conversation.ts` | frozen relic | **ORPHANED** |
| `urgency` | 916 | string | none | ops scripts only | relic | **ORPHANED** |
| `draftReply` | 916 | string (old drafted reply text) | none | ops scripts only | relic | **ORPHANED** |
| `tasks` | 916 | array | none | ops scripts only | relic | **ORPHANED** |
| `intent` | 916 | string | none | ops scripts only | relic | **ORPHANED** |
| `reasoning` | 916 | string | none | ops scripts only | relic | **ORPHANED** |
| `recommendedAction` | 916 | string | none | ops scripts only | relic | **ORPHANED** |
| `pricingAnalytics` | 915 | `null` in sampled rows | none | none | relic | **ORPHANED** |
| `visitReason` | 23 | string | **none found** (grep of server/, 27 Aug: no matches) | none | writer deleted | **ORPHANED** |
| `leadPlan` | 1 | object | none found | none | writer deleted | **ORPHANED** |

Schema note: `shared/schema.ts:1637` comments metadata as "Store Agentic Plans" — stale;
the 8 Agentic-Plan keys have had no writer since the V5 cleanup, yet occupy ~70% of rows.

Supporting live distributions (same survey): stages closed 1233 / scoping 9 / won 9 /
enquiry 2; priorities normal 1148 / high 60 / low 39 / urgent 6; drafts
sent·comms_agent 79, rejected·comms_agent 39, sent·first_contact_ack 6,
sent·post_call_video 4, rejected·first_contact_ack 3, failed·first_contact_ack 1;
tags led by `board_clearout_2026_08` 1225, `revive_candidate` 25, `spam` 15,
`sla_breached` 15, `window_closed` 13, `needs_quote` 11, `photos_received` 8,
`quote_sent` 6, then the ~100-tag free-text long tail.

`agent_outcomes` real columns (verified): `agent, capability, kind, source, verdict,
decided_by, send_status, proposed_body, final_body, reason, created_at` (plus id/phone
keys used by ops scripts).

---

## STAGE-2 CANDIDATES SURFACED BY THIS MAP (no action taken)

1. Close the `whatsapp-api.ts:85` Meta/template branch onto the choke point (regain landline guard + SMS fallback + ledger).
2. Purge or archive the 8 legacy Agentic-Plan metadata keys (916 rows) + `visitReason` + `leadPlan`.
3. Constrain agent `add_tags` to a fixed vocabulary — the ~100 one-off tags are unbounded namespace pollution.
4. Resolve `comms_agent.autosend.enabled` config drift (code default false, live DB true).
5. If dunning is ever revived: add a DB kill-switch flag (sentAt gate already exists at invoice-generator.ts:607).
6. Fix the stale schema comments at shared/schema.ts:1630 (stage vocabulary) and :1637 (metadata purpose).
7. Stage writes are last-writer-wins (no CAS) — consider the same fresh-read pattern used for tags (comms.ts:739-741).
