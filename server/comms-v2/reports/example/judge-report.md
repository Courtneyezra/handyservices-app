# Comms v2 judge report

Generated 2026-09-10T20:27:22.437Z. Desk: current desk (server/spine via /api/comms-sandbox, dry run). Door: in_process at http://127.0.0.1:63345/api/comms-sandbox. Runs: 2.

Lines: 3 pass, 8 fail, 0 error. Exit code 0 (non-zero only on an error; a fail is not an error).

A line passes only when every expectation on it passes in every run. Fails against the current desk are expected: Goal 0 proves the judge, not the desk.

## Lines

| Line | Expected | Result | Run 1 | Run 2 |
|---|---|---|---|---|
| 1.1 | The customer's first WhatsApp message gets one acknowledgement that quotes their enquiry back and offers a call, freeform. | **FAIL** | FAIL | FAIL |
| 1.6 | A customer who has said text-only is never asked for a call again. | **PASS** | PASS | PASS |
| 1.7 | Photos arriving with the first message are acknowledged as photos, not as a bare enquiry. | **FAIL** | FAIL | FAIL |
| 2.1 | It replies to every customer turn, whether or not the reply is a question. | **FAIL** | FAIL | FAIL |
| 2.2 | It asks for a photo once. If they reply without sending one, it proceeds. | **FAIL** | FAIL | FAIL |
| 2.3 | It asks about the job one thing at a time, in its own words. | **FAIL** | FAIL | FAIL |
| 2.4 | A short pause ("one sec") does not stop it. | **PASS** | PASS | PASS |
| 2.5 | A real promise ("I'll send photos tomorrow") gets one acknowledgement, then quiet until they write. | **FAIL** | FAIL | FAIL |
| 2.6 | A date question gets "dates come with your quote" and scoping continues. No lead-time guess. | **FAIL** | FAIL | FAIL |
| 2.7 | Anything about money goes to Ben, not answered. | **PASS** | PASS | PASS |
| 2.8 | It never sends a second reply without the customer writing in between. | **FAIL** | FAIL | FAIL |

### Line 1.1: FAIL

The customer's first WhatsApp message gets one acknowledgement that quotes their enquiry back and offers a call, freeform.

Run 1: FAIL

- 1.1-inbound-whatsapp turn 1 reply_sent: pass - a reply would go (2 bubbles, rules_layer_mirror)
- 1.1-inbound-whatsapp turn 1 text_matches: fail - no match for /\btap\b/
- 1.1-inbound-whatsapp turn 1 offers_call: pass - the reply offers a call
- 1.1-inbound-whatsapp turn 1 freeform: pass - freeform, no template
- 1.1-inbound-whatsapp turn 1 bubble_count_within: pass - 2 bubbles, ceiling 4

Run 2: FAIL

- 1.1-inbound-whatsapp turn 1 reply_sent: pass - a reply would go (2 bubbles, rules_layer_mirror)
- 1.1-inbound-whatsapp turn 1 text_matches: fail - no match for /\btap\b/
- 1.1-inbound-whatsapp turn 1 offers_call: pass - the reply offers a call
- 1.1-inbound-whatsapp turn 1 freeform: pass - freeform, no template
- 1.1-inbound-whatsapp turn 1 bubble_count_within: pass - 2 bubbles, ceiling 4

### Line 1.6: PASS

A customer who has said text-only is never asked for a call again.

Run 1: PASS

- 1.6-prefers-text turn 2 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 3 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 4 not_offers_call: pass - the reply does not offer a call

Run 2: PASS

- 1.6-prefers-text turn 2 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 3 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 4 not_offers_call: pass - the reply does not offer a call

### Line 1.7: FAIL

Photos arriving with the first message are acknowledged as photos, not as a bare enquiry.

Run 1: FAIL

- 1.7-photos-first turn 1 reply_sent: fail - no reply would go: decision pending
- 1.7-photos-first turn 1 text_matches: fail - no reply would go

Run 2: FAIL

- 1.7-photos-first turn 1 reply_sent: fail - no reply would go: decision pending
- 1.7-photos-first turn 1 text_matches: fail - no reply would go

### Line 2.1: FAIL

It replies to every customer turn, whether or not the reply is a question.

Run 1: FAIL

- 2.1-replies-to-statements turn 1 reply_sent: pass - a reply would go (2 bubbles, rules_layer_mirror)
- 2.1-replies-to-statements turn 2 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.1-replies-to-statements turn 3 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.1-replies-to-statements turn 4 reply_sent: fail - no reply would go: decision pending

Run 2: FAIL

- 2.1-replies-to-statements turn 1 reply_sent: pass - a reply would go (2 bubbles, rules_layer_mirror)
- 2.1-replies-to-statements turn 2 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.1-replies-to-statements turn 3 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.1-replies-to-statements turn 4 reply_sent: fail - no reply would go: decision pending

### Line 2.2: FAIL

It asks for a photo once. If they reply without sending one, it proceeds.

Run 1: FAIL

- 2.2-photo-once turn 1 asked_at_most_once: pass - media asked 0 times so far
- 2.2-photo-once turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.2-photo-once turn 2 asked_at_most_once: pass - media asked 1 time so far
- 2.2-photo-once turn 3 reply_sent: fail - no reply would go: decision pending
- 2.2-photo-once turn 3 not_asks_subject: pass - the reply does not ask about media
- 2.2-photo-once turn 3 asked_at_most_once: pass - media asked 1 time so far
- 2.2-photo-once turn 4 reply_sent: fail - no reply would go: decision pending
- 2.2-photo-once turn 4 not_asks_subject: pass - the reply does not ask about media
- 2.2-photo-once turn 4 asked_at_most_once: pass - media asked 1 time so far

Run 2: FAIL

- 2.2-photo-once turn 1 asked_at_most_once: pass - media asked 0 times so far
- 2.2-photo-once turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.2-photo-once turn 2 asked_at_most_once: pass - media asked 1 time so far
- 2.2-photo-once turn 3 reply_sent: fail - no reply would go: decision none
- 2.2-photo-once turn 3 not_asks_subject: pass - the reply does not ask about media
- 2.2-photo-once turn 3 asked_at_most_once: pass - media asked 1 time so far
- 2.2-photo-once turn 4 reply_sent: fail - no reply would go: decision none
- 2.2-photo-once turn 4 not_asks_subject: pass - the reply does not ask about media
- 2.2-photo-once turn 4 asked_at_most_once: pass - media asked 1 time so far

### Line 2.3: FAIL

It asks about the job one thing at a time, in its own words.

Run 1: FAIL

- 2.3-own-words turn 2 asks_subject: fail - no reply would go
- 2.3-own-words turn 2 own_words: fail - no reply would go [model claude-haiku-4-5: skipped - no reply to judge]
- 2.3-own-words turn 3 own_words: pass - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this) [model claude-haiku-4-5: no - The reply fails by introducing unrelated jobs (door and tap) that the customer never mentioned, making it read like a template rather than a natural response to their specific bannister issue.]

Run 2: FAIL

- 2.3-own-words turn 2 asks_subject: fail - no reply would go
- 2.3-own-words turn 2 own_words: fail - no reply would go [model claude-haiku-4-5: skipped - no reply to judge]
- 2.3-own-words turn 3 own_words: pass - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this) [model claude-haiku-4-5: no - The reply fails because bubble 3 introduces 'door and tap' work that the customer never mentioned, reading like a template rather than responding naturally to what was actually said.]

### Line 2.4: PASS

A short pause ("one sec") does not stop it.

Run 1: PASS

- 2.4-short-pause turn 3 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.4-short-pause turn 3 asks_subject: pass - the reply asks about any

Run 2: PASS

- 2.4-short-pause turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.4-short-pause turn 3 asks_subject: pass - the reply asks about any

### Line 2.5: FAIL

A real promise ("I'll send photos tomorrow") gets one acknowledgement, then quiet until they write.

Run 1: FAIL

- 2.5-promise-then-quiet turn 2 reply_sent: fail - no reply would go: decision none
- 2.5-promise-then-quiet turn 2 bubble_count_within: fail - no reply would go
- 2.5-promise-then-quiet turn 3 reply_not_sent: pass - nothing goes: decision none
- 2.5-promise-then-quiet turn 4 reply_not_sent: pass - nothing goes: decision none

Run 2: FAIL

- 2.5-promise-then-quiet turn 2 reply_sent: fail - no reply would go: decision none
- 2.5-promise-then-quiet turn 2 bubble_count_within: fail - no reply would go
- 2.5-promise-then-quiet turn 3 reply_not_sent: pass - nothing goes: decision none
- 2.5-promise-then-quiet turn 4 reply_not_sent: pass - nothing goes: decision none

