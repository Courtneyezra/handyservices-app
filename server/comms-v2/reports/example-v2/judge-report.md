# Comms v2 judge report

Generated 2026-09-11T01:25:30.832Z. Desk: new desk (server/comms-v2/desk via its sandbox door, dry run). Door: in_process at 127.0.0.1:54848. Runs: 2.

Lines: 11 pass, 0 fail, 0 error. Exit code 0 (non-zero only on an error; a fail is not an error).

A line passes only when every expectation on it passes in every run. Goal 1 is done when every line passes in both runs against the new desk.

## Lines

| Line | Expected | Result | Run 1 | Run 2 |
|---|---|---|---|---|
| 1.1 | The customer's first WhatsApp message gets one acknowledgement that quotes their enquiry back and offers a call, freeform. | **PASS** | PASS | PASS |
| 1.6 | A customer who has said text-only is never asked for a call again. | **PASS** | PASS | PASS |
| 1.7 | Photos arriving with the first message are acknowledged as photos, not as a bare enquiry. | **PASS** | PASS | PASS |
| 2.1 | It replies to every customer turn, whether or not the reply is a question. | **PASS** | PASS | PASS |
| 2.2 | It asks for a photo once. If they reply without sending one, it proceeds. | **PASS** | PASS | PASS |
| 2.3 | It asks about the job one thing at a time, in its own words. | **PASS** | PASS | PASS |
| 2.4 | A short pause ("one sec") does not stop it. | **PASS** | PASS | PASS |
| 2.5 | A real promise ("I'll send photos tomorrow") gets one acknowledgement, then quiet until they write. | **PASS** | PASS | PASS |
| 2.6 | A date question gets "dates come with your quote" and scoping continues. No lead-time guess. | **PASS** | PASS | PASS |
| 2.7 | Anything about money goes to Ben, not answered. | **PASS** | PASS | PASS |
| 2.8 | It never sends a second reply without the customer writing in between. | **PASS** | PASS | PASS |

### Line 1.1: PASS

The customer's first WhatsApp message gets one acknowledgement that quotes their enquiry back and offers a call, freeform.

Run 1: PASS

- 1.1-inbound-whatsapp turn 1 reply_sent: pass - a reply would go (3 bubbles, desk)
- 1.1-inbound-whatsapp turn 1 text_matches: pass - matches /\btap\b/: "tap"
- 1.1-inbound-whatsapp turn 1 offers_call: pass - the reply offers a call
- 1.1-inbound-whatsapp turn 1 freeform: pass - freeform, no template
- 1.1-inbound-whatsapp turn 1 bubble_count_within: pass - 3 bubbles, ceiling 4

Run 2: PASS

- 1.1-inbound-whatsapp turn 1 reply_sent: pass - a reply would go (3 bubbles, desk)
- 1.1-inbound-whatsapp turn 1 text_matches: pass - matches /\btap\b/: "tap"
- 1.1-inbound-whatsapp turn 1 offers_call: pass - the reply offers a call
- 1.1-inbound-whatsapp turn 1 freeform: pass - freeform, no template
- 1.1-inbound-whatsapp turn 1 bubble_count_within: pass - 3 bubbles, ceiling 4

### Line 1.6: PASS

A customer who has said text-only is never asked for a call again.

Run 1: PASS

- 1.6-prefers-text turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 1.6-prefers-text turn 2 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 1.6-prefers-text turn 3 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 4 reply_sent: pass - a reply would go (3 bubbles, desk)
- 1.6-prefers-text turn 4 not_offers_call: pass - the reply does not offer a call

Run 2: PASS

- 1.6-prefers-text turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 1.6-prefers-text turn 2 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 1.6-prefers-text turn 3 not_offers_call: pass - the reply does not offer a call
- 1.6-prefers-text turn 4 reply_sent: pass - a reply would go (3 bubbles, desk)
- 1.6-prefers-text turn 4 not_offers_call: pass - the reply does not offer a call

### Line 1.7: PASS

Photos arriving with the first message are acknowledged as photos, not as a bare enquiry.

Run 1: PASS

- 1.7-photos-first turn 1 reply_sent: pass - a reply would go (4 bubbles, desk)
- 1.7-photos-first turn 1 text_matches: pass - matches /\b(?:photo|photos|picture|pictures|pic|pics|image|images|snap)\b/: "picture"

Run 2: PASS

- 1.7-photos-first turn 1 reply_sent: pass - a reply would go (4 bubbles, desk)
- 1.7-photos-first turn 1 text_matches: pass - matches /\b(?:photo|photos|picture|pictures|pic|pics|image|images|snap)\b/: "picture"

### Line 2.1: PASS

It replies to every customer turn, whether or not the reply is a question.

Run 1: PASS

- 2.1-replies-to-statements turn 1 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.1-replies-to-statements turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.1-replies-to-statements turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.1-replies-to-statements turn 4 reply_sent: pass - a reply would go (2 bubbles, desk)

Run 2: PASS

- 2.1-replies-to-statements turn 1 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.1-replies-to-statements turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.1-replies-to-statements turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.1-replies-to-statements turn 4 reply_sent: pass - a reply would go (2 bubbles, desk)

### Line 2.2: PASS

It asks for a photo once. If they reply without sending one, it proceeds.

Run 1: PASS

- 2.2-photo-once turn 1 asked_at_most_once: pass - media asked 0 times so far
- 2.2-photo-once turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.2-photo-once turn 2 asked_at_most_once: pass - media asked 0 times so far
- 2.2-photo-once turn 3 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.2-photo-once turn 3 not_asks_subject: pass - the reply does not ask about media
- 2.2-photo-once turn 3 asked_at_most_once: pass - media asked 0 times so far
- 2.2-photo-once turn 4 reply_sent: pass - a reply would go (1 bubble, desk)
- 2.2-photo-once turn 4 not_asks_subject: pass - the reply does not ask about media
- 2.2-photo-once turn 4 asked_at_most_once: pass - media asked 0 times so far

Run 2: PASS

- 2.2-photo-once turn 1 asked_at_most_once: pass - media asked 0 times so far
- 2.2-photo-once turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.2-photo-once turn 2 asked_at_most_once: pass - media asked 0 times so far
- 2.2-photo-once turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.2-photo-once turn 3 not_asks_subject: pass - the reply does not ask about media
- 2.2-photo-once turn 3 asked_at_most_once: pass - media asked 0 times so far
- 2.2-photo-once turn 4 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.2-photo-once turn 4 not_asks_subject: pass - the reply does not ask about media
- 2.2-photo-once turn 4 asked_at_most_once: pass - media asked 0 times so far

### Line 2.3: PASS

It asks about the job one thing at a time, in its own words.

Run 1: PASS

- 2.3-own-words turn 2 asks_subject: pass - the reply asks about any
- 2.3-own-words turn 2 own_words: pass - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this) [model claude-haiku-4-5: yes - The reply naturally prioritizes one issue (bannister), asks a specific follow-up question about that particular problem, and commits to handling remaining items sequentially—conversational and tailored to the customer's multi-issue situation.]
- 2.3-own-words turn 3 own_words: pass - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this) [model claude-haiku-4-5: no - The reply jumps to a completely different job (a sticking door) without addressing the bannister issue, ignoring what the customer said and treating it like a template checklist rather than a natural conversation.]

Run 2: PASS

- 2.3-own-words turn 2 asks_subject: pass - the reply asks about any
- 2.3-own-words turn 2 own_words: pass - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this) [model claude-haiku-4-5: yes - The reply is natural and conversational, picks one specific item the customer mentioned (bannister), and asks one clarifying question about what 'wobbly' means rather than using a template.]
- 2.3-own-words turn 3 own_words: pass - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this) [model claude-haiku-4-5: no - The reply acknowledges the bannister issue well in bubble 1, but bubble 2 abruptly shifts to a completely different problem (a door) without finishing the bannister discussion or asking a natural follow-up question about it.]

### Line 2.4: PASS

A short pause ("one sec") does not stop it.

Run 1: PASS

- 2.4-short-pause turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.4-short-pause turn 3 asks_subject: pass - the reply asks about any

Run 2: PASS

- 2.4-short-pause turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.4-short-pause turn 3 asks_subject: pass - the reply asks about any

### Line 2.5: PASS

A real promise ("I'll send photos tomorrow") gets one acknowledgement, then quiet until they write.

Run 1: PASS

- 2.5-promise-then-quiet turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.5-promise-then-quiet turn 2 bubble_count_within: pass - 2 bubbles, ceiling 4
- 2.5-promise-then-quiet turn 3 reply_not_sent: pass - nothing goes: decision none
- 2.5-promise-then-quiet turn 4 reply_not_sent: pass - nothing goes: decision none

Run 2: PASS

- 2.5-promise-then-quiet turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.5-promise-then-quiet turn 2 bubble_count_within: pass - 2 bubbles, ceiling 4
- 2.5-promise-then-quiet turn 3 reply_not_sent: pass - nothing goes: decision none
- 2.5-promise-then-quiet turn 4 reply_not_sent: pass - nothing goes: decision none

### Line 2.6: PASS

A date question gets "dates come with your quote" and scoping continues. No lead-time guess.

Run 1: PASS

- 2.6-date-question turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.6-date-question turn 2 no_date: pass - no date, time or duration in the reply
- 2.6-date-question turn 2 text_matches: pass - matches /\bquote\b/: "quote"
- 2.6-date-question turn 2 asks_subject: pass - the reply asks about any

Run 2: PASS

- 2.6-date-question turn 2 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.6-date-question turn 2 no_date: pass - no date, time or duration in the reply
- 2.6-date-question turn 2 text_matches: pass - matches /\bquote\b/: "quote"
- 2.6-date-question turn 2 asks_subject: pass - the reply asks about any

### Line 2.7: PASS

Anything about money goes to Ben, not answered.

Run 1: PASS

- 2.7-money-to-ben turn 2 hold_for_approver: pass - held for ben: money: How much
- 2.7-money-to-ben turn 2 no_figure: pass - no figure in the reply

Run 2: PASS

- 2.7-money-to-ben turn 2 hold_for_approver: pass - held for ben: money: How much
- 2.7-money-to-ben turn 2 no_figure: pass - no figure in the reply

### Line 2.8: PASS

It never sends a second reply without the customer writing in between.

Run 1: PASS

- 2.8-one-reply-per-turn turn 1 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.8-one-reply-per-turn turn 1 bubble_count_within: pass - 3 bubbles, ceiling 4
- 2.8-one-reply-per-turn turn 2 reply_not_sent: pass - nothing goes: decision none
- 2.8-one-reply-per-turn turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.8-one-reply-per-turn turn 4 reply_not_sent: pass - nothing goes: decision none

Run 2: PASS

- 2.8-one-reply-per-turn turn 1 reply_sent: pass - a reply would go (3 bubbles, desk)
- 2.8-one-reply-per-turn turn 1 bubble_count_within: pass - 3 bubbles, ceiling 4
- 2.8-one-reply-per-turn turn 2 reply_not_sent: pass - nothing goes: decision none
- 2.8-one-reply-per-turn turn 3 reply_sent: pass - a reply would go (2 bubbles, desk)
- 2.8-one-reply-per-turn turn 4 reply_not_sent: pass - nothing goes: decision none

## Scenarios, turn by turn

### 1.1-inbound-whatsapp run 1: Inbound WhatsApp: the opening message gets one freeform acknowledgement that quotes the enquiry back and offers a call

Lines 1.1. Started 2026-09-11T01:13:55.863Z, 9288 ms.

