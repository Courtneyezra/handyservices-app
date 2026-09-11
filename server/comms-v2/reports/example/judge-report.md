# Comms v2 judge report

Generated 2026-09-10T23:50:29.617Z. Desk: current desk (server/spine via /api/comms-sandbox, dry run). Door: in_process at 127.0.0.1:52194. Runs: 2.

Lines: 2 pass, 9 fail, 0 error. Exit code 0 (non-zero only on an error; a fail is not an error).

A line passes only when every expectation on it passes in every run. Fails against the current desk are expected: Goal 0 proves the judge, not the desk.

Known limitation of this door: it did not put every planned reply on the thread (the current sandbox lands only the rules-layer first-contact ack, never a desk reply planned in dry run). On the turns after such a reply, the expectations that only hold when the desk has seen its own reply (reply_not_sent, not_asks_subject, asked_at_most_once) are recorded as fail with the reason "artefact: dry-run reply not landed on thread". Those verdicts judge the door, not the desk.

## Lines

| Line | Expected | Result | Run 1 | Run 2 |
|---|---|---|---|---|
| 1.1 | The customer's first WhatsApp message gets one acknowledgement that quotes their enquiry back and offers a call, freeform. | **FAIL** | FAIL | FAIL |
| 1.6 | A customer who has said text-only is never asked for a call again. | **FAIL** | FAIL | FAIL |
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

### Line 1.6: FAIL

A customer who has said text-only is never asked for a call again.

Run 1: FAIL

- 1.6-prefers-text turn 2 reply_sent: pass - a reply would go (3 bubbles, desk)
- 1.6-prefers-text turn 2 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 1.6-prefers-text turn 3 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 4 reply_sent: fail - no reply would go: decision pending
- 1.6-prefers-text turn 4 not_offers_call: pass - the reply does not offer a call

Run 2: FAIL

- 1.6-prefers-text turn 2 reply_sent: fail - no reply would go: decision none
- 1.6-prefers-text turn 2 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 3 reply_sent: fail - no reply would go: decision none
- 1.6-prefers-text turn 3 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 4 reply_sent: fail - no reply would go: decision none
- 1.6-prefers-text turn 4 not_offers_call: pass - the reply does not offer a call

### Line 1.7: FAIL

Photos arriving with the first message are acknowledged as photos, not as a bare enquiry.

Run 1: FAIL

- 1.7-photos-first turn 1 reply_sent: pass - a reply would go (2 bubbles, rules_layer_mirror)
- 1.7-photos-first turn 1 text_matches: fail - no match for /\b(?:photo|photos|picture|pictures|pic|pics|image|images|snap)\b/

Run 2: FAIL

- 1.7-photos-first turn 1 reply_sent: fail - no reply would go: decision pending
- 1.7-photos-first turn 1 text_matches: fail - no reply would go

### Line 2.1: FAIL

It replies to every customer turn, whether or not the reply is a question.

Run 1: FAIL

- 2.1-replies-to-statements turn 1 reply_sent: pass - a reply would go (2 bubbles, rules_layer_mirror)
- 2.1-replies-to-statements turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.1-replies-to-statements turn 3 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.1-replies-to-statements turn 4 reply_sent: fail - no reply would go: decision pending

Run 2: FAIL

- 2.1-replies-to-statements turn 1 reply_sent: pass - a reply would go (2 bubbles, rules_layer_mirror)
- 2.1-replies-to-statements turn 2 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.1-replies-to-statements turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.1-replies-to-statements turn 4 reply_sent: fail - no reply would go: decision pending

### Line 2.2: FAIL

It asks for a photo once. If they reply without sending one, it proceeds.

Run 1: FAIL

- 2.2-photo-once turn 1 asked_at_most_once: pass - media asked 0 times so far
- 2.2-photo-once turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.2-photo-once turn 2 asked_at_most_once: pass - media asked 1 time so far
- 2.2-photo-once turn 3 reply_sent: fail - no reply would go: decision pending
- 2.2-photo-once turn 3 not_asks_subject: fail - artefact: dry-run reply not landed on thread
- 2.2-photo-once turn 3 asked_at_most_once: fail - artefact: dry-run reply not landed on thread
- 2.2-photo-once turn 4 reply_sent: fail - no reply would go: decision pending
- 2.2-photo-once turn 4 not_asks_subject: fail - artefact: dry-run reply not landed on thread
- 2.2-photo-once turn 4 asked_at_most_once: fail - artefact: dry-run reply not landed on thread

Run 2: FAIL

- 2.2-photo-once turn 1 asked_at_most_once: pass - media asked 0 times so far
- 2.2-photo-once turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.2-photo-once turn 2 asked_at_most_once: pass - media asked 1 time so far
- 2.2-photo-once turn 3 reply_sent: fail - no reply would go: decision pending
- 2.2-photo-once turn 3 not_asks_subject: fail - artefact: dry-run reply not landed on thread
- 2.2-photo-once turn 3 asked_at_most_once: fail - artefact: dry-run reply not landed on thread
- 2.2-photo-once turn 4 reply_sent: fail - no reply would go: decision pending
- 2.2-photo-once turn 4 not_asks_subject: fail - artefact: dry-run reply not landed on thread
- 2.2-photo-once turn 4 asked_at_most_once: fail - artefact: dry-run reply not landed on thread

### Line 2.3: FAIL

It asks about the job one thing at a time, in its own words.

Run 1: FAIL

- 2.3-own-words turn 2 asks_subject: fail - no reply would go
- 2.3-own-words turn 2 own_words: fail - no reply would go [model claude-haiku-4-5: skipped - no reply to judge]
- 2.3-own-words turn 3 own_words: pass - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this) [model claude-haiku-4-5: no - The reply asks about multiple unrelated issues (sticky door and leaking tap) that the customer never mentioned, treating this like a template rather than responding naturally to what was actually said.]

Run 2: FAIL

- 2.3-own-words turn 2 asks_subject: fail - no reply would go
- 2.3-own-words turn 2 own_words: fail - no reply would go [model claude-haiku-4-5: skipped - no reply to judge]
- 2.3-own-words turn 3 own_words: pass - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this) [model claude-haiku-4-5: no - The reply mentions 'the door and tap details' which the customer never mentioned, suggesting a template response, and it asks for a photo/video without first clarifying the specific repair needed or acknowledging the safety concern of the rocking bannister.]

### Line 2.4: PASS

A short pause ("one sec") does not stop it.

Run 1: PASS

- 2.4-short-pause turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
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
- 2.8-one-reply-per-turn turn 4 reply_not_sent: fail - artefact: dry-run reply not landed on thread

Run 2: FAIL

- 2.8-one-reply-per-turn turn 1 reply_sent: pass - a reply would go (2 bubbles, rules_layer_mirror)
- 2.8-one-reply-per-turn turn 1 bubble_count_within: pass - 2 bubbles, ceiling 4
- 2.8-one-reply-per-turn turn 2 reply_not_sent: pass - nothing goes: decision none
- 2.8-one-reply-per-turn turn 3 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.8-one-reply-per-turn turn 4 reply_not_sent: fail - artefact: dry-run reply not landed on thread