### Line 2.6: FAIL

A date question gets "dates come with your quote" and scoping continues. No lead-time guess.

Run 1: FAIL

- 2.6-date-question turn 2 reply_sent: fail - no reply would go: decision pending
- 2.6-date-question turn 2 no_date: pass - no date, time or duration in the reply
- 2.6-date-question turn 2 text_matches: fail - no reply would go
- 2.6-date-question turn 2 asks_subject: fail - no reply would go

Run 2: FAIL

- 2.6-date-question turn 2 reply_sent: fail - no reply would go: decision pending
- 2.6-date-question turn 2 no_date: pass - no date, time or duration in the reply
- 2.6-date-question turn 2 text_matches: fail - no reply would go
- 2.6-date-question turn 2 asks_subject: fail - no reply would go

### Line 2.7: PASS

Anything about money goes to Ben, not answered.

Run 1: PASS

- 2.7-money-to-ben turn 2 hold_for_approver: pass - held for ben: money_question
- 2.7-money-to-ben turn 2 no_figure: pass - no figure in the reply

Run 2: PASS

- 2.7-money-to-ben turn 2 hold_for_approver: pass - held for ben: money_question
- 2.7-money-to-ben turn 2 no_figure: pass - no figure in the reply

### Line 2.8: FAIL

It never sends a second reply without the customer writing in between.

Run 1: FAIL

- 2.8-one-reply-per-turn turn 1 reply_sent: pass - a reply would go (2 bubbles, rules_layer_mirror)
- 2.8-one-reply-per-turn turn 1 bubble_count_within: pass - 2 bubbles, ceiling 4
- 2.8-one-reply-per-turn turn 2 reply_not_sent: pass - nothing goes: decision none
- 2.8-one-reply-per-turn turn 3 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.8-one-reply-per-turn turn 4 reply_not_sent: fail - a reply would go (desk): Got it, bathroom door catching on the frame upstairs.

Run 2: FAIL

- 2.8-one-reply-per-turn turn 1 reply_sent: pass - a reply would go (2 bubbles, rules_layer_mirror)
- 2.8-one-reply-per-turn turn 1 bubble_count_within: pass - 2 bubbles, ceiling 4
- 2.8-one-reply-per-turn turn 2 reply_not_sent: pass - nothing goes: decision none
- 2.8-one-reply-per-turn turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.8-one-reply-per-turn turn 4 reply_not_sent: fail - a reply would go (desk): Cheers Lee, that helps.

## Scenarios, turn by turn

### 1.1-inbound-whatsapp run 1: Inbound WhatsApp: the opening message gets one freeform acknowledgement that quotes the enquiry back and offers a call

Lines 1.1. Started 2026-09-10T19:47:11.396Z, 25821 ms.

Seed: customer new, name Sam, prefers text false, already rung false, window open. customer: honoured (name "Sam" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_21715a0d-45ad-4418-b75b-efd25c1b1dbe.

> Hi Sam, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [1.1] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)
- [1.1] text_matches: **FAIL** - no match for /\btap\b/
- [1.1] offers_call: **PASS** - the reply offers a call
- [1.1] freeform: **PASS** - freeform, no template
- [1.1] bubble_count_within: **PASS** - 2 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "b2ad401b-b205-4055-b738-274342b96bbb",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sam"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Sam, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_21715a0d-45ad-4418-b75b-efd25c1b1dbe",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "b2ad401b-b205-4055-b738-274342b96bbb",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "leaking_tap",
    "kitchen",
    "plumbing"
  ],
  "contactName": "Sam",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sam",
      "at": "2026-09-10T19:47:18.050Z",
      "content": "Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:47:32.085Z",
      "content": "Hi Sam, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 1.6-prefers-text run 1: Prefers text: once the customer says text only, a call is never offered again

Lines 1.6. Started 2026-09-10T19:47:37.217Z, 166700 ms.

Seed: customer new, name Jo, prefers text true, already rung false, window open. customer: honoured (name "Jo" passed to POST /start as the pushname); prefersText: unsupported (no seed field on the current door; the scenario states it in a customer turn ("text only please")).

#### Turn 1 (customer/message): Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?

Planned send: nothing goes; decision none; intent ask_postcode; window open; template unavailable; approver none; hold none; run run_63cb65c9-281e-4794-8bb0-d49a7a3746f4.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a12a4f40-89e4-4682-b19a-b73fa54ea095",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": null,
  "runId": "run_63cb65c9-281e-4794-8bb0-d49a7a3746f4",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "ask_postcode",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "a12a4f40-89e4-4682-b19a-b73fa54ea095",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_work",
    "damage"
  ],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T19:47:43.251Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): Text only please, I can't take calls at work.

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_5e0baa61-881c-4d32-b729-4c5205287acb.

> Hiya, sorry to hear that, we can sort a replacement panel.
> No worries, text is fine. Could you send a photo of the fallen panel and the fence line either side?

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a12a4f40-89e4-4682-b19a-b73fa54ea095",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya, sorry to hear that, we can sort a replacement panel.",
    "No worries, text is fine. Could you send a photo of the fallen panel and the fence line either side?"
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_5e0baa61-881c-4d32-b729-4c5205287acb",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 2 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "a12a4f40-89e4-4682-b19a-b73fa54ea095",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_work",
    "damage",
    "text_only"
  ],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T19:47:43.251Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T19:47:59.819Z",
      "content": "Text only please, I can't take calls at work."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): It's one 6ft panel, the posts are fine. We're NG9 2AB.

Planned send: 2 bubbles (desk); decision send; intent confirm_received; window open; template none; approver agent.scoper; hold none; run run_e1f1be46-810e-4deb-aede-973515f97b68.

> Got it thanks, one 6ft panel down, posts fine, NG9 2AB.
> I'll get your quote sent over by text, no calls needed.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a12a4f40-89e4-4682-b19a-b73fa54ea095",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Got it thanks, one 6ft panel down, posts fine, NG9 2AB.",
    "I'll get your quote sent over by text, no calls needed."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_e1f1be46-810e-4deb-aede-973515f97b68",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 2 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "a12a4f40-89e4-4682-b19a-b73fa54ea095",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_work",
    "damage",
    "text_only",
    "postcode_provided",
    "scope_clear",
    "needs_quote"
  ],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T19:47:43.251Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T19:47:59.819Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T19:48:28.156Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 4 (customer/message): Do you need anything else from me?

Planned send: nothing goes; decision none; intent propose_intake; window open; template unavailable; approver none; hold none; run run_ea72d183-66b4-42e0-b5a3-9a82726281b1.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a12a4f40-89e4-4682-b19a-b73fa54ea095",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_ea72d183-66b4-42e0-b5a3-9a82726281b1",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "propose_intake",
    "lane": "quote_clerk",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — artifact quote_intake recorded (tier PROPOSE); nothing goes to the customer",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [
      "intent propose_intake is not allowed in pack customer.default"
    ],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "a12a4f40-89e4-4682-b19a-b73fa54ea095",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_work",
    "damage",
    "text_only",
    "postcode_provided",
    "scope_clear",
    "needs_quote"
  ],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T19:47:43.251Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T19:47:59.819Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T19:48:28.156Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T19:49:21.025Z",
      "content": "Do you need anything else from me?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 1.7-photos-first run 1: Photos with the first message are acknowledged as photos, not as a bare enquiry

Lines 1.7. Started 2026-09-10T19:50:23.918Z, 53498 ms.

Seed: customer new, name Priya, prefers text false, already rung false, window open. customer: honoured (name "Priya" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it? [+1 media]

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_43f23c58-6edc-4eca-9526-bc1a260f9a95.

- [1.7] reply_sent: **FAIL** - no reply would go: decision pending
- [1.7] text_matches: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "4988b71a-eab5-4976-897b-c392e862bef5",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sandbox customer (not real)"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_43f23c58-6edc-4eca-9526-bc1a260f9a95",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: ask_gap:customer_question",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "4988b71a-eab5-4976-897b-c392e862bef5",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "photos_received",
    "needs_quote",
    "plumbing"
  ],
  "contactName": "Sandbox customer (not real)",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sandbox customer (not real)",
      "at": "2026-09-10T19:50:45.840Z",
      "content": "Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.1-replies-to-statements run 1: Replies to every customer turn, whether or not the reply is a question

Lines 2.1. Started 2026-09-10T19:51:17.416Z, 148825 ms.

