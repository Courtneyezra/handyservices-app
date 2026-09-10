# Comms v2 judge report

Generated 2026-09-10T22:26:29.571Z. Desk: current desk (server/spine via /api/comms-sandbox, dry run). Door: in_process at 127.0.0.1:50225. Runs: 2.

Lines: 3 pass, 8 fail, 0 error. Exit code 0 (non-zero only on an error; a fail is not an error).

A line passes only when every expectation on it passes in every run. Fails against the current desk are expected: Goal 0 proves the judge, not the desk.

Known limitation of this door: it did not put every planned reply on the thread (the current sandbox lands only the rules-layer first-contact ack, never a desk reply planned in dry run). On the turns after such a reply, the expectations that only hold when the desk has seen its own reply (reply_not_sent, not_asks_subject, asked_at_most_once) are recorded as fail with the reason "artefact: dry-run reply not landed on thread". Those verdicts judge the door, not the desk.

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
- 2.3-own-words turn 3 own_words: pass - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this) [model claude-haiku-4-5: no - The reply fails by asking multiple unrelated things at once (video of bannister, photos of door and tap) when the customer only mentioned the bannister issue, making it read like a template form rather than a natural conversation about the specific problem described.]

Run 2: FAIL

- 2.3-own-words turn 2 asks_subject: fail - no reply would go
- 2.3-own-words turn 2 own_words: fail - no reply would go [model claude-haiku-4-5: skipped - no reply to judge]
- 2.3-own-words turn 3 own_words: pass - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this) [model claude-haiku-4-5: no - The reply asks for photos of three different issues (bannister, sticking door, tap) at once, but the customer only mentioned the bannister problem, making it read like a template rather than a natural response to what was actually said.]

### Line 2.4: PASS

A short pause ("one sec") does not stop it.

Run 1: PASS

- 2.4-short-pause turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.4-short-pause turn 3 asks_subject: pass - the reply asks about any

Run 2: PASS

- 2.4-short-pause turn 3 reply_sent: pass - a reply would go (3 bubbles, desk)
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

- 2.8-one-reply-per-turn turn 1 reply_sent: fail - no reply would go: decision none
- 2.8-one-reply-per-turn turn 1 bubble_count_within: fail - no reply would go
- 2.8-one-reply-per-turn turn 2 reply_not_sent: pass - nothing goes: decision none
- 2.8-one-reply-per-turn turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.8-one-reply-per-turn turn 4 reply_not_sent: fail - artefact: dry-run reply not landed on thread

Run 2: FAIL

- 2.8-one-reply-per-turn turn 1 reply_sent: fail - no reply would go: decision none
- 2.8-one-reply-per-turn turn 1 bubble_count_within: fail - no reply would go
- 2.8-one-reply-per-turn turn 2 reply_not_sent: fail - a reply would go (desk): Hiya, thanks for the message.
- 2.8-one-reply-per-turn turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.8-one-reply-per-turn turn 4 reply_not_sent: fail - artefact: dry-run reply not landed on thread

## Scenarios, turn by turn

### 1.1-inbound-whatsapp run 1: Inbound WhatsApp: the opening message gets one freeform acknowledgement that quotes the enquiry back and offers a call

Lines 1.1. Started 2026-09-10T21:53:51.621Z, 41039 ms.