## Scenarios, turn by turn

### 1.1-inbound-whatsapp run 1: Inbound WhatsApp: the opening message gets one freeform acknowledgement that quotes the enquiry back and offers a call

Lines 1.1. Started 2026-09-10T23:17:17.781Z, 25906 ms.

Seed: customer new, name Sam, prefers text false, already rung false, window open. customer: honoured (name "Sam" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_16a82a9e-0a3f-4188-b3e8-bd85259b5e1d.

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
  "caseId": "f7c704e7-6c63-4d39-a5fc-90814119932f",
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
  "runId": "run_16a82a9e-0a3f-4188-b3e8-bd85259b5e1d",
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
  "conversationId": "f7c704e7-6c63-4d39-a5fc-90814119932f",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "tap_repair",
    "leak",
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
      "at": "2026-09-10T23:17:23.891Z",
      "content": "Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:17:37.854Z",
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

Lines 1.6. Started 2026-09-10T23:17:43.687Z, 131425 ms.

Seed: customer new, name Jo, prefers text true, already rung false, window open. customer: honoured (name "Jo" passed to POST /start as the pushname); prefersText: unsupported (no seed field on the current door; the scenario states it in a customer turn ("text only please")).

#### Turn 1 (customer/message): Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_dd719f57-ba91-458f-bfdc-a1566967991a.

> Hi Jo, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "54624214-5b2f-4f54-9232-e32030458f93",
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
  "runId": "run_dd719f57-ba91-458f-bfdc-a1566967991a",
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
  "conversationId": "54624214-5b2f-4f54-9232-e32030458f93",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "beeston"
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
      "at": "2026-09-10T23:17:49.623Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:18:03.794Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_b62963e3-d10c-4063-8120-a127e8738602. Not landed on the thread by the door.

> No problem Jo, text is fine.
> Could you send a photo of the fence panel and the posts either side?
> That'll help me see what's needed to replace it.

- [1.6] reply_sent: **PASS** - a reply would go (3 bubbles, desk)
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "54624214-5b2f-4f54-9232-e32030458f93",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No problem Jo, text is fine.",
    "Could you send a photo of the fence panel and the posts either side?",
    "That'll help me see what's needed to replace it."
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
  "runId": "run_b62963e3-d10c-4063-8120-a127e8738602",
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
  "conversationId": "54624214-5b2f-4f54-9232-e32030458f93",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "beeston",
    "text_only"
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
      "at": "2026-09-10T23:17:49.623Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:18:03.794Z",
      "content": "Hi Jo, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:18:11.309Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_1aea6736-53c7-4a66-8ad5-b1f571ad8fe0. Not landed on the thread by the door.

> Got it, one 6ft panel down and the posts are fine, that's helpful.
> Could you send a quick photo of the fence so I can see the panel and fixings before I quote it 🙂

- [1.6] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "54624214-5b2f-4f54-9232-e32030458f93",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Got it, one 6ft panel down and the posts are fine, that's helpful.",
    "Could you send a quick photo of the fence so I can see the panel and fixings before I quote it 🙂"
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
  "runId": "run_1aea6736-53c7-4a66-8ad5-b1f571ad8fe0",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
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
  "conversationId": "54624214-5b2f-4f54-9232-e32030458f93",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "beeston",
    "text_only",
    "postcode_provided"
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
      "at": "2026-09-10T23:17:49.623Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:18:03.794Z",
      "content": "Hi Jo, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:18:11.309Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:18:47.405Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_56e42525-b53e-4d43-9e2b-047236b27785.

- [1.6] reply_sent: **FAIL** - no reply would go: decision pending
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "54624214-5b2f-4f54-9232-e32030458f93",
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
  "runId": "run_56e42525-b53e-4d43-9e2b-047236b27785",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:49.462Z) — precondition: ask_gap:customer_question",
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
  "conversationId": "54624214-5b2f-4f54-9232-e32030458f93",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "beeston",
    "text_only",
    "postcode_provided",
    "photos_pending"
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
      "at": "2026-09-10T23:17:49.623Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:18:03.794Z",
      "content": "Hi Jo, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:18:11.309Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:18:47.405Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:19:25.767Z",
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

Lines 1.7. Started 2026-09-10T23:19:55.112Z, 63830 ms.