Seed: customer new, name Dan, prefers text false, already rung false, window open. customer: honoured (name "Dan" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my bathroom extractor fan has stopped working, can you sort it?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_c6222435-6983-4731-84a3-deb182b94bee.

> Hi Dan, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e048782-50d2-4cb2-9285-47461bbad409",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Dan, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_c6222435-6983-4731-84a3-deb182b94bee",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "5e048782-50d2-4cb2-9285-47461bbad409",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "extractor_fan",
    "electrical"
  ],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T19:51:23.417Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:51:40.445Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): It's a ceiling fan, about four inch. The light still works but the fan is dead.

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_9797d7b7-476f-4163-bf52-ea304182c8e2.

> Good to know it's just the fan and not the light.
> Could you send a quick photo of the fan and the switch it's wired to?
> That'll help me see what we're dealing with.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e048782-50d2-4cb2-9285-47461bbad409",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Good to know it's just the fan and not the light.",
    "Could you send a quick photo of the fan and the switch it's wired to?",
    "That'll help me see what we're dealing with."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_9797d7b7-476f-4163-bf52-ea304182c8e2",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "5e048782-50d2-4cb2-9285-47461bbad409",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "extractor_fan",
    "electrical",
    "needs_quote"
  ],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T19:51:23.417Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:51:40.445Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T19:51:48.166Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): We're in NG7 2PQ.

Planned send: 3 bubbles (desk); decision send; intent confirm_received; window open; template none; approver agent.scoper; hold none; run run_ab862daa-ba6e-4299-960e-c71fb991e8c8.

> Got it, four inch ceiling fan not spinning but light's fine.
> NG7 2PQ noted, thanks Dan.
> I'll get your quote sent over shortly.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e048782-50d2-4cb2-9285-47461bbad409",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Got it, four inch ceiling fan not spinning but light's fine.",
    "NG7 2PQ noted, thanks Dan.",
    "I'll get your quote sent over shortly."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_ab862daa-ba6e-4299-960e-c71fb991e8c8",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "5e048782-50d2-4cb2-9285-47461bbad409",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "extractor_fan",
    "electrical",
    "needs_quote",
    "postcode_received"
  ],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T19:51:23.417Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:51:40.445Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T19:51:48.166Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T19:52:21.155Z",
      "content": "We're in NG7 2PQ."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 4 (customer/message): Ok thanks, that all makes sense.

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_c6a09122-c710-4b49-a71c-62502d7778e8.

- [2.1] reply_sent: **FAIL** - no reply would go: decision pending

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e048782-50d2-4cb2-9285-47461bbad409",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_c6a09122-c710-4b49-a71c-62502d7778e8",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: confirm_received:nothing_arrived",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "5e048782-50d2-4cb2-9285-47461bbad409",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "extractor_fan",
    "electrical",
    "needs_quote",
    "postcode_received",
    "scoping_in_progress"
  ],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T19:51:23.417Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:51:40.445Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T19:51:48.166Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T19:52:21.155Z",
      "content": "We're in NG7 2PQ."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T19:53:04.190Z",
      "content": "Ok thanks, that all makes sense."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.2-photo-once run 1: Asks for a photo once; when the customer answers in words without one, it proceeds

Lines 2.2. Started 2026-09-10T19:53:46.241Z, 134103 ms.

Seed: customer new, name Mel, prefers text false, already rung false, window open. customer: honoured (name "Mel" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_067c019f-0650-42c9-8e74-efc8a80533a9.

> Hi Mel, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "e7eaf62a-25bf-4c91-8ec6-b16d01728680",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Mel, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_067c019f-0650-42c9-8e74-efc8a80533a9",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "e7eaf62a-25bf-4c91-8ec6-b16d01728680",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "tile_repair",
    "postcode_provided"
  ],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T19:53:51.554Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:54:03.361Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): It's one tile, cracked corner to corner. Plain white, about 20cm square.

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_e1c79079-3378-49ca-a2bf-c21c366c4352.

> Thanks Mel, that's really helpful.
> Could you send a quick photo of the cracked tile and the ones around it? Helps us match it up properly.

- [2.2] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.2] asked_at_most_once: **PASS** - media asked 1 time so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "e7eaf62a-25bf-4c91-8ec6-b16d01728680",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Mel, that's really helpful.",
    "Could you send a quick photo of the cracked tile and the ones around it? Helps us match it up properly."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_e1c79079-3378-49ca-a2bf-c21c366c4352",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 2 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "e7eaf62a-25bf-4c91-8ec6-b16d01728680",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "tile_repair",
    "postcode_provided",
    "needs_quote"
  ],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T19:53:51.554Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:54:03.361Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T19:54:10.467Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q.

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_0731e5ee-fb1c-4f9a-95f1-d3801f97511e.

- [2.2] reply_sent: **FAIL** - no reply would go: decision pending
- [2.2] not_asks_subject: **PASS** - the reply does not ask about media
- [2.2] asked_at_most_once: **PASS** - media asked 1 time so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "e7eaf62a-25bf-4c91-8ec6-b16d01728680",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_0731e5ee-fb1c-4f9a-95f1-d3801f97511e",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: confirm_received:nothing_arrived",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "e7eaf62a-25bf-4c91-8ec6-b16d01728680",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "tile_repair",
    "postcode_provided",
    "needs_quote",
    "no_photos"
  ],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T19:53:51.554Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:54:03.361Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T19:54:10.467Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T19:54:41.481Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 4 (customer/message): What else do you need to know?

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_6b36fc17-efc0-455d-b7c1-84d28cd538bd.

- [2.2] reply_sent: **FAIL** - no reply would go: decision pending
- [2.2] not_asks_subject: **PASS** - the reply does not ask about media
- [2.2] asked_at_most_once: **PASS** - media asked 1 time so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "e7eaf62a-25bf-4c91-8ec6-b16d01728680",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_6b36fc17-efc0-455d-b7c1-84d28cd538bd",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: confirm_received:nothing_arrived",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "e7eaf62a-25bf-4c91-8ec6-b16d01728680",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "tile_repair",
    "postcode_provided",
    "needs_quote",
    "no_photos"
  ],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T19:53:51.554Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:54:03.361Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T19:54:10.467Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T19:54:41.481Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T19:55:18.502Z",
      "content": "What else do you need to know?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.3-own-words run 1: Asks about the job one thing at a time, in its own words (model verdict recorded beside the deterministic one)

Lines 2.3. Started 2026-09-10T19:56:00.345Z, 90373 ms.

Seed: customer new, name Alex, prefers text false, already rung false, window open. customer: honoured (name "Alex" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9.

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_fa62aaad-cd0e-46d5-9472-7e978e3e2176.

> Hiya, sounds like a good list for us.
> Could you send a few photos or a quick video, the bannister, the sticking door, and the leaking tap?
> That'll help me get it all scoped properly.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "7797bdb4-6a54-49b1-b751-a3a8daa06d15",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya, sounds like a good list for us.",
    "Could you send a few photos or a quick video, the bannister, the sticking door, and the leaking tap?",
    "That'll help me get it all scoped properly."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_fa62aaad-cd0e-46d5-9472-7e978e3e2176",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "7797bdb4-6a54-49b1-b751-a3a8daa06d15",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "initial_contact",
    "multiple_jobs",
    "postcode_provided"
  ],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T19:56:04.362Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): Which one do you want to know about first?

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_70adcbe9-63d8-46df-ac03-66d5f82f091c.

- [2.3] asks_subject: **FAIL** - no reply would go
- [2.3] own_words: **FAIL** - no reply would go
  - model judge (beside, not instead): claude-haiku-4-5, prompt 153f36d8fd03, verdict **skipped** - no reply to judge

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "7797bdb4-6a54-49b1-b751-a3a8daa06d15",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_70adcbe9-63d8-46df-ac03-66d5f82f091c",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: ask_gap:customer_question",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "7797bdb4-6a54-49b1-b751-a3a8daa06d15",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "initial_contact",
    "multiple_jobs",
    "postcode_provided",
    "needs_scoping"
  ],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T19:56:04.362Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T19:56:33.983Z",
      "content": "Which one do you want to know about first?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): The bannister is at the top of the stairs, two of the spindles have come loose and it rocks when you lean on it.

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_84ac0e5b-498d-4200-bc89-f1dbf53afe7e.

> Hiya, thanks for that, the bannister sounds straightforward enough.
> Could you send a quick video of it wobbling, showing the loose spindles?
> Once I've seen that we'll sort the door and the tap too.

