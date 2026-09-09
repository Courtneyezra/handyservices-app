---
name: customer-data-processors
description: Use when adding, removing or changing any provider that receives customer content — a model, a transcriber, a media store, an analytics tool — or when a customer data flow, retention period or erasure question comes up. Two files must be updated in the same PR.
---

# Adding a processor of customer data

Two files describe what the system does with customer data, and they must be kept true
whenever a data flow changes:

- `client/src/pages/PrivacyPolicyPage.tsx` — the customer-facing notice at `/privacy`.
- `docs/COMMS_RECORD_OF_PROCESSING.md` — the internal Article 30 record: categories,
  purposes, bases, every processor with the file that proves it, storage, retention.

Adding a provider that receives customer content — a model, a transcriber, a store, an
analytics tool — means naming it in **both**, with its purpose, in the same PR.

`client/src/pages/__tests__/PrivacyPolicyPage.test.tsx` asserts that each named processor
carries a purpose, so a silent deletion fails the suite.

## Two standing facts

**Retention is documented but not enforced.** The notice states retention periods that no
code implements: there is no deletion job and no erasure tooling. Read
`docs/COMMS_RECORD_OF_PROCESSING.md` §6 before quoting a retention period anywhere.

**There is deliberately no bot-disclosure line to customers in chat.** That is an owner
decision. The transparency lives on the notice, not in the message thread. Do not add one.