Seed: customer new, name Priya, prefers text false, already rung false, window open. customer: honoured (name "Priya" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it? [+1 media]

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_photos; window open; template none; approver rules_layer; hold none; run run_94a1d2fd-e444-41cb-97c9-caaee58063d8.

> Hi, thanks for sending those over.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [1.7] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)
- [1.7] text_matches: **FAIL** - no match for /\b(?:photo|photos|picture|pictures|pic|pics|image|images|snap)\b/

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "421bab61-b4ff-4f92-a33e-24d95341c9ee",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sandbox customer (not real)"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi, thanks for sending those over.",
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
  "runId": "run_94a1d2fd-e444-41cb-97c9-caaee58063d8",
  "hold": null,
  "delivered": true,
  "origin": "rules_layer_mirror",
  "evidence": {
    "decision": "none",
    "intent": "ack_photos",
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
  "conversationId": "421bab61-b4ff-4f92-a33e-24d95341c9ee",
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
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sandbox customer (not real)",
      "at": "2026-09-10T23:20:05.698Z",
      "content": "Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:20:54.536Z",
      "content": "Hi, thanks for sending those over.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
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

Lines 2.1. Started 2026-09-10T23:20:58.943Z, 136629 ms.

Seed: customer new, name Dan, prefers text false, already rung false, window open. customer: honoured (name "Dan" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my bathroom extractor fan has stopped working, can you sort it?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_5d063db9-0fbb-4699-b87a-e829ae713fbf.

> Hi Dan, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "fbed9b6f-699c-4107-aa24-c07344dd5e7d",
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
  "runId": "run_5d063db9-0fbb-4699-b87a-e829ae713fbf",
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
  "conversationId": "fbed9b6f-699c-4107-aa24-c07344dd5e7d",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "bathroom_extractor",
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
      "at": "2026-09-10T23:21:02.787Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:21:13.728Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_dcf924a4-39a7-4d47-bf3f-32ac2ff35104. Not landed on the thread by the door.

> Thanks Dan, that's useful. Could you send a quick photo or video of the fan and ceiling area?
> That'll help me see the unit and how it's fitted before quoting.

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "fbed9b6f-699c-4107-aa24-c07344dd5e7d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Dan, that's useful. Could you send a quick photo or video of the fan and ceiling area?",
    "That'll help me see the unit and how it's fitted before quoting."
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
  "runId": "run_dcf924a4-39a7-4d47-bf3f-32ac2ff35104",
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
  "conversationId": "fbed9b6f-699c-4107-aa24-c07344dd5e7d",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "bathroom_extractor",
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
      "at": "2026-09-10T23:21:02.787Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:21:13.728Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:21:24.432Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_d90a0b76-0ce9-4c22-8c7c-1428be2dcf90. Not landed on the thread by the door.

> Ta Dan, NG7 2PQ noted.
> Could you send a couple of photos of the fan, one close up and one standing back?
> That's usually enough for us to get it priced up.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "fbed9b6f-699c-4107-aa24-c07344dd5e7d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Ta Dan, NG7 2PQ noted.",
    "Could you send a couple of photos of the fan, one close up and one standing back?",
    "That's usually enough for us to get it priced up."
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
  "runId": "run_d90a0b76-0ce9-4c22-8c7c-1428be2dcf90",
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
  "conversationId": "fbed9b6f-699c-4107-aa24-c07344dd5e7d",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "bathroom_extractor",
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
      "at": "2026-09-10T23:21:02.787Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:21:13.728Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:21:24.432Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:21:55.362Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_04813730-4cac-4567-a8b2-6adca3a6eedd.

- [2.1] reply_sent: **FAIL** - no reply would go: decision pending

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "fbed9b6f-699c-4107-aa24-c07344dd5e7d",
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
  "runId": "run_04813730-4cac-4567-a8b2-6adca3a6eedd",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:10.235Z) — precondition: confirm_received:nothing_arrived",
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
  "conversationId": "fbed9b6f-699c-4107-aa24-c07344dd5e7d",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "bathroom_extractor",
    "electrical",
    "needs_quote",
    "postcode_received",
    "scope_clarified"
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
      "at": "2026-09-10T23:21:02.787Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:21:13.728Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:21:24.432Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:21:55.362Z",
      "content": "We're in NG7 2PQ."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:22:36.790Z",
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

Lines 2.2. Started 2026-09-10T23:23:15.573Z, 122340 ms.

Seed: customer new, name Mel, prefers text false, already rung false, window open. customer: honoured (name "Mel" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_633c55a3-c18a-46f9-afff-a0f7807225b7.

> Hi Mel, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "26209d8b-5ed3-418f-8c66-230ea9534c08",
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
  "runId": "run_633c55a3-c18a-46f9-afff-a0f7807225b7",
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
  "conversationId": "26209d8b-5ed3-418f-8c66-230ea9534c08",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "tile_repair"
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
      "at": "2026-09-10T23:23:19.607Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:23:33.068Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_4aa2d6b1-7760-471f-a673-f096eb1163f4. Not landed on the thread by the door.

> Got it, one cracked white tile above the bath.
> Could you send a quick photo of it so I can see the crack and the surrounding tiles?

- [2.2] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.2] asked_at_most_once: **PASS** - media asked 1 time so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "26209d8b-5ed3-418f-8c66-230ea9534c08",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Got it, one cracked white tile above the bath.",
    "Could you send a quick photo of it so I can see the crack and the surrounding tiles?"
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
  "runId": "run_4aa2d6b1-7760-471f-a673-f096eb1163f4",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
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
  "conversationId": "26209d8b-5ed3-418f-8c66-230ea9534c08",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "postcode_provided",
    "tile_repair",
    "needs_quote",
    "scoping_in_progress"
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
      "at": "2026-09-10T23:23:19.607Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:23:33.068Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:23:38.719Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_3a947508-58cb-41a7-9fb4-9641ce3846c8.

- [2.2] reply_sent: **FAIL** - no reply would go: decision pending
- [2.2] not_asks_subject: **FAIL** - artefact: dry-run reply not landed on thread
- [2.2] asked_at_most_once: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "26209d8b-5ed3-418f-8c66-230ea9534c08",
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
  "runId": "run_3a947508-58cb-41a7-9fb4-9641ce3846c8",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:30.518Z) — precondition: confirm_received:nothing_arrived",
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
  "conversationId": "26209d8b-5ed3-418f-8c66-230ea9534c08",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "postcode_provided",
    "tile_repair",
    "needs_quote",
    "scoping_in_progress",
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
      "at": "2026-09-10T23:23:19.607Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:23:33.068Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:23:38.719Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:24:05.730Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_948d6e60-1c40-453f-90f8-9cf344df5000.

- [2.2] reply_sent: **FAIL** - no reply would go: decision pending
- [2.2] not_asks_subject: **FAIL** - artefact: dry-run reply not landed on thread
- [2.2] asked_at_most_once: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "26209d8b-5ed3-418f-8c66-230ea9534c08",
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
  "runId": "run_948d6e60-1c40-453f-90f8-9cf344df5000",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:10.003Z) — precondition: confirm_received:nothing_arrived",
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
  "conversationId": "26209d8b-5ed3-418f-8c66-230ea9534c08",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "postcode_provided",
    "tile_repair",
    "needs_quote",
    "scoping_in_progress",
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
      "at": "2026-09-10T23:23:19.607Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:23:33.068Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:23:38.719Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:24:05.730Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:24:40.878Z",
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

Lines 2.3. Started 2026-09-10T23:25:17.913Z, 86575 ms.

Seed: customer new, name Alex, prefers text false, already rung false, window open. customer: honoured (name "Alex" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_3dea13dd-b690-48f9-9e9a-d5ee5e9a843e.

> Hi Alex, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5069474c-253a-4cef-97ff-8c7a0b1184f8",
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
  "runId": "run_3dea13dd-b690-48f9-9e9a-d5ee5e9a843e",
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
  "conversationId": "5069474c-253a-4cef-97ff-8c7a0b1184f8",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "initial_contact",
    "multiple_jobs",
    "beeston"
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
      "at": "2026-09-10T23:25:25.042Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:25:35.611Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_5c54337c-ed57-469d-ac63-2cd859813e09.

- [2.3] asks_subject: **FAIL** - no reply would go
- [2.3] own_words: **FAIL** - no reply would go
  - model judge (beside, not instead): claude-haiku-4-5, prompt 153f36d8fd03, verdict **skipped** - no reply to judge

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5069474c-253a-4cef-97ff-8c7a0b1184f8",
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
  "runId": "run_5c54337c-ed57-469d-ac63-2cd859813e09",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:06.055Z) — precondition: ask_gap:customer_question",
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
  "conversationId": "5069474c-253a-4cef-97ff-8c7a0b1184f8",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "initial_contact",
    "multiple_jobs",
    "beeston",
    "needs_photos"
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
      "at": "2026-09-10T23:25:25.042Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:25:35.611Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T23:25:48.272Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_b420ceec-eafe-4c3d-a985-90799a6cfe48. Not landed on the thread by the door.

> Thanks, that's clear on the bannister.
> Could you send a quick video of the spindles rocking, plus photos of the sticky door and the leaking tap?
> That'll let me get all three scoped properly.

- [2.3] own_words: **PASS** - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)
  - model judge (beside, not instead): claude-haiku-4-5, prompt a3338aebed23, verdict **no** - The reply asks about multiple unrelated issues (sticky door and leaking tap) that the customer never mentioned, treating this like a template rather than responding naturally to what was actually said.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5069474c-253a-4cef-97ff-8c7a0b1184f8",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks, that's clear on the bannister.",
    "Could you send a quick video of the spindles rocking, plus photos of the sticky door and the leaking tap?",
    "That'll let me get all three scoped properly."
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
  "runId": "run_b420ceec-eafe-4c3d-a985-90799a6cfe48",
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
  "conversationId": "5069474c-253a-4cef-97ff-8c7a0b1184f8",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "initial_contact",
    "multiple_jobs",
    "beeston",
    "needs_photos",
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
      "at": "2026-09-10T23:25:25.042Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:25:35.611Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T23:25:48.272Z",
      "content": "Which one do you want to know about first?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T23:26:12.943Z",
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