- [2.3] own_words: **PASS** - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)
  - model judge (beside, not instead): claude-haiku-4-5, prompt 39a56e837818, verdict **no** - The reply fails by introducing unrelated jobs (door and tap) that the customer never mentioned, making it read like a template rather than a natural response to their specific bannister issue.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "7797bdb4-6a54-49b1-b751-a3a8daa06d15",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya, thanks for that, the bannister sounds straightforward enough.",
    "Could you send a quick video of it wobbling, showing the loose spindles?",
    "Once I've seen that we'll sort the door and the tap too."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_84ac0e5b-498d-4200-bc89-f1dbf53afe7e",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "7797bdb4-6a54-49b1-b751-a3a8daa06d15",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "initial_contact",
    "multiple_jobs",
    "postcode_provided",
    "needs_scoping"
  ],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T19:56:04.362Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T19:56:33.983Z",
      "content": "Which one do you want to know about first?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T19:57:02.141Z",
      "content": "The bannister is at the top of the stairs, two of the spindles have come loose and it rocks when you lean on it."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.4-short-pause run 1: A short pause ("one sec") does not stop it: the real answer that follows is scoped

Lines 2.4. Started 2026-09-10T19:57:30.718Z, 86221 ms.

Seed: customer new, name Chris, prefers text false, already rung false, window open. customer: honoured (name "Chris" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_85edca27-9a49-4896-9e60-46410dc0e7e9.

> Hi Chris, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "8dcb1d4a-3d4a-4cad-a173-83bfed477cb6",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Chris, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_85edca27-9a49-4896-9e60-46410dc0e7e9",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "8dcb1d4a-3d4a-4cad-a173-83bfed477cb6",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "gate_repair",
    "ng9_postcode"
  ],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T19:57:36.291Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:57:52.300Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): one sec, let me check

Planned send: nothing goes; decision none; intent unknown; window open; template unavailable; approver none; hold none; run run_f841c5f0-b7c1-43e0-ba5e-ecbd6ebe4a22.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "8dcb1d4a-3d4a-4cad-a173-83bfed477cb6",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": null,
  "runId": "run_f841c5f0-b7c1-43e0-ba5e-ecbd6ebe4a22",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "unknown",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — no proposal",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "8dcb1d4a-3d4a-4cad-a173-83bfed477cb6",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "gate_repair",
    "ng9_postcode",
    "awaiting_customer_response"
  ],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T19:57:36.291Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:57:52.300Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T19:57:59.926Z",
      "content": "one sec, let me check"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): Right, it's a wooden gate. The post has rotted at the bottom so the whole thing leans.

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_12703aca-e27a-4225-bd30-c1b4e00822e8.

> Thanks for that, sounds like the post's the main issue.
> Could you send a photo or short video of the rotted post and how the gate's leaning?
> That'll help me see exactly what needs doing.

- [2.4] reply_sent: **PASS** - a reply would go (3 bubbles, desk)
- [2.4] asks_subject: **PASS** - the reply asks about any

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "8dcb1d4a-3d4a-4cad-a173-83bfed477cb6",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks for that, sounds like the post's the main issue.",
    "Could you send a photo or short video of the rotted post and how the gate's leaning?",
    "That'll help me see exactly what needs doing."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_12703aca-e27a-4225-bd30-c1b4e00822e8",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "8dcb1d4a-3d4a-4cad-a173-83bfed477cb6",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "gate_repair",
    "ng9_postcode",
    "awaiting_customer_response",
    "wooden_gate",
    "rotted_post",
    "needs_photos"
  ],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T19:57:36.291Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:57:52.300Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T19:57:59.926Z",
      "content": "one sec, let me check"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T19:58:25.813Z",
      "content": "Right, it's a wooden gate. The post has rotted at the bottom so the whole thing leans."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.5-promise-then-quiet run 1: A real promise ("I'll send photos tomorrow") gets one acknowledgement, then quiet until the customer writes

Lines 2.5. Started 2026-09-10T19:58:56.940Z, 202265 ms.

Seed: customer new, name Sara, prefers text false, already rung false, window open. customer: honoured (name "Sara" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_9e83da12-13fa-41ec-9512-75a67216dfb7.

> Hi Sara, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d52d4113-70e4-4ac9-ab9b-70d472645d3c",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Sara, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_9e83da12-13fa-41ec-9512-75a67216dfb7",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "d52d4113-70e4-4ac9-ab9b-70d472645d3c",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "storm_damage",
    "postcode_provided"
  ],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T19:59:05.122Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:59:24.624Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): I'll send photos tomorrow when I'm home.

Planned send: nothing goes; decision none; intent confirm_received; window open; template unavailable; approver none; hold none; run run_f3bbbc5c-a50e-41aa-9e11-615d4ceb9f67.

- [2.5] reply_sent: **FAIL** - no reply would go: decision none
- [2.5] bubble_count_within: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d52d4113-70e4-4ac9-ab9b-70d472645d3c",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_f3bbbc5c-a50e-41aa-9e11-615d4ceb9f67",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — waiting_for_promised",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "d52d4113-70e4-4ac9-ab9b-70d472645d3c",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_repair",
    "storm_damage",
    "postcode_provided",
    "photos_pending"
  ],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T19:59:05.122Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:59:24.624Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T19:59:32.680Z",
      "content": "I'll send photos tomorrow when I'm home."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (system/clock): clock pass

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_1aa213a5-ce98-48b7-a772-9f2c593aeba3.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d52d4113-70e4-4ac9-ab9b-70d472645d3c",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_1aa213a5-ce98-48b7-a772-9f2c593aeba3",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "holding",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — waiting_for_promised",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "d52d4113-70e4-4ac9-ab9b-70d472645d3c",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_repair",
    "storm_damage",
    "postcode_provided",
    "photos_pending"
  ],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 2 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T19:59:05.122Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:59:24.624Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T19:59:32.680Z",
      "content": "I'll send photos tomorrow when I'm home."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 4 (system/clock): clock pass

Planned send: nothing goes; decision none; intent ask_gap; window open; template unavailable; approver none; hold none; run run_32c63ded-9b68-4b64-b69e-d24cd2063e72.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d52d4113-70e4-4ac9-ab9b-70d472645d3c",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_32c63ded-9b68-4b64-b69e-d24cd2063e72",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — waiting_for_promised",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "d52d4113-70e4-4ac9-ab9b-70d472645d3c",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_repair",
    "storm_damage",
    "postcode_provided",
    "photos_pending"
  ],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 3 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T19:59:05.122Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T19:59:24.624Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T19:59:32.680Z",
      "content": "I'll send photos tomorrow when I'm home."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.6-date-question run 1: A date question gets "dates come with your quote" and scoping continues; no lead-time guess

Lines 2.6. Started 2026-09-10T20:02:19.205Z, 80703 ms.

Seed: customer new, name Tom, prefers text false, already rung false, window open. customer: honoured (name "Tom" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ.

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_9ee50ec6-5833-43f4-822b-4f74d23ea6b8.

> Hiya Tom, no problem, we can sort that.
> Could you send a photo of the current extractor fan and where it sits in the ceiling?

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5c3bb21d-9095-44f3-aa59-241d1564c213",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Tom"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya Tom, no problem, we can sort that.",
    "Could you send a photo of the current extractor fan and where it sits in the ceiling?"
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_9ee50ec6-5833-43f4-822b-4f74d23ea6b8",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 2 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "5c3bb21d-9095-44f3-aa59-241d1564c213",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "extractor_fan",
    "postcode_given",
    "needs_photos"
  ],
  "contactName": "Tom",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T20:02:25.939Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): When can you come?

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_16bc96a8-2f5d-4b4c-8645-2747f35d2039.

- [2.6] reply_sent: **FAIL** - no reply would go: decision pending
- [2.6] no_date: **PASS** - no date, time or duration in the reply
- [2.6] text_matches: **FAIL** - no reply would go
- [2.6] asks_subject: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5c3bb21d-9095-44f3-aa59-241d1564c213",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Tom"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_16bc96a8-2f5d-4b4c-8645-2747f35d2039",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: ask_gap:date_asked",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "5c3bb21d-9095-44f3-aa59-241d1564c213",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "extractor_fan",
    "postcode_given",
    "needs_photos",
    "availability_asked"
  ],
  "contactName": "Tom",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T20:02:25.939Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T20:03:07.609Z",
      "content": "When can you come?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.7-money-to-ben run 1: Anything about money or price goes to Ben, not answered

Lines 2.7. Started 2026-09-10T20:03:39.908Z, 54638 ms.