Seed: customer new, name Sam, prefers text false, already rung false, window open. customer: honoured (name "Sam" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_3d4c417b-359c-46dd-bb09-ab25e0b87af9.

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
  "caseId": "b1398743-362d-4a65-a8ff-6268c9a3ae2f",
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
  "runId": "run_3d4c417b-359c-46dd-bb09-ab25e0b87af9",
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
  "conversationId": "b1398743-362d-4a65-a8ff-6268c9a3ae2f",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "tap_repair",
    "leak",
    "kitchen"
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
      "at": "2026-09-10T21:54:03.126Z",
      "content": "Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:54:26.331Z",
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

Lines 1.6. Started 2026-09-10T21:54:32.660Z, 119607 ms.

Seed: customer new, name Jo, prefers text true, already rung false, window open. customer: honoured (name "Jo" passed to POST /start as the pushname); prefersText: unsupported (no seed field on the current door; the scenario states it in a customer turn ("text only please")).

#### Turn 1 (customer/message): Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_97eee546-1c2c-4f7c-adf8-b4837cfd25ee.

> Hi Jo, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e6e2baa-393b-4726-a629-ab307d8bbee5",
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
  "runId": "run_97eee546-1c2c-4f7c-adf8-b4837cfd25ee",
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
  "conversationId": "5e6e2baa-393b-4726-a629-ab307d8bbee5",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
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
      "at": "2026-09-10T21:54:36.206Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:54:52.148Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_08b6b8f7-dd59-4572-b4db-4cad33adcd71. Not landed on the thread by the door.

> No problem Jo, text is fine.
> Could you send a photo of the blown down panel and the fence line either side?
> That'll help me get everything sorted for your quote.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e6e2baa-393b-4726-a629-ab307d8bbee5",
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
    "Could you send a photo of the blown down panel and the fence line either side?",
    "That'll help me get everything sorted for your quote."
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
  "runId": "run_08b6b8f7-dd59-4572-b4db-4cad33adcd71",
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
  "conversationId": "5e6e2baa-393b-4726-a629-ab307d8bbee5",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_repair",
    "beeston",
    "needs_quote",
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
      "at": "2026-09-10T21:54:36.206Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:54:52.148Z",
      "content": "Hi Jo, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T21:55:00.475Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_7296aada-89a5-4f78-bb58-dced24b4f71a. Not landed on the thread by the door.

> Thanks Jo, that's really helpful.
> Could you send a quick photo of the fallen panel and the posts either side?
> Once I've seen that I'll get your quote sorted.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e6e2baa-393b-4726-a629-ab307d8bbee5",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Jo, that's really helpful.",
    "Could you send a quick photo of the fallen panel and the posts either side?",
    "Once I've seen that I'll get your quote sorted."
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
  "runId": "run_7296aada-89a5-4f78-bb58-dced24b4f71a",
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
  "conversationId": "5e6e2baa-393b-4726-a629-ab307d8bbee5",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_repair",
    "beeston",
    "needs_quote",
    "text_only",
    "postcode_received"
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
      "at": "2026-09-10T21:54:36.206Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:54:52.148Z",
      "content": "Hi Jo, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T21:55:00.475Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T21:55:28.233Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_8ad37d23-0298-4f93-a5ed-1096c35b1288.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5e6e2baa-393b-4726-a629-ab307d8bbee5",
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
  "runId": "run_8ad37d23-0298-4f93-a5ed-1096c35b1288",
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
  "conversationId": "5e6e2baa-393b-4726-a629-ab307d8bbee5",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "fence_repair",
    "beeston",
    "needs_quote",
    "text_only",
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
      "at": "2026-09-10T21:54:36.206Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:54:52.148Z",
      "content": "Hi Jo, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T21:55:00.475Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T21:55:28.233Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T21:56:02.718Z",
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

Lines 1.7. Started 2026-09-10T21:56:32.267Z, 45933 ms.

Seed: customer new, name Priya, prefers text false, already rung false, window open. customer: honoured (name "Priya" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it? [+1 media]

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_a0520a31-cca3-4ffa-b925-d0eac80cbd1a.

- [1.7] reply_sent: **FAIL** - no reply would go: decision pending
- [1.7] text_matches: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "57bb3bcc-d7ba-4b0e-af8f-fd0deeafe8d2",
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
  "runId": "run_a0520a31-cca3-4ffa-b925-d0eac80cbd1a",
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
  "conversationId": "57bb3bcc-d7ba-4b0e-af8f-fd0deeafe8d2",
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
      "at": "2026-09-10T21:56:41.697Z",
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

Lines 2.1. Started 2026-09-10T21:57:18.201Z, 133084 ms.

Seed: customer new, name Dan, prefers text false, already rung false, window open. customer: honoured (name "Dan" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my bathroom extractor fan has stopped working, can you sort it?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_87d1fa76-1e2b-4400-9afd-e93acb1d506a.

> Hi Dan, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "005cfba8-4cb7-4ac6-9c7e-470cc89d2ed7",
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
  "runId": "run_87d1fa76-1e2b-4400-9afd-e93acb1d506a",
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
  "conversationId": "005cfba8-4cb7-4ac6-9c7e-470cc89d2ed7",
  "stage": "enquiry",
  "tags": [
    "sandbox"
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
      "at": "2026-09-10T21:57:23.174Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:57:37.094Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_e1a501e3-c976-499f-a8d2-d266888c27fa. Not landed on the thread by the door.

> Thanks Dan, that helps.
> Could you send a quick photo of the fan and the switch that controls it?
> That'll help me see what we're working with.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "005cfba8-4cb7-4ac6-9c7e-470cc89d2ed7",
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
    "Could you send a quick photo of the fan and the switch that controls it?",
    "That'll help me see what we're working with."
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
  "runId": "run_e1a501e3-c976-499f-a8d2-d266888c27fa",
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
  "conversationId": "005cfba8-4cb7-4ac6-9c7e-470cc89d2ed7",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "electrical_work",
    "extractor_fan",
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
      "at": "2026-09-10T21:57:23.174Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:57:37.094Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T21:57:44.631Z",
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

Planned send: 3 bubbles (desk); decision send; intent confirm_received; window open; template none; approver agent.scoper; hold none; run run_f24705d6-745f-4369-a21e-df5a29c22c52. Not landed on the thread by the door.

> Perfect, got all that, thanks Dan.
> Four inch ceiling fan, light still fine just the fan dead, NG7 2PQ.
> I'll get your quote over shortly.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "005cfba8-4cb7-4ac6-9c7e-470cc89d2ed7",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Perfect, got all that, thanks Dan.",
    "Four inch ceiling fan, light still fine just the fan dead, NG7 2PQ.",
    "I'll get your quote over shortly."
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
  "runId": "run_f24705d6-745f-4369-a21e-df5a29c22c52",
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
  "conversationId": "005cfba8-4cb7-4ac6-9c7e-470cc89d2ed7",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "electrical_work",
    "extractor_fan",
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
      "at": "2026-09-10T21:57:23.174Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:57:37.094Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T21:57:44.631Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T21:58:19.578Z",
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

Planned send: nothing goes; decision pending; intent closing; window open; template unavailable; approver none; hold none; run run_83f2ddd2-7134-4827-a756-e407f1f4ae9a.

- [2.1] reply_sent: **FAIL** - no reply would go: decision pending

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "005cfba8-4cb7-4ac6-9c7e-470cc89d2ed7",
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
  "runId": "run_83f2ddd2-7134-4827-a756-e407f1f4ae9a",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "closing",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "scoping",
    "exitNote": "DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve (due 2026-09-11T11:00:00.000Z) — intent closing is at tier DRAFT in pack customer.default",
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
  "conversationId": "005cfba8-4cb7-4ac6-9c7e-470cc89d2ed7",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "electrical_work",
    "extractor_fan",
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
      "at": "2026-09-10T21:57:23.174Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:57:37.094Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T21:57:44.631Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T21:58:19.578Z",
      "content": "We're in NG7 2PQ."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T21:58:56.269Z",
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

Lines 2.2. Started 2026-09-10T21:59:31.285Z, 129919 ms.

Seed: customer new, name Mel, prefers text false, already rung false, window open. customer: honoured (name "Mel" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_2ac8d46d-cc5b-4c34-90e3-7a8f8b1da6ea.

> Hi Mel, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "35be38ed-5da4-40af-ac83-599d4e2d29ec",
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
  "runId": "run_2ac8d46d-cc5b-4c34-90e3-7a8f8b1da6ea",
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
  "conversationId": "35be38ed-5da4-40af-ac83-599d4e2d29ec",
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
      "at": "2026-09-10T21:59:35.265Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:59:47.081Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_35be877a-2304-42dc-9c48-194dacaa12b6. Not landed on the thread by the door.

> Thanks Mel, that's clear, one cracked corner tile, 20cm plain white.
> Could you send a quick photo of it so I can check the match and access?

- [2.2] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.2] asked_at_most_once: **PASS** - media asked 1 time so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "35be38ed-5da4-40af-ac83-599d4e2d29ec",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Mel, that's clear, one cracked corner tile, 20cm plain white.",
    "Could you send a quick photo of it so I can check the match and access?"
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
  "runId": "run_35be877a-2304-42dc-9c48-194dacaa12b6",
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
  "conversationId": "35be38ed-5da4-40af-ac83-599d4e2d29ec",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "tile_repair",
    "postcode_provided",
    "scoping_detail"
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
      "at": "2026-09-10T21:59:35.265Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:59:47.081Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T21:59:55.648Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_35c0e12f-6e4f-4d24-b629-a827ddf010f0.

- [2.2] reply_sent: **FAIL** - no reply would go: decision pending
- [2.2] not_asks_subject: **FAIL** - artefact: dry-run reply not landed on thread
- [2.2] asked_at_most_once: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "35be38ed-5da4-40af-ac83-599d4e2d29ec",
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
  "runId": "run_35c0e12f-6e4f-4d24-b629-a827ddf010f0",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
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
  "conversationId": "35be38ed-5da4-40af-ac83-599d4e2d29ec",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "tile_repair",
    "postcode_provided",
    "scoping_detail",
    "no_photos",
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
      "at": "2026-09-10T21:59:35.265Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:59:47.081Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T21:59:55.648Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T22:00:28.549Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_35ea9231-85c1-4a49-b552-21faed83ad4b.

- [2.2] reply_sent: **FAIL** - no reply would go: decision pending
- [2.2] not_asks_subject: **FAIL** - artefact: dry-run reply not landed on thread
- [2.2] asked_at_most_once: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "35be38ed-5da4-40af-ac83-599d4e2d29ec",
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
  "runId": "run_35ea9231-85c1-4a49-b552-21faed83ad4b",
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
  "conversationId": "35be38ed-5da4-40af-ac83-599d4e2d29ec",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "tile_repair",
    "postcode_provided",
    "scoping_detail",
    "no_photos",
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
      "at": "2026-09-10T21:59:35.265Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T21:59:47.081Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T21:59:55.648Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T22:00:28.549Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T22:00:56.833Z",
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

Lines 2.3. Started 2026-09-10T22:01:41.205Z, 99120 ms.

Seed: customer new, name Alex, prefers text false, already rung false, window open. customer: honoured (name "Alex" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_b415db5c-c60c-42b3-9ba1-65426ea83b9b.

> Hi Alex, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "2772ea0e-5235-4e36-8c73-5859338a280b",
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
  "runId": "run_b415db5c-c60c-42b3-9ba1-65426ea83b9b",
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
  "conversationId": "2772ea0e-5235-4e36-8c73-5859338a280b",
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
      "at": "2026-09-10T22:01:51.309Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:02:03.632Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_7fe9b95c-9108-41f3-85d8-cd136c446582.

- [2.3] asks_subject: **FAIL** - no reply would go
- [2.3] own_words: **FAIL** - no reply would go
  - model judge (beside, not instead): claude-haiku-4-5, prompt 153f36d8fd03, verdict **skipped** - no reply to judge

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "2772ea0e-5235-4e36-8c73-5859338a280b",
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
  "runId": "run_7fe9b95c-9108-41f3-85d8-cd136c446582",
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
  "conversationId": "2772ea0e-5235-4e36-8c73-5859338a280b",
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
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T22:01:51.309Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:02:03.632Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T22:02:11.060Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_b0a072f6-31ef-436c-9474-1a99d9d53857. Not landed on the thread by the door.

> Thanks Alex, that's helpful. Could you send a quick video of the bannister, showing it rock when you lean on it?
> While you're at it, a photo of the sticking door and the leaking tap would help too.
> Then I can get one quote sorted for all three.

- [2.3] own_words: **PASS** - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)
  - model judge (beside, not instead): claude-haiku-4-5, prompt 8648a0b3ffb6, verdict **no** - The reply fails by asking multiple unrelated things at once (video of bannister, photos of door and tap) when the customer only mentioned the bannister issue, making it read like a template form rather than a natural conversation about the specific problem described.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "2772ea0e-5235-4e36-8c73-5859338a280b",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Alex, that's helpful. Could you send a quick video of the bannister, showing it rock when you lean on it?",
    "While you're at it, a photo of the sticking door and the leaking tap would help too.",
    "Then I can get one quote sorted for all three."
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
  "runId": "run_b0a072f6-31ef-436c-9474-1a99d9d53857",
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
  "conversationId": "2772ea0e-5235-4e36-8c73-5859338a280b",
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
    "summary": "OPEN — last customer WhatsApp 1 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T22:01:51.309Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:02:03.632Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T22:02:11.060Z",
      "content": "Which one do you want to know about first?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T22:02:42.971Z",
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

Lines 2.4. Started 2026-09-10T22:03:20.325Z, 74475 ms.

Seed: customer new, name Chris, prefers text false, already rung false, window open. customer: honoured (name "Chris" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_060e3c33-5c65-4f4b-bec4-82a40fcf538f.

> Hi Chris, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "0805b3a1-6f2b-4a0e-8149-39eb7f09fdd4",
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
  "runId": "run_060e3c33-5c65-4f4b-bec4-82a40fcf538f",
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
  "conversationId": "0805b3a1-6f2b-4a0e-8149-39eb7f09fdd4",
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
      "at": "2026-09-10T22:03:24.576Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:03:36.837Z",
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

Planned send: nothing goes; decision none; intent unknown; window open; template unavailable; approver none; hold none; run run_8b386bdd-32fb-4f5d-b110-c3263d3a576c.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "0805b3a1-6f2b-4a0e-8149-39eb7f09fdd4",
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
  "runId": "run_8b386bdd-32fb-4f5d-b110-c3263d3a576c",
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
  "conversationId": "0805b3a1-6f2b-4a0e-8149-39eb7f09fdd4",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "gate_repair",
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
      "at": "2026-09-10T22:03:24.576Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:03:36.837Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T22:03:45.010Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_44d71ddc-5654-453d-a86e-28e5dea015e5. Not landed on the thread by the door.

> That'll be the post causing it to lean, makes sense.
> Could you send a photo or quick video of the post and where it's rotted, plus the whole gate?

- [2.4] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.4] asks_subject: **PASS** - the reply asks about any

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "0805b3a1-6f2b-4a0e-8149-39eb7f09fdd4",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "That'll be the post causing it to lean, makes sense.",
    "Could you send a photo or quick video of the post and where it's rotted, plus the whole gate?"
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
  "runId": "run_44d71ddc-5654-453d-a86e-28e5dea015e5",
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
  "conversationId": "0805b3a1-6f2b-4a0e-8149-39eb7f09fdd4",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "gate_repair",
    "postcode_provided",
    "awaiting_response",
    "needs_photos",
    "wooden_gate",
    "rotted_post"
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
      "at": "2026-09-10T22:03:24.576Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:03:36.837Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T22:03:45.010Z",
      "content": "one sec, let me check"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T22:04:08.839Z",
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

Lines 2.5. Started 2026-09-10T22:04:34.800Z, 139403 ms.

Seed: customer new, name Sara, prefers text false, already rung false, window open. customer: honoured (name "Sara" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_42274f95-0833-40fa-bce2-a98d872b6df4.

> Hi Sara, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "8d5930f3-e99c-4dd6-9abd-d5dafc4be328",
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
  "runId": "run_42274f95-0833-40fa-bce2-a98d872b6df4",
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
  "conversationId": "8d5930f3-e99c-4dd6-9abd-d5dafc4be328",
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
      "at": "2026-09-10T22:04:39.431Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:04:56.890Z",
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

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_6295271c-03e4-477b-a003-b17e5af25f32.

- [2.5] reply_sent: **FAIL** - no reply would go: decision none
- [2.5] bubble_count_within: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "8d5930f3-e99c-4dd6-9abd-d5dafc4be328",
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
  "runId": "run_6295271c-03e4-477b-a003-b17e5af25f32",
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
  "conversationId": "8d5930f3-e99c-4dd6-9abd-d5dafc4be328",
  "stage": "scoping",
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
      "at": "2026-09-10T22:04:39.431Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:04:56.890Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T22:05:11.638Z",
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

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_456875b8-4780-4efb-862c-86815431e9cd.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "8d5930f3-e99c-4dd6-9abd-d5dafc4be328",
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
  "runId": "run_456875b8-4780-4efb-862c-86815431e9cd",
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
  "conversationId": "8d5930f3-e99c-4dd6-9abd-d5dafc4be328",
  "stage": "scoping",
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
      "at": "2026-09-10T22:04:39.431Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:04:56.890Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T22:05:11.638Z",
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

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_6ed68063-92d3-42a7-b25b-c54b10dc619e.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "8d5930f3-e99c-4dd6-9abd-d5dafc4be328",
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
  "runId": "run_6ed68063-92d3-42a7-b25b-c54b10dc619e",
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
  "conversationId": "8d5930f3-e99c-4dd6-9abd-d5dafc4be328",
  "stage": "scoping",
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
      "at": "2026-09-10T22:04:39.431Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:04:56.890Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T22:05:11.638Z",
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

Lines 2.6. Started 2026-09-10T22:06:54.203Z, 59030 ms.

Seed: customer new, name Tom, prefers text false, already rung false, window open. customer: honoured (name "Tom" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ.

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_3f538c77-fed4-4368-b3c3-567482fccec2. Not landed on the thread by the door.

> Hiya Tom, no problem, we can help with that.
> Could you send a quick photo of the current extractor fan, and the ceiling or wall it's fitted in?

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "746e74e6-0c07-4990-80d2-e89c58f2003d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Tom"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya Tom, no problem, we can help with that.",
    "Could you send a quick photo of the current extractor fan, and the ceiling or wall it's fitted in?"
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
  "runId": "run_3f538c77-fed4-4368-b3c3-567482fccec2",
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
  "conversationId": "746e74e6-0c07-4990-80d2-e89c58f2003d",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "extractor_fan",
    "needs_photos"
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
      "at": "2026-09-10T22:06:58.648Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_94cfc752-8efa-4dc7-9c66-e4649ac2eaef.

- [2.6] reply_sent: **FAIL** - no reply would go: decision pending
- [2.6] no_date: **PASS** - no date, time or duration in the reply
- [2.6] text_matches: **FAIL** - no reply would go
- [2.6] asks_subject: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "746e74e6-0c07-4990-80d2-e89c58f2003d",
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
  "runId": "run_94cfc752-8efa-4dc7-9c66-e4649ac2eaef",
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
  "conversationId": "746e74e6-0c07-4990-80d2-e89c58f2003d",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "extractor_fan",
    "needs_photos",
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
      "at": "2026-09-10T22:06:58.648Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T22:07:27.841Z",
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

Lines 2.7. Started 2026-09-10T22:07:53.233Z, 52889 ms.

Seed: customer new, name Nina, prefers text false, already rung false, window open. customer: honoured (name "Nina" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_5b6b99e6-665f-49e5-9794-ac4295971aef.

> Hi Nina, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a03e1de3-48f6-4479-be73-8dae4f687865",
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
  "runId": "run_5b6b99e6-665f-49e5-9794-ac4295971aef",
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
  "conversationId": "a03e1de3-48f6-4479-be73-8dae4f687865",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "tap_replacement",
    "customer_supplied_materials"
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
      "at": "2026-09-10T22:07:57.632Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:08:13.858Z",
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

Planned send: nothing goes; decision flag; intent unknown; window open; template unavailable; approver none; hold ben (money_question); run run_b454589f-9abc-4f7c-a74d-86c83985fd9a.

- [2.7] hold_for_approver: **PASS** - held for ben: money_question
- [2.7] no_figure: **PASS** - no figure in the reply

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "a03e1de3-48f6-4479-be73-8dae4f687865",
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
  "runId": "run_b454589f-9abc-4f7c-a74d-86c83985fd9a",
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
  "conversationId": "a03e1de3-48f6-4479-be73-8dae4f687865",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "tap_replacement",
    "customer_supplied_materials"
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
      "at": "2026-09-10T22:07:57.632Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:08:13.858Z",
      "content": "Hi Nina, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-10T22:08:22.634Z",
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

Lines 2.8. Started 2026-09-10T22:08:46.122Z, 109241 ms.

Seed: customer new, name Lee, prefers text false, already rung false, window open. customer: honoured (name "Lee" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need an internal door rehung, it's catching on the frame. We're in NG9.

Planned send: nothing goes; decision none; intent ask_postcode; window open; template unavailable; approver none; hold none; run run_6fe9e0d0-8005-4650-abdb-663e3ec9b3eb.

- [2.8] reply_sent: **FAIL** - no reply would go: decision none
- [2.8] bubble_count_within: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5cc68796-64ab-4f98-ab0d-9f28ad5b52f7",
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
  "runId": "run_6fe9e0d0-8005-4650-abdb-663e3ec9b3eb",
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
  "conversationId": "5cc68796-64ab-4f98-ab0d-9f28ad5b52f7",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "postcode_provided"
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
      "at": "2026-09-10T22:08:56.624Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
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

Planned send: nothing goes; decision none; intent ack_enquiry; window open; template unavailable; approver none; hold none; run run_f9d8a410-89a9-4eaf-a965-42b70b883d75.

- [2.8] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5cc68796-64ab-4f98-ab0d-9f28ad5b52f7",
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
  "runId": "run_f9d8a410-89a9-4eaf-a965-42b70b883d75",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": "ack_enquiry",
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
  "conversationId": "5cc68796-64ab-4f98-ab0d-9f28ad5b52f7",
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
      "at": "2026-09-10T22:08:56.624Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_3572cc70-de23-44b1-a758-51df8dd19877. Not landed on the thread by the door.

> Hiya Lee, sounds like a simple rehang job.
> Could you send a quick video of the door where it's catching on the frame?

- [2.8] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5cc68796-64ab-4f98-ab0d-9f28ad5b52f7",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya Lee, sounds like a simple rehang job.",
    "Could you send a quick video of the door where it's catching on the frame?"
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
  "runId": "run_3572cc70-de23-44b1-a758-51df8dd19877",
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
  "conversationId": "5cc68796-64ab-4f98-ab0d-9f28ad5b52f7",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "postcode_provided",
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
      "at": "2026-09-10T22:08:56.624Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T22:09:38.295Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_df1b5030-23e5-4f5d-97be-a702334c645f. Not landed on the thread by the door.

> Hiya Lee, thanks for that. Sounds like it's just dropped on its hinges over time, very common.
> Could you send a quick photo or video of where it's catching on the frame?

- [2.8] reply_not_sent: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "5cc68796-64ab-4f98-ab0d-9f28ad5b52f7",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya Lee, thanks for that. Sounds like it's just dropped on its hinges over time, very common.",
    "Could you send a quick photo or video of where it's catching on the frame?"
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
  "runId": "run_df1b5030-23e5-4f5d-97be-a702334c645f",
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
  "conversationId": "5cc68796-64ab-4f98-ab0d-9f28ad5b52f7",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehang",
    "postcode_provided",
    "bathroom_door",
    "internal_door"
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
      "at": "2026-09-10T22:08:56.624Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T22:09:38.295Z",
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

Lines 1.1. Started 2026-09-10T22:10:35.363Z, 28147 ms.

Seed: customer new, name Sam, prefers text false, already rung false, window open. customer: honoured (name "Sam" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_b79d0e6b-1d47-4ccd-86e5-005e8d356b99.

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
  "caseId": "bab01dcd-e0ff-40c0-9db0-d2b79fbbf413",
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
  "runId": "run_b79d0e6b-1d47-4ccd-86e5-005e8d356b99",
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
  "conversationId": "bab01dcd-e0ff-40c0-9db0-d2b79fbbf413",
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
      "at": "2026-09-10T22:10:42.269Z",
      "content": "Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:10:56.265Z",
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

Lines 1.6. Started 2026-09-10T22:11:03.510Z, 170936 ms.

Seed: customer new, name Jo, prefers text true, already rung false, window open. customer: honoured (name "Jo" passed to POST /start as the pushname); prefersText: unsupported (no seed field on the current door; the scenario states it in a customer turn ("text only please")).

#### Turn 1 (customer/message): Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?

Planned send: nothing goes; decision none; intent ask_postcode; window open; template unavailable; approver none; hold none; run run_e7125ed8-cfa0-46e6-bcb0-c3943b4c41c7.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "4688cbbb-1681-4bf2-99b7-f30a041f2f6c",
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
  "runId": "run_e7125ed8-cfa0-46e6-bcb0-c3943b4c41c7",
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
  "conversationId": "4688cbbb-1681-4bf2-99b7-f30a041f2f6c",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "first_contact"
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
      "at": "2026-09-10T22:11:07.362Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_b633f275-7f8f-4fc4-b0e3-f447b779a887. Not landed on the thread by the door.

> Hiya Jo, sorry to hear that, blown down fence panels are a common one this time of year.
> Could you send a photo of the damaged panel and the posts either side?
> No problem on text only, we'll keep it all here.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "4688cbbb-1681-4bf2-99b7-f30a041f2f6c",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya Jo, sorry to hear that, blown down fence panels are a common one this time of year.",
    "Could you send a photo of the damaged panel and the posts either side?",
    "No problem on text only, we'll keep it all here."
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
  "runId": "run_b633f275-7f8f-4fc4-b0e3-f447b779a887",
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
  "conversationId": "4688cbbb-1681-4bf2-99b7-f30a041f2f6c",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "first_contact",
    "no_calls"
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
      "at": "2026-09-10T22:11:07.362Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T22:11:26.733Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_8b752768-25c9-41b0-973e-c229e5c3901d. Not landed on the thread by the door.

> Hiya Jo, thanks, that's a good bit of detail already.
> Could you send a quick photo of the blown down panel and the gap?
> That'll help me get the quote spot on for you.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "4688cbbb-1681-4bf2-99b7-f30a041f2f6c",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya Jo, thanks, that's a good bit of detail already.",
    "Could you send a quick photo of the blown down panel and the gap?",
    "That'll help me get the quote spot on for you."
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
  "runId": "run_8b752768-25c9-41b0-973e-c229e5c3901d",
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
  "conversationId": "4688cbbb-1681-4bf2-99b7-f30a041f2f6c",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "first_contact",
    "no_calls",
    "postcode_provided",
    "scope_clear"
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
      "at": "2026-09-10T22:11:07.362Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T22:11:26.733Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T22:11:53.627Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_3007e6ca-737a-4356-9846-44faa06328a5.

- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "4688cbbb-1681-4bf2-99b7-f30a041f2f6c",
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
  "runId": "run_3007e6ca-737a-4356-9846-44faa06328a5",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "pending",
    "intent": "confirm_received",
    "lane": "scoper",
    "pack": "customer.default",
    "stageAfter": "enquiry",
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
  "conversationId": "4688cbbb-1681-4bf2-99b7-f30a041f2f6c",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "fence_repair",
    "first_contact",
    "no_calls",
    "postcode_provided",
    "scope_clear",
    "text_only",
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
      "at": "2026-09-10T22:11:07.362Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T22:11:26.733Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T22:11:53.627Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-10T22:13:08.116Z",
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

Lines 1.7. Started 2026-09-10T22:13:54.446Z, 30993 ms.

Seed: customer new, name Priya, prefers text false, already rung false, window open. customer: honoured (name "Priya" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it? [+1 media]

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_89d6a72c-f21c-4afd-acbe-7e88cabccdb2.

- [1.7] reply_sent: **FAIL** - no reply would go: decision pending
- [1.7] text_matches: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "f6cbaa8e-300f-4d87-823f-942329e2dac2",
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
  "runId": "run_89d6a72c-f21c-4afd-acbe-7e88cabccdb2",
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
  "conversationId": "f6cbaa8e-300f-4d87-823f-942329e2dac2",
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
      "at": "2026-09-10T22:14:03.951Z",
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

Lines 2.1. Started 2026-09-10T22:14:25.440Z, 127705 ms.

Seed: customer new, name Dan, prefers text false, already rung false, window open. customer: honoured (name "Dan" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my bathroom extractor fan has stopped working, can you sort it?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_efbe5a48-6fef-4915-8352-9cc379879422.

> Hi Dan, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, rules_layer_mirror)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "9f434183-0f02-44c5-a2b3-de0a0451aeb0",
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
  "runId": "run_efbe5a48-6fef-4915-8352-9cc379879422",
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
  "conversationId": "9f434183-0f02-44c5-a2b3-de0a0451aeb0",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "bathroom_electrical",
    "extractor_fan"
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
      "at": "2026-09-10T22:14:30.930Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:14:41.891Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_3ad299b5-b1b1-4555-a102-948c82d107e0. Not landed on the thread by the door.

> Thanks Dan, that helps.
> Could you send a quick photo of the fan and the switch that runs it?
> That'll let me see what we're dealing with.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "9f434183-0f02-44c5-a2b3-de0a0451aeb0",
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
    "Could you send a quick photo of the fan and the switch that runs it?",
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
  "runId": "run_3ad299b5-b1b1-4555-a102-948c82d107e0",
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
  "conversationId": "9f434183-0f02-44c5-a2b3-de0a0451aeb0",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "bathroom_electrical",
    "extractor_fan",
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
      "at": "2026-09-10T22:14:30.930Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:14:41.891Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T22:14:48.263Z",
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

Planned send: 3 bubbles (desk); decision send; intent confirm_received; window open; template none; approver agent.scoper; hold none; run run_c777ccb8-7b0a-4ab6-a87b-278e15bfa75d. Not landed on the thread by the door.

> Cheers, that's clear, a 4 inch bathroom extractor, light still working but the fan's dead.
> Got your postcode too, NG7 2PQ noted.
> I'll get your quote sorted and sent over shortly.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "9f434183-0f02-44c5-a2b3-de0a0451aeb0",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Cheers, that's clear, a 4 inch bathroom extractor, light still working but the fan's dead.",
    "Got your postcode too, NG7 2PQ noted.",
    "I'll get your quote sorted and sent over shortly."
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
  "runId": "run_c777ccb8-7b0a-4ab6-a87b-278e15bfa75d",
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
  "conversationId": "9f434183-0f02-44c5-a2b3-de0a0451aeb0",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "bathroom_electrical",
    "extractor_fan",
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
      "at": "2026-09-10T22:14:30.930Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:14:41.891Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T22:14:48.263Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T22:15:18.049Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_cfbaf220-95c6-4849-bde2-4d41a2e5b7fc.

- [2.1] reply_sent: **FAIL** - no reply would go: decision pending

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "9f434183-0f02-44c5-a2b3-de0a0451aeb0",
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
  "runId": "run_cfbaf220-95c6-4849-bde2-4d41a2e5b7fc",
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
  "conversationId": "9f434183-0f02-44c5-a2b3-de0a0451aeb0",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "bathroom_electrical",
    "extractor_fan",
    "needs_quote",
    "postcode_received",
    "description_received"
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
      "at": "2026-09-10T22:14:30.930Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:14:41.891Z",
      "content": "Hi Dan, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T22:14:48.263Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T22:15:18.049Z",
      "content": "We're in NG7 2PQ."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-10T22:15:59.121Z",
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

Lines 2.2. Started 2026-09-10T22:16:33.145Z, 129296 ms.

Seed: customer new, name Mel, prefers text false, already rung false, window open. customer: honoured (name "Mel" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_f92a3833-427d-4348-ba91-04fce52d6932.

> Hi Mel, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "b43e8ecf-4188-4d38-90cb-84505dde99dc",
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
  "runId": "run_f92a3833-427d-4348-ba91-04fce52d6932",
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
  "conversationId": "b43e8ecf-4188-4d38-90cb-84505dde99dc",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
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
      "at": "2026-09-10T22:16:38.138Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:16:52.346Z",
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_a0ae0969-47ac-44c3-9d1e-94aa19fa9904. Not landed on the thread by the door.

> Thanks Mel, that helps.
> Could you send a quick photo of the cracked tile so I can see it properly?

- [2.2] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.2] asked_at_most_once: **PASS** - media asked 1 time so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "b43e8ecf-4188-4d38-90cb-84505dde99dc",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Mel, that helps.",
    "Could you send a quick photo of the cracked tile so I can see it properly?"
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
  "runId": "run_a0ae0969-47ac-44c3-9d1e-94aa19fa9904",
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
  "conversationId": "b43e8ecf-4188-4d38-90cb-84505dde99dc",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "postcode_provided",
    "tile_replacement",
    "needs_photos"
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
      "at": "2026-09-10T22:16:38.138Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:16:52.346Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T22:17:01.872Z",
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

Planned send: nothing goes; decision pending; intent confirm_received; window open; template unavailable; approver none; hold none; run run_e1b19c14-611d-4cf5-b2cd-6c03161ea245.

- [2.2] reply_sent: **FAIL** - no reply would go: decision pending
- [2.2] not_asks_subject: **FAIL** - artefact: dry-run reply not landed on thread
- [2.2] asked_at_most_once: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "b43e8ecf-4188-4d38-90cb-84505dde99dc",
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
  "runId": "run_e1b19c14-611d-4cf5-b2cd-6c03161ea245",
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
  "conversationId": "b43e8ecf-4188-4d38-90cb-84505dde99dc",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "first_contact",
    "postcode_provided",
    "tile_replacement",
    "needs_photos",
    "photo_declined",
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
      "at": "2026-09-10T22:16:38.138Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:16:52.346Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T22:17:01.872Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T22:17:28.295Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_ce9672ea-9d64-4cdb-a762-7d1e311e3987.

- [2.2] reply_sent: **FAIL** - no reply would go: decision pending
- [2.2] not_asks_subject: **FAIL** - artefact: dry-run reply not landed on thread
- [2.2] asked_at_most_once: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "b43e8ecf-4188-4d38-90cb-84505dde99dc",
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
  "runId": "run_ce9672ea-9d64-4cdb-a762-7d1e311e3987",
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
  "conversationId": "b43e8ecf-4188-4d38-90cb-84505dde99dc",
  "stage": "scoping",
  "tags": [
    "sandbox",
    "first_contact",
    "postcode_provided",
    "tile_replacement",
    "needs_photos",
    "photo_declined",
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
      "at": "2026-09-10T22:16:38.138Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:16:52.346Z",
      "content": "Hi Mel, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T22:17:01.872Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T22:17:28.295Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-10T22:18:05.320Z",
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

Lines 2.3. Started 2026-09-10T22:18:42.442Z, 91594 ms.

Seed: customer new, name Alex, prefers text false, already rung false, window open. customer: honoured (name "Alex" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_d25321eb-e956-4e4e-8e0b-9b64b2b185c5.

> Hi Alex, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "39644753-1cee-411d-9a7c-fcc41f7aab64",
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
  "runId": "run_d25321eb-e956-4e4e-8e0b-9b64b2b185c5",
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
  "conversationId": "39644753-1cee-411d-9a7c-fcc41f7aab64",
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
      "at": "2026-09-10T22:18:46.428Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:18:58.633Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_3ba0811b-b3d0-445b-8a61-da94cdf153eb.

- [2.3] asks_subject: **FAIL** - no reply would go
- [2.3] own_words: **FAIL** - no reply would go
  - model judge (beside, not instead): claude-haiku-4-5, prompt 153f36d8fd03, verdict **skipped** - no reply to judge

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "39644753-1cee-411d-9a7c-fcc41f7aab64",
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
  "runId": "run_3ba0811b-b3d0-445b-8a61-da94cdf153eb",
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
  "conversationId": "39644753-1cee-411d-9a7c-fcc41f7aab64",
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
      "at": "2026-09-10T22:18:46.428Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:18:58.633Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T22:19:07.837Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_5e5ec23a-496d-44e9-8827-79986a15bd88. Not landed on the thread by the door.

> Got it, loose spindles at the top making it rock, thanks Alex.
> Could you send a quick photo or video of the bannister, plus the sticking door and the tap?
> That'll help us scope all three properly.

- [2.3] own_words: **PASS** - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)
  - model judge (beside, not instead): claude-haiku-4-5, prompt 5c7817bc5130, verdict **no** - The reply asks for photos of three different issues (bannister, sticking door, tap) at once, but the customer only mentioned the bannister problem, making it read like a template rather than a natural response to what was actually said.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "39644753-1cee-411d-9a7c-fcc41f7aab64",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Got it, loose spindles at the top making it rock, thanks Alex.",
    "Could you send a quick photo or video of the bannister, plus the sticking door and the tap?",
    "That'll help us scope all three properly."
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
  "runId": "run_5e5ec23a-496d-44e9-8827-79986a15bd88",
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
  "conversationId": "39644753-1cee-411d-9a7c-fcc41f7aab64",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
    "multiple_jobs",
    "postcode_provided",
    "clarification_needed",
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
      "at": "2026-09-10T22:18:46.428Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:18:58.633Z",
      "content": "Hi Alex, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T22:19:07.837Z",
      "content": "Which one do you want to know about first?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-10T22:19:46.893Z",
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

Lines 2.4. Started 2026-09-10T22:20:14.036Z, 70550 ms.

Seed: customer new, name Chris, prefers text false, already rung false, window open. customer: honoured (name "Chris" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_148c665b-cfbf-4176-9bc9-617075b3b017.

> Hi Chris, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "6fe35459-7974-4974-945a-7e581e1d6364",
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
  "runId": "run_148c665b-cfbf-4176-9bc9-617075b3b017",
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
  "conversationId": "6fe35459-7974-4974-945a-7e581e1d6364",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "gate_repair",
    "dropped",
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
      "at": "2026-09-10T22:20:18.682Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:20:31.849Z",
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

Planned send: nothing goes; decision none; intent unknown; window open; template unavailable; approver none; hold none; run run_d27ea6f3-ca1c-4218-b714-a086f1483d1a.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "6fe35459-7974-4974-945a-7e581e1d6364",
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
  "runId": "run_d27ea6f3-ca1c-4218-b714-a086f1483d1a",
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
  "conversationId": "6fe35459-7974-4974-945a-7e581e1d6364",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "gate_repair",
    "dropped",
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
      "at": "2026-09-10T22:20:18.682Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:20:31.849Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T22:20:38.040Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_90007cc6-db4e-4e8d-be6f-0c2c362b8714. Not landed on the thread by the door.

> Ah, that'll do it if the post's gone at the base.
> Could you send a photo of the post where it's rotted, and one of the whole gate?
> That'll help me see what we're dealing with.

- [2.4] reply_sent: **PASS** - a reply would go (3 bubbles, desk)
- [2.4] asks_subject: **PASS** - the reply asks about any

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "6fe35459-7974-4974-945a-7e581e1d6364",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Ah, that'll do it if the post's gone at the base.",
    "Could you send a photo of the post where it's rotted, and one of the whole gate?",
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
  "runId": "run_90007cc6-db4e-4e8d-be6f-0c2c362b8714",
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
  "conversationId": "6fe35459-7974-4974-945a-7e581e1d6364",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "gate_repair",
    "dropped",
    "postcode_provided",
    "awaiting_response",
    "needs_photos",
    "wooden_gate",
    "structural"
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
      "at": "2026-09-10T22:20:18.682Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:20:31.849Z",
      "content": "Hi Chris, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T22:20:38.040Z",
      "content": "one sec, let me check"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-10T22:20:59.059Z",
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

Lines 2.5. Started 2026-09-10T22:21:24.586Z, 129413 ms.

Seed: customer new, name Sara, prefers text false, already rung false, window open. customer: honoured (name "Sara" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_f4b9bc63-c0c5-4e7c-bc74-98fe4e685569.

> Hi Sara, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "da828012-e0b0-4b25-a9c2-19120b3bf26b",
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
  "runId": "run_f4b9bc63-c0c5-4e7c-bc74-98fe4e685569",
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
  "conversationId": "da828012-e0b0-4b25-a9c2-19120b3bf26b",
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
      "at": "2026-09-10T22:21:30.233Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:21:43.278Z",
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

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_777cd40d-cd81-46e6-9f98-66f20a17cf2d.

- [2.5] reply_sent: **FAIL** - no reply would go: decision none
- [2.5] bubble_count_within: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "da828012-e0b0-4b25-a9c2-19120b3bf26b",
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
  "runId": "run_777cd40d-cd81-46e6-9f98-66f20a17cf2d",
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
  "conversationId": "da828012-e0b0-4b25-a9c2-19120b3bf26b",
  "stage": "scoping",
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
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T22:21:30.233Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:21:43.278Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T22:21:50.287Z",
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

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_0d402780-8a50-480c-80ed-9a8c550990c2.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "da828012-e0b0-4b25-a9c2-19120b3bf26b",
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
  "runId": "run_0d402780-8a50-480c-80ed-9a8c550990c2",
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
  "conversationId": "da828012-e0b0-4b25-a9c2-19120b3bf26b",
  "stage": "scoping",
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
      "at": "2026-09-10T22:21:30.233Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:21:43.278Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T22:21:50.287Z",
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

Planned send: nothing goes; decision none; intent holding; window open; template unavailable; approver none; hold none; run run_a3ffc719-6a8d-4a9a-a91d-37462cf3235f.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "da828012-e0b0-4b25-a9c2-19120b3bf26b",
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
  "runId": "run_a3ffc719-6a8d-4a9a-a91d-37462cf3235f",
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
  "conversationId": "da828012-e0b0-4b25-a9c2-19120b3bf26b",
  "stage": "scoping",
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
      "at": "2026-09-10T22:21:30.233Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:21:43.278Z",
      "content": "Hi Sara, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-10T22:21:50.287Z",
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

Lines 2.6. Started 2026-09-10T22:23:33.999Z, 47270 ms.

Seed: customer new, name Tom, prefers text false, already rung false, window open. customer: honoured (name "Tom" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_d18972f5-269b-43ce-a7ab-d8777eebd55f.

> Hi Tom, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "587ab5be-018d-4c1c-8374-101104687eb8",
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
  "runId": "run_d18972f5-269b-43ce-a7ab-d8777eebd55f",
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
  "conversationId": "587ab5be-018d-4c1c-8374-101104687eb8",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "first_contact",
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
      "at": "2026-09-10T22:23:37.986Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:23:49.658Z",
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

Planned send: nothing goes; decision pending; intent ask_gap; window open; template unavailable; approver none; hold none; run run_8093e967-bbff-462f-be73-9fa0ff114244.

- [2.6] reply_sent: **FAIL** - no reply would go: decision pending
- [2.6] no_date: **PASS** - no date, time or duration in the reply
- [2.6] text_matches: **FAIL** - no reply would go
- [2.6] asks_subject: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "587ab5be-018d-4c1c-8374-101104687eb8",
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
  "runId": "run_8093e967-bbff-462f-be73-9fa0ff114244",
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
  "conversationId": "587ab5be-018d-4c1c-8374-101104687eb8",
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
    "summary": "OPEN — last customer WhatsApp 0 min ago; shuts 24.0 h from now"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T22:23:37.986Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:23:49.658Z",
      "content": "Hi Tom, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-10T22:23:56.726Z",
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

Lines 2.7. Started 2026-09-10T22:24:21.270Z, 34706 ms.

Seed: customer new, name Nina, prefers text false, already rung false, window open. customer: honoured (name "Nina" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA.

Planned send: 2 bubbles (rules_layer_mirror); decision none; intent ack_enquiry; window open; template none; approver rules_layer; hold none; run run_2e7ce642-5885-436c-9c34-d18b15260247.

> Hi Nina, thanks for getting in touch.
> You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "adb6cc55-0459-4106-8a47-9057a5aef7dd",
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
  "runId": "run_2e7ce642-5885-436c-9c34-d18b15260247",
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
  "conversationId": "adb6cc55-0459-4106-8a47-9057a5aef7dd",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "materials_supplied",
    "kitchen_tap"
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
      "at": "2026-09-10T22:24:25.765Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:24:38.958Z",
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

Planned send: nothing goes; decision flag; intent unknown; window open; template unavailable; approver none; hold ben (money_question); run run_e5cb136d-7558-497f-92b7-44e2597ea554.

- [2.7] hold_for_approver: **PASS** - held for ben: money_question
- [2.7] no_figure: **PASS** - no figure in the reply

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "adb6cc55-0459-4106-8a47-9057a5aef7dd",
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
  "runId": "run_e5cb136d-7558-497f-92b7-44e2597ea554",
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
  "conversationId": "adb6cc55-0459-4106-8a47-9057a5aef7dd",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "postcode_provided",
    "materials_supplied",
    "kitchen_tap"
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
      "at": "2026-09-10T22:24:25.765Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "Sandbox (rules layer ack, mirrored, never sent)",
      "at": "2026-09-10T22:24:38.958Z",
      "content": "Hi Nina, thanks for getting in touch.\n---\nYou've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-10T22:24:44.784Z",
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

Lines 2.8. Started 2026-09-10T22:24:55.976Z, 93593 ms.

Seed: customer new, name Lee, prefers text false, already rung false, window open. customer: honoured (name "Lee" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need an internal door rehung, it's catching on the frame. We're in NG9.

Planned send: nothing goes; decision none; intent ask_postcode; window open; template unavailable; approver none; hold none; run run_e685ef8b-e0e2-4cf4-8f7a-73c1eaf907db.

- [2.8] reply_sent: **FAIL** - no reply would go: decision none
- [2.8] bubble_count_within: **FAIL** - no reply would go

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "14fd66de-cca5-4412-8765-f2af05460436",
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
  "runId": "run_e685ef8b-e0e2-4cf4-8f7a-73c1eaf907db",
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
  "conversationId": "14fd66de-cca5-4412-8765-f2af05460436",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehung",
    "postcode_provided"
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
      "at": "2026-09-10T22:25:00.899Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_aac241b3-25b4-4fe6-8e4c-57f36f8fe3f2. Not landed on the thread by the door.

> Hiya, thanks for the message.
> Could you send a quick video of where the door is catching on the frame?

- [2.8] reply_not_sent: **FAIL** - a reply would go (desk): Hiya, thanks for the message.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "14fd66de-cca5-4412-8765-f2af05460436",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya, thanks for the message.",
    "Could you send a quick video of where the door is catching on the frame?"
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
  "runId": "run_aac241b3-25b4-4fe6-8e4c-57f36f8fe3f2",
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
  "conversationId": "14fd66de-cca5-4412-8765-f2af05460436",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehung",
    "postcode_provided",
    "needs_photos"
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
      "at": "2026-09-10T22:25:00.899Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
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

Planned send: 2 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_d31348f0-f81b-40d5-a044-91405d0a9a56. Not landed on the thread by the door.

> Hiya Lee, thanks for that. Sounds like a straightforward rehang.
> Could you send a quick photo or video of where it's catching on the frame?

- [2.8] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "14fd66de-cca5-4412-8765-f2af05460436",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya Lee, thanks for that. Sounds like a straightforward rehang.",
    "Could you send a quick photo or video of where it's catching on the frame?"
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
  "runId": "run_d31348f0-f81b-40d5-a044-91405d0a9a56",
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
  "conversationId": "14fd66de-cca5-4412-8765-f2af05460436",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehung",
    "postcode_provided",
    "needs_photos",
    "upstairs_bathroom"
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
      "at": "2026-09-10T22:25:00.899Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T22:25:40.301Z",
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

Planned send: 3 bubbles (desk); decision send; intent ask_gap; window open; template none; approver agent.scoper; hold none; run run_01ac1f7b-dccf-47a8-9d2a-25b3e5577305. Not landed on the thread by the door.

> Hiya Lee, thanks for that.
> Could you send a quick video or photo of the door where it's catching the frame?
> That'll help me see what's needed to sort it.

- [2.8] reply_not_sent: **FAIL** - artefact: dry-run reply not landed on thread

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "14fd66de-cca5-4412-8765-f2af05460436",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hiya Lee, thanks for that.",
    "Could you send a quick video or photo of the door where it's catching the frame?",
    "That'll help me see what's needed to sort it."
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
  "runId": "run_01ac1f7b-dccf-47a8-9d2a-25b3e5577305",
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
  "conversationId": "14fd66de-cca5-4412-8765-f2af05460436",
  "stage": "enquiry",
  "tags": [
    "sandbox",
    "door_rehung",
    "postcode_provided",
    "needs_photos",
    "upstairs_bathroom"
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
      "at": "2026-09-10T22:25:00.899Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-10T22:25:40.301Z",
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