Lines 2.4. Started 2026-09-10T23:26:44.488Z, 79232 ms.

Seed: customer new, name Chris, prefers text false, already rung false, window open. customer: honoured (name "Chris" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_4b44da31-ea13-4eb8-afdb-2056a9a32b98.

> Hi Chris, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "60c31972-9dbe-4780-8418-92e0d34476de",
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
  "runId": "run_4b44da31-ea13-4eb8-afdb-2056a9a32b98",
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
  "conversationId": "60c31972-9dbe-4780-8418-92e0d34476de",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "gate_repair",
    "postcode_provided"
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
      "at": "2026-09-10T23:26:48.399Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:27:02.713Z",
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

Planned send: nothing goes; decision none; intent unknown; window open; template unavailable; approver none; hold none; run run_3e9e56f9-adce-4492-8712-a06e59e920ff.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "60c31972-9dbe-4780-8418-92e0d34476de",
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
  "runId": "run_3e9e56f9-adce-4492-8712-a06e59e920ff",
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
  "conversationId": "60c31972-9dbe-4780-8418-92e0d34476de",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "gate_repair",
    "postcode_provided",
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
      "at": "2026-09-10T23:26:48.399Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:27:02.713Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T23:27:10.176Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_a9ae71a5-8ca9-4f0c-a1a6-06dfc1faa783. Not landed on the thread by the door.

> Thanks Chris, that helps. Could you send a photo of the post and the gate, showing where it's rotted?
> That'll let me see what we're dealing with.

- [2.4] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.4] asks_subject: **PASS** - the reply asks about any

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "60c31972-9dbe-4780-8418-92e0d34476de",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Chris, that helps. Could you send a photo of the post and the gate, showing where it's rotted?",
    "That'll let me see what we're dealing with."
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
  "runId": "run_a9ae71a5-8ca9-4f0c-a1a6-06dfc1faa783",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
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
  "conversationId": "60c31972-9dbe-4780-8418-92e0d34476de",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "gate_repair",
    "postcode_provided",
    "awaiting_customer_response",
    "wood_rot",
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
      "at": "2026-09-10T23:26:48.399Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:27:02.713Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T23:27:10.176Z",
      "content": "one sec, let me check"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T23:27:34.399Z",
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

Lines 2.5. Started 2026-09-10T23:28:03.720Z, 150735 ms.