Seed: customer new, name Nina, prefers text false, already rung false, window open. customer: honoured (name "Nina" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_dcddd262-f6ed-4ecc-ad22-f3f30dd70c2b.

> Hi Nina, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "408a8b5c-2a8b-4bb0-b8eb-1b84cdd0d881",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Nina"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Nina, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_dcddd262-f6ed-4ecc-ad22-f3f30dd70c2b",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "408a8b5c-2a8b-4bb0-b8eb-1b84cdd0d881",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "materials_supplied"
  ],
  "contactName": "Nina",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-10T20:03:46.955Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:04:10.621Z",
      "content": "Hi Nina, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): How much roughly?

Planned send: nothing goes; decision flag; intent unknown; window open; template unavailable; approver none; hold ben (money_question); run run_466f8b2c-70d7-41c6-ba28-69f1c3211d77.

- [2.7] hold_for_approver: **PASS** - held for ben: money_question
- [2.7] no_figure: **PASS** - no figure in the reply

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "408a8b5c-2a8b-4bb0-b8eb-1b84cdd0d881",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Nina"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": null,
  "runId": "run_466f8b2c-70d7-41c6-ba28-69f1c3211d77",
  "hold": {
    "approver": "ben",
    "reason": "money_question",
    "since": "2026-09-11T11:00:00.000Z"
  },
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "flag",
    "intent": "unknown",
    "lane": "ben",
    "pack": "customer.exception",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: flagged for Ben (money_question), due 2026-09-11T11:00:00.000Z: a question on his phone, nothing to the customer",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "408a8b5c-2a8b-4bb0-b8eb-1b84cdd0d881",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "materials_supplied"
  ],
  "contactName": "Nina",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-10T20:03:46.955Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:04:10.621Z",
      "content": "Hi Nina, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-10T20:04:21.041Z",
      "content": "How much roughly?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.8-one-reply-per-turn run 1: Never a second reply without the customer writing in between: one reply per customer turn, however many bubbles

Lines 2.8. Started 2026-09-10T20:04:34.546Z, 131370 ms.

Seed: customer new, name Lee, prefers text false, already rung false, window open. customer: honoured (name "Lee" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need an internal door rehung, it's catching on the frame. We're in NG9.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_18f9d40b-ddae-4c0a-b946-f3b8d29521c2.

> Hi Lee, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.8] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)
- [2.8] bubble_count_within: **PASS** - 2 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "4eb0419f-52c7-497d-a13b-61470e574295",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Lee, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_18f9d40b-ddae-4c0a-b946-f3b8d29521c2",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "4eb0419f-52c7-497d-a13b-61470e574295",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "catching_frame",
    "ng9_postcode"
  ],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:04:39.113Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:05:02.640Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (system/clock): clock pass

Planned send: nothing goes; decision none; intent unknown; window open; template unavailable; approver none; hold none; run run_c2c9a897-f229-4403-99a2-bf3406c9e208.

- [2.8] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "4eb0419f-52c7-497d-a13b-61470e574295",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": null,
  "runId": "run_c2c9a897-f229-4403-99a2-bf3406c9e208",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "unknown",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — no proposal",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "4eb0419f-52c7-497d-a13b-61470e574295",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "catching_frame",
    "ng9_postcode"
  ],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:04:39.113Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:05:02.640Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): It's the bathroom door upstairs, been like it since the summer.

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_107ce396-b6d1-463a-b90f-a356161b5968.

> Cheers Lee, that helps.
> Could you send a quick photo or video of the door where it's catching on the frame?
> That'll let us see exactly what's going on.

- [2.8] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "4eb0419f-52c7-497d-a13b-61470e574295",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Cheers Lee, that helps.",
    "Could you send a quick photo or video of the door where it's catching on the frame?",
    "That'll let us see exactly what's going on."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_107ce396-b6d1-463a-b90f-a356161b5968",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "4eb0419f-52c7-497d-a13b-61470e574295",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "catching_frame",
    "ng9_postcode",
    "bathroom_door"
  ],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:04:39.113Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:05:02.640Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:05:51.270Z",
      "content": "It's the bathroom door upstairs, been like it since the summer."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 4 (system/clock): clock pass

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_26b9c932-425c-4878-855b-aee8559ec439.

> Got it, bathroom door catching on the frame upstairs.
> Could you send a quick photo or video of where it's rubbing on the frame?
> That'll help me see exactly what's going on.

- [2.8] reply_not_sent: **FAIL** - a reply would go (desk): Got it, bathroom door catching on the frame upstairs.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "4eb0419f-52c7-497d-a13b-61470e574295",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Got it, bathroom door catching on the frame upstairs.",
    "Could you send a quick photo or video of where it's rubbing on the frame?",
    "That'll help me see exactly what's going on."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_26b9c932-425c-4878-855b-aee8559ec439",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "4eb0419f-52c7-497d-a13b-61470e574295",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "catching_frame",
    "ng9_postcode",
    "bathroom_door"
  ],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:04:39.113Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:05:02.640Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:05:51.270Z",
      "content": "It's the bathroom door upstairs, been like it since the summer."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 1.1-inbound-whatsapp run 2: Inbound WhatsApp: the opening message gets one freeform acknowledgement that quotes the enquiry back and offers a call

Lines 1.1. Started 2026-09-10T20:06:45.916Z, 20733 ms.

Seed: customer new, name Sam, prefers text false, already rung false, window open. customer: honoured (name "Sam" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_5734cd1e-bfe5-4c7a-bd32-3a09ddf43728.

> Hi Sam, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [1.1] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)
- [1.1] text_matches: **FAIL** - no match for /\btap\b/
- [1.1] offers_call: **PASS** - the reply offers a call
- [1.1] freeform: **PASS** - freeform, no template
- [1.1] bubble_count_within: **PASS** - 2 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "7b9d6c60-f6a3-4962-b899-b90a80d17db7",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sam"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Sam, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_5734cd1e-bfe5-4c7a-bd32-3a09ddf43728",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "7b9d6c60-f6a3-4962-b899-b90a80d17db7",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "tap_leak",
    "needs_quote"
  ],
  "contactName": "Sam",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sam",
      "at": "2026-09-10T20:06:49.911Z",
      "content": "Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:07:01.563Z",
      "content": "Hi Sam, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 1.6-prefers-text run 2: Prefers text: once the customer says text only, a call is never offered again

Lines 1.6. Started 2026-09-10T20:07:06.650Z, 107249 ms.

Seed: customer new, name Jo, prefers text true, already rung false, window open. customer: honoured (name "Jo" passed to POST /start as the pushname); prefersText: unsupported (no seed field on the current door; the scenario states it in a customer turn ("text only please")).

#### Turn 1 (customer/message): Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_8282758f-8639-406f-83a7-b1c262ff7e8a.

> Hi Jo, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d2cdea8d-bf3d-464b-8cb7-9df19e3982ad",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Jo, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_8282758f-8639-406f-83a7-b1c262ff7e8a",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "d2cdea8d-bf3d-464b-8cb7-9df19e3982ad",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_panel",
    "beeston",
    "needs_quote"
  ],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T20:07:10.634Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:07:21.962Z",
      "content": "Hi Jo, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): Text only please, I can't take calls at work.

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_9d895f49-859a-45b4-a1d7-bbf650aa9c1e.

> No worries, we will keep it all to text.
> Could you send a photo of the fence panel that has blown down?
> That will help me see what needs replacing.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d2cdea8d-bf3d-464b-8cb7-9df19e3982ad",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No worries, we will keep it all to text.",
    "Could you send a photo of the fence panel that has blown down?",
    "That will help me see what needs replacing."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_9d895f49-859a-45b4-a1d7-bbf650aa9c1e",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "d2cdea8d-bf3d-464b-8cb7-9df19e3982ad",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_panel",
    "beeston",
    "needs_quote",
    "text_preferred"
  ],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T20:07:10.634Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:07:21.962Z",
      "content": "Hi Jo, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T20:07:29.547Z",
      "content": "Text only please, I can't take calls at work."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): It's one 6ft panel, the posts are fine. We're NG9 2AB.

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_99d55021-05e6-4153-a025-add1c114d9da.

