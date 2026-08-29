# Brief: T1 — Pre-call photo/video prompt on initial inbound

**Owner:** top-right pane agent. **Dispatched:** 29 Aug 2026 by orchestrator pane.
**Goal:** when a new enquiry arrives (WhatsApp / SMS / webform) and we ask for a call —
including the out-of-hours "we'll call first thing tomorrow" variant — also ask the
customer to send a quick photo or video of the job, so the callback and quote are faster.

## Agreed policy (do not deviate)

- **Canned template only. No LLM composition anywhere in this path.** The first-contact
  ack is safe because it is content-free by construction (see
  docs/AGENT_DECISION_FRAMEWORK.md, "Structural incapability beats instruction") — the
  media ask must stay inside that: no money, no dates, no scope vocabulary, no promises.
- **Config flag, default OFF**, same pattern as the existing firstContactAck flag. Ship
  disabled; the user flips it after inspecting real runs.
- Wording direction (adapt to house voice, keep one sentence): "If you can, send a quick
  photo or video of the job so we're ready when we call."

## Where the work lives

- `server/first-contact-ack.ts` — the template set (web_enquiry_ack_context,
  call_request, first_contact_ack, video_request, postcode_request, fallback) and the
  out-of-hours variant. Study how templates are chosen before changing anything.
- `server/agents/comms-lanes.ts` — the inbound lane that calls maybeAutoAckFirstContact.
- The webform ack path (trace from `/api/leads` in server/leads.ts).

## Design questions you must resolve (investigate, then decide, document in code comments)

1. **One message or two?** Media ask folded into the existing ack text vs a follow-up
   line. Prefer folding into the same message — two rapid-fire messages reads botty.
2. **Channel fit:** the ask makes sense on WhatsApp. On SMS, decide: omit, or adapt
   ("WhatsApp us a photo on this number"). Webform ack follows whichever channel the
   ack goes out on. Document the choice.
3. **Out-of-hours variant** must keep its overnight framing: photos tonight help the
   morning call.
4. Media the customer sends already lands on the thread and quote-prep reads it via
   get_thread — verify this holds for each channel; do NOT build a new intake mechanism.

## Constraints

- Do NOT touch: `server/post-call-outreach.ts`, `server/call-thread.ts`,
  `server/agents/va-call-tasks.ts`, `server/pushover.ts`, `shared/eval-types.ts`,
  `scripts/eval-*.ts`, `eval-cases/*` — other panes own those right now.
- Respect every existing gate: opt-out GATE 0, WhatsApp 24h window / SMS fallback,
  queue-for-Ben when both fail. Change template CONTENT and the flag, not the gating.
- Extend the existing test suite for first-contact ack (see
  `scripts/_first-contact-ack-test.ts`) with cases for: flag off (no media ask), flag on
  per channel, out-of-hours variant. Run the whole suite; it must stay green.
- No messages to real numbers; test numbers stay in the +447700900xxx drama range.

## Done means

Flag-gated media ask in the ack templates for all three channels (with the SMS decision
documented), out-of-hours variant included, existing + new suite green, shipped disabled.
Report back: what wording shipped per channel/variant, flag name, and suite results.