Seed: customer new, name Sara, prefers text false, already rung false, window open. customer: honoured (name "Sara" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_9d77f110-b6cf-49dd-bf60-28a253caac2a.

> Hi Sara, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "9fb25201-ba41-49dd-9e35-f7f01624ae96",
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
  "runId": "run_9d77f110-b6cf-49dd-bf60-28a253caac2a",
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
  "conversationId": "9fb25201-ba41-49dd-9e35-f7f01624ae96",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_panels",
    "storm_damage",
    "needs_quote"
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
      "at": "2026-09-10T23:28:11.116Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:28:24.572Z",
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

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_00c8be33-70e0-40a5-9db6-a288b760f8d3.

- [2.5] reply_sent: **FAIL** - no reply would go: decision none
- [2.5] bubble_count_within: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "9fb25201-ba41-49dd-9e35-f7f01624ae96",
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
  "runId": "run_00c8be33-70e0-40a5-9db6-a288b760f8d3",
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
  "conversationId": "9fb25201-ba41-49dd-9e35-f7f01624ae96",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_panels",
    "storm_damage",
    "needs_quote",
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
      "at": "2026-09-10T23:28:11.116Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:28:24.572Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T23:28:35.121Z",
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

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_385b7c29-32a7-4986-ab11-4044c1b355c2.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "9fb25201-ba41-49dd-9e35-f7f01624ae96",
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
  "runId": "run_385b7c29-32a7-4986-ab11-4044c1b355c2",
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
  "conversationId": "9fb25201-ba41-49dd-9e35-f7f01624ae96",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_panels",
    "storm_damage",
    "needs_quote",
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
      "at": "2026-09-10T23:28:11.116Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:28:24.572Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T23:28:35.121Z",
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

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_f97255bf-217a-4003-8e6d-db59ba6840b3.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "9fb25201-ba41-49dd-9e35-f7f01624ae96",
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
  "runId": "run_f97255bf-217a-4003-8e6d-db59ba6840b3",
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
  "conversationId": "9fb25201-ba41-49dd-9e35-f7f01624ae96",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_panels",
    "storm_damage",
    "needs_quote",
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
      "at": "2026-09-10T23:28:11.116Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:28:24.572Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T23:28:35.121Z",
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

Lines 2.6. Started 2026-09-10T23:30:34.455Z, 64254 ms.

Seed: customer new, name Tom, prefers text false, already rung false, window open. customer: honoured (name "Tom" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ.

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_9ba029b7-c3e8-43f6-999d-1e77ec0d4ae7. Not landed on the thread by the door.

> Hiya Tom, no problem, we can sort that.
> Could you send a quick photo of the current extractor fan and where it sits, so I can see what we're working with?

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d85bf851-20b2-4e1e-911e-c0df61de0025",
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
    "Could you send a quick photo of the current extractor fan and where it sits, so I can see what we're working with?"
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
  "runId": "run_9ba029b7-c3e8-43f6-999d-1e77ec0d4ae7",
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
  "conversationId": "d85bf851-20b2-4e1e-911e-c0df61de0025",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "postcode_provided",
    "extractor_fan"
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
      "at": "2026-09-10T23:30:38.545Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_d99dc8f3-5b75-43f2-9baf-b6234f5eae04.

- [2.6] reply_sent: **FAIL** - no reply would go: decision pending
- [2.6] no_date: **PASS** - no date, time or duration in the reply
- [2.6] text_matches: **FAIL** - no reply would go
- [2.6] asks_subject: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d85bf851-20b2-4e1e-911e-c0df61de0025",
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
  "runId": "run_d99dc8f3-5b75-43f2-9baf-b6234f5eae04",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:33.690Z) — precondition: ask_gap:date_asked",
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
  "conversationId": "d85bf851-20b2-4e1e-911e-c0df61de0025",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "postcode_provided",
    "extractor_fan",
    "availability_ask"
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
      "at": "2026-09-10T23:30:38.545Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T23:31:13.228Z",
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

Lines 2.7. Started 2026-09-10T23:31:38.709Z, 43130 ms.

Seed: customer new, name Nina, prefers text false, already rung false, window open. customer: honoured (name "Nina" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_b1955282-db7e-4bed-a36d-9861c876ce63.

> Hi Nina, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "bc1d85d4-57f4-4d4a-95c0-48f5fffb8b5c",
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
  "runId": "run_b1955282-db7e-4bed-a36d-9861c876ce63",
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
  "conversationId": "bc1d85d4-57f4-4d4a-95c0-48f5fffb8b5c",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "tap_replacement",
    "own_materials",
    "postcode_provided"
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
      "at": "2026-09-10T23:31:44.357Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:32:01.202Z",
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

Planned send: nothing goes; decision flag; intent unknown; window open; template unavailable; approver none; hold ben (money_question); run run_e2f63b70-152d-4654-b202-09725ead4d0a.

- [2.7] hold_for_approver: **PASS** - held for ben: money_question
- [2.7] no_figure: **PASS** - no figure in the reply

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "bc1d85d4-57f4-4d4a-95c0-48f5fffb8b5c",
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
  "runId": "run_e2f63b70-152d-4654-b202-09725ead4d0a",
  "hold": {
    "approver": "ben",
    "reason": "money_question",
    "since": "2026-09-11T11:00:13.692Z"
  },
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "flag",
    "intent": "unknown",
    "lane": "ben",
    "pack": "customer.exception",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: flagged for Ben (money_question), due 2026-09-11T11:00:13.692Z: a question on his phone, nothing to the customer",
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
  "conversationId": "bc1d85d4-57f4-4d4a-95c0-48f5fffb8b5c",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "tap_replacement",
    "own_materials",
    "postcode_provided"
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
      "at": "2026-09-10T23:31:44.357Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:32:01.202Z",
      "content": "Hi Nina, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-10T23:32:08.690Z",
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

Lines 2.8. Started 2026-09-10T23:32:21.840Z, 125683 ms.

Seed: customer new, name Lee, prefers text false, already rung false, window open. customer: honoured (name "Lee" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need an internal door rehung, it's catching on the frame. We're in NG9.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_8c8f7e05-f0de-4f92-aff6-90754a164a3b.

> Hi Lee, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.8] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)
- [2.8] bubble_count_within: **PASS** - 2 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "308e612f-8032-425f-9b13-0533bf7f3838",
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
  "runId": "run_8c8f7e05-f0de-4f92-aff6-90754a164a3b",
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
  "conversationId": "308e612f-8032-425f-9b13-0533bf7f3838",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "postcode_provided"
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
      "at": "2026-09-10T23:32:27.674Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:32:53.204Z",
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

Planned send: nothing goes; decision none; intent unknown; window open; template unavailable; approver none; hold none; run run_7f8d1bbc-d383-4a8d-8867-8fb0cefe2f36.

- [2.8] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "308e612f-8032-425f-9b13-0533bf7f3838",
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
  "runId": "run_7f8d1bbc-d383-4a8d-8867-8fb0cefe2f36",
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
  "conversationId": "308e612f-8032-425f-9b13-0533bf7f3838",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "postcode_provided"
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
      "at": "2026-09-10T23:32:27.674Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:32:53.204Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_718b9518-88d4-4f84-a1cb-9334596b1a25. Not landed on the thread by the door.

> Thanks Lee, that helps.
> Could you send a quick photo or video of where it's catching on the frame?
> That'll let me see exactly what's going on with it.

- [2.8] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "308e612f-8032-425f-9b13-0533bf7f3838",
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
    "Could you send a quick photo or video of where it's catching on the frame?",
    "That'll let me see exactly what's going on with it."
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
  "runId": "run_718b9518-88d4-4f84-a1cb-9334596b1a25",
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
  "conversationId": "308e612f-8032-425f-9b13-0533bf7f3838",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "postcode_provided",
    "photos_needed"
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
      "at": "2026-09-10T23:32:27.674Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:32:53.204Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T23:33:33.109Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_62ef5bfd-1344-4505-9cad-a512d1e0b2df. Not landed on the thread by the door.

> Thanks Lee, that helps. Could you send a quick video of the door catching on the frame?
> That'll help me see exactly where it's rubbing.

- [2.8] reply_not_sent: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "308e612f-8032-425f-9b13-0533bf7f3838",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Lee, that helps. Could you send a quick video of the door catching on the frame?",
    "That'll help me see exactly where it's rubbing."
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
  "runId": "run_62ef5bfd-1344-4505-9cad-a512d1e0b2df",
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
  "conversationId": "308e612f-8032-425f-9b13-0533bf7f3838",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "postcode_provided",
    "photos_needed",
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
      "at": "2026-09-10T23:32:27.674Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:32:53.204Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T23:33:33.109Z",
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

Lines 1.1. Started 2026-09-10T23:34:27.523Z, 29725 ms.

Seed: customer new, name Sam, prefers text false, already rung false, window open. customer: honoured (name "Sam" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_c4fe0cdf-aab9-4f43-a22b-fc8e2aa748ae.

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
  "caseId": "1f7d8035-dadc-49e8-9213-6d4202827593",
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
  "runId": "run_c4fe0cdf-aab9-4f43-a22b-fc8e2aa748ae",
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
  "conversationId": "1f7d8035-dadc-49e8-9213-6d4202827593",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "plumbing",
    "leaking_tap",
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
      "at": "2026-09-10T23:34:32.786Z",
      "content": "Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:34:50.885Z",
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

Lines 1.6. Started 2026-09-10T23:34:57.248Z, 219180 ms.

Seed: customer new, name Jo, prefers text true, already rung false, window open. customer: honoured (name "Jo" passed to POST /start as the pushname); prefersText: unsupported (no seed field on the current door; the scenario states it in a customer turn ("text only please")).

#### Turn 1 (customer/message): Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?

Planned send: nothing goes; decision none; intent ask_postcode; window open; template unavailable; approver none; hold none; run run_0fa3960f-dcaf-4916-ba8f-84b14effc92c.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "91d5e90d-92d3-4e86-acf3-d8300d68aa83",
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
  "runId": "run_0fa3960f-dcaf-4916-ba8f-84b14effc92c",
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
  "conversationId": "91d5e90d-92d3-4e86-acf3-d8300d68aa83",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
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
      "at": "2026-09-10T23:35:02.628Z",
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

Planned send: nothing goes; decision none; intent propose_intake; window open; template unavailable; approver none; hold none; run run_633c1750-57bc-4c17-be59-5a2974514ba3.

- [1.6] reply_sent: **FAIL** - no reply would go: decision none
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "91d5e90d-92d3-4e86-acf3-d8300d68aa83",
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
  "runId": "run_633c1750-57bc-4c17-be59-5a2974514ba3",
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
  "conversationId": "91d5e90d-92d3-4e86-acf3-d8300d68aa83",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "no_calls"
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
      "at": "2026-09-10T23:35:02.628Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:35:23.620Z",
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

Planned send: nothing goes; decision none; intent propose_intake; window open; template unavailable; approver none; hold none; run run_95b62f65-e7dc-4afd-8dc4-4ed91e1f84bf.

- [1.6] reply_sent: **FAIL** - no reply would go: decision none
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "91d5e90d-92d3-4e86-acf3-d8300d68aa83",
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
  "runId": "run_95b62f65-e7dc-4afd-8dc4-4ed91e1f84bf",
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
  "conversationId": "91d5e90d-92d3-4e86-acf3-d8300d68aa83",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "no_calls",
    "postcode_provided"
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
      "at": "2026-09-10T23:35:02.628Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:35:23.620Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:36:17.606Z",
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

Planned send: nothing goes; decision none; intent propose_intake; window open; template unavailable; approver none; hold none; run run_0f10ef57-79dc-428d-abf3-395d2b12da8b.

- [1.6] reply_sent: **FAIL** - no reply would go: decision none
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "91d5e90d-92d3-4e86-acf3-d8300d68aa83",
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
  "runId": "run_0f10ef57-79dc-428d-abf3-395d2b12da8b",
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
  "conversationId": "91d5e90d-92d3-4e86-acf3-d8300d68aa83",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "needs_quote",
    "no_calls",
    "postcode_provided",
    "photos_needed"
  ],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "OPEN — last customer WhatsApp 2 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:35:02.628Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:35:23.620Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:36:17.606Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T23:37:01.652Z",
      "content": "Do you need anything else from me?"
    }
  ],
  "quote": {
    "slug": "u33cbcdo",
    "basePrice": null,
    "isDraft": true
  },
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