> Got it, one 6ft panel down, posts fine, NG9 2AB.
> Could you send a quick photo of the fence and the posts either side?
> That'll help me get your quote spot on.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d2cdea8d-bf3d-464b-8cb7-9df19e3982ad",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Got it, one 6ft panel down, posts fine, NG9 2AB.",
    "Could you send a quick photo of the fence and the posts either side?",
    "That'll help me get your quote spot on."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_99d55021-05e6-4153-a025-add1c114d9da",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "d2cdea8d-bf3d-464b-8cb7-9df19e3982ad",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_panel",
    "beeston",
    "needs_quote",
    "text_preferred",
    "postcode_received"
  ],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T20:07:10.634Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:07:21.962Z",
      "content": "Hi Jo, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T20:07:29.547Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T20:07:57.420Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 4 (customer/message): Do you need anything else from me?

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_e7311238-d7f5-47b2-8c98-ba27f44f1edd.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d2cdea8d-bf3d-464b-8cb7-9df19e3982ad",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_e7311238-d7f5-47b2-8c98-ba27f44f1edd",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: ask_gap:customer_question",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "d2cdea8d-bf3d-464b-8cb7-9df19e3982ad",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_panel",
    "beeston",
    "needs_quote",
    "text_preferred",
    "postcode_received",
    "photos_needed"
  ],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T20:07:10.634Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:07:21.962Z",
      "content": "Hi Jo, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T20:07:29.547Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T20:07:57.420Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T20:08:27.926Z",
      "content": "Do you need anything else from me?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 1.7-photos-first run 2: Photos with the first message are acknowledged as photos, not as a bare enquiry

Lines 1.7. Started 2026-09-10T20:08:53.899Z, 31111 ms.

Seed: customer new, name Priya, prefers text false, already rung false, window open. customer: honoured (name "Priya" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it? [+1 media]

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_03379e3f-b40e-45da-9c82-881af4e9a6e1.

- [1.7] reply_sent: **FAIL** - no reply would go: decision pending
- [1.7] text_matches: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "c12da189-6156-4e16-ac43-ef3e47337f52",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sandbox customer (not real)"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_03379e3f-b40e-45da-9c82-881af4e9a6e1",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: ask_gap:customer_question",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "c12da189-6156-4e16-ac43-ef3e47337f52",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "photos_received",
    "needs_quote",
    "kitchen_tap_leak"
  ],
  "contactName": "Sandbox customer (not real)",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sandbox customer (not real)",
      "at": "2026-09-10T20:09:04.382Z",
      "content": "Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.1-replies-to-statements run 2: Replies to every customer turn, whether or not the reply is a question

Lines 2.1. Started 2026-09-10T20:09:25.010Z, 132529 ms.

Seed: customer new, name Dan, prefers text false, already rung false, window open. customer: honoured (name "Dan" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my bathroom extractor fan has stopped working, can you sort it?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_1d17b290-446b-440d-9b68-4933c8534693.

> Hi Dan, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "504b56af-ee07-4f4a-908c-5b52ed722fa3",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Dan, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_1d17b290-446b-440d-9b68-4933c8534693",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "504b56af-ee07-4f4a-908c-5b52ed722fa3",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "extractor_fan",
    "bathroom",
    "electrical"
  ],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T20:09:28.712Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:09:39.220Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): It's a ceiling fan, about four inch. The light still works but the fan is dead.

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_f265844a-a21a-45e5-832c-1d3a0447db1a.

> Thanks Dan, that helps.
> Could you send a couple of photos, one close up of the fan and one standing back?
> That's usually enough for us to price it up.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "504b56af-ee07-4f4a-908c-5b52ed722fa3",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Dan, that helps.",
    "Could you send a couple of photos, one close up of the fan and one standing back?",
    "That's usually enough for us to price it up."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_f265844a-a21a-45e5-832c-1d3a0447db1a",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "504b56af-ee07-4f4a-908c-5b52ed722fa3",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "extractor_fan",
    "bathroom",
    "electrical",
    "needs_quote"
  ],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T20:09:28.712Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:09:39.220Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T20:09:45.663Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): We're in NG7 2PQ.

Planned send: 3 bubbles (desk); decision send; intent confirm_received; window open; template none; approver agent.scoper; hold none; run run_10f7a92d-1a80-4f14-953d-217cdd4cba30.

> Got it, ceiling extractor, light still working but fan's packed in.
> Postcode noted, NG7 2PQ.
> I'll get your quote sent over shortly.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "504b56af-ee07-4f4a-908c-5b52ed722fa3",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Got it, ceiling extractor, light still working but fan's packed in.",
    "Postcode noted, NG7 2PQ.",
    "I'll get your quote sent over shortly."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_10f7a92d-1a80-4f14-953d-217cdd4cba30",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "504b56af-ee07-4f4a-908c-5b52ed722fa3",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "extractor_fan",
    "bathroom",
    "electrical",
    "needs_quote",
    "postcode_received"
  ],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T20:09:28.712Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:09:39.220Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T20:09:45.663Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T20:10:14.365Z",
      "content": "We're in NG7 2PQ."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 4 (customer/message): Ok thanks, that all makes sense.

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_0c25d858-bb07-4c29-b51e-60b3980064f3.

- [2.1] reply_sent: **FAIL** - no reply would go: decision pending

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "504b56af-ee07-4f4a-908c-5b52ed722fa3",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_0c25d858-bb07-4c29-b51e-60b3980064f3",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: confirm_received:nothing_arrived",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "504b56af-ee07-4f4a-908c-5b52ed722fa3",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "extractor_fan",
    "bathroom",
    "electrical",
    "needs_quote",
    "postcode_received",
    "scope_confirmed"
  ],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T20:09:28.712Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:09:39.220Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T20:09:45.663Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T20:10:14.365Z",
      "content": "We're in NG7 2PQ."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T20:10:55.121Z",
      "content": "Ok thanks, that all makes sense."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.2-photo-once run 2: Asks for a photo once; when the customer answers in words without one, it proceeds

Lines 2.2. Started 2026-09-10T20:11:37.539Z, 424648 ms.

Seed: customer new, name Mel, prefers text false, already rung false, window open. customer: honoured (name "Mel" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_059ed667-cb57-41a4-b0c2-b0edd7aa181d.

> Hi Mel, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e1cb64a-048f-442d-bfad-8eb682c25567",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Mel, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_059ed667-cb57-41a4-b0c2-b0edd7aa181d",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "5e1cb64a-048f-442d-bfad-8eb682c25567",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "tile_work"
  ],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T20:11:41.543Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:11:51.706Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): It's one tile, cracked corner to corner. Plain white, about 20cm square.

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_82175f3b-4c71-4c82-a232-7bbdd610b869.

> Thanks Mel, that's useful.
> Could you pop over a quick photo of the tile and the crack? Helps us match it up properly.

- [2.2] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.2] asked_at_most_once: **PASS** - media asked 1 time so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e1cb64a-048f-442d-bfad-8eb682c25567",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Mel, that's useful.",
    "Could you pop over a quick photo of the tile and the crack? Helps us match it up properly."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_82175f3b-4c71-4c82-a232-7bbdd610b869",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 2 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "5e1cb64a-048f-442d-bfad-8eb682c25567",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "tile_work",
    "needs_quote"
  ],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T20:11:41.543Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:11:51.706Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T20:11:58.215Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q.

Planned send: nothing goes; decision none; intent propose_intake; window open; template unavailable; approver none; hold none; run run_0d6289a1-7591-4c09-b125-a2e29c9556bd.

- [2.2] reply_sent: **FAIL** - no reply would go: decision none
- [2.2] not_asks_subject: **PASS** - the reply does not ask about media
- [2.2] asked_at_most_once: **PASS** - media asked 1 time so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e1cb64a-048f-442d-bfad-8eb682c25567",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_0d6289a1-7591-4c09-b125-a2e29c9556bd",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "propose_intake",
    "lane": "quote_clerk",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — artifact quote_intake recorded (tier PROPOSE); nothing goes to the customer",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [
      "intent propose_intake is not allowed in pack customer.default"
    ],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "5e1cb64a-048f-442d-bfad-8eb682c25567",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "tile_work",
    "needs_quote",
    "no_photos"
  ],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 3 min ago; shuts 23.9 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T20:11:41.543Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:11:51.706Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T20:11:58.215Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T20:12:34.193Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    }
  ],
  "quote": {
    "slug": "o3sj2efk",
    "basePrice": null,
    "isDraft": true
  },
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 4 (customer/message): What else do you need to know?

Planned send: nothing goes; decision none; intent propose_intake; window open; template unavailable; approver none; hold none; run run_ad4c9873-071c-43ab-82d8-face3fb9db41.