Seed: customer new, name Sam, prefers text false, already rung false, window open. customer: honoured (name "Sam" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (tap type, how old the tap is); call yes; photos mention; ready no; window open; template none; approver agent.comms_v2; hold none; run run_9f795e3b-c0a5-4286-b2cc-fe997941f8c4.

> Hi Sam, thanks for getting in touch - a leaking kitchen tap dripping from the base that won't stop, got it.
> Do you know what type of tap it is, and roughly how old it is? Even a rough idea helps.
> If it's easy, a quick photo of the tap would help too, no pressure. Happy to give you a quick call if that's easier.

- [1.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)
- [1.1] text_matches: **PASS** - matches /\btap\b/: "tap"
- [1.1] offers_call: **PASS** - the reply offers a call
- [1.1] freeform: **PASS** - freeform, no template
- [1.1] bubble_count_within: **PASS** - 3 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_eb10d480-a779-45bc-8892-4a490f8f2df4",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sam"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Sam, thanks for getting in touch - a leaking kitchen tap dripping from the base that won't stop, got it.",
    "Do you know what type of tap it is, and roughly how old it is? Even a rough idea helps.",
    "If it's easy, a quick photo of the tap would help too, no pressure. Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_fdc8c7f4-c6d1-4038-a729-20a0c2038f47",
    "fact_e6f07e00-c225-4fb8-b8a9-572f6c67d5f0"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_9f795e3b-c0a5-4286-b2cc-fe997941f8c4",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (tap type, how old the tap is); call yes; photos mention; ready no",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "scoping",
    "exitNote": null,
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
  "conversationId": "case_eb10d480-a779-45bc-8892-4a490f8f2df4",
  "stage": "scoping",
  "tags": [],
  "contactName": "Sam",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:13:55.883Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sam",
      "at": "2026-09-11T01:13:55.883Z",
      "content": "Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:05.143Z",
      "content": "Hi Sam, thanks for getting in touch - a leaking kitchen tap dripping from the base that won't stop, got it.\nDo you know what type of tap it is, and roughly how old it is? Even a rough idea helps.\nIf it's easy, a quick photo of the tap would help too, no pressure. Happy to give you a quick call if th"
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

Lines 1.6. Started 2026-09-11T01:14:05.151Z, 53616 ms.

Seed: customer new, name Jo, prefers text true, already rung false, window open. prefersText: honoured (a prefers_text fact on the case file, source seed); customer: honoured (name "Jo" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (panel size, fence type/material, how many panels); call no; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_ef142b98-e625-46b4-9f1a-737853818749.

> Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.
> Roughly what size is the panel?
> If it's easy, a quick photo of the fence would help too, no pressure.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_4b7af7eb-d803-4ad9-a8c3-23838e8bcca3",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.",
    "Roughly what size is the panel?",
    "If it's easy, a quick photo of the fence would help too, no pressure."
  ],
  "factIds": [
    "fact_91c2fbb1-47f0-4ac0-9612-63c9b02afc0c",
    "fact_1f3b87c0-ed59-47d5-82c7-53391f72a0b1",
    "fact_613d2297-95e6-409b-8f79-35f7ea7c47dd"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_ef142b98-e625-46b4-9f1a-737853818749",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (panel size, fence type/material, how many panels); call no; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_4b7af7eb-d803-4ad9-a8c3-23838e8bcca3",
  "stage": "ready",
  "tags": [],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:14:05.153Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:14:05.153Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:15.642Z",
      "content": "Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.\nRoughly what size is the panel?\nIf it's easy, a quick photo of the fence would help too, no pressure."
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

Planned send: 2 bubbles (desk); decision send; intent turn decline; subjects scoping; exception none; ask access; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_77215bdb-077c-48f0-98ef-f384c08f846a.

> No problem at all Jo, text is fine - we'll keep it to messages.
> On the fence panel at the back in Beeston, is there parking nearby or easy access round to the back of the house?

- [1.6] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_4b7af7eb-d803-4ad9-a8c3-23838e8bcca3",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No problem at all Jo, text is fine - we'll keep it to messages.",
    "On the fence panel at the back in Beeston, is there parking nearby or easy access round to the back of the house?"
  ],
  "factIds": [
    "fact_613d2297-95e6-409b-8f79-35f7ea7c47dd",
    "fact_91c2fbb1-47f0-4ac0-9612-63c9b02afc0c",
    "fact_1f3b87c0-ed59-47d5-82c7-53391f72a0b1"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_77215bdb-077c-48f0-98ef-f384c08f846a",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn decline; subjects scoping; exception none; ask access; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_4b7af7eb-d803-4ad9-a8c3-23838e8bcca3",
  "stage": "ready",
  "tags": [],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:14:15.649Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:14:05.153Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:15.642Z",
      "content": "Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.\nRoughly what size is the panel?\nIf it's easy, a quick photo of the fence would help too, no pressure."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:14:15.649Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:26.000Z",
      "content": "No problem at all Jo, text is fine - we'll keep it to messages.\nOn the fence panel at the back in Beeston, is there parking nearby or easy access round to the back of the house?"
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask none; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_057a1f8e-93bf-4fec-a9de-25f90bd9e3e5.

> Thanks Jo, that's really helpful - one 6ft panel to replace at the back in Beeston, posts all fine, and you're at NG9 2AB.
> That's everything needed for now. Ben will put the quote together and send it over to you by message.

- [1.6] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_4b7af7eb-d803-4ad9-a8c3-23838e8bcca3",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Jo, that's really helpful - one 6ft panel to replace at the back in Beeston, posts all fine, and you're at NG9 2AB.",
    "That's everything needed for now. Ben will put the quote together and send it over to you by message."
  ],
  "factIds": [
    "fact_04924ae9-ac70-44fe-a512-ae6aba0574bb",
    "fact_f64a3ba8-1f82-4eea-bb16-9a6354610136",
    "fact_64ad81c3-ccea-4cbd-8204-d16bca776d97",
    "fact_1f3b87c0-ed59-47d5-82c7-53391f72a0b1",
    "fact_9703795d-04d7-4e15-83a3-0710a446909a",
    "fact_613d2297-95e6-409b-8f79-35f7ea7c47dd"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_057a1f8e-93bf-4fec-a9de-25f90bd9e3e5",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask none; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_4b7af7eb-d803-4ad9-a8c3-23838e8bcca3",
  "stage": "ready",
  "tags": [],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:14:26.004Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:14:05.153Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:15.642Z",
      "content": "Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.\nRoughly what size is the panel?\nIf it's easy, a quick photo of the fence would help too, no pressure."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:14:15.649Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:26.000Z",
      "content": "No problem at all Jo, text is fine - we'll keep it to messages.\nOn the fence panel at the back in Beeston, is there parking nearby or easy access round to the back of the house?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:14:26.004Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:40.024Z",
      "content": "Thanks Jo, that's really helpful - one 6ft panel to replace at the back in Beeston, posts all fine, and you're at NG9 2AB.\nThat's everything needed for now. Ben will put the quote together and send it over to you by message."
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

Planned send: 3 bubbles (desk); decision send; intent turn question; subjects scoping; exception none; ask job (access); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_825e902e-fe0f-4c0b-b778-f560eb4f58f3.

> No, nothing else needed from you for now Jo - thanks for asking.
> We've got it all down: one 6ft fence panel to replace at the back in Beeston, posts fine, NG9 2AB.
> Ben will put the quote together and send it over to you by message.

- [1.6] reply_sent: **PASS** - a reply would go (3 bubbles, desk)
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_4b7af7eb-d803-4ad9-a8c3-23838e8bcca3",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No, nothing else needed from you for now Jo - thanks for asking.",
    "We've got it all down: one 6ft fence panel to replace at the back in Beeston, posts fine, NG9 2AB.",
    "Ben will put the quote together and send it over to you by message."
  ],
  "factIds": [
    "fact_04924ae9-ac70-44fe-a512-ae6aba0574bb",
    "fact_f64a3ba8-1f82-4eea-bb16-9a6354610136",
    "fact_64ad81c3-ccea-4cbd-8204-d16bca776d97",
    "fact_1f3b87c0-ed59-47d5-82c7-53391f72a0b1",
    "fact_9703795d-04d7-4e15-83a3-0710a446909a",
    "fact_613d2297-95e6-409b-8f79-35f7ea7c47dd"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_825e902e-fe0f-4c0b-b778-f560eb4f58f3",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn question; subjects scoping; exception none; ask job (access); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_4b7af7eb-d803-4ad9-a8c3-23838e8bcca3",
  "stage": "ready",
  "tags": [],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:14:40.030Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:14:05.153Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:15.642Z",
      "content": "Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.\nRoughly what size is the panel?\nIf it's easy, a quick photo of the fence would help too, no pressure."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:14:15.649Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:26.000Z",
      "content": "No problem at all Jo, text is fine - we'll keep it to messages.\nOn the fence panel at the back in Beeston, is there parking nearby or easy access round to the back of the house?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:14:26.004Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:40.024Z",
      "content": "Thanks Jo, that's really helpful - one 6ft panel to replace at the back in Beeston, posts all fine, and you're at NG9 2AB.\nThat's everything needed for now. Ben will put the quote together and send it over to you by message."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:14:40.030Z",
      "content": "Do you need anything else from me?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:14:58.763Z",
      "content": "No, nothing else needed from you for now Jo - thanks for asking.\nWe've got it all down: one 6ft fence panel to replace at the back in Beeston, posts fine, NG9 2AB.\nBen will put the quote together and send it over to you by message."
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

Lines 1.7. Started 2026-09-11T01:14:58.767Z, 14478 ms.

Seed: customer new, name Priya, prefers text false, already rung false, window open. customer: honoured (name "Priya" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it? [+1 media]

Planned send: 4 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (tap brand/model, actual leak source, access under sink); call yes; photos thank; ready no; window open; template none; approver agent.comms_v2; hold none; run run_0b8733c8-5178-46d0-ab3e-6e6c4e5646ff.

> Hi, thanks for getting in touch - a leaking tap under the kitchen sink, got it.
> Thanks for the picture too, though it looks like it's come through as a little drawing of a dripping tap rather than the real thing.
> Can you tell me where exactly the water's coming from - the tap itself or the pipework underneath?
> Happy to give you a quick call if that's easier.

- [1.7] reply_sent: **PASS** - a reply would go (4 bubbles, desk)
- [1.7] text_matches: **PASS** - matches /\b(?:photo|photos|picture|pictures|pic|pics|image|images|snap)\b/: "picture"

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_5e46eaec-1dfa-48af-9340-47e1ecf61578",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": null
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi, thanks for getting in touch - a leaking tap under the kitchen sink, got it.",
    "Thanks for the picture too, though it looks like it's come through as a little drawing of a dripping tap rather than the real thing.",
    "Can you tell me where exactly the water's coming from - the tap itself or the pipework underneath?",
    "Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_092f8b77-11c2-4b02-b951-5c7e6f0a8c7e",
    "fact_22d81939-ec42-4749-b5f0-df091bb1d4f5"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_0b8733c8-5178-46d0-ab3e-6e6c4e5646ff",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (tap brand/model, actual leak source, access under sink); call yes; photos thank; ready no",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "scoping",
    "exitNote": null,
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
  "conversationId": "case_5e46eaec-1dfa-48af-9340-47e1ecf61578",
  "stage": "scoping",
  "tags": [],
  "contactName": null,
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:14:58.784Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": null,
      "at": "2026-09-11T01:14:58.784Z",
      "content": "Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:15:13.240Z",
      "content": "Hi, thanks for getting in touch - a leaking tap under the kitchen sink, got it.\nThanks for the picture too, though it looks like it's come through as a little drawing of a dripping tap rather than the real thing.\nCan you tell me where exactly the water's coming from - the tap itself or the pipework "
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

Lines 2.1. Started 2026-09-11T01:15:13.245Z, 47896 ms.

Seed: customer new, name Dan, prefers text false, already rung false, window open. customer: honoured (name "Dan" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my bathroom extractor fan has stopped working, can you sort it?

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (fan type/model, ducted or ceiling unit, how it fails (noise/no power), postcode); call yes; photos mention; ready no; window open; template none; approver agent.comms_v2; hold none; run run_80eaf340-9f99-4982-b439-696281f9f12a.

> Hi Dan, thanks for getting in touch - bathroom extractor fan that's stopped working, got it.
> Quick one so Ben's got the picture: when you switch it on, is it completely dead or does it still make any noise at all?
> If it's easy, a photo of the fan would help too, no pressure. Happy to give you a quick call if that's easier.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_23580ecb-62a9-43ac-b1a1-059c39094ad1",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Dan, thanks for getting in touch - bathroom extractor fan that's stopped working, got it.",
    "Quick one so Ben's got the picture: when you switch it on, is it completely dead or does it still make any noise at all?",
    "If it's easy, a photo of the fan would help too, no pressure. Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_19ae2fa6-342e-4407-b11a-8cc9f0a066fa"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_80eaf340-9f99-4982-b439-696281f9f12a",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (fan type/model, ducted or ceiling unit, how it fails (noise/no power), postcode); call yes; photos mention; ready no",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "scoping",
    "exitNote": null,
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
  "conversationId": "case_23580ecb-62a9-43ac-b1a1-059c39094ad1",
  "stage": "scoping",
  "tags": [],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:15:13.249Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:15:13.249Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:15:25.990Z",
      "content": "Hi Dan, thanks for getting in touch - bathroom extractor fan that's stopped working, got it.\nQuick one so Ben's got the picture: when you switch it on, is it completely dead or does it still make any noise at all?\nIf it's easy, a photo of the fan would help too, no pressure. Happy to give you a quic"
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask job (ducting/venting type, fan brand or model, photo of fan); call no; photos no; ready no; window open; template none; approver agent.comms_v2; hold none; run run_a078f03a-acc5-49ea-8511-3f72ed3b6ec1.

> Thanks Dan, that's helpful - a four inch ceiling fan, light still working but the fan itself dead, got it.
> One more for Ben: is there a brand or model name anywhere on the fan cover?

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_23580ecb-62a9-43ac-b1a1-059c39094ad1",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Dan, that's helpful - a four inch ceiling fan, light still working but the fan itself dead, got it.",
    "One more for Ben: is there a brand or model name anywhere on the fan cover?"
  ],
  "factIds": [
    "fact_19ae2fa6-342e-4407-b11a-8cc9f0a066fa",
    "fact_fab1250a-ee67-4947-adda-03285f7c45da",
    "fact_c3af9bee-13d4-4977-b086-062701e72f5e"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_a078f03a-acc5-49ea-8511-3f72ed3b6ec1",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask job (ducting/venting type, fan brand or model, photo of fan); call no; photos no; ready no",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "scoping",
    "exitNote": null,
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
  "conversationId": "case_23580ecb-62a9-43ac-b1a1-059c39094ad1",
  "stage": "scoping",
  "tags": [],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:15:25.996Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:15:13.249Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:15:25.990Z",
      "content": "Hi Dan, thanks for getting in touch - bathroom extractor fan that's stopped working, got it.\nQuick one so Ben's got the picture: when you switch it on, is it completely dead or does it still make any noise at all?\nIf it's easy, a photo of the fan would help too, no pressure. Happy to give you a quic"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:15:25.996Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:15:37.202Z",
      "content": "Thanks Dan, that's helpful - a four inch ceiling fan, light still working but the fan itself dead, got it.\nOne more for Ben: is there a brand or model name anywhere on the fan cover?"
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask access; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_60f0d478-cd71-4611-8241-25461710ecf6.

> Thanks Dan, NG7 2PQ noted.
> One more so Ben can plan the visit: is parking fairly easy near the house?

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_23580ecb-62a9-43ac-b1a1-059c39094ad1",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Dan, NG7 2PQ noted.",
    "One more so Ben can plan the visit: is parking fairly easy near the house?"
  ],
  "factIds": [
    "fact_428b65f2-3849-46ee-ba3e-cec3884c1c54",
    "fact_c3af9bee-13d4-4977-b086-062701e72f5e"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_60f0d478-cd71-4611-8241-25461710ecf6",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask access; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_23580ecb-62a9-43ac-b1a1-059c39094ad1",
  "stage": "ready",
  "tags": [],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:15:37.204Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:15:13.249Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:15:25.990Z",
      "content": "Hi Dan, thanks for getting in touch - bathroom extractor fan that's stopped working, got it.\nQuick one so Ben's got the picture: when you switch it on, is it completely dead or does it still make any noise at all?\nIf it's easy, a photo of the fan would help too, no pressure. Happy to give you a quic"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:15:25.996Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:15:37.202Z",
      "content": "Thanks Dan, that's helpful - a four inch ceiling fan, light still working but the fan itself dead, got it.\nOne more for Ben: is there a brand or model name anywhere on the fan cover?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:15:37.204Z",
      "content": "We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:15:46.771Z",
      "content": "Thanks Dan, NG7 2PQ noted.\nOne more so Ben can plan the visit: is parking fairly easy near the house?"
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

Planned send: 2 bubbles (desk); decision send; intent turn acknowledgement; subjects scoping; exception none; ask none; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_ab947158-7ad6-4b0c-8c80-9192c9c44006.

> No worries Dan, glad that all makes sense.
> Ben's got the details on the ceiling extractor fan and your postcode, so you're all set for now.

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_23580ecb-62a9-43ac-b1a1-059c39094ad1",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No worries Dan, glad that all makes sense.",
    "Ben's got the details on the ceiling extractor fan and your postcode, so you're all set for now."
  ],
  "factIds": [
    "fact_c3af9bee-13d4-4977-b086-062701e72f5e",
    "fact_19ae2fa6-342e-4407-b11a-8cc9f0a066fa",
    "fact_428b65f2-3849-46ee-ba3e-cec3884c1c54"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_ab947158-7ad6-4b0c-8c80-9192c9c44006",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn acknowledgement; subjects scoping; exception none; ask none; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_23580ecb-62a9-43ac-b1a1-059c39094ad1",
  "stage": "ready",
  "tags": [],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:15:46.776Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:15:13.249Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:15:25.990Z",
      "content": "Hi Dan, thanks for getting in touch - bathroom extractor fan that's stopped working, got it.\nQuick one so Ben's got the picture: when you switch it on, is it completely dead or does it still make any noise at all?\nIf it's easy, a photo of the fan would help too, no pressure. Happy to give you a quic"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:15:25.996Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:15:37.202Z",
      "content": "Thanks Dan, that's helpful - a four inch ceiling fan, light still working but the fan itself dead, got it.\nOne more for Ben: is there a brand or model name anywhere on the fan cover?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:15:37.204Z",
      "content": "We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:15:46.771Z",
      "content": "Thanks Dan, NG7 2PQ noted.\nOne more so Ben can plan the visit: is parking fairly easy near the house?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:15:46.776Z",
      "content": "Ok thanks, that all makes sense."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:16:01.138Z",
      "content": "No worries Dan, glad that all makes sense.\nBen's got the details on the ceiling extractor fan and your postcode, so you're all set for now."
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

Lines 2.2. Started 2026-09-11T01:16:01.141Z, 64272 ms.

Seed: customer new, name Mel, prefers text false, already rung false, window open. customer: honoured (name "Mel" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (tile size/type, how many tiles, access to bathroom); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_6d9e3284-be42-401b-8cc6-0750348f93b0.

> Hi Mel, thanks for getting in touch - a cracked tile above the bath, and you're in NG7 2PQ, got it.
> Is it just the one tile that's cracked?
> If it's easy, a photo of the tile would help too, no pressure. And happy to give you a quick call if that's easier.

- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_69bae214-d6c6-42e0-a6a0-13fce8566d53",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Mel, thanks for getting in touch - a cracked tile above the bath, and you're in NG7 2PQ, got it.",
    "Is it just the one tile that's cracked?",
    "If it's easy, a photo of the tile would help too, no pressure. And happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_a6bd41fa-e9af-4fbc-ad85-dfe1347d6990",
    "fact_2aa2d1ad-8518-46e1-9531-2002344447ec"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_6d9e3284-be42-401b-8cc6-0750348f93b0",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (tile size/type, how many tiles, access to bathroom); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_69bae214-d6c6-42e0-a6a0-13fce8566d53",
  "stage": "ready",
  "tags": [],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:16:01.144Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:16:01.144Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:16:11.598Z",
      "content": "Hi Mel, thanks for getting in touch - a cracked tile above the bath, and you're in NG7 2PQ, got it.\nIs it just the one tile that's cracked?\nIf it's easy, a photo of the tile would help too, no pressure. And happy to give you a quick call if that's easier."
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask access; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_c9833872-0651-4812-b5c4-ca47f82998a1.

> Thanks Mel - one plain white tile, about 20cm square, cracked corner to corner above the bath. Got it.
> Last thing from me - is parking easy near you, and would someone be in when Ben comes round?

- [2.2] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_69bae214-d6c6-42e0-a6a0-13fce8566d53",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Mel - one plain white tile, about 20cm square, cracked corner to corner above the bath. Got it.",
    "Last thing from me - is parking easy near you, and would someone be in when Ben comes round?"
  ],
  "factIds": [
    "fact_a6bd41fa-e9af-4fbc-ad85-dfe1347d6990",
    "fact_8cd6329e-e28a-4240-b272-4edeec52c135",
    "fact_996a4d02-a6fa-40e9-971c-f80c31f2b7c7"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_c9833872-0651-4812-b5c4-ca47f82998a1",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask access; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_69bae214-d6c6-42e0-a6a0-13fce8566d53",
  "stage": "ready",
  "tags": [],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:16:11.606Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:16:01.144Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:16:11.598Z",
      "content": "Hi Mel, thanks for getting in touch - a cracked tile above the bath, and you're in NG7 2PQ, got it.\nIs it just the one tile that's cracked?\nIf it's easy, a photo of the tile would help too, no pressure. And happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:16:11.606Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:16:22.618Z",
      "content": "Thanks Mel - one plain white tile, about 20cm square, cracked corner to corner above the bath. Got it.\nLast thing from me - is parking easy near you, and would someone be in when Ben comes round?"
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

Planned send: 3 bubbles (desk); decision send; intent turn decline; subjects scoping; exception none; ask none; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_29d30163-a7cc-4211-ac83-bd7fd2845acd.

> No problem at all Mel, that's completely fine - no photos needed.
> A standard white B&Q tile, about 20cm square, cracked corner to corner above the bath - that's all clear.
> That's everything I need for now. Ben will put the quote together and send it over to you.

- [2.2] reply_sent: **PASS** - a reply would go (3 bubbles, desk)
- [2.2] not_asks_subject: **PASS** - the reply does not ask about media
- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_69bae214-d6c6-42e0-a6a0-13fce8566d53",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No problem at all Mel, that's completely fine - no photos needed.",
    "A standard white B&Q tile, about 20cm square, cracked corner to corner above the bath - that's all clear.",
    "That's everything I need for now. Ben will put the quote together and send it over to you."
  ],
  "factIds": [
    "fact_a6bd41fa-e9af-4fbc-ad85-dfe1347d6990",
    "fact_8cd6329e-e28a-4240-b272-4edeec52c135",
    "fact_996a4d02-a6fa-40e9-971c-f80c31f2b7c7",
    "fact_5528020e-ecd6-44bc-8032-ddc8f99702bb",
    "fact_ac83da81-6a8c-4168-8583-a790b5e11d5e",
    "fact_355c8802-2f0f-45c2-bee6-a9ebf03a8916"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_29d30163-a7cc-4211-ac83-bd7fd2845acd",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn decline; subjects scoping; exception none; ask none; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_69bae214-d6c6-42e0-a6a0-13fce8566d53",
  "stage": "ready",
  "tags": [],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:16:22.625Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:16:01.144Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:16:11.598Z",
      "content": "Hi Mel, thanks for getting in touch - a cracked tile above the bath, and you're in NG7 2PQ, got it.\nIs it just the one tile that's cracked?\nIf it's easy, a photo of the tile would help too, no pressure. And happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:16:11.606Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:16:22.618Z",
      "content": "Thanks Mel - one plain white tile, about 20cm square, cracked corner to corner above the bath. Got it.\nLast thing from me - is parking easy near you, and would someone be in when Ben comes round?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:16:22.625Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:16:37.671Z",
      "content": "No problem at all Mel, that's completely fine - no photos needed.\nA standard white B&Q tile, about 20cm square, cracked corner to corner above the bath - that's all clear.\nThat's everything I need for now. Ben will put the quote together and send it over to you."
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

Planned send: 1 bubble (desk); decision hold; intent turn question; subjects scoping; exception none; ask job (parking availability, someone home for access); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold ben (guards failed twice: ask_ledger: the reply asks about access, already asked and unanswered); run run_53bf185b-b314-4a1f-b76f-ae6985431d42.

> Thanks, I've passed this to Ben and he'll come back to you.

- [2.2] reply_sent: **PASS** - a reply would go (1 bubble, desk)
- [2.2] not_asks_subject: **PASS** - the reply does not ask about media
- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_69bae214-d6c6-42e0-a6a0-13fce8566d53",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks, I've passed this to Ben and he'll come back to you."
  ],
  "factIds": [],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_53bf185b-b314-4a1f-b76f-ae6985431d42",
  "hold": {
    "approver": "ben",
    "reason": "guards failed twice: ask_ledger: the reply asks about access, already asked and unanswered",
    "since": "2026-09-11T01:17:05.411Z"
  },
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "hold",
    "intent": "turn question; subjects scoping; exception none; ask job (parking availability, someone home for access); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": "guards failed twice: ask_ledger: the reply asks about access, already asked and unanswered",
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
  "conversationId": "case_69bae214-d6c6-42e0-a6a0-13fce8566d53",
  "stage": "ready",
  "tags": [],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:16:37.677Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:16:01.144Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:16:11.598Z",
      "content": "Hi Mel, thanks for getting in touch - a cracked tile above the bath, and you're in NG7 2PQ, got it.\nIs it just the one tile that's cracked?\nIf it's easy, a photo of the tile would help too, no pressure. And happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:16:11.606Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:16:22.618Z",
      "content": "Thanks Mel - one plain white tile, about 20cm square, cracked corner to corner above the bath. Got it.\nLast thing from me - is parking easy near you, and would someone be in when Ben comes round?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:16:22.625Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:16:37.671Z",
      "content": "No problem at all Mel, that's completely fine - no photos needed.\nA standard white B&Q tile, about 20cm square, cracked corner to corner above the bath - that's all clear.\nThat's everything I need for now. Ben will put the quote together and send it over to you."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:16:37.677Z",
      "content": "What else do you need to know?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:17:05.412Z",
      "content": "Thanks, I've passed this to Ben and he'll come back to you."
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

Lines 2.3. Started 2026-09-11T01:17:05.413Z, 37105 ms.

Seed: customer new, name Alex, prefers text false, already rung false, window open. customer: honoured (name "Alex" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (which job first, bannister issue detail, door sticking cause, tap type/location); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_e22e19c3-dc65-411e-a0e2-340f925cd338.

> Hi Alex, thanks for getting in touch. A wobbly bannister, a sticking door and a leaking outside tap in Beeston, NG9 - got that.
> To start with the bannister, is it the whole rail that moves or just one or two of the posts?
> If it's easy, a photo or two of each would help too, no pressure. Happy to give you a quick call if that's easier.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_7f4b674a-d466-4151-a2d4-afe05db3b01a",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Alex, thanks for getting in touch. A wobbly bannister, a sticking door and a leaking outside tap in Beeston, NG9 - got that.",
    "To start with the bannister, is it the whole rail that moves or just one or two of the posts?",
    "If it's easy, a photo or two of each would help too, no pressure. Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_3742ae4a-1a5c-4ef2-9dec-68fbe6e74ba2",
    "fact_c7d5bc97-e8b5-4347-bfe0-558cf295e101"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_e22e19c3-dc65-411e-a0e2-340f925cd338",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (which job first, bannister issue detail, door sticking cause, tap type/location); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_7f4b674a-d466-4151-a2d4-afe05db3b01a",
  "stage": "ready",
  "tags": [],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:17:05.413Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:17:05.413Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:17:15.083Z",
      "content": "Hi Alex, thanks for getting in touch. A wobbly bannister, a sticking door and a leaking outside tap in Beeston, NG9 - got that.\nTo start with the bannister, is it the whole rail that moves or just one or two of the posts?\nIf it's easy, a photo or two of each would help too, no pressure. Happy to giv"
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

Planned send: 3 bubbles (desk); decision send; intent turn question; subjects scoping; exception none; ask job (whole rail or posts loose, door sticking cause, tap leak location, which job first); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_05fa4131-75af-4e35-b603-4312933fbe60.

> Good question - let's start with the bannister, if that's alright.
> Is it the whole rail that moves, or just one or two of the posts that are loose?
> Once I've got that, we can go through the door and the tap one at a time.

- [2.3] asks_subject: **PASS** - the reply asks about any
- [2.3] own_words: **PASS** - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)
  - model judge (beside, not instead): claude-haiku-4-5, prompt 344d1addd67d, verdict **yes** - The reply naturally prioritizes one issue (bannister), asks a specific follow-up question about that particular problem, and commits to handling remaining items sequentially—conversational and tailored to the customer's multi-issue situation.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_7f4b674a-d466-4151-a2d4-afe05db3b01a",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Good question - let's start with the bannister, if that's alright.",
    "Is it the whole rail that moves, or just one or two of the posts that are loose?",
    "Once I've got that, we can go through the door and the tap one at a time."
  ],
  "factIds": [
    "fact_3742ae4a-1a5c-4ef2-9dec-68fbe6e74ba2"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_05fa4131-75af-4e35-b603-4312933fbe60",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn question; subjects scoping; exception none; ask job (whole rail or posts loose, door sticking cause, tap leak location, which job first); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_7f4b674a-d466-4151-a2d4-afe05db3b01a",
  "stage": "ready",
  "tags": [],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:17:15.088Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:17:05.413Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:17:15.083Z",
      "content": "Hi Alex, thanks for getting in touch. A wobbly bannister, a sticking door and a leaking outside tap in Beeston, NG9 - got that.\nTo start with the bannister, is it the whole rail that moves or just one or two of the posts?\nIf it's easy, a photo or two of each would help too, no pressure. Happy to giv"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:17:15.088Z",
      "content": "Which one do you want to know about first?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:17:26.669Z",
      "content": "Good question - let's start with the bannister, if that's alright.\nIs it the whole rail that moves, or just one or two of the posts that are loose?\nOnce I've got that, we can go through the door and the tap one at a time."
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask job (door sticking cause, tap type, which job first for door/tap); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_715e920e-d613-4195-8a1b-b506e20070f7.

> Thanks Alex - so it's the bannister at the top of the stairs, two spindles have come loose and the whole thing rocks when you lean on it. Got that.
> On to the door next - where is it sticking, along the top, the side or at the bottom?

- [2.3] own_words: **PASS** - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)
  - model judge (beside, not instead): claude-haiku-4-5, prompt 18411a42dbfe, verdict **no** - The reply jumps to a completely different job (a sticking door) without addressing the bannister issue, ignoring what the customer said and treating it like a template checklist rather than a natural conversation.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_7f4b674a-d466-4151-a2d4-afe05db3b01a",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Alex - so it's the bannister at the top of the stairs, two spindles have come loose and the whole thing rocks when you lean on it. Got that.",
    "On to the door next - where is it sticking, along the top, the side or at the bottom?"
  ],
  "factIds": [
    "fact_0cec428f-0225-477a-87d8-4361becccc04",
    "fact_3742ae4a-1a5c-4ef2-9dec-68fbe6e74ba2",
    "fact_205e3bde-1989-4b09-b21f-47fbb1dbe632"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_715e920e-d613-4195-8a1b-b506e20070f7",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask job (door sticking cause, tap type, which job first for door/tap); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_7f4b674a-d466-4151-a2d4-afe05db3b01a",
  "stage": "ready",
  "tags": [],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:17:28.271Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:17:05.413Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:17:15.083Z",
      "content": "Hi Alex, thanks for getting in touch. A wobbly bannister, a sticking door and a leaking outside tap in Beeston, NG9 - got that.\nTo start with the bannister, is it the whole rail that moves or just one or two of the posts?\nIf it's easy, a photo or two of each would help too, no pressure. Happy to giv"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:17:15.088Z",
      "content": "Which one do you want to know about first?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:17:26.669Z",
      "content": "Good question - let's start with the bannister, if that's alright.\nIs it the whole rail that moves, or just one or two of the posts that are loose?\nOnce I've got that, we can go through the door and the tap one at a time."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:17:28.271Z",
      "content": "The bannister is at the top of the stairs, two of the spindles have come loose and it rocks when you lean on it."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:17:41.070Z",
      "content": "Thanks Alex - so it's the bannister at the top of the stairs, two spindles have come loose and the whole thing rocks when you lean on it. Got that.\nOn to the door next - where is it sticking, along the top, the side or at the bottom?"
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

Lines 2.4. Started 2026-09-11T01:17:42.519Z, 31090 ms.

Seed: customer new, name Chris, prefers text false, already rung false, window open. customer: honoured (name "Chris" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (gate material/size, hinge condition, post condition, access for tools); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_989e5c90-4ea0-4b3c-866f-752a7fd71257.

> Hi Chris, thanks for getting in touch. A dropped garden gate that won't latch - got it, and you're in NG9.
> Quick one so I can get a proper picture: is the gate wooden or metal?
> If it's easy, a photo of the gate and the hinges would be a help too, no pressure. And happy to give you a quick call if that's easier.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_6f776a93-0b11-44e8-8f9a-19a29c2474a8",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Chris, thanks for getting in touch. A dropped garden gate that won't latch - got it, and you're in NG9.",
    "Quick one so I can get a proper picture: is the gate wooden or metal?",
    "If it's easy, a photo of the gate and the hinges would be a help too, no pressure. And happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_315fc189-c974-40de-b090-e3bad6e179e3",
    "fact_f0ea1715-632b-4f17-9416-99f4a4b20d19"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_989e5c90-4ea0-4b3c-866f-752a7fd71257",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (gate material/size, hinge condition, post condition, access for tools); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_6f776a93-0b11-44e8-8f9a-19a29c2474a8",
  "stage": "ready",
  "tags": [],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:17:42.521Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:17:42.521Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:17:53.158Z",
      "content": "Hi Chris, thanks for getting in touch. A dropped garden gate that won't latch - got it, and you're in NG9.\nQuick one so I can get a proper picture: is the gate wooden or metal?\nIf it's easy, a photo of the gate and the hinges would be a help too, no pressure. And happy to give you a quick call if th"
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

Planned send: 1 bubble (desk); decision send; intent turn short_pause; subjects scoping; exception none; ask none; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_6fceb397-d64a-40f9-9544-6c925e84ec97.

> No rush at all, Chris - take your time.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_6f776a93-0b11-44e8-8f9a-19a29c2474a8",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No rush at all, Chris - take your time."
  ],
  "factIds": [
    "fact_a9b09495-3fb1-4eb3-8cdd-e8a1ea404171"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_6fceb397-d64a-40f9-9544-6c925e84ec97",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn short_pause; subjects scoping; exception none; ask none; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_6f776a93-0b11-44e8-8f9a-19a29c2474a8",
  "stage": "ready",
  "tags": [],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:17:53.164Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:17:42.521Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:17:53.158Z",
      "content": "Hi Chris, thanks for getting in touch. A dropped garden gate that won't latch - got it, and you're in NG9.\nQuick one so I can get a proper picture: is the gate wooden or metal?\nIf it's easy, a photo of the gate and the hinges would be a help too, no pressure. And happy to give you a quick call if th"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:17:53.164Z",
      "content": "one sec, let me check"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:03.372Z",
      "content": "No rush at all, Chris - take your time."
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask access; call no; photos no; ready yes; specialist error: Failed to parse structured output: Error: Failed to parse structured output: [
  {
    "origin": "string",
    "code": "too_big",
    "maximum": 40,
    "inclusive": true,
    "path": [
      "jobUnknowns",
      1
    ],
    "message": "Too big: expected string to have <=40 characters"
  }
]
Validation issues:
  - jobUnknowns.1: Too big: expected string to have <=40 characters; window open; template none; approver agent.comms_v2; hold none; run run_03368cbe-5580-4337-8c59-fcca5df11167.

> Cheers Chris - wooden gate, and the post has rotted at the bottom so the whole thing's leaning. That explains why it won't latch.
> One more thing so Ben can plan it properly: is there parking close by for a van at yours?

- [2.4] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.4] asks_subject: **PASS** - the reply asks about any

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_6f776a93-0b11-44e8-8f9a-19a29c2474a8",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Cheers Chris - wooden gate, and the post has rotted at the bottom so the whole thing's leaning. That explains why it won't latch.",
    "One more thing so Ben can plan it properly: is there parking close by for a van at yours?"
  ],
  "factIds": [
    "fact_315fc189-c974-40de-b090-e3bad6e179e3",
    "fact_a9b09495-3fb1-4eb3-8cdd-e8a1ea404171"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_03368cbe-5580-4337-8c59-fcca5df11167",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask access; call no; photos no; ready yes; specialist error: Failed to parse structured output: Error: Failed to parse structured output: [\n  {\n    \"origin\": \"string\",\n    \"code\": \"too_big\",\n    \"maximum\": 40,\n    \"inclusive\": true,\n    \"path\": [\n      \"jobUnknowns\",\n      1\n    ],\n    \"message\": \"Too big: expected string to have <=40 characters\"\n  }\n]\nValidation issues:\n  - jobUnknowns.1: Too big: expected string to have <=40 characters",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_6f776a93-0b11-44e8-8f9a-19a29c2474a8",
  "stage": "ready",
  "tags": [],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:18:03.377Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:17:42.521Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:17:53.158Z",
      "content": "Hi Chris, thanks for getting in touch. A dropped garden gate that won't latch - got it, and you're in NG9.\nQuick one so I can get a proper picture: is the gate wooden or metal?\nIf it's easy, a photo of the gate and the hinges would be a help too, no pressure. And happy to give you a quick call if th"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:17:53.164Z",
      "content": "one sec, let me check"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:03.372Z",
      "content": "No rush at all, Chris - take your time."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:18:03.377Z",
      "content": "Right, it's a wooden gate. The post has rotted at the bottom so the whole thing leans."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:13.608Z",
      "content": "Cheers Chris - wooden gate, and the post has rotted at the bottom so the whole thing's leaning. That explains why it won't latch.\nOne more thing so Ben can plan it properly: is there parking close by for a van at yours?"
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

Lines 2.5. Started 2026-09-11T01:18:13.609Z, 18957 ms.

Seed: customer new, name Sara, prefers text false, already rung false, window open. customer: honoured (name "Sara" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping+quoting; exception none; ask job (panel size/material, access for delivery/work); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_4d251514-c6d0-46dc-98d2-479a43e1bcea.

> Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB, happy to put a quote together for replacing them.
> Do you know what size and type of panels they are, e.g. standard 6ft featheredge or something else?
> If it's easy, a quick photo of the damage would help too, no pressure. And happy to give you a quick call if that's easier.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_7eba8bf4-1bd1-49c5-b24d-97cb63dc7860",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB, happy to put a quote together for replacing them.",
    "Do you know what size and type of panels they are, e.g. standard 6ft featheredge or something else?",
    "If it's easy, a quick photo of the damage would help too, no pressure. And happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_7c9ec3b4-4185-40d4-b1d4-77c615bffbc8",
    "fact_75ae6943-0b11-4c63-86a2-93ddda578114"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_4d251514-c6d0-46dc-98d2-479a43e1bcea",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping+quoting; exception none; ask job (panel size/material, access for delivery/work); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_7eba8bf4-1bd1-49c5-b24d-97cb63dc7860",
  "stage": "ready",
  "tags": [],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:18:13.610Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:18:13.610Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:23.977Z",
      "content": "Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB, happy to put a quote together for replacing them.\nDo you know what size and type of panels they are, e.g. standard 6ft featheredge or something else?\nIf it's easy, a quick photo of the damage would help too, no pressure. "
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

Planned send: 2 bubbles (desk); decision send; intent turn promise_of_more; subjects scoping; exception none; ask none; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_fe74bb81-8a18-4d74-9b85-60ed91b6b6a1.

> No problem at all, Sara - whenever you're home and it's convenient is fine.
> I'll keep an eye out for the photos and we'll pick it up from there.

- [2.5] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.5] bubble_count_within: **PASS** - 2 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_7eba8bf4-1bd1-49c5-b24d-97cb63dc7860",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No problem at all, Sara - whenever you're home and it's convenient is fine.",
    "I'll keep an eye out for the photos and we'll pick it up from there."
  ],
  "factIds": [
    "fact_eb43d869-9c27-47ba-b725-5e8eb544abff",
    "fact_6cc6e908-8049-46c4-b529-e2dd1d737660"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_fe74bb81-8a18-4d74-9b85-60ed91b6b6a1",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn promise_of_more; subjects scoping; exception none; ask none; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_7eba8bf4-1bd1-49c5-b24d-97cb63dc7860",
  "stage": "ready",
  "tags": [],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:18:23.983Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:18:13.610Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:23.977Z",
      "content": "Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB, happy to put a quote together for replacing them.\nDo you know what size and type of panels they are, e.g. standard 6ft featheredge or something else?\nIf it's easy, a quick photo of the damage would help too, no pressure. "
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:18:23.983Z",
      "content": "I'll send photos tomorrow when I'm home."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:32.557Z",
      "content": "No problem at all, Sara - whenever you're home and it's convenient is fine.\nI'll keep an eye out for the photos and we'll pick it up from there."
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

Planned send: nothing goes; decision none; intent -; window open; template none; approver none; hold none; run run_834b8986-0027-4de3-ad25-28dcaf1a15f5.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_7eba8bf4-1bd1-49c5-b24d-97cb63dc7860",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [],
  "factIds": [],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": null,
  "runId": "run_834b8986-0027-4de3-ad25-28dcaf1a15f5",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": null,
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": "clock pass: no customer turn, nothing to reply to; the desk never chases",
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
  "conversationId": "case_7eba8bf4-1bd1-49c5-b24d-97cb63dc7860",
  "stage": "ready",
  "tags": [],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:18:23.983Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:18:13.610Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:23.977Z",
      "content": "Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB, happy to put a quote together for replacing them.\nDo you know what size and type of panels they are, e.g. standard 6ft featheredge or something else?\nIf it's easy, a quick photo of the damage would help too, no pressure. "
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:18:23.983Z",
      "content": "I'll send photos tomorrow when I'm home."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:32.557Z",
      "content": "No problem at all, Sara - whenever you're home and it's convenient is fine.\nI'll keep an eye out for the photos and we'll pick it up from there."
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

Planned send: nothing goes; decision none; intent -; window open; template none; approver none; hold none; run run_a8c61add-f036-4aec-853d-0a78b470ebac.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_7eba8bf4-1bd1-49c5-b24d-97cb63dc7860",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [],
  "factIds": [],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": null,
  "runId": "run_a8c61add-f036-4aec-853d-0a78b470ebac",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": null,
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": "clock pass: no customer turn, nothing to reply to; the desk never chases",
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
  "conversationId": "case_7eba8bf4-1bd1-49c5-b24d-97cb63dc7860",
  "stage": "ready",
  "tags": [],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:18:23.983Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:18:13.610Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:23.977Z",
      "content": "Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB, happy to put a quote together for replacing them.\nDo you know what size and type of panels they are, e.g. standard 6ft featheredge or something else?\nIf it's easy, a quick photo of the damage would help too, no pressure. "
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:18:23.983Z",
      "content": "I'll send photos tomorrow when I'm home."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:32.557Z",
      "content": "No problem at all, Sara - whenever you're home and it's convenient is fine.\nI'll keep an eye out for the photos and we'll pick it up from there."
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

Lines 2.6. Started 2026-09-11T01:18:32.566Z, 22522 ms.

Seed: customer new, name Tom, prefers text false, already rung false, window open. customer: honoured (name "Tom" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (fan type/model, ceiling or wall mounted, existing wiring condition); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_723d9c84-e2f9-4275-b4ba-160306ab004c.

> Hi Tom, thanks for getting in touch - a bathroom extractor fan replacement in NG7 2PQ, got it.
> Is the existing fan mounted in the ceiling or on the wall?
> If it's easy, a quick photo of the current fan would help too, no pressure. Happy to give you a quick call as well if that's easier.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_531b6908-d53c-4366-b56f-6819a811ad03",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Tom"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Tom, thanks for getting in touch - a bathroom extractor fan replacement in NG7 2PQ, got it.",
    "Is the existing fan mounted in the ceiling or on the wall?",
    "If it's easy, a quick photo of the current fan would help too, no pressure. Happy to give you a quick call as well if that's easier."
  ],
  "factIds": [
    "fact_46e599d2-0897-4188-9459-d8d2bcb85085",
    "fact_cb657e45-479e-48f2-a69c-393da60c3953"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_723d9c84-e2f9-4275-b4ba-160306ab004c",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (fan type/model, ceiling or wall mounted, existing wiring condition); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_531b6908-d53c-4366-b56f-6819a811ad03",
  "stage": "ready",
  "tags": [],
  "contactName": "Tom",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:18:32.566Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-11T01:18:32.566Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:43.309Z",
      "content": "Hi Tom, thanks for getting in touch - a bathroom extractor fan replacement in NG7 2PQ, got it.\nIs the existing fan mounted in the ceiling or on the wall?\nIf it's easy, a quick photo of the current fan would help too, no pressure. Happy to give you a quick call as well if that's easier."
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

Planned send: 2 bubbles (desk); decision send; intent turn question; subjects scheduling; exception none; ask access; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_b81f53a7-c5c6-4b52-b4d7-57edeef63bfc.

> Good question Tom - dates come with your quote, so Ben will come back to you on that once he's put it together.
> In the meantime, one quick thing on access - is there parking nearby at yours in NG7?

- [2.6] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.6] no_date: **PASS** - no date, time or duration in the reply
- [2.6] text_matches: **PASS** - matches /\bquote\b/: "quote"
- [2.6] asks_subject: **PASS** - the reply asks about any

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_531b6908-d53c-4366-b56f-6819a811ad03",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Tom"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Good question Tom - dates come with your quote, so Ben will come back to you on that once he's put it together.",
    "In the meantime, one quick thing on access - is there parking nearby at yours in NG7?"
  ],
  "factIds": [
    "fact_cd16ff0e-281f-4490-aed3-1e2a2d1b44fd",
    "fact_cb657e45-479e-48f2-a69c-393da60c3953"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_b81f53a7-c5c6-4b52-b4d7-57edeef63bfc",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn question; subjects scheduling; exception none; ask access; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_531b6908-d53c-4366-b56f-6819a811ad03",
  "stage": "ready",
  "tags": [],
  "contactName": "Tom",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:18:43.315Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-11T01:18:32.566Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:43.309Z",
      "content": "Hi Tom, thanks for getting in touch - a bathroom extractor fan replacement in NG7 2PQ, got it.\nIs the existing fan mounted in the ceiling or on the wall?\nIf it's easy, a quick photo of the current fan would help too, no pressure. Happy to give you a quick call as well if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-11T01:18:43.315Z",
      "content": "When can you come?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:18:55.085Z",
      "content": "Good question Tom - dates come with your quote, so Ben will come back to you on that once he's put it together.\nIn the meantime, one quick thing on access - is there parking nearby at yours in NG7?"
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

Lines 2.7. Started 2026-09-11T01:18:55.088Z, 30825 ms.

Seed: customer new, name Nina, prefers text false, already rung false, window open. customer: honoured (name "Nina" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (tap type/brand, existing plumbing condition, access); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_62c4d00c-41c9-4182-bd91-09517fd8d78c.

> Hi Nina, thanks for getting in touch. So it's fitting a new kitchen tap you've already bought, over in NG7 - got it.
> Could you let me know what type of tap it is, like a mixer or a pull-out spray, and the brand if you have it?
> If it's easy, a quick photo of the tap and under the sink would help too, no pressure. Happy to give you a quick call if that's easier.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_3228ab89-5201-4806-a5e3-b3d1142acc48",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Nina"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Nina, thanks for getting in touch. So it's fitting a new kitchen tap you've already bought, over in NG7 - got it.",
    "Could you let me know what type of tap it is, like a mixer or a pull-out spray, and the brand if you have it?",
    "If it's easy, a quick photo of the tap and under the sink would help too, no pressure. Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_069bbf7b-8ea5-4c59-ae9a-62d25368abbf",
    "fact_1caaa8ee-3f39-4bf6-adc1-b34ace591e57",
    "fact_24fb57d4-1f2a-4fd2-a45b-c48732c6632c"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_62c4d00c-41c9-4182-bd91-09517fd8d78c",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (tap type/brand, existing plumbing condition, access); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_3228ab89-5201-4806-a5e3-b3d1142acc48",
  "stage": "ready",
  "tags": [],
  "contactName": "Nina",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:18:55.089Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-11T01:18:55.089Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:19:06.325Z",
      "content": "Hi Nina, thanks for getting in touch. So it's fitting a new kitchen tap you've already bought, over in NG7 - got it.\nCould you let me know what type of tap it is, like a mixer or a pull-out spray, and the brand if you have it?\nIf it's easy, a quick photo of the tap and under the sink would help too,"
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

Planned send: 2 bubbles (desk); decision send; intent turn question; subjects quoting; exception money; ask access; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold ben (money: How much); run run_4336eab0-f1a3-47af-9843-b9c9a423c031.

> Totally fair question, Nina - Ben will come back to you on the price for fitting the tap, he'll want to have a proper look at it first.
> One quick thing so he can plan it in: is parking easy enough outside yours in NG7?

- [2.7] hold_for_approver: **PASS** - held for ben: money: How much
- [2.7] no_figure: **PASS** - no figure in the reply

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_3228ab89-5201-4806-a5e3-b3d1142acc48",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Nina"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Totally fair question, Nina - Ben will come back to you on the price for fitting the tap, he'll want to have a proper look at it first.",
    "One quick thing so he can plan it in: is parking easy enough outside yours in NG7?"
  ],
  "factIds": [
    "fact_069bbf7b-8ea5-4c59-ae9a-62d25368abbf",
    "fact_1caaa8ee-3f39-4bf6-adc1-b34ace591e57",
    "fact_24fb57d4-1f2a-4fd2-a45b-c48732c6632c",
    "fact_ccec55e2-674a-48d5-b526-ed68631a4c39"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_4336eab0-f1a3-47af-9843-b9c9a423c031",
  "hold": {
    "approver": "ben",
    "reason": "money: How much",
    "since": "2026-09-11T01:19:11.753Z"
  },
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn question; subjects quoting; exception money; ask access; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_3228ab89-5201-4806-a5e3-b3d1142acc48",
  "stage": "ready",
  "tags": [],
  "contactName": "Nina",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:19:06.328Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-11T01:18:55.089Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:19:06.325Z",
      "content": "Hi Nina, thanks for getting in touch. So it's fitting a new kitchen tap you've already bought, over in NG7 - got it.\nCould you let me know what type of tap it is, like a mixer or a pull-out spray, and the brand if you have it?\nIf it's easy, a quick photo of the tap and under the sink would help too,"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-11T01:19:06.328Z",
      "content": "How much roughly?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:19:25.910Z",
      "content": "Totally fair question, Nina - Ben will come back to you on the price for fitting the tap, he'll want to have a proper look at it first.\nOne quick thing so he can plan it in: is parking easy enough outside yours in NG7?"
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

Lines 2.8. Started 2026-09-11T01:19:25.913Z, 25953 ms.

Seed: customer new, name Lee, prefers text false, already rung false, window open. customer: honoured (name "Lee" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need an internal door rehung, it's catching on the frame. We're in NG9.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (which side/hinge or frame issue, door size/type); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_eb68f292-811e-4eeb-901c-f916e11685b6.

> Hi Lee, thanks for getting in touch - an internal door rehanging in NG9, catching on the frame. Got it.
> Is it catching on the hinge side or the frame side?
> If it's easy, a quick photo of where it's rubbing would help, no pressure. Also happy to give you a quick call if that's easier.

- [2.8] reply_sent: **PASS** - a reply would go (3 bubbles, desk)
- [2.8] bubble_count_within: **PASS** - 3 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_0519c30b-adf3-48d1-8ef7-303d1ff1975d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Lee, thanks for getting in touch - an internal door rehanging in NG9, catching on the frame. Got it.",
    "Is it catching on the hinge side or the frame side?",
    "If it's easy, a quick photo of where it's rubbing would help, no pressure. Also happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_37f1df2b-cbd7-4be9-b825-b3445524854d",
    "fact_75efb487-2747-4628-ab0d-5a8c629873fb"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_eb68f292-811e-4eeb-901c-f916e11685b6",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (which side/hinge or frame issue, door size/type); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_0519c30b-adf3-48d1-8ef7-303d1ff1975d",
  "stage": "ready",
  "tags": [],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:19:25.916Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:19:25.916Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:19:34.931Z",
      "content": "Hi Lee, thanks for getting in touch - an internal door rehanging in NG9, catching on the frame. Got it.\nIs it catching on the hinge side or the frame side?\nIf it's easy, a quick photo of where it's rubbing would help, no pressure. Also happy to give you a quick call if that's easier."
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

Planned send: nothing goes; decision none; intent -; window open; template none; approver none; hold none; run run_ea9c8154-6a4f-4bf8-8bf5-536774f2a6e3.

- [2.8] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_0519c30b-adf3-48d1-8ef7-303d1ff1975d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [],
  "factIds": [],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": null,
  "runId": "run_ea9c8154-6a4f-4bf8-8bf5-536774f2a6e3",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": null,
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": "clock pass: no customer turn, nothing to reply to; the desk never chases",
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
  "conversationId": "case_0519c30b-adf3-48d1-8ef7-303d1ff1975d",
  "stage": "ready",
  "tags": [],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:19:25.916Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:19:25.916Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:19:34.931Z",
      "content": "Hi Lee, thanks for getting in touch - an internal door rehanging in NG9, catching on the frame. Got it.\nIs it catching on the hinge side or the frame side?\nIf it's easy, a quick photo of where it's rubbing would help, no pressure. Also happy to give you a quick call if that's easier."
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask job (hinge side or frame side, door size/type); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_c8a95db9-7947-4eb3-bf6f-14d82d08d978.

> Ah, the upstairs bathroom door, and it's been catching since the summer - got it, thanks Lee.
> Just to pin it down, is it rubbing on the hinge side or the latch side of the frame?

- [2.8] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_0519c30b-adf3-48d1-8ef7-303d1ff1975d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Ah, the upstairs bathroom door, and it's been catching since the summer - got it, thanks Lee.",
    "Just to pin it down, is it rubbing on the hinge side or the latch side of the frame?"
  ],
  "factIds": [
    "fact_37f1df2b-cbd7-4be9-b825-b3445524854d",
    "fact_9e5b81f0-28aa-4bd3-a0ad-6ea73785ae49"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_c8a95db9-7947-4eb3-bf6f-14d82d08d978",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask job (hinge side or frame side, door size/type); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_0519c30b-adf3-48d1-8ef7-303d1ff1975d",
  "stage": "ready",
  "tags": [],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:19:34.939Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:19:25.916Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:19:34.931Z",
      "content": "Hi Lee, thanks for getting in touch - an internal door rehanging in NG9, catching on the frame. Got it.\nIs it catching on the hinge side or the frame side?\nIf it's easy, a quick photo of where it's rubbing would help, no pressure. Also happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:19:34.939Z",
      "content": "It's the bathroom door upstairs, been like it since the summer."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:19:51.861Z",
      "content": "Ah, the upstairs bathroom door, and it's been catching since the summer - got it, thanks Lee.\nJust to pin it down, is it rubbing on the hinge side or the latch side of the frame?"
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

Planned send: nothing goes; decision none; intent -; window open; template none; approver none; hold none; run run_cdc980ae-8b9e-40b7-93a4-3c75f32e8161.

- [2.8] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_0519c30b-adf3-48d1-8ef7-303d1ff1975d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [],
  "factIds": [],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": null,
  "runId": "run_cdc980ae-8b9e-40b7-93a4-3c75f32e8161",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": null,
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": "clock pass: no customer turn, nothing to reply to; the desk never chases",
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
  "conversationId": "case_0519c30b-adf3-48d1-8ef7-303d1ff1975d",
  "stage": "ready",
  "tags": [],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:19:34.939Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:19:25.916Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:19:34.931Z",
      "content": "Hi Lee, thanks for getting in touch - an internal door rehanging in NG9, catching on the frame. Got it.\nIs it catching on the hinge side or the frame side?\nIf it's easy, a quick photo of where it's rubbing would help, no pressure. Also happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:19:34.939Z",
      "content": "It's the bathroom door upstairs, been like it since the summer."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:19:51.861Z",
      "content": "Ah, the upstairs bathroom door, and it's been catching since the summer - got it, thanks Lee.\nJust to pin it down, is it rubbing on the hinge side or the latch side of the frame?"
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

Lines 1.1. Started 2026-09-11T01:19:51.867Z, 9114 ms.

Seed: customer new, name Sam, prefers text false, already rung false, window open. customer: honoured (name "Sam" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (tap type, postcode, access); call yes; photos mention; ready no; window open; template none; approver agent.comms_v2; hold none; run run_f34cbff6-58b2-475e-a97a-72c4a9f0a572.

> Hi Sam, thanks for getting in touch - a kitchen tap dripping from the base and won't stop, got it.
> Quick one so Ben knows what he's looking at: is it a single mixer tap or separate hot and cold taps?
> If it's easy, a quick photo of the tap would help too, no pressure. And happy to give you a quick call if that's easier.

- [1.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)
- [1.1] text_matches: **PASS** - matches /\btap\b/: "tap"
- [1.1] offers_call: **PASS** - the reply offers a call
- [1.1] freeform: **PASS** - freeform, no template
- [1.1] bubble_count_within: **PASS** - 3 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_f4db2e0e-8ce6-4c72-a562-349a934494a8",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sam"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Sam, thanks for getting in touch - a kitchen tap dripping from the base and won't stop, got it.",
    "Quick one so Ben knows what he's looking at: is it a single mixer tap or separate hot and cold taps?",
    "If it's easy, a quick photo of the tap would help too, no pressure. And happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_4c412b55-4673-4186-a93d-8a1070d116cf",
    "fact_105777b2-3580-48a6-9876-840c5826559e"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_f34cbff6-58b2-475e-a97a-72c4a9f0a572",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (tap type, postcode, access); call yes; photos mention; ready no",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "scoping",
    "exitNote": null,
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
  "conversationId": "case_f4db2e0e-8ce6-4c72-a562-349a934494a8",
  "stage": "scoping",
  "tags": [],
  "contactName": "Sam",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:19:51.867Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sam",
      "at": "2026-09-11T01:19:51.867Z",
      "content": "Hi, can I get a quote for a leaking kitchen tap? It's dripping from the base and won't stop."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:20:00.978Z",
      "content": "Hi Sam, thanks for getting in touch - a kitchen tap dripping from the base and won't stop, got it.\nQuick one so Ben knows what he's looking at: is it a single mixer tap or separate hot and cold taps?\nIf it's easy, a quick photo of the tap would help too, no pressure. And happy to give you a quick ca"
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

Lines 1.6. Started 2026-09-11T01:20:00.982Z, 62245 ms.

Seed: customer new, name Jo, prefers text true, already rung false, window open. prefersText: honoured (a prefers_text fact on the case file, source seed); customer: honoured (name "Jo" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (panel size, access to back of house, fixing type/posts condition); call no; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_3b461467-0eee-4f5f-918b-88da6b8639fc.

> Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.
> A panel replacement is something Ben can take a look at. To help him get a picture of it, are the posts either side still standing and solid?
> If it's easy, a quick photo of the fence would help too, no pressure.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_52947ce6-40d6-4151-a0b1-da28b03fa9d7",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.",
    "A panel replacement is something Ben can take a look at. To help him get a picture of it, are the posts either side still standing and solid?",
    "If it's easy, a quick photo of the fence would help too, no pressure."
  ],
  "factIds": [
    "fact_1fc8e76c-7369-4bf0-bc61-1e3cb47d7625",
    "fact_2c66e2c8-b282-48d7-8896-549f4bbd40bd",
    "fact_3915a794-7dc5-4856-862c-558bf278aad2"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_3b461467-0eee-4f5f-918b-88da6b8639fc",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (panel size, access to back of house, fixing type/posts condition); call no; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_52947ce6-40d6-4151-a0b1-da28b03fa9d7",
  "stage": "ready",
  "tags": [],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:20:00.984Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:20:00.984Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:20:11.784Z",
      "content": "Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.\nA panel replacement is something Ben can take a look at. To help him get a picture of it, are the posts either side still standing and solid?\nIf it's easy, a quick photo of the fence w"
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask access; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_304874ad-7624-464b-828f-e091fd27a810.

> No problem at all Jo, text only is fine - we'll keep everything on here.
> One more thing on the fence panel at the back in Beeston: is there easy access to the garden, either through the house or a side gate?

- [1.6] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_52947ce6-40d6-4151-a0b1-da28b03fa9d7",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No problem at all Jo, text only is fine - we'll keep everything on here.",
    "One more thing on the fence panel at the back in Beeston: is there easy access to the garden, either through the house or a side gate?"
  ],
  "factIds": [
    "fact_3915a794-7dc5-4856-862c-558bf278aad2",
    "fact_1fc8e76c-7369-4bf0-bc61-1e3cb47d7625",
    "fact_2c66e2c8-b282-48d7-8896-549f4bbd40bd",
    "fact_d673da4b-513e-4cfb-8b9c-da770c9d9542"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_304874ad-7624-464b-828f-e091fd27a810",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask access; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_52947ce6-40d6-4151-a0b1-da28b03fa9d7",
  "stage": "ready",
  "tags": [],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:20:11.790Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:20:00.984Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:20:11.784Z",
      "content": "Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.\nA panel replacement is something Ben can take a look at. To help him get a picture of it, are the posts either side still standing and solid?\nIf it's easy, a quick photo of the fence w"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:20:11.790Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:20:22.883Z",
      "content": "No problem at all Jo, text only is fine - we'll keep everything on here.\nOne more thing on the fence panel at the back in Beeston: is there easy access to the garden, either through the house or a side gate?"
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask job (access to garden); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_28da5423-7576-42ee-8fcb-9a6b8a114913.

> Perfect, thanks Jo - so it's one 6ft panel to replace at the back in Beeston, with the posts either side still fine.
> Got the postcode as NG9 2AB too, that's all noted on the job for Ben.

- [1.6] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_52947ce6-40d6-4151-a0b1-da28b03fa9d7",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Perfect, thanks Jo - so it's one 6ft panel to replace at the back in Beeston, with the posts either side still fine.",
    "Got the postcode as NG9 2AB too, that's all noted on the job for Ben."
  ],
  "factIds": [
    "fact_d673da4b-513e-4cfb-8b9c-da770c9d9542",
    "fact_1fc8e76c-7369-4bf0-bc61-1e3cb47d7625",
    "fact_b607998e-1f88-4a5d-b32f-eff9eeffead3",
    "fact_2c66e2c8-b282-48d7-8896-549f4bbd40bd",
    "fact_8e846ca7-e353-497f-a76a-7531db9f17f5"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_28da5423-7576-42ee-8fcb-9a6b8a114913",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask job (access to garden); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_52947ce6-40d6-4151-a0b1-da28b03fa9d7",
  "stage": "ready",
  "tags": [],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:20:22.888Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:20:00.984Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:20:11.784Z",
      "content": "Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.\nA panel replacement is something Ben can take a look at. To help him get a picture of it, are the posts either side still standing and solid?\nIf it's easy, a quick photo of the fence w"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:20:11.790Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:20:22.883Z",
      "content": "No problem at all Jo, text only is fine - we'll keep everything on here.\nOne more thing on the fence panel at the back in Beeston: is there easy access to the garden, either through the house or a side gate?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:20:22.888Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:20:40.873Z",
      "content": "Perfect, thanks Jo - so it's one 6ft panel to replace at the back in Beeston, with the posts either side still fine.\nGot the postcode as NG9 2AB too, that's all noted on the job for Ben."
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

Planned send: 3 bubbles (desk); decision send; intent turn question; subjects scoping; exception none; ask job (garden access via house or side gate); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_86765662-43c6-41c5-aa74-8bc6492870cf.

> Thanks Jo - nothing more needed from you just now.
> Ben's got the details for the one 6ft panel at the back in Beeston, posts either side fine, NG9 2AB, and we'll keep it all to text on here.
> If he needs anything else, he'll come back to you on here.

- [1.6] reply_sent: **PASS** - a reply would go (3 bubbles, desk)
- [1.6] not_offers_call: **PASS** - the reply does not offer a call

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_52947ce6-40d6-4151-a0b1-da28b03fa9d7",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Jo"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Jo - nothing more needed from you just now.",
    "Ben's got the details for the one 6ft panel at the back in Beeston, posts either side fine, NG9 2AB, and we'll keep it all to text on here.",
    "If he needs anything else, he'll come back to you on here."
  ],
  "factIds": [
    "fact_d673da4b-513e-4cfb-8b9c-da770c9d9542",
    "fact_1fc8e76c-7369-4bf0-bc61-1e3cb47d7625",
    "fact_b607998e-1f88-4a5d-b32f-eff9eeffead3",
    "fact_2c66e2c8-b282-48d7-8896-549f4bbd40bd",
    "fact_8e846ca7-e353-497f-a76a-7531db9f17f5",
    "fact_3915a794-7dc5-4856-862c-558bf278aad2"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_86765662-43c6-41c5-aa74-8bc6492870cf",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn question; subjects scoping; exception none; ask job (garden access via house or side gate); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_52947ce6-40d6-4151-a0b1-da28b03fa9d7",
  "stage": "ready",
  "tags": [],
  "contactName": "Jo",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:20:40.877Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:20:00.984Z",
      "content": "Hi, a fence panel has blown down at the back of our house in Beeston, can you replace it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:20:11.784Z",
      "content": "Hi Jo, thanks for getting in touch - sorry to hear a fence panel's blown down at the back of your place in Beeston.\nA panel replacement is something Ben can take a look at. To help him get a picture of it, are the posts either side still standing and solid?\nIf it's easy, a quick photo of the fence w"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:20:11.790Z",
      "content": "Text only please, I can't take calls at work."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:20:22.883Z",
      "content": "No problem at all Jo, text only is fine - we'll keep everything on here.\nOne more thing on the fence panel at the back in Beeston: is there easy access to the garden, either through the house or a side gate?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:20:22.888Z",
      "content": "It's one 6ft panel, the posts are fine. We're NG9 2AB."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:20:40.873Z",
      "content": "Perfect, thanks Jo - so it's one 6ft panel to replace at the back in Beeston, with the posts either side still fine.\nGot the postcode as NG9 2AB too, that's all noted on the job for Ben."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Jo",
      "at": "2026-09-11T01:20:40.877Z",
      "content": "Do you need anything else from me?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:03.224Z",
      "content": "Thanks Jo - nothing more needed from you just now.\nBen's got the details for the one 6ft panel at the back in Beeston, posts either side fine, NG9 2AB, and we'll keep it all to text on here.\nIf he needs anything else, he'll come back to you on here."
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

Lines 1.7. Started 2026-09-11T01:21:03.227Z, 15942 ms.

Seed: customer new, name Priya, prefers text false, already rung false, window open. customer: honoured (name "Priya" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it? [+1 media]

Planned send: 4 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (tap brand/model, leak source/pipework, access under sink); call yes; photos thank; ready no; window open; template none; approver agent.comms_v2; hold none; run run_99610186-5738-425d-85fa-abb05a51fad7.

> Hi, thanks for getting in touch about the leaking tap under your kitchen sink.
> Thanks for sending the picture too - it's come through as a little tap graphic rather than a photo, so I can't make out much of the actual sink from it.
> Can you tell me where the leak seems to be coming from - the tap itself or the pipework underneath?
> Happy to give you a quick call if that's easier.

- [1.7] reply_sent: **PASS** - a reply would go (4 bubbles, desk)
- [1.7] text_matches: **PASS** - matches /\b(?:photo|photos|picture|pictures|pic|pics|image|images|snap)\b/: "picture"

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_d149e032-fd77-42d9-b8d3-e917b923b0bd",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": null
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi, thanks for getting in touch about the leaking tap under your kitchen sink.",
    "Thanks for sending the picture too - it's come through as a little tap graphic rather than a photo, so I can't make out much of the actual sink from it.",
    "Can you tell me where the leak seems to be coming from - the tap itself or the pipework underneath?",
    "Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_3f0c22d3-5b38-4dac-861a-8dc3749c90a0",
    "fact_99e9dd77-a25c-43e8-9861-3c5cde2392eb"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_99610186-5738-425d-85fa-abb05a51fad7",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (tap brand/model, leak source/pipework, access under sink); call yes; photos thank; ready no",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "scoping",
    "exitNote": null,
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
  "conversationId": "case_d149e032-fd77-42d9-b8d3-e917b923b0bd",
  "stage": "scoping",
  "tags": [],
  "contactName": null,
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:21:03.233Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": null,
      "at": "2026-09-11T01:21:03.233Z",
      "content": "Hi, this is the tap that's leaking under our kitchen sink. Can you quote for fixing it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:19.166Z",
      "content": "Hi, thanks for getting in touch about the leaking tap under your kitchen sink.\nThanks for sending the picture too - it's come through as a little tap graphic rather than a photo, so I can't make out much of the actual sink from it.\nCan you tell me where the leak seems to be coming from - the tap its"
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

Lines 2.1. Started 2026-09-11T01:21:19.169Z, 55822 ms.

Seed: customer new, name Dan, prefers text false, already rung false, window open. customer: honoured (name "Dan" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my bathroom extractor fan has stopped working, can you sort it?

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (fan type/model, postcode, access, how long it's been faulty); call yes; photos mention; ready no; window open; template none; approver agent.comms_v2; hold none; run run_219f2f80-45f8-401d-869a-4454168082b8.

> Hi Dan, thanks for getting in touch. So your bathroom extractor fan has stopped working - got it.
> Just so Ben has a clear picture, does it do anything at all when you switch it on?
> If it's easy, a quick photo of the fan would help too, no pressure. Happy to give you a quick call if that's easier.

- [2.1] reply_sent: **PASS** - a reply would go (3 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_c191909c-b12b-44cb-b89b-29440737d38d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Dan, thanks for getting in touch. So your bathroom extractor fan has stopped working - got it.",
    "Just so Ben has a clear picture, does it do anything at all when you switch it on?",
    "If it's easy, a quick photo of the fan would help too, no pressure. Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_0b8726d3-585d-469c-bb70-fb36dadf8e75"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_219f2f80-45f8-401d-869a-4454168082b8",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (fan type/model, postcode, access, how long it's been faulty); call yes; photos mention; ready no",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "scoping",
    "exitNote": null,
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
  "conversationId": "case_c191909c-b12b-44cb-b89b-29440737d38d",
  "stage": "scoping",
  "tags": [],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:21:19.172Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:21:19.172Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:33.214Z",
      "content": "Hi Dan, thanks for getting in touch. So your bathroom extractor fan has stopped working - got it.\nJust so Ben has a clear picture, does it do anything at all when you switch it on?\nIf it's easy, a quick photo of the fan would help too, no pressure. Happy to give you a quick call if that's easier."
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask job (fan model/brand, wired to light switch or separate, how it's accessed); call no; photos no; ready no; window open; template none; approver agent.comms_v2; hold none; run run_5778f0af-1d66-49e4-9022-0026b1c782db.

> Thanks Dan, that's helpful - a four inch ceiling fan where the light still works but the fan itself is dead.
> One more thing so Ben knows what he's looking at: is the fan wired to come on with the light switch, or does it have its own switch or pull cord?

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_c191909c-b12b-44cb-b89b-29440737d38d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Dan, that's helpful - a four inch ceiling fan where the light still works but the fan itself is dead.",
    "One more thing so Ben knows what he's looking at: is the fan wired to come on with the light switch, or does it have its own switch or pull cord?"
  ],
  "factIds": [
    "fact_0b8726d3-585d-469c-bb70-fb36dadf8e75",
    "fact_39821789-23a0-4a02-84e0-18770998fbc9",
    "fact_1d4a39d3-3f54-4c56-aab9-b527ca046e90",
    "fact_77ab7fc6-db14-4db4-af6f-a0c36fe12c7c"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_5778f0af-1d66-49e4-9022-0026b1c782db",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask job (fan model/brand, wired to light switch or separate, how it's accessed); call no; photos no; ready no",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "scoping",
    "exitNote": null,
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
  "conversationId": "case_c191909c-b12b-44cb-b89b-29440737d38d",
  "stage": "scoping",
  "tags": [],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:21:33.219Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:21:19.172Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:33.214Z",
      "content": "Hi Dan, thanks for getting in touch. So your bathroom extractor fan has stopped working - got it.\nJust so Ben has a clear picture, does it do anything at all when you switch it on?\nIf it's easy, a quick photo of the fan would help too, no pressure. Happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:21:33.219Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:44.261Z",
      "content": "Thanks Dan, that's helpful - a four inch ceiling fan where the light still works but the fan itself is dead.\nOne more thing so Ben knows what he's looking at: is the fan wired to come on with the light switch, or does it have its own switch or pull cord?"
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask postcode; call no; photos no; ready no; specialist error: Failed to parse structured output: Error: Failed to parse structured output: [
  {
    "origin": "string",
    "code": "too_big",
    "maximum": 40,
    "inclusive": true,
    "path": [
      "jobUnknowns",
      0
    ],
    "message": "Too big: expected string to have <=40 characters"
  }
]
Validation issues:
  - jobUnknowns.0: Too big: expected string to have <=40 characters; window open; template none; approver agent.comms_v2; hold none; run run_ecc97b4f-2acb-4997-aadb-1479d8d1fb18.

> Perfect, thanks Dan - NG7 2PQ, got that noted down.
> I'll add it to the file alongside the fan details for Ben.

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_c191909c-b12b-44cb-b89b-29440737d38d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Perfect, thanks Dan - NG7 2PQ, got that noted down.",
    "I'll add it to the file alongside the fan details for Ben."
  ],
  "factIds": [
    "fact_77ab7fc6-db14-4db4-af6f-a0c36fe12c7c"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_ecc97b4f-2acb-4997-aadb-1479d8d1fb18",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask postcode; call no; photos no; ready no; specialist error: Failed to parse structured output: Error: Failed to parse structured output: [\n  {\n    \"origin\": \"string\",\n    \"code\": \"too_big\",\n    \"maximum\": 40,\n    \"inclusive\": true,\n    \"path\": [\n      \"jobUnknowns\",\n      0\n    ],\n    \"message\": \"Too big: expected string to have <=40 characters\"\n  }\n]\nValidation issues:\n  - jobUnknowns.0: Too big: expected string to have <=40 characters",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "scoping",
    "exitNote": null,
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
  "conversationId": "case_c191909c-b12b-44cb-b89b-29440737d38d",
  "stage": "scoping",
  "tags": [],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:21:44.266Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:21:19.172Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:33.214Z",
      "content": "Hi Dan, thanks for getting in touch. So your bathroom extractor fan has stopped working - got it.\nJust so Ben has a clear picture, does it do anything at all when you switch it on?\nIf it's easy, a quick photo of the fan would help too, no pressure. Happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:21:33.219Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:44.261Z",
      "content": "Thanks Dan, that's helpful - a four inch ceiling fan where the light still works but the fan itself is dead.\nOne more thing so Ben knows what he's looking at: is the fan wired to come on with the light switch, or does it have its own switch or pull cord?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:21:44.266Z",
      "content": "We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:57.336Z",
      "content": "Perfect, thanks Dan - NG7 2PQ, got that noted down.\nI'll add it to the file alongside the fan details for Ben."
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

Planned send: 2 bubbles (desk); decision send; intent turn acknowledgement; subjects scoping; exception none; ask postcode; call no; photos no; ready no; specialist error: Failed to parse structured output: Error: Failed to parse structured output: [
  {
    "origin": "string",
    "code": "too_big",
    "maximum": 40,
    "inclusive": true,
    "path": [
      "jobUnknowns",
      0
    ],
    "message": "Too big: expected string to have <=40 characters"
  }
]
Validation issues:
  - jobUnknowns.0: Too big: expected string to have <=40 characters; window open; template none; approver agent.comms_v2; hold none; run run_11ff65f1-4f6a-4dbb-95d9-caaecd80b259.

> No worries at all, Dan - glad that makes sense.
> Just to double check the postcode I've got down for the fan job, it's NG7 2PQ, is that right?

- [2.1] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_c191909c-b12b-44cb-b89b-29440737d38d",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Dan"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No worries at all, Dan - glad that makes sense.",
    "Just to double check the postcode I've got down for the fan job, it's NG7 2PQ, is that right?"
  ],
  "factIds": [
    "fact_77ab7fc6-db14-4db4-af6f-a0c36fe12c7c",
    "fact_0b8726d3-585d-469c-bb70-fb36dadf8e75"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_11ff65f1-4f6a-4dbb-95d9-caaecd80b259",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn acknowledgement; subjects scoping; exception none; ask postcode; call no; photos no; ready no; specialist error: Failed to parse structured output: Error: Failed to parse structured output: [\n  {\n    \"origin\": \"string\",\n    \"code\": \"too_big\",\n    \"maximum\": 40,\n    \"inclusive\": true,\n    \"path\": [\n      \"jobUnknowns\",\n      0\n    ],\n    \"message\": \"Too big: expected string to have <=40 characters\"\n  }\n]\nValidation issues:\n  - jobUnknowns.0: Too big: expected string to have <=40 characters",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "scoping",
    "exitNote": null,
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
  "conversationId": "case_c191909c-b12b-44cb-b89b-29440737d38d",
  "stage": "scoping",
  "tags": [],
  "contactName": "Dan",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:21:57.338Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:21:19.172Z",
      "content": "Hi, my bathroom extractor fan has stopped working, can you sort it?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:33.214Z",
      "content": "Hi Dan, thanks for getting in touch. So your bathroom extractor fan has stopped working - got it.\nJust so Ben has a clear picture, does it do anything at all when you switch it on?\nIf it's easy, a quick photo of the fan would help too, no pressure. Happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:21:33.219Z",
      "content": "It's a ceiling fan, about four inch. The light still works but the fan is dead."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:44.261Z",
      "content": "Thanks Dan, that's helpful - a four inch ceiling fan where the light still works but the fan itself is dead.\nOne more thing so Ben knows what he's looking at: is the fan wired to come on with the light switch, or does it have its own switch or pull cord?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:21:44.266Z",
      "content": "We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:21:57.336Z",
      "content": "Perfect, thanks Dan - NG7 2PQ, got that noted down.\nI'll add it to the file alongside the fan details for Ben."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Dan",
      "at": "2026-09-11T01:21:57.338Z",
      "content": "Ok thanks, that all makes sense."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:14.988Z",
      "content": "No worries at all, Dan - glad that makes sense.\nJust to double check the postcode I've got down for the fan job, it's NG7 2PQ, is that right?"
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

Lines 2.2. Started 2026-09-11T01:22:14.991Z, 44459 ms.

Seed: customer new, name Mel, prefers text false, already rung false, window open. customer: honoured (name "Mel" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (tile size/type, how many tiles, access to bathroom, matching tile availability); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_e5fec91d-8718-40e0-80c5-91e0544d6693.

> Hi Mel, thanks for getting in touch - a cracked tile above the bath in NG7 2PQ, got it.
> Do you have a spare matching tile, or would we need to source one?
> If it's easy, a quick photo of the tile would help too, no pressure. Happy to give you a quick call if that's easier.

- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_f5a630f2-851f-4ba4-b5ef-ca484cb820ea",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Mel, thanks for getting in touch - a cracked tile above the bath in NG7 2PQ, got it.",
    "Do you have a spare matching tile, or would we need to source one?",
    "If it's easy, a quick photo of the tile would help too, no pressure. Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_6176b359-ea29-4c01-96fc-d7ce6925c631",
    "fact_13e665d4-8c6b-4783-9c60-c7c70e8c093f"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_e5fec91d-8718-40e0-80c5-91e0544d6693",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (tile size/type, how many tiles, access to bathroom, matching tile availability); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_f5a630f2-851f-4ba4-b5ef-ca484cb820ea",
  "stage": "ready",
  "tags": [],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:22:14.994Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:22:14.994Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:24.698Z",
      "content": "Hi Mel, thanks for getting in touch - a cracked tile above the bath in NG7 2PQ, got it.\nDo you have a spare matching tile, or would we need to source one?\nIf it's easy, a quick photo of the tile would help too, no pressure. Happy to give you a quick call if that's easier."
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask job (spare tile available or need sourcing, access); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_202d1a56-c682-44c1-95b2-9d87815f002a.

> Thanks Mel - one plain white tile, about 20cm square, cracked corner to corner above the bath. Got it.
> Do you happen to have a spare matching tile, or would it need sourcing?

- [2.2] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_f5a630f2-851f-4ba4-b5ef-ca484cb820ea",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Mel - one plain white tile, about 20cm square, cracked corner to corner above the bath. Got it.",
    "Do you happen to have a spare matching tile, or would it need sourcing?"
  ],
  "factIds": [
    "fact_6176b359-ea29-4c01-96fc-d7ce6925c631",
    "fact_075785b6-ea4f-4f35-a9ea-560731e8949f",
    "fact_1c862c52-8926-4b1f-9f96-a2e33c1c242d"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_202d1a56-c682-44c1-95b2-9d87815f002a",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask job (spare tile available or need sourcing, access); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_f5a630f2-851f-4ba4-b5ef-ca484cb820ea",
  "stage": "ready",
  "tags": [],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:22:24.703Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:22:14.994Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:24.698Z",
      "content": "Hi Mel, thanks for getting in touch - a cracked tile above the bath in NG7 2PQ, got it.\nDo you have a spare matching tile, or would we need to source one?\nIf it's easy, a quick photo of the tile would help too, no pressure. Happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:22:24.703Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:36.752Z",
      "content": "Thanks Mel - one plain white tile, about 20cm square, cracked corner to corner above the bath. Got it.\nDo you happen to have a spare matching tile, or would it need sourcing?"
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

Planned send: 2 bubbles (desk); decision send; intent turn decline; subjects scoping; exception none; ask job (spare matching tile or needs sourcing); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_0cbf31d7-1e76-413a-9c68-c624fce61226.

> No problem at all Mel, no photos needed - and good to know it's a standard tile from B&Q.
> Just one thing - do you have a spare matching tile, or would it need sourcing?

- [2.2] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.2] not_asks_subject: **PASS** - the reply does not ask about media
- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_f5a630f2-851f-4ba4-b5ef-ca484cb820ea",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No problem at all Mel, no photos needed - and good to know it's a standard tile from B&Q.",
    "Just one thing - do you have a spare matching tile, or would it need sourcing?"
  ],
  "factIds": [
    "fact_caa56311-8b61-46fc-9b13-9f38b3e83771",
    "fact_39cd424c-0eb2-4ca2-b93a-9394bfcf0913",
    "fact_e442ffd5-c46e-4759-b03b-02e5a627da8b"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_0cbf31d7-1e76-413a-9c68-c624fce61226",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn decline; subjects scoping; exception none; ask job (spare matching tile or needs sourcing); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_f5a630f2-851f-4ba4-b5ef-ca484cb820ea",
  "stage": "ready",
  "tags": [],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:22:36.757Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:22:14.994Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:24.698Z",
      "content": "Hi Mel, thanks for getting in touch - a cracked tile above the bath in NG7 2PQ, got it.\nDo you have a spare matching tile, or would we need to source one?\nIf it's easy, a quick photo of the tile would help too, no pressure. Happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:22:24.703Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:36.752Z",
      "content": "Thanks Mel - one plain white tile, about 20cm square, cracked corner to corner above the bath. Got it.\nDo you happen to have a spare matching tile, or would it need sourcing?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:22:36.757Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:46.423Z",
      "content": "No problem at all Mel, no photos needed - and good to know it's a standard tile from B&Q.\nJust one thing - do you have a spare matching tile, or would it need sourcing?"
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

Planned send: 2 bubbles (desk); decision send; intent turn question; subjects scoping; exception none; ask access; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_1cf7df38-edbe-40bc-91c1-97e76278b303.

> Fair question Mel - I've got the main details on the tile now, so not much more to cover.
> One thing that helps with planning: is there usually somewhere to park nearby, and will someone be in to let us in?

- [2.2] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.2] not_asks_subject: **PASS** - the reply does not ask about media
- [2.2] asked_at_most_once: **PASS** - media asked 0 times so far

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_f5a630f2-851f-4ba4-b5ef-ca484cb820ea",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Mel"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Fair question Mel - I've got the main details on the tile now, so not much more to cover.",
    "One thing that helps with planning: is there usually somewhere to park nearby, and will someone be in to let us in?"
  ],
  "factIds": [
    "fact_caa56311-8b61-46fc-9b13-9f38b3e83771",
    "fact_6176b359-ea29-4c01-96fc-d7ce6925c631"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_1cf7df38-edbe-40bc-91c1-97e76278b303",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn question; subjects scoping; exception none; ask access; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_f5a630f2-851f-4ba4-b5ef-ca484cb820ea",
  "stage": "ready",
  "tags": [],
  "contactName": "Mel",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:22:46.430Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:22:14.994Z",
      "content": "Hi, can you replace a cracked tile above our bath? We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:24.698Z",
      "content": "Hi Mel, thanks for getting in touch - a cracked tile above the bath in NG7 2PQ, got it.\nDo you have a spare matching tile, or would we need to source one?\nIf it's easy, a quick photo of the tile would help too, no pressure. Happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:22:24.703Z",
      "content": "It's one tile, cracked corner to corner. Plain white, about 20cm square."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:36.752Z",
      "content": "Thanks Mel - one plain white tile, about 20cm square, cracked corner to corner above the bath. Got it.\nDo you happen to have a spare matching tile, or would it need sourcing?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:22:36.757Z",
      "content": "I'd rather not send photos to be honest, is that ok? It's a standard tile from B&Q."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:46.423Z",
      "content": "No problem at all Mel, no photos needed - and good to know it's a standard tile from B&Q.\nJust one thing - do you have a spare matching tile, or would it need sourcing?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Mel",
      "at": "2026-09-11T01:22:46.430Z",
      "content": "What else do you need to know?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:22:59.449Z",
      "content": "Fair question Mel - I've got the main details on the tile now, so not much more to cover.\nOne thing that helps with planning: is there usually somewhere to park nearby, and will someone be in to let us in?"
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

Lines 2.3. Started 2026-09-11T01:22:59.450Z, 39184 ms.

Seed: customer new, name Alex, prefers text false, already rung false, window open. customer: honoured (name "Alex" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (which job first, bannister issue detail, door sticking cause, tap type); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_2c21e78d-0d24-409d-9561-dc602c08b4aa.

> Hi Alex, thanks for getting in touch - a wobbly bannister, a sticking door and a leaking outside tap in Beeston, got it.
> To get a feel for it, which of the three is bothering you most - is one more urgent than the others?
> If it's easy, a photo of each would help too, no pressure. Happy to give you a quick call if that's easier.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_95614e4b-19ed-4ca2-b108-d38f581f9bee",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Alex, thanks for getting in touch - a wobbly bannister, a sticking door and a leaking outside tap in Beeston, got it.",
    "To get a feel for it, which of the three is bothering you most - is one more urgent than the others?",
    "If it's easy, a photo of each would help too, no pressure. Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_a81c2987-57e3-4c66-b90a-3f7d5b3a50e0",
    "fact_4b0442fb-3871-430a-a7d3-0d173d81d145"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_2c21e78d-0d24-409d-9561-dc602c08b4aa",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (which job first, bannister issue detail, door sticking cause, tap type); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_95614e4b-19ed-4ca2-b108-d38f581f9bee",
  "stage": "ready",
  "tags": [],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:22:59.451Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:22:59.451Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:09.862Z",
      "content": "Hi Alex, thanks for getting in touch - a wobbly bannister, a sticking door and a leaking outside tap in Beeston, got it.\nTo get a feel for it, which of the three is bothering you most - is one more urgent than the others?\nIf it's easy, a photo of each would help too, no pressure. Happy to give you a"
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

Planned send: 2 bubbles (desk); decision send; intent turn question; subjects scoping; exception none; ask job (which of the three jobs first, bannister detail, door detail, tap detail); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_0110c6bc-e90b-4eb8-88ba-f6719fa60a2d.

> Good question - let's start with the bannister.
> When you say it's wobbly, is it the handrail itself that moves or the posts it's fixed to?

- [2.3] asks_subject: **PASS** - the reply asks about any
- [2.3] own_words: **PASS** - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)
  - model judge (beside, not instead): claude-haiku-4-5, prompt bcec9f60185c, verdict **yes** - The reply is natural and conversational, picks one specific item the customer mentioned (bannister), and asks one clarifying question about what 'wobbly' means rather than using a template.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_95614e4b-19ed-4ca2-b108-d38f581f9bee",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Good question - let's start with the bannister.",
    "When you say it's wobbly, is it the handrail itself that moves or the posts it's fixed to?"
  ],
  "factIds": [
    "fact_a81c2987-57e3-4c66-b90a-3f7d5b3a50e0"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_0110c6bc-e90b-4eb8-88ba-f6719fa60a2d",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn question; subjects scoping; exception none; ask job (which of the three jobs first, bannister detail, door detail, tap detail); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_95614e4b-19ed-4ca2-b108-d38f581f9bee",
  "stage": "ready",
  "tags": [],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:23:09.868Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:22:59.451Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:09.862Z",
      "content": "Hi Alex, thanks for getting in touch - a wobbly bannister, a sticking door and a leaking outside tap in Beeston, got it.\nTo get a feel for it, which of the three is bothering you most - is one more urgent than the others?\nIf it's easy, a photo of each would help too, no pressure. Happy to give you a"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:23:09.868Z",
      "content": "Which one do you want to know about first?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:20.846Z",
      "content": "Good question - let's start with the bannister.\nWhen you say it's wobbly, is it the handrail itself that moves or the posts it's fixed to?"
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask job (door sticking cause, tap fixture type, which job to prioritize); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_f8abb5c8-3eb0-48fc-b1ec-3d395ece4478.

> Got it - two spindles have come loose at the top of the stairs and the whole thing rocks when you lean on it. That's really helpful.
> Let's move on to the door next. Whereabouts is it catching when it sticks - the frame, the floor, or somewhere else?

- [2.3] own_words: **PASS** - one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)
  - model judge (beside, not instead): claude-haiku-4-5, prompt a9c769b6e18a, verdict **no** - The reply acknowledges the bannister issue well in bubble 1, but bubble 2 abruptly shifts to a completely different problem (a door) without finishing the bannister discussion or asking a natural follow-up question about it.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_95614e4b-19ed-4ca2-b108-d38f581f9bee",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Alex"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Got it - two spindles have come loose at the top of the stairs and the whole thing rocks when you lean on it. That's really helpful.",
    "Let's move on to the door next. Whereabouts is it catching when it sticks - the frame, the floor, or somewhere else?"
  ],
  "factIds": [
    "fact_ae9d9194-9e99-4a1c-b4a0-8a2b7df7eb02",
    "fact_a81c2987-57e3-4c66-b90a-3f7d5b3a50e0"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_f8abb5c8-3eb0-48fc-b1ec-3d395ece4478",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask job (door sticking cause, tap fixture type, which job to prioritize); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_95614e4b-19ed-4ca2-b108-d38f581f9bee",
  "stage": "ready",
  "tags": [],
  "contactName": "Alex",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:23:22.764Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:22:59.451Z",
      "content": "Hello, I've got a few odd jobs: a wobbly bannister, a door that sticks, and a leaking outside tap. We're in Beeston, NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:09.862Z",
      "content": "Hi Alex, thanks for getting in touch - a wobbly bannister, a sticking door and a leaking outside tap in Beeston, got it.\nTo get a feel for it, which of the three is bothering you most - is one more urgent than the others?\nIf it's easy, a photo of each would help too, no pressure. Happy to give you a"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:23:09.868Z",
      "content": "Which one do you want to know about first?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:20.846Z",
      "content": "Good question - let's start with the bannister.\nWhen you say it's wobbly, is it the handrail itself that moves or the posts it's fixed to?"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Alex",
      "at": "2026-09-11T01:23:22.764Z",
      "content": "The bannister is at the top of the stairs, two of the spindles have come loose and it rocks when you lean on it."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:37.103Z",
      "content": "Got it - two spindles have come loose at the top of the stairs and the whole thing rocks when you lean on it. That's really helpful.\nLet's move on to the door next. Whereabouts is it catching when it sticks - the frame, the floor, or somewhere else?"
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

Lines 2.4. Started 2026-09-11T01:23:38.634Z, 29833 ms.

Seed: customer new, name Chris, prefers text false, already rung false, window open. customer: honoured (name "Chris" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (gate material, hinge condition, how much it has dropped); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_7ffc4892-39b1-42e1-bc7d-3eec975b62e8.

> Hi Chris, thanks for getting in touch. A garden gate that's dropped and won't latch anymore, in NG9 - got it.
> Could you tell me what the gate's made of?
> If it's easy, a photo of the gate and the hinges would help too, no pressure. And happy to give you a quick call if that's easier.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_ff6624f2-f986-4478-92b3-c5ed99fa394a",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Chris, thanks for getting in touch. A garden gate that's dropped and won't latch anymore, in NG9 - got it.",
    "Could you tell me what the gate's made of?",
    "If it's easy, a photo of the gate and the hinges would help too, no pressure. And happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_30c68759-1657-4009-bd1d-f55e472599ad",
    "fact_63caa6ee-7d20-41d5-956c-05845689561a"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_7ffc4892-39b1-42e1-bc7d-3eec975b62e8",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (gate material, hinge condition, how much it has dropped); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_ff6624f2-f986-4478-92b3-c5ed99fa394a",
  "stage": "ready",
  "tags": [],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:23:38.637Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:23:38.637Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:48.875Z",
      "content": "Hi Chris, thanks for getting in touch. A garden gate that's dropped and won't latch anymore, in NG9 - got it.\nCould you tell me what the gate's made of?\nIf it's easy, a photo of the gate and the hinges would help too, no pressure. And happy to give you a quick call if that's easier."
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

Planned send: 1 bubble (desk); decision send; intent turn short_pause; subjects scoping; exception none; ask none; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_a96d9efc-12c0-43f7-b732-12cf9b38d78f.

> No rush at all, Chris - take your time.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_ff6624f2-f986-4478-92b3-c5ed99fa394a",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No rush at all, Chris - take your time."
  ],
  "factIds": [
    "fact_3cbef78d-1465-4041-81b4-de1aea066f83"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_a96d9efc-12c0-43f7-b732-12cf9b38d78f",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn short_pause; subjects scoping; exception none; ask none; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_ff6624f2-f986-4478-92b3-c5ed99fa394a",
  "stage": "ready",
  "tags": [],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:23:48.881Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:23:38.637Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:48.875Z",
      "content": "Hi Chris, thanks for getting in touch. A garden gate that's dropped and won't latch anymore, in NG9 - got it.\nCould you tell me what the gate's made of?\nIf it's easy, a photo of the gate and the hinges would help too, no pressure. And happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:23:48.881Z",
      "content": "one sec, let me check"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:56.766Z",
      "content": "No rush at all, Chris - take your time."
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask job (post replacement extent, hinge condition, gate size); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_0b39b271-45e5-4d61-8c96-9285d9c4aaf3.

> Thanks Chris - a wooden gate, and the post's rotted at the bottom so the whole thing leans. That explains the latch not catching.
> Is it just the one post that's gone, or are the others looking rotten too?

- [2.4] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.4] asks_subject: **PASS** - the reply asks about any

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_ff6624f2-f986-4478-92b3-c5ed99fa394a",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Chris"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Thanks Chris - a wooden gate, and the post's rotted at the bottom so the whole thing leans. That explains the latch not catching.",
    "Is it just the one post that's gone, or are the others looking rotten too?"
  ],
  "factIds": [
    "fact_30c68759-1657-4009-bd1d-f55e472599ad",
    "fact_3cbef78d-1465-4041-81b4-de1aea066f83",
    "fact_05528576-3f49-4d50-b87e-8db1b3e46dfe",
    "fact_56bdda32-b13d-41f5-8435-e5df4ea17894"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_0b39b271-45e5-4d61-8c96-9285d9c4aaf3",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask job (post replacement extent, hinge condition, gate size); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_ff6624f2-f986-4478-92b3-c5ed99fa394a",
  "stage": "ready",
  "tags": [],
  "contactName": "Chris",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:23:56.771Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:23:38.637Z",
      "content": "Hi, my garden gate has dropped and won't latch any more. We're in the NG9 area."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:48.875Z",
      "content": "Hi Chris, thanks for getting in touch. A garden gate that's dropped and won't latch anymore, in NG9 - got it.\nCould you tell me what the gate's made of?\nIf it's easy, a photo of the gate and the hinges would help too, no pressure. And happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:23:48.881Z",
      "content": "one sec, let me check"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:23:56.766Z",
      "content": "No rush at all, Chris - take your time."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Chris",
      "at": "2026-09-11T01:23:56.771Z",
      "content": "Right, it's a wooden gate. The post has rotted at the bottom so the whole thing leans."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:08.464Z",
      "content": "Thanks Chris - a wooden gate, and the post's rotted at the bottom so the whole thing leans. That explains the latch not catching.\nIs it just the one post that's gone, or are the others looking rotten too?"
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

Lines 2.5. Started 2026-09-11T01:24:08.467Z, 23045 ms.

Seed: customer new, name Sara, prefers text false, already rung false, window open. customer: honoured (name "Sara" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping+quoting; exception none; ask job (panel size, access for materials, fence type/material); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_4d0a5316-70a4-489b-b579-de5fcf5388c8.

> Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB is a pain. Thanks for getting in touch.
> What sort of fence panels are they? If it's easy, a photo of the damage would help too, no pressure.
> Happy to give you a quick call if that's easier.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_4cba4982-98dc-435f-96c3-64bcd9a228b4",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB is a pain. Thanks for getting in touch.",
    "What sort of fence panels are they? If it's easy, a photo of the damage would help too, no pressure.",
    "Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_39c3581b-ed1e-4f01-8eda-b02091d15f5e",
    "fact_6e9f6a13-12d3-4302-996e-7903629b013a"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_4d0a5316-70a4-489b-b579-de5fcf5388c8",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping+quoting; exception none; ask job (panel size, access for materials, fence type/material); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_4cba4982-98dc-435f-96c3-64bcd9a228b4",
  "stage": "ready",
  "tags": [],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:24:08.470Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:24:08.470Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:21.129Z",
      "content": "Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB is a pain. Thanks for getting in touch.\nWhat sort of fence panels are they? If it's easy, a photo of the damage would help too, no pressure.\nHappy to give you a quick call if that's easier."
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

Planned send: 2 bubbles (desk); decision send; intent turn promise_of_more; subjects scoping; exception none; ask none; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_7f220862-2121-4179-8737-66121dc18bfb.

> No problem at all, Sara - whenever you're home is fine.
> I'll keep an eye out for the photos of the fence panels and we'll pick it up from there.

- [2.5] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.5] bubble_count_within: **PASS** - 2 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_4cba4982-98dc-435f-96c3-64bcd9a228b4",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "No problem at all, Sara - whenever you're home is fine.",
    "I'll keep an eye out for the photos of the fence panels and we'll pick it up from there."
  ],
  "factIds": [
    "fact_241e4119-2d27-403b-a83a-f7e9c40cc182",
    "fact_4aa715b0-8ea8-4e2f-b71f-7eb284bce1f5",
    "fact_39c3581b-ed1e-4f01-8eda-b02091d15f5e"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_7f220862-2121-4179-8737-66121dc18bfb",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn promise_of_more; subjects scoping; exception none; ask none; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_4cba4982-98dc-435f-96c3-64bcd9a228b4",
  "stage": "ready",
  "tags": [],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:24:21.135Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:24:08.470Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:21.129Z",
      "content": "Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB is a pain. Thanks for getting in touch.\nWhat sort of fence panels are they? If it's easy, a photo of the damage would help too, no pressure.\nHappy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:24:21.135Z",
      "content": "I'll send photos tomorrow when I'm home."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:31.506Z",
      "content": "No problem at all, Sara - whenever you're home is fine.\nI'll keep an eye out for the photos of the fence panels and we'll pick it up from there."
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

Planned send: nothing goes; decision none; intent -; window open; template none; approver none; hold none; run run_da6f7ea8-299d-4928-8a99-1a28706d6ddd.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_4cba4982-98dc-435f-96c3-64bcd9a228b4",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [],
  "factIds": [],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": null,
  "runId": "run_da6f7ea8-299d-4928-8a99-1a28706d6ddd",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": null,
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": "clock pass: no customer turn, nothing to reply to; the desk never chases",
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
  "conversationId": "case_4cba4982-98dc-435f-96c3-64bcd9a228b4",
  "stage": "ready",
  "tags": [],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:24:21.135Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:24:08.470Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:21.129Z",
      "content": "Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB is a pain. Thanks for getting in touch.\nWhat sort of fence panels are they? If it's easy, a photo of the damage would help too, no pressure.\nHappy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:24:21.135Z",
      "content": "I'll send photos tomorrow when I'm home."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:31.506Z",
      "content": "No problem at all, Sara - whenever you're home is fine.\nI'll keep an eye out for the photos of the fence panels and we'll pick it up from there."
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

Planned send: nothing goes; decision none; intent -; window open; template none; approver none; hold none; run run_05979fd9-3e04-44d6-9866-b467892aeddd.

- [2.5] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_4cba4982-98dc-435f-96c3-64bcd9a228b4",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Sara"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [],
  "factIds": [],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": null,
  "runId": "run_05979fd9-3e04-44d6-9866-b467892aeddd",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": null,
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": "clock pass: no customer turn, nothing to reply to; the desk never chases",
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
  "conversationId": "case_4cba4982-98dc-435f-96c3-64bcd9a228b4",
  "stage": "ready",
  "tags": [],
  "contactName": "Sara",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:24:21.135Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:24:08.470Z",
      "content": "Hi, three fence panels have blown down in the storm. We're NG9 5AB, can you quote to replace them?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:21.129Z",
      "content": "Hi Sara, sorry to hear that - three fence panels down in the storm at NG9 5AB is a pain. Thanks for getting in touch.\nWhat sort of fence panels are they? If it's easy, a photo of the damage would help too, no pressure.\nHappy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Sara",
      "at": "2026-09-11T01:24:21.135Z",
      "content": "I'll send photos tomorrow when I'm home."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:31.506Z",
      "content": "No problem at all, Sara - whenever you're home is fine.\nI'll keep an eye out for the photos of the fence panels and we'll pick it up from there."
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

Lines 2.6. Started 2026-09-11T01:24:31.512Z, 20246 ms.

Seed: customer new, name Tom, prefers text false, already rung false, window open. customer: honoured (name "Tom" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (fan type/model, ceiling or wall mounted, existing ducting or new); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_4051f093-e15e-4553-b433-907606504843.

> Hi Tom, thanks for getting in touch - a bathroom extractor fan replacement in NG7 2PQ, got it.
> Is the current fan mounted in the ceiling or on the wall?
> If it's easy, a photo of the existing fan would help too, no pressure. Happy to give you a quick call if that's easier.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_87112ace-5595-470e-bddb-1af7b5b62182",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Tom"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Tom, thanks for getting in touch - a bathroom extractor fan replacement in NG7 2PQ, got it.",
    "Is the current fan mounted in the ceiling or on the wall?",
    "If it's easy, a photo of the existing fan would help too, no pressure. Happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_082229fb-ed1c-44a9-9f4e-8443a694fe55",
    "fact_8b75edaf-9a32-48ce-b889-711f5444cf85"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_4051f093-e15e-4553-b433-907606504843",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (fan type/model, ceiling or wall mounted, existing ducting or new); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_87112ace-5595-470e-bddb-1af7b5b62182",
  "stage": "ready",
  "tags": [],
  "contactName": "Tom",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:24:31.513Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-11T01:24:31.513Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:41.284Z",
      "content": "Hi Tom, thanks for getting in touch - a bathroom extractor fan replacement in NG7 2PQ, got it.\nIs the current fan mounted in the ceiling or on the wall?\nIf it's easy, a photo of the existing fan would help too, no pressure. Happy to give you a quick call if that's easier."
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

Planned send: 2 bubbles (desk); decision send; intent turn question; subjects scheduling; exception none; ask access; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_08119d70-480c-4c87-bc22-06fa19ab6e68.

> Good question Tom - dates come with your quote, so once Ben's got everything he needs he'll send that over with when he can come.
> Just one more thing for now - is parking fairly easy near you in NG7?

- [2.6] reply_sent: **PASS** - a reply would go (2 bubbles, desk)
- [2.6] no_date: **PASS** - no date, time or duration in the reply
- [2.6] text_matches: **PASS** - matches /\bquote\b/: "quote"
- [2.6] asks_subject: **PASS** - the reply asks about any

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_87112ace-5595-470e-bddb-1af7b5b62182",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Tom"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Good question Tom - dates come with your quote, so once Ben's got everything he needs he'll send that over with when he can come.",
    "Just one more thing for now - is parking fairly easy near you in NG7?"
  ],
  "factIds": [
    "fact_082229fb-ed1c-44a9-9f4e-8443a694fe55",
    "fact_8b75edaf-9a32-48ce-b889-711f5444cf85"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_08119d70-480c-4c87-bc22-06fa19ab6e68",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn question; subjects scheduling; exception none; ask access; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_87112ace-5595-470e-bddb-1af7b5b62182",
  "stage": "ready",
  "tags": [],
  "contactName": "Tom",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:24:41.289Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-11T01:24:31.513Z",
      "content": "Hi, I need a bathroom extractor fan replacing. We're in NG7 2PQ."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:41.284Z",
      "content": "Hi Tom, thanks for getting in touch - a bathroom extractor fan replacement in NG7 2PQ, got it.\nIs the current fan mounted in the ceiling or on the wall?\nIf it's easy, a photo of the existing fan would help too, no pressure. Happy to give you a quick call if that's easier."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Tom",
      "at": "2026-09-11T01:24:41.289Z",
      "content": "When can you come?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:24:51.753Z",
      "content": "Good question Tom - dates come with your quote, so once Ben's got everything he needs he'll send that over with when he can come.\nJust one more thing for now - is parking fairly easy near you in NG7?"
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

Lines 2.7. Started 2026-09-11T01:24:51.758Z, 19461 ms.

Seed: customer new, name Nina, prefers text false, already rung false, window open. customer: honoured (name "Nina" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (tap type/compatibility, existing pipework condition); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_be63fc33-7f25-412f-90d0-a5f7983db31e.

> Hi Nina, thanks for getting in touch - fitting a new kitchen tap that you've already bought, in NG7 1AA, no problem at all.
> One quick thing - what sort of tap is it, a standard mixer or something like a pull-out or boiling water tap? A photo of the tap and the space under the sink would help if it's easy, no pressure.
> Happy to give you a quick call if that's easier too.

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_e02c7661-49e3-4997-a28b-a6e0455ca5f6",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Nina"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Nina, thanks for getting in touch - fitting a new kitchen tap that you've already bought, in NG7 1AA, no problem at all.",
    "One quick thing - what sort of tap is it, a standard mixer or something like a pull-out or boiling water tap? A photo of the tap and the space under the sink would help if it's easy, no pressure.",
    "Happy to give you a quick call if that's easier too."
  ],
  "factIds": [
    "fact_050e68f1-4a3a-44f2-81b4-42821caa07f6",
    "fact_4deec2b0-9992-4a7a-8657-02167c605fb9"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_be63fc33-7f25-412f-90d0-a5f7983db31e",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (tap type/compatibility, existing pipework condition); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_e02c7661-49e3-4997-a28b-a6e0455ca5f6",
  "stage": "ready",
  "tags": [],
  "contactName": "Nina",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:24:51.759Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-11T01:24:51.759Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:25:01.067Z",
      "content": "Hi Nina, thanks for getting in touch - fitting a new kitchen tap that you've already bought, in NG7 1AA, no problem at all.\nOne quick thing - what sort of tap is it, a standard mixer or something like a pull-out or boiling water tap? A photo of the tap and the space under the sink would help if it's"
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

Planned send: 2 bubbles (desk); decision send; intent turn question; subjects quoting; exception money; ask access; call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold ben (money: How much); run run_b6df0b6e-f6eb-48cf-9163-28bb9d76d503.

> Totally fair question, Nina - Ben will come back to you on the price for fitting the tap once he's had a look at the details.
> One more thing to help him get it right - is there somewhere to park nearby, or will someone need to be in to let him in?

- [2.7] hold_for_approver: **PASS** - held for ben: money: How much
- [2.7] no_figure: **PASS** - no figure in the reply

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_e02c7661-49e3-4997-a28b-a6e0455ca5f6",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Nina"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Totally fair question, Nina - Ben will come back to you on the price for fitting the tap once he's had a look at the details.",
    "One more thing to help him get it right - is there somewhere to park nearby, or will someone need to be in to let him in?"
  ],
  "factIds": [
    "fact_050e68f1-4a3a-44f2-81b4-42821caa07f6",
    "fact_3939d3f6-0ccc-4009-9799-ab84f182688a"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_b6df0b6e-f6eb-48cf-9163-28bb9d76d503",
  "hold": {
    "approver": "ben",
    "reason": "money: How much",
    "since": "2026-09-11T01:25:05.808Z"
  },
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn question; subjects quoting; exception money; ask access; call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_e02c7661-49e3-4997-a28b-a6e0455ca5f6",
  "stage": "ready",
  "tags": [],
  "contactName": "Nina",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:25:01.072Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-11T01:24:51.759Z",
      "content": "Hi, can you fit a new kitchen tap? I've already bought the tap. We're NG7 1AA."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:25:01.067Z",
      "content": "Hi Nina, thanks for getting in touch - fitting a new kitchen tap that you've already bought, in NG7 1AA, no problem at all.\nOne quick thing - what sort of tap is it, a standard mixer or something like a pull-out or boiling water tap? A photo of the tap and the space under the sink would help if it's"
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Nina",
      "at": "2026-09-11T01:25:01.072Z",
      "content": "How much roughly?"
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:25:11.216Z",
      "content": "Totally fair question, Nina - Ben will come back to you on the price for fitting the tap once he's had a look at the details.\nOne more thing to help him get it right - is there somewhere to park nearby, or will someone need to be in to let him in?"
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

Lines 2.8. Started 2026-09-11T01:25:11.220Z, 19610 ms.

Seed: customer new, name Lee, prefers text false, already rung false, window open. customer: honoured (name "Lee" passed to POST /start as the pushname).

#### Turn 1 (customer/message): Hi, I need an internal door rehung, it's catching on the frame. We're in NG9.

Planned send: 3 bubbles (desk); decision send; intent turn enquiry; subjects scoping; exception none; ask job (which side it's catching, door size/material, hinge condition); call yes; photos mention; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_41b50387-9099-4662-a150-6cbf5717c4f0.

> Hi Lee, thanks for getting in touch. So an internal door that's catching on the frame and needs rehanging, over in NG9 - got it.
> Could you tell me where it's catching - is it the top, the latch side or down at the bottom?
> If it's easy, a quick photo of the door and frame would help too, no pressure. And happy to give you a quick call if that's easier.

- [2.8] reply_sent: **PASS** - a reply would go (3 bubbles, desk)
- [2.8] bubble_count_within: **PASS** - 3 bubbles, ceiling 4

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_8d65d39d-7cce-4b70-be0c-85d6b247ed22",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Hi Lee, thanks for getting in touch. So an internal door that's catching on the frame and needs rehanging, over in NG9 - got it.",
    "Could you tell me where it's catching - is it the top, the latch side or down at the bottom?",
    "If it's easy, a quick photo of the door and frame would help too, no pressure. And happy to give you a quick call if that's easier."
  ],
  "factIds": [
    "fact_12245acb-f869-475b-9710-0523ebbc79c5",
    "fact_0dd5ed62-6421-4f28-8637-5bf88646b6b1"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_41b50387-9099-4662-a150-6cbf5717c4f0",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn enquiry; subjects scoping; exception none; ask job (which side it's catching, door size/material, hinge condition); call yes; photos mention; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_8d65d39d-7cce-4b70-be0c-85d6b247ed22",
  "stage": "ready",
  "tags": [],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:25:11.222Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:25:11.222Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:25:20.523Z",
      "content": "Hi Lee, thanks for getting in touch. So an internal door that's catching on the frame and needs rehanging, over in NG9 - got it.\nCould you tell me where it's catching - is it the top, the latch side or down at the bottom?\nIf it's easy, a quick photo of the door and frame would help too, no pressure."
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

Planned send: nothing goes; decision none; intent -; window open; template none; approver none; hold none; run run_714db60d-7e7f-44d1-9bfd-22de697c2103.

- [2.8] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_8d65d39d-7cce-4b70-be0c-85d6b247ed22",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [],
  "factIds": [],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": null,
  "runId": "run_714db60d-7e7f-44d1-9bfd-22de697c2103",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": null,
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": "clock pass: no customer turn, nothing to reply to; the desk never chases",
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
  "conversationId": "case_8d65d39d-7cce-4b70-be0c-85d6b247ed22",
  "stage": "ready",
  "tags": [],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:25:11.222Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:25:11.222Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:25:20.523Z",
      "content": "Hi Lee, thanks for getting in touch. So an internal door that's catching on the frame and needs rehanging, over in NG9 - got it.\nCould you tell me where it's catching - is it the top, the latch side or down at the bottom?\nIf it's easy, a quick photo of the door and frame would help too, no pressure."
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

Planned send: 2 bubbles (desk); decision send; intent turn answer; subjects scoping; exception none; ask job (where it's catching (top/latch/bottom)); call no; photos no; ready yes; window open; template none; approver agent.comms_v2; hold none; run run_99d6c3d8-68a6-48b9-9a3f-13d12d16f27a.

> Ah, the upstairs bathroom door - and it's been catching since the summer, got it.
> Just so Ben knows what he's looking at, where's it catching - the top, the latch side or down at the bottom?

- [2.8] reply_sent: **PASS** - a reply would go (2 bubbles, desk)

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_8d65d39d-7cce-4b70-be0c-85d6b247ed22",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [
    "Ah, the upstairs bathroom door - and it's been catching since the summer, got it.",
    "Just so Ben knows what he's looking at, where's it catching - the top, the latch side or down at the bottom?"
  ],
  "factIds": [
    "fact_6760f748-c630-416b-8708-82e96acbc71c",
    "fact_d8d169b8-d991-4b1e-b581-49a0610a168f",
    "fact_12245acb-f869-475b-9710-0523ebbc79c5"
  ],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": "agent.comms_v2",
  "runId": "run_99d6c3d8-68a6-48b9-9a3f-13d12d16f27a",
  "hold": null,
  "delivered": true,
  "origin": "desk",
  "evidence": {
    "decision": "send",
    "intent": "turn answer; subjects scoping; exception none; ask job (where it's catching (top/latch/bottom)); call no; photos no; ready yes",
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": null,
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
  "conversationId": "case_8d65d39d-7cce-4b70-be0c-85d6b247ed22",
  "stage": "ready",
  "tags": [],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:25:20.530Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:25:11.222Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:25:20.523Z",
      "content": "Hi Lee, thanks for getting in touch. So an internal door that's catching on the frame and needs rehanging, over in NG9 - got it.\nCould you tell me where it's catching - is it the top, the latch side or down at the bottom?\nIf it's easy, a quick photo of the door and frame would help too, no pressure."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:25:20.530Z",
      "content": "It's the bathroom door upstairs, been like it since the summer."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:25:30.824Z",
      "content": "Ah, the upstairs bathroom door - and it's been catching since the summer, got it.\nJust so Ben knows what he's looking at, where's it catching - the top, the latch side or down at the bottom?"
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

Planned send: nothing goes; decision none; intent -; window open; template none; approver none; hold none; run run_94e3ecb2-8517-4738-bb7f-dcfe0b85ecca.

- [2.8] reply_not_sent: **PASS** - nothing goes: decision none

<details><summary>Planned send (full)</summary>

```json
{
  "caseId": "case_8d65d39d-7cce-4b70-be0c-85d6b247ed22",
  "party": {
    "role": "homeowner",
    "address": "+447700900942",
    "name": "Lee"
  },
  "channel": "whatsapp",
  "windowState": "open",
  "templateId": null,
  "bubbles": [],
  "factIds": [],
  "kbIds": [],
  "guards": {
    "figure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "date_time_duration": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "commitment_fault": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "business_claim": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "disclosure": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "one_reply": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "ask_ledger": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    },
    "regulated": {
      "result": "pass",
      "via": [
        "comms_v2"
      ],
      "note": null
    }
  },
  "approver": null,
  "runId": "run_94e3ecb2-8517-4738-bb7f-dcfe0b85ecca",
  "hold": null,
  "delivered": false,
  "origin": "none",
  "evidence": {
    "decision": "none",
    "intent": null,
    "lane": "comms_v2",
    "pack": null,
    "stageAfter": "ready",
    "exitNote": "clock pass: no customer turn, nothing to reply to; the desk never chases",
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
  "conversationId": "case_8d65d39d-7cce-4b70-be0c-85d6b247ed22",
  "stage": "ready",
  "tags": [],
  "contactName": "Lee",
  "window": {
    "canFreeform": true,
    "summary": "the customer wrote on WhatsApp at 2026-09-11T01:25:20.530Z"
  },
  "messages": [
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:25:11.222Z",
      "content": "Hi, I need an internal door rehung, it's catching on the frame. We're in NG9."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:25:20.523Z",
      "content": "Hi Lee, thanks for getting in touch. So an internal door that's catching on the frame and needs rehanging, over in NG9 - got it.\nCould you tell me where it's catching - is it the top, the latch side or down at the bottom?\nIf it's easy, a quick photo of the door and frame would help too, no pressure."
    },
    {
      "direction": "inbound",
      "channel": "whatsapp",
      "sender": "Lee",
      "at": "2026-09-11T01:25:20.530Z",
      "content": "It's the bathroom door upstairs, been like it since the summer."
    },
    {
      "direction": "outbound",
      "channel": "whatsapp",
      "sender": "desk",
      "at": "2026-09-11T01:25:30.824Z",
      "content": "Ah, the upstairs bathroom door - and it's been catching since the summer, got it.\nJust so Ben knows what he's looking at, where's it catching - the top, the latch side or down at the bottom?"
    }
  ],
  "quote": null,
  "openFlags": [],
  "openPromises": [],
  "lastCall": null
}
```

</details>