### 1.7-photos-first run 2: Photos with the first message are acknowledged as photos, not as a bare enquiry

Lines 1.7. Started 2026-09-10T23:38:36.428Z, 33776 ms.

Seed: customer new, name Priya, prefers text false, already rung false, window open. customer: honoured (name "Priya" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it? [+1 media]

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_7f249e87-7a0c-4c67-bfb1-0ffb72fac81c.

- [1.7] reply_sent: **FAIL** - no reply would go: decision pending
- [1.7] text_matches: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "53b40eef-107e-4ce6-93d2-f82ff27dbfd1",
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
  "runId": "run_7f249e87-7a0c-4c67-bfb1-0ffb72fac81c",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:04.996Z) — precondition: ask_gap:customer_question",
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
  "conversationId": "53b40eef-107e-4ce6-93d2-f82ff27dbfd1",
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
      "at": "2026-09-10T23:38:45.680Z",
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

Lines 2.1. Started 2026-09-10T23:39:10.204Z, 117707 ms.

Seed: customer new, name Dan, prefers text false, already rung false, window open. customer: honoured (name "Dan" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my bathroom extractor fan has stopped working, can you sort it?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_e926f57c-4026-45a9-b190-8514425c55f4.

> Hi Dan, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "6a52d79c-9824-4eb1-a338-106308624732",
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
  "runId": "run_e926f57c-4026-45a9-b190-8514425c55f4",
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
  "conversationId": "6a52d79c-9824-4eb1-a338-106308624732",
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
      "at": "2026-09-10T23:39:13.365Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:39:26.165Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_efbb69f8-7b04-4423-a9c0-c2a470b4a9d2. Not landed on the thread by the door.

> Thanks Dan, that helps.
> Could you send a quick photo of the fan and its ceiling plate? Helps me see the setup.
> I'll get a quote sorted once I've seen that.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "6a52d79c-9824-4eb1-a338-106308624732",
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
    "Could you send a quick photo of the fan and its ceiling plate? Helps me see the setup.",
    "I'll get a quote sorted once I've seen that."
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
  "runId": "run_efbb69f8-7b04-4423-a9c0-c2a470b4a9d2",
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
  "conversationId": "6a52d79c-9824-4eb1-a338-106308624732",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "extractor_fan",
    "electrical",
    "first_contact"
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
      "at": "2026-09-10T23:39:13.365Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:39:26.165Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:39:35.200Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_9b30f1ec-923f-455a-9b42-b546d6d792b7. Not landed on the thread by the door.

> Thanks Dan, that helps.
> Could you send a quick photo of the fan and the ceiling round it? Helps us see the fitting before quoting.

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "6a52d79c-9824-4eb1-a338-106308624732",
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
    "Could you send a quick photo of the fan and the ceiling round it? Helps us see the fitting before quoting."
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
  "runId": "run_9b30f1ec-923f-455a-9b42-b546d6d792b7",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
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
  "conversationId": "6a52d79c-9824-4eb1-a338-106308624732",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "extractor_fan",
    "electrical",
    "first_contact",
    "postcode_received",
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
      "at": "2026-09-10T23:39:13.365Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:39:26.165Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:39:35.200Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:40:04.293Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_87db8c5f-c1a6-4896-aa2b-adf4c6eb98d0.

- [2.1] reply_sent: **FAIL** - no reply would go: decision pending

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "6a52d79c-9824-4eb1-a338-106308624732",
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
  "runId": "run_87db8c5f-c1a6-4896-aa2b-adf4c6eb98d0",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:01.762Z) — precondition: confirm_received:nothing_arrived",
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
  "conversationId": "6a52d79c-9824-4eb1-a338-106308624732",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "extractor_fan",
    "electrical",
    "first_contact",
    "postcode_received",
    "needs_quote"
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
      "at": "2026-09-10T23:39:13.365Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:39:26.165Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:39:35.200Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:40:04.293Z",
      "content": "We're in NG7 2PQ."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T23:40:36.224Z",
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

Lines 2.2. Started 2026-09-10T23:41:07.911Z, 93841 ms.

Seed: customer new, name Mel, prefers text false, already rung false, window open. customer: honoured (name "Mel" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_9b57a9f1-c35d-4158-b8f1-fe8ed19437b7.

> Hi Mel, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "11d7356f-7793-4254-a4ce-ff8fb20cec1e",
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
  "runId": "run_9b57a9f1-c35d-4158-b8f1-fe8ed19437b7",
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
  "conversationId": "11d7356f-7793-4254-a4ce-ff8fb20cec1e",
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
      "at": "2026-09-10T23:41:11.976Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:41:22.390Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_6b46a8eb-b405-42ed-81f5-c73ed705c2bd. Not landed on the thread by the door.

> Perfect, that helps.
> Could you send a quick photo of the tile and the area around it, so we can match it up properly?

- [2.2] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.2] asked_at_most_once: **PASS** - media asked 1 time so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "11d7356f-7793-4254-a4ce-ff8fb20cec1e",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Perfect, that helps.",
    "Could you send a quick photo of the tile and the area around it, so we can match it up properly?"
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
  "runId": "run_6b46a8eb-b405-42ed-81f5-c73ed705c2bd",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
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
  "conversationId": "11d7356f-7793-4254-a4ce-ff8fb20cec1e",
  "stage": "scoping",
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
      "at": "2026-09-10T23:41:11.976Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:41:22.390Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:41:27.142Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_fc721931-835d-497b-8588-326a9bc51802.

- [2.2] reply_sent: **FAIL** - no reply would go: decision pending
- [2.2] not_asks_subject: **FAIL** - artefact: dry-run reply not landed on thread
- [2.2] asked_at_most_once: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "11d7356f-7793-4254-a4ce-ff8fb20cec1e",
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
  "runId": "run_fc721931-835d-497b-8588-326a9bc51802",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:11.503Z) — precondition: confirm_received:nothing_arrived",
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
  "conversationId": "11d7356f-7793-4254-a4ce-ff8fb20cec1e",
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
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:41:11.976Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:41:22.390Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:41:27.142Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:41:51.193Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_89f5524f-8596-43fb-b748-60c2529c1f5f.