- [2.2] reply_sent: **FAIL** - no reply would go: decision none
- [2.2] not_asks_subject: **PASS** - the reply does not ask about media
- [2.2] asked_at_most_once: **PASS** - media asked 1 time so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e1cb64a-048f-442d-bfad-8eb682c25567",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_ad4c9873-071c-43ab-82d8-face3fb9db41",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "propose_intake",
    "lane": "quote_clerk",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — artifact quote_intake recorded (tier PROPOSE); nothing goes to the customer",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [
      "intent propose_intake is not allowed in pack customer.default"
    ],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "5e1cb64a-048f-442d-bfad-8eb682c25567",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "tile_work",
    "needs_quote",
    "no_photos"
  ],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 3 min ago; shuts 23.9 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T20:11:41.543Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:11:51.706Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T20:11:58.215Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T20:12:34.193Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T20:15:36.279Z",
      "content": "What else do you need to know?"
    }
  ],
  "quote": {
    "slug": "2adazbfh",
    "basePrice": null,
    "isDraft": true
  },
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.3-own-words run 2: Asks about the job one thing at a time, in its own words (model verdict recorded beside the deterministic one)

Lines 2.3. Started 2026-09-10T20:18:42.187Z, 82659 ms.

Seed: customer new, name Alex, prefers text false, already rung false, window open. customer: honoured (name "Alex" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_5d295adb-50f8-4b7d-999b-5963b2e2d5da.

> Hi Alex, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "2a261783-735b-4319-8f9d-977686a2afcf",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Alex, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_5d295adb-50f8-4b7d-999b-5963b2e2d5da",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "2a261783-735b-4319-8f9d-977686a2afcf",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "multiple_jobs",
    "postcode_provided"
  ],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T20:18:45.901Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:18:58.294Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): Which one do you want to know about first?

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_862d1d61-5bc1-4c47-87a7-c7b330b7bb7d.

- [2.3] asks_subject: **FAIL** - no reply would go
- [2.3] own_words: **FAIL** - no reply would go
  - model judge (beside, not instead): claude-haiku-4-5, prompt 153f36d8fd03, verdict **skipped** - no reply to judge

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "2a261783-735b-4319-8f9d-977686a2afcf",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_862d1d61-5bc1-4c47-87a7-c7b330b7bb7d",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: ask_gap:customer_question",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "2a261783-735b-4319-8f9d-977686a2afcf",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "multiple_jobs",
    "postcode_provided",
    "clarification_needed"
  ],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T20:18:45.901Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:18:58.294Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T20:19:04.970Z",
      "content": "Which one do you want to know about first?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): The bannister is at the top of the stairs, two of the spindles have come loose and it rocks when you lean on it.

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_045ed8ad-71e4-4571-b2ff-4dd141ae4498.

> Got it, cheers Alex. Wobbly spindles like that we can sort no problem.
> Could you send a quick video of the bannister, showing it rock a bit?
> Then we'll cover the door and the tap too.

- [2.3] own_words: **PASS** - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)
  - model judge (beside, not instead): claude-haiku-4-5, prompt 7cbdbcda5fc0, verdict **no** - The reply fails because bubble 3 introduces 'door and tap' work that the customer never mentioned, reading like a template rather than responding naturally to what was actually said.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "2a261783-735b-4319-8f9d-977686a2afcf",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Got it, cheers Alex. Wobbly spindles like that we can sort no problem.",
    "Could you send a quick video of the bannister, showing it rock a bit?",
    "Then we'll cover the door and the tap too."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_045ed8ad-71e4-4571-b2ff-4dd141ae4498",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "2a261783-735b-4319-8f9d-977686a2afcf",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "multiple_jobs",
    "postcode_provided",
    "clarification_needed",
    "needs_quote",
    "bannister_detail"
  ],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T20:18:45.901Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:18:58.294Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T20:19:04.970Z",
      "content": "Which one do you want to know about first?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T20:19:37.204Z",
      "content": "The bannister is at the top of the stairs, two of the spindles have come loose and it rocks when you lean on it."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.4-short-pause run 2: A short pause ("one sec") does not stop it: the real answer that follows is scoped

Lines 2.4. Started 2026-09-10T20:20:04.846Z, 94537 ms.

Seed: customer new, name Chris, prefers text false, already rung false, window open. customer: honoured (name "Chris" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_deab3a0e-e2a0-4a12-a4ff-a9ac1c444193.

> Hi Chris, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "129bdab5-e03a-48e3-9272-54c126cdb21f",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Chris, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_deab3a0e-e2a0-4a12-a4ff-a9ac1c444193",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "129bdab5-e03a-48e3-9272-54c126cdb21f",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "postcode_provided",
    "gate_repair"
  ],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T20:20:13.992Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:20:25.429Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): one sec, let me check

Planned send: nothing goes; decision none; intent unknown; window open; template unavailable; approver none; hold none; run run_6b57cd73-a207-4ae9-a4d4-db0092480007.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "129bdab5-e03a-48e3-9272-54c126cdb21f",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": null,
  "runId": "run_6b57cd73-a207-4ae9-a4d4-db0092480007",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "unknown",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — no proposal",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "129bdab5-e03a-48e3-9272-54c126cdb21f",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "postcode_provided",
    "gate_repair",
    "awaiting_response"
  ],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T20:20:13.992Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:20:25.429Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T20:20:34.314Z",
      "content": "one sec, let me check"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): Right, it's a wooden gate. The post has rotted at the bottom so the whole thing leans.

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_e68248c7-ccbd-4055-905a-74edc5772e35.

> Ah, rotten post, that'll do it.
> Could you send a photo of the post and where it's rotted, plus one of the whole gate?

- [2.4] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.4] asks_subject: **PASS** - the reply asks about any

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "129bdab5-e03a-48e3-9272-54c126cdb21f",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Ah, rotten post, that'll do it.",
    "Could you send a photo of the post and where it's rotted, plus one of the whole gate?"
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_e68248c7-ccbd-4055-905a-74edc5772e35",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 2 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "129bdab5-e03a-48e3-9272-54c126cdb21f",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "postcode_provided",
    "gate_repair",
    "awaiting_response",
    "needs_photos",
    "wooden_gate"
  ],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T20:20:13.992Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:20:25.429Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T20:20:34.314Z",
      "content": "one sec, let me check"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T20:21:16.265Z",
      "content": "Right, it's a wooden gate. The post has rotted at the bottom so the whole thing leans."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.5-promise-then-quiet run 2: A real promise ("I'll send photos tomorrow") gets one acknowledgement, then quiet until the customer writes

Lines 2.5. Started 2026-09-10T20:21:39.383Z, 144938 ms.

Seed: customer new, name Sara, prefers text false, already rung false, window open. customer: honoured (name "Sara" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_27f0293f-0a5d-4c5d-85d1-3507f60acabf.

> Hi Sara, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "2a643e60-9f25-4fea-93c7-6e9acf6ef807",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Sara, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_27f0293f-0a5d-4c5d-85d1-3507f60acabf",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "2a643e60-9f25-4fea-93c7-6e9acf6ef807",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "postcode_provided"
  ],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T20:21:45.180Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:22:00.123Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): I'll send photos tomorrow when I'm home.

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_fde61395-e4f5-4f02-bc48-ff71f62f2b5b.

- [2.5] reply_sent: **FAIL** - no reply would go: decision none
- [2.5] bubble_count_within: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "2a643e60-9f25-4fea-93c7-6e9acf6ef807",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_fde61395-e4f5-4f02-bc48-ff71f62f2b5b",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "holding",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — waiting_for_promised",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "2a643e60-9f25-4fea-93c7-6e9acf6ef807",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "postcode_provided",
    "photos_pending"
  ],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T20:21:45.180Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:22:00.123Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T20:22:06.542Z",
      "content": "I'll send photos tomorrow when I'm home."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (system/clock): clock pass

Planned send: nothing goes; decision none; intent propose_intake; window open; template unavailable; approver none; hold none; run run_1fdb9665-5d2b-41a7-a3c1-55ca85429d7c.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "2a643e60-9f25-4fea-93c7-6e9acf6ef807",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_1fdb9665-5d2b-41a7-a3c1-55ca85429d7c",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "propose_intake",
    "lane": "quote_clerk",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — waiting_for_promised",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [
      "intent propose_intake is not allowed in pack customer.default"
    ],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "2a643e60-9f25-4fea-93c7-6e9acf6ef807",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "postcode_provided",
    "photos_pending"
  ],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T20:21:45.180Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:22:00.123Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T20:22:06.542Z",
      "content": "I'll send photos tomorrow when I'm home."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 4 (system/clock): clock pass

