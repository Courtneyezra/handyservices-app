# Brief: T3 — Post-call WhatsApp opener reads as a continuation of the call

**Owner:** bottom-left pane agent. **Dispatched:** 29 Aug 2026 by orchestrator pane.
**Goal:** when an incoming call ends and the caller agreed to WhatsApp
(classification.whatsappAgreed = 'agreed'), the first WhatsApp they receive should read
like a continuation of the phone conversation — not a cold template.

## Agreed policy (do not deviate)

- **FIXED template with ONE bounded slot.** No free LLM composition. The slot is a short
  job reference derived from the call classifier's jobSummary (the same field already
  trusted for Pushover alerts). Hard length cap (~60 chars after normalisation);
  if the summary is missing, over-cap, or low quality, **fall back to the fully generic
  continuation template** — never truncate mid-thought, never let raw transcript through.
  - Slotted: "Good to speak just now about the {jobRef} — this is the number to send
    any photos or videos of the job, and we'll get your quote moving."
  - Generic fallback: same message without the job reference.
  Adapt wording to house voice; keep it to one message.
- **Config flag, default OFF** (same pattern as firstContactAck). Ship disabled.
- Includes the **video-ask** as part of the same single message (see slotted example) —
  do not send a separate second message.

## Where the work lives

- `server/post-call-outreach.ts` — existing manual routes (sendPostCallVideo,
  sendCallbackFallbackForCall). Study before changing; your work likely becomes a new
  flag-gated automatic path triggered on call ingestion.
- `server/call-thread.ts` — call → message row + classification read. You own this file
  for this task but keep changes minimal (likely just the trigger hook).
- Call classification shape: kind, whatsappAgreed, jobSummary, urgency,
  callbackPromised, callIncomplete (server/call-classifier.ts — read only).

## Things you must get right (investigate first)

1. **The WhatsApp 24h window.** Rule 1 in call-thread.ts: a call does NOT open the
   WhatsApp window. If the customer has no open window, a freeform message cannot be
   sent — check how post-call-outreach handles this today (Meta template vs freeform vs
   SMS fallback) and follow the established mechanism. If a Meta-approved template with
   a variable is required for the slotted version, say so in your report; do not invent
   a workaround.
2. **Send only when appropriate:** whatsappAgreed='agreed' AND kind='job_enquiry'.
   Never on complaint threads (complaint flag suppresses ALL automation), never after
   opt-out, never for sales_spam/wrong_number/supplier.
3. **Idempotency:** one continuation message per call, ever. Deterministic guard keyed
   on the call record id (mirror the `call_<id>` message-id pattern).
4. **Timing:** send shortly after the call classification lands, not instantly at
   hangup (classification must exist). Check how/when classification completes.
5. Coordinate with existing lanes: if a VA call task or first-contact ack already
   messaged this thread, the continuation must not double up — check thread state
   before sending.

## Constraints

- Do NOT touch: `server/first-contact-ack.ts`, `server/agents/comms-lanes.ts`,
  `server/agents/va-call-tasks.ts`, `server/pushover.ts`, `shared/eval-types.ts`,
  `scripts/eval-*.ts`, `eval-cases/*` — other panes own those right now.
- The slot content must pass the draft guards (server/agents/draft-guards.ts) — run
  checkDraft over the composed message in code before sending; a guard refusal means
  fall back to the generic template (which must be guard-clean by construction).
- Extend the relevant test suite (see scripts/_call-thread-test.ts pattern): flag off,
  agreed/declined/not_discussed, missing jobSummary fallback, over-cap fallback,
  complaint suppression, idempotency on re-ingest. Suites must stay green.
- No messages to real numbers; test numbers in the +447700900xxx drama range only.

## Done means

Flag-gated automatic continuation message: fixed template + bounded jobRef slot with
generic fallback, correct window handling, idempotent, suppressed on
complaint/opt-out/non-enquiry, suites green, shipped disabled. Report back: exact
template wording (both variants), flag name, window-handling mechanism used, and suite
results.