- [2.2] reply_sent: **FAIL** - no reply would go: decision pending
- [2.2] not_asks_subject: **FAIL** - artefact: dry-run reply not landed on thread
- [2.2] asked_at_most_once: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "11d7356f-7793-4254-a4ce-ff8fb20cec1e",
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
  "runId": "run_89f5524f-8596-43fb-b748-60c2529c1f5f",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:37.019Z) — precondition: confirm_received:nothing_arrived",
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
  "conversationId": "11d7356f-7793-4254-a4ce-ff8fb20cec1e",
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
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:41:11.976Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:41:22.390Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:41:27.142Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:41:51.193Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T23:42:16.790Z",
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

### 2.3-own-words run 2: Asks about the job one thing at a time, in its own words (model verdict recorded beside the deterministic one)

Lines 2.3. Started 2026-09-10T23:42:41.753Z, 78558 ms.

Seed: customer new, name Alex, prefers text false, already rung false, window open. customer: honoured (name "Alex" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_7079cbec-fcc1-48f7-a95e-41b0f146fd2a.

> Hi Alex, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "c21507be-e4e0-43c0-bbdd-a1e0d5d4d903",
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
  "runId": "run_7079cbec-fcc1-48f7-a95e-41b0f146fd2a",
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
  "conversationId": "c21507be-e4e0-43c0-bbdd-a1e0d5d4d903",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "multiple_jobs",
    "beeston"
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
      "at": "2026-09-10T23:42:44.926Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:42:54.786Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_cd31b625-b0a2-46fc-b7ee-5516b79769f2.

- [2.3] asks_subject: **FAIL** - no reply would go
- [2.3] own_words: **FAIL** - no reply would go
  - model judge (beside, not instead): claude-haiku-4-5, prompt 153f36d8fd03, verdict **skipped** - no reply to judge

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "c21507be-e4e0-43c0-bbdd-a1e0d5d4d903",
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
  "runId": "run_cd31b625-b0a2-46fc-b7ee-5516b79769f2",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:20.298Z) — precondition: ask_gap:customer_question",
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
  "conversationId": "c21507be-e4e0-43c0-bbdd-a1e0d5d4d903",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "multiple_jobs",
    "beeston",
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
      "at": "2026-09-10T23:42:44.926Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:42:54.786Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T23:43:00.344Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_a2841b8c-7913-4eb9-afa7-040901d4b1e1. Not landed on the thread by the door.

> Thanks Alex, that's useful.
> Could you send a quick photo or video of the bannister and the loose spindles?
> We'll sort the door and tap details next.

- [2.3] own_words: **PASS** - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)
  - model judge (beside, not instead): claude-haiku-4-5, prompt 020b9840ef19, verdict **no** - The reply mentions 'the door and tap details' which the customer never mentioned, suggesting a template response, and it asks for a photo/video without first clarifying the specific repair needed or acknowledging the safety concern of the rocking bannister.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "c21507be-e4e0-43c0-bbdd-a1e0d5d4d903",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Alex, that's useful.",
    "Could you send a quick photo or video of the bannister and the loose spindles?",
    "We'll sort the door and tap details next."
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
  "runId": "run_a2841b8c-7913-4eb9-afa7-040901d4b1e1",
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
  "conversationId": "c21507be-e4e0-43c0-bbdd-a1e0d5d4d903",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "multiple_jobs",
    "beeston",
    "needs_scoping",
    "bannister_loose"
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
      "at": "2026-09-10T23:42:44.926Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:42:54.786Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T23:43:00.344Z",
      "content": "Which one do you want to know about first?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T23:43:28.671Z",
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

Lines 2.4. Started 2026-09-10T23:44:00.312Z, 64542 ms.

Seed: customer new, name Chris, prefers text false, already rung false, window open. customer: honoured (name "Chris" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_d3ee0e46-08fa-458c-9d00-2327cc364ac3.

> Hi Chris, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d4c2cedd-9b6f-448b-aff6-bb31d27401ec",
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
  "runId": "run_d3ee0e46-08fa-458c-9d00-2327cc364ac3",
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
  "conversationId": "d4c2cedd-9b6f-448b-aff6-bb31d27401ec",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "garden_gate",
    "postcode_provided"
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
      "at": "2026-09-10T23:44:04.725Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:44:15.368Z",
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

Planned send: nothing goes; decision none; intent ask_media; window open; template unavailable; approver none; hold none; run run_fceef51e-35a7-4e4f-9dd6-24e0b25ce808.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d4c2cedd-9b6f-448b-aff6-bb31d27401ec",
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
  "runId": "run_fceef51e-35a7-4e4f-9dd6-24e0b25ce808",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "ask_media",
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
  "conversationId": "d4c2cedd-9b6f-448b-aff6-bb31d27401ec",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "garden_gate",
    "postcode_provided",
    "awaiting_response"
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
      "at": "2026-09-10T23:44:04.725Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:44:15.368Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T23:44:20.856Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_c1494d86-7559-4524-879b-a3c93731701f. Not landed on the thread by the door.

> Ah, rotten post, that'll do it. Could you send a photo or quick video of the gate and the post where it's rotted?
> That'll help me see what we're dealing with.

- [2.4] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.4] asks_subject: **PASS** - the reply asks about any

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d4c2cedd-9b6f-448b-aff6-bb31d27401ec",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Ah, rotten post, that'll do it. Could you send a photo or quick video of the gate and the post where it's rotted?",
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
  "runId": "run_c1494d86-7559-4524-879b-a3c93731701f",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
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
  "conversationId": "d4c2cedd-9b6f-448b-aff6-bb31d27401ec",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "garden_gate",
    "postcode_provided",
    "awaiting_response",
    "wooden_gate",
    "rot_damage",
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
      "at": "2026-09-10T23:44:04.725Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:44:15.368Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T23:44:20.856Z",
      "content": "one sec, let me check"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T23:44:41.479Z",
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

Lines 2.5. Started 2026-09-10T23:45:04.854Z, 146232 ms.