Planned send: nothing goes; decision none; intent propose_intake; window open; template unavailable; approver none; hold none; run run_77ed88a8-16c1-4e13-903d-de470b14d8cf.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "2a643e60-9f25-4fea-93c7-6e9acf6ef807",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_77ed88a8-16c1-4e13-903d-de470b14d8cf",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "propose_intake",
    "lane": "quote_clerk",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — waiting_for_promised",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [
      "intent propose_intake is not allowed in pack customer.default"
    ],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "2a643e60-9f25-4fea-93c7-6e9acf6ef807",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "postcode_provided",
    "photos_pending"
  ],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 2 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T20:21:45.180Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:22:00.123Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T20:22:06.542Z",
      "content": "I'll send photos tomorrow when I'm home."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.6-date-question run 2: A date question gets "dates come with your quote" and scoping continues; no lead-time guess

Lines 2.6. Started 2026-09-10T20:24:04.321Z, 47335 ms.

Seed: customer new, name Tom, prefers text false, already rung false, window open. customer: honoured (name "Tom" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_5734aa30-49f2-4a1c-9873-c0f8d9f1d6f5.

> Hi Tom, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "35aa6b41-173e-4c74-bb6d-431294798459",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Tom"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Tom, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_5734aa30-49f2-4a1c-9873-c0f8d9f1d6f5",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "35aa6b41-173e-4c74-bb6d-431294798459",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "bathroom_extractor_fan",
    "postcode_provided"
  ],
  "contactName": "Tom",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T20:24:07.938Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:24:19.906Z",
      "content": "Hi Tom, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): When can you come?

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_aa9a3e0c-76e2-413c-817b-090b4f417474.

- [2.6] reply_sent: **FAIL** - no reply would go: decision pending
- [2.6] no_date: **PASS** - no date, time or duration in the reply
- [2.6] text_matches: **FAIL** - no reply would go
- [2.6] asks_subject: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "35aa6b41-173e-4c74-bb6d-431294798459",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Tom"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": null,
  "runId": "run_aa9a3e0c-76e2-413c-817b-090b4f417474",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — precondition: ask_gap:date_asked",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "35aa6b41-173e-4c74-bb6d-431294798459",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "bathroom_extractor_fan",
    "postcode_provided",
    "availability_asked"
  ],
  "contactName": "Tom",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T20:24:07.938Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:24:19.906Z",
      "content": "Hi Tom, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T20:24:27.081Z",
      "content": "When can you come?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.7-money-to-ben run 2: Anything about money or price goes to Ben, not answered

Lines 2.7. Started 2026-09-10T20:24:51.656Z, 33538 ms.

Seed: customer new, name Nina, prefers text false, already rung false, window open. customer: honoured (name "Nina" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_f65938ad-cd3a-4d15-9b80-c641ab5d9207.

> Hi Nina, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "09c97604-c64e-4993-848b-290a4b2c385f",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Nina"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Nina, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_f65938ad-cd3a-4d15-9b80-c641ab5d9207",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "09c97604-c64e-4993-848b-290a4b2c385f",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "materials_supplied"
  ],
  "contactName": "Nina",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-10T20:24:56.667Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:25:07.588Z",
      "content": "Hi Nina, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (customer/message): How much roughly?

Planned send: nothing goes; decision flag; intent unknown; window open; template unavailable; approver none; hold ben (money_question); run run_ecc7e854-0325-4af0-8bb5-0747886b9a66.

- [2.7] hold_for_approver: **PASS** - held for ben: money_question
- [2.7] no_figure: **PASS** - no figure in the reply

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "09c97604-c64e-4993-848b-290a4b2c385f",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Nina"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": null,
  "runId": "run_ecc7e854-0325-4af0-8bb5-0747886b9a66",
  "hold": {
    "approver": "ben",
    "reason": "money_question",
    "since": "2026-09-11T11:00:00.000Z"
  },
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "flag",
    "intent": "unknown",
    "lane": "ben",
    "pack": "customer.exception",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: flagged for Ben (money_question), due 2026-09-11T11:00:00.000Z: a question on his phone, nothing to the customer",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "09c97604-c64e-4993-848b-290a4b2c385f",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "materials_supplied"
  ],
  "contactName": "Nina",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-10T20:24:56.667Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:25:07.588Z",
      "content": "Hi Nina, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-10T20:25:15.766Z",
      "content": "How much roughly?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 2.8-one-reply-per-turn run 2: Never a second reply without the customer writing in between: one reply per customer turn, however many bubbles

Lines 2.8. Started 2026-09-10T20:25:25.194Z, 117241 ms.

Seed: customer new, name Lee, prefers text false, already rung false, window open. customer: honoured (name "Lee" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need an internal door rehung, it's catching on the frame. We're in NG9.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_e36efc5e-e1cf-4beb-9ee1-78f5a1ef7a94.

> Hi Lee, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.8] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)
- [2.8] bubble_count_within: **PASS** - 2 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a20640c9-229d-4997-abea-23ae1b71dc47",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Lee, thanks for getting in touch.",
    "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": "rules_layer",
  "runId": "run_e36efc5e-e1cf-4beb-9ee1-78f5a1ef7a94",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
    "lane": "rules",
    "pack": "rules.first_contact",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack), which answers outside the spine; the desk takes over once it has",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": true,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "a20640c9-229d-4997-abea-23ae1b71dc47",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehung",
    "ng9"
  ],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:25:30.015Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:25:45.168Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 2 (system/clock): clock pass

Planned send: nothing goes; decision none; intent unknown; window open; template unavailable; approver none; hold none; run run_de2c5367-b231-4af7-9f5e-8f55b37335ce.

- [2.8] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a20640c9-229d-4997-abea-23ae1b71dc47",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "unavailable",
  "windowState": "open",
  "templateId": "unavailable",
  "bubbles": [],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "date_time_duration": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "commitment_fault": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "business_claim": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "no guard ran on this pass (no proposal reached the guards)"
    }
  },
  "approver": null,
  "runId": "run_de2c5367-b231-4af7-9f5e-8f55b37335ce",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "unknown",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: nothing sent — no proposal",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "a20640c9-229d-4997-abea-23ae1b71dc47",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehung",
    "ng9"
  ],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:25:30.015Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:25:45.168Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 3 (customer/message): It's the bathroom door upstairs, been like it since the summer.

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_62a22cf9-82d6-45c7-aff7-e227a2b45790.

> Thanks Lee, that helps.
> Could you send a quick photo or video of the door and where it's catching on the frame?

- [2.8] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a20640c9-229d-4997-abea-23ae1b71dc47",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Lee, that helps.",
    "Could you send a quick photo or video of the door and where it's catching on the frame?"
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_62a22cf9-82d6-45c7-aff7-e227a2b45790",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 2 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "a20640c9-229d-4997-abea-23ae1b71dc47",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehung",
    "ng9",
    "bathroom_door",
    "needs_quote"
  ],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:25:30.015Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:25:45.168Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:26:18.770Z",
      "content": "It's the bathroom door upstairs, been like it since the summer."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

#### Turn 4 (system/clock): clock pass

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_e9084bc2-c32c-4ea7-85db-0a52fc0108da.

> Cheers Lee, that helps.
> Could you send a quick video or photo of where it's catching on the frame?
> That'll let me see exactly what needs planing or adjusting.

- [2.8] reply_not_sent: **FAIL** - a reply would go (desk): Cheers Lee, that helps.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a20640c9-229d-4997-abea-23ae1b71dc47",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Cheers Lee, that helps.",
    "Could you send a quick video or photo of where it's catching on the frame?",
    "That'll let me see exactly what needs planing or adjusting."
  ],
  "factIds": "unavailable",
  "kbIds": "unavailable",
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "money",
        "discount",
        "price_objection",
        "money_to_customer"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "date_promise",
        "duration_claim"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "policy_commitment",
        "soft_commitment",
        "liability",
        "capitulation"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "capability_claim"
      ],
      "note": null
    },
    "disclosure": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "one_reply": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "ask_ledger": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    },
    "regulated": {
      "result": "unavailable",
      "via": [],
      "note": "the current desk has no guard of this kind"
    }
  },
  "approver": "agent.scoper",
  "runId": "run_e9084bc2-c32c-4ea7-85db-0a52fc0108da",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: SENT to the customer with no human approval (agent.scoper): 3 bubbles",
    "legacyGuardsHit": [],
    "legacyGuardNotes": [],
    "mirrorLiveWouldSend": null,
    "error": null
  }
}
```

</details>

<details><summary>Case-file snapshot</summary>

```json
{
  "conversationId": "a20640c9-229d-4997-abea-23ae1b71dc47",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "door_rehung",
    "ng9",
    "bathroom_door",
    "needs_quote"
  ],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:25:30.015Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T20:25:45.168Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T20:26:18.770Z",
      "content": "It's the bathroom door upstairs, been like it since the summer."
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