Seed: customer new, name Sara, prefers text false, already rung false, window open. customer: honoured (name "Sara" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_428525eb-3f71-4fb5-a27d-913e0290891d.

> Hi Sara, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "31636f15-bfe5-44ee-bffe-9e0281cd67f1",
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
  "runId": "run_428525eb-3f71-4fb5-a27d-913e0290891d",
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
  "conversationId": "31636f15-bfe5-44ee-bffe-9e0281cd67f1",
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
      "at": "2026-09-10T23:45:11.521Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:45:22.215Z",
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

Planned send: nothing goes; decision none; intent propose_intake; window open; template unavailable; approver none; hold none; run run_e1a096aa-5a41-496b-885c-c1b6d75c9054.

- [2.5] reply_sent: **FAIL** - no reply would go: decision none
- [2.5] bubble_count_within: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "31636f15-bfe5-44ee-bffe-9e0281cd67f1",
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
  "runId": "run_e1a096aa-5a41-496b-885c-c1b6d75c9054",
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
  "conversationId": "31636f15-bfe5-44ee-bffe-9e0281cd67f1",
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
      "at": "2026-09-10T23:45:11.521Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:45:22.215Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T23:45:30.737Z",
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

Planned send: nothing goes; decision none; intent propose_intake; window open; template unavailable; approver none; hold none; run run_13e5ee72-d402-4bff-88e5-58743c67525e.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "31636f15-bfe5-44ee-bffe-9e0281cd67f1",
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
  "runId": "run_13e5ee72-d402-4bff-88e5-58743c67525e",
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
  "conversationId": "31636f15-bfe5-44ee-bffe-9e0281cd67f1",
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
      "at": "2026-09-10T23:45:11.521Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:45:22.215Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T23:45:30.737Z",
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

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_f797a189-1229-43fa-912c-f08bbc88aea9.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "31636f15-bfe5-44ee-bffe-9e0281cd67f1",
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
  "runId": "run_f797a189-1229-43fa-912c-f08bbc88aea9",
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
  "conversationId": "31636f15-bfe5-44ee-bffe-9e0281cd67f1",
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
      "at": "2026-09-10T23:45:11.521Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:45:22.215Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T23:45:30.737Z",
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

Lines 2.6. Started 2026-09-10T23:47:31.086Z, 43066 ms.

Seed: customer new, name Tom, prefers text false, already rung false, window open. customer: honoured (name "Tom" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_c9db599a-8f7d-4fc6-924a-19b4810cba59.

> Hi Tom, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a9308d82-e27b-4aa3-a201-c04490459570",
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
  "runId": "run_c9db599a-8f7d-4fc6-924a-19b4810cba59",
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
  "conversationId": "a9308d82-e27b-4aa3-a201-c04490459570",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "extractor_fan",
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
      "at": "2026-09-10T23:47:34.189Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:47:44.700Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_c7879067-eb51-4cc6-97ad-71e6c0fed96d.

- [2.6] reply_sent: **FAIL** - no reply would go: decision pending
- [2.6] no_date: **PASS** - no date, time or duration in the reply
- [2.6] text_matches: **FAIL** - no reply would go
- [2.6] asks_subject: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a9308d82-e27b-4aa3-a201-c04490459570",
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
  "runId": "run_c7879067-eb51-4cc6-97ad-71e6c0fed96d",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "ask_gap",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:09.812Z) — precondition: ask_gap:date_asked",
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
  "conversationId": "a9308d82-e27b-4aa3-a201-c04490459570",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "extractor_fan",
    "postcode_provided",
    "availability_question"
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
      "at": "2026-09-10T23:47:34.189Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:47:44.700Z",
      "content": "Hi Tom, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T23:47:49.563Z",
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

Lines 2.7. Started 2026-09-10T23:48:14.153Z, 32501 ms.

Seed: customer new, name Nina, prefers text false, already rung false, window open. customer: honoured (name "Nina" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_42cb9047-10cc-460e-8c6d-18180afff80e.

> Hi Nina, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d2a3407c-00d7-44b1-a517-ff69f68db27f",
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
  "runId": "run_42cb9047-10cc-460e-8c6d-18180afff80e",
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
  "conversationId": "d2a3407c-00d7-44b1-a517-ff69f68db27f",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "tap_replacement",
    "customer_supplied_materials",
    "postcode_provided"
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
      "at": "2026-09-10T23:48:18.485Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:48:32.354Z",
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

Planned send: nothing goes; decision flag; intent unknown; window open; template unavailable; approver none; hold ben (money_question); run run_fdc66087-8c20-4567-ba2e-fff814127169.

- [2.7] hold_for_approver: **PASS** - held for ben: money_question
- [2.7] no_figure: **PASS** - no figure in the reply

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "d2a3407c-00d7-44b1-a517-ff69f68db27f",
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
  "runId": "run_fdc66087-8c20-4567-ba2e-fff814127169",
  "hold": {
    "approver": "ben",
    "reason": "money_question",
    "since": "2026-09-11T11:00:42.223Z"
  },
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "flag",
    "intent": "unknown",
    "lane": "ben",
    "pack": "customer.exception",
    "stageAfter": "enquiry",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: flagged for Ben (money_question), due 2026-09-11T11:00:42.223Z: a question on his phone, nothing to the customer",
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
  "conversationId": "d2a3407c-00d7-44b1-a517-ff69f68db27f",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "tap_replacement",
    "customer_supplied_materials",
    "postcode_provided"
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
      "at": "2026-09-10T23:48:18.485Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:48:32.354Z",
      "content": "Hi Nina, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-10T23:48:36.925Z",
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

Lines 2.8. Started 2026-09-10T23:48:46.654Z, 102961 ms.

Seed: customer new, name Lee, prefers text false, already rung false, window open. customer: honoured (name "Lee" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need an internal door rehung, it's catching on the frame. We're in NG9.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_21e45b94-3e6e-45a1-9401-37a996f54ca2.

> Hi Lee, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.8] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)
- [2.8] bubble_count_within: **PASS** - 2 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "e3baadf6-2fe3-4b16-aae3-5fafac0002c8",
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
  "runId": "run_21e45b94-3e6e-45a1-9401-37a996f54ca2",
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
  "conversationId": "e3baadf6-2fe3-4b16-aae3-5fafac0002c8",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
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
      "at": "2026-09-10T23:48:56.655Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:49:09.365Z",
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

Planned send: nothing goes; decision none; intent unknown; window open; template unavailable; approver none; hold none; run run_46130704-73a7-4c4a-b445-a0bb7cc19b15.

- [2.8] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "e3baadf6-2fe3-4b16-aae3-5fafac0002c8",
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
  "runId": "run_46130704-73a7-4c4a-b445-a0bb7cc19b15",
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
  "conversationId": "e3baadf6-2fe3-4b16-aae3-5fafac0002c8",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "ng9",
    "enquiry_received"
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
      "at": "2026-09-10T23:48:56.655Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:49:09.365Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_c1dc64ff-90c4-4d48-9f7e-eac8c64f845b. Not landed on the thread by the door.

> Thanks Lee, that helps.
> Could you send a quick photo or video of where it's catching on the frame?
> That'll let me see exactly what needs planing or rehanging.

- [2.8] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "e3baadf6-2fe3-4b16-aae3-5fafac0002c8",
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
    "Could you send a quick photo or video of where it's catching on the frame?",
    "That'll let me see exactly what needs planing or rehanging."
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
  "runId": "run_c1dc64ff-90c4-4d48-9f7e-eac8c64f845b",
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
  "conversationId": "e3baadf6-2fe3-4b16-aae3-5fafac0002c8",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "ng9",
    "enquiry_received",
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
      "at": "2026-09-10T23:48:56.655Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:49:09.365Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T23:49:38.615Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_6e57a39f-351c-4e66-b9a5-1172c03dea51. Not landed on the thread by the door.

> Thanks Lee, that helps.
> Could you send a quick photo or video of where it's catching on the frame?
> That'll let me see what's needed to sort it.

- [2.8] reply_not_sent: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "e3baadf6-2fe3-4b16-aae3-5fafac0002c8",
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
    "Could you send a quick photo or video of where it's catching on the frame?",
    "That'll let me see what's needed to sort it."
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
  "runId": "run_6e57a39f-351c-4e66-b9a5-1172c03dea51",
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
  "conversationId": "e3baadf6-2fe3-4b16-aae3-5fafac0002c8",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "ng9",
    "enquiry_received",
    "bathroom_door",
    "catching_frame"
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
      "at": "2026-09-10T23:48:56.655Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T23:49:09.365Z",
      "content": "Hi Lee, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T23:49:38.615Z",
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

