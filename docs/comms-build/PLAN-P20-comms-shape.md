> # ⛔ SUPERSEDED — DO NOT BUILD FROM THIS FILE
>
> Reviewed **flawed** on 6 Sep 2026 (`P20-REVIEW.md`). Its two load-bearing premises were false:
> the estimator already accepts a bare line list with no conversation, and the move/words "fusion"
> it argues from does not exist (intent is already a closed enum, tiers and templates are already
> per intent, and Ben's chips already separate `wrong_move` from `tone`).
>
> **The live document is `PRD-COMMS.md`.** This file is kept only as the record of what was
> proposed and why it was rejected.

# Plan P20 — the shape comms should be developed into

Written 6 Sep 2026, out of a first-principles reset (`~/Desktop/Handy Services/V6 Switchboard/Comms
Architecture (first principles).md`) and a decomposition audit run against the live code. A plan for
the owner to check, and to be pressure-tested before it becomes briefs.

## 0. The claim in one line

**Comms should get smaller.** It is currently the bucket everything customer-facing fell into. Every
release from here should leave less in it, not more.

## 1. The test for what belongs

> Does it change what we **know**, or does it change what we **say**?

Knowing: scoping, measuring, pricing, scheduling — the business. Saying: acknowledging, asking,
replying, chasing, notifying — comms. By this test the **quote clerk and the estimator are not
comms**. They must work when Ben types a job in by hand with no thread involved. Today they cannot:
both are `SpineAgent`s, and that contract hands them a `CaseFile`.

## 2. What is left in comms afterwards

| Part | Job |
|---|---|
| The wire | WhatsApp, SMS, voice, templates, windows, opt-outs. Works. Leave alone |
| The record | Every message, call, decision and human action, in order |
| The decision | Is there anything to say · whose is it · what is the move · is it safe |
| The words | Rendering a move into the brand voice |

Plus **adapters** — "read this conversation into a Scope", "read this call transcript into a Scope".
Adapters stay comms-side: they are allowed to know what a message is. What they produce is not.

## 3. The four questions, and what checks each today

Audited against the code on 5 Sep.

| Question | Decided separately? | Checked separately? |
|---|---|---|
| Does this need a reply at all? | Only 3 special cases (opt-out, spam, P7 `waiting_for_promised`) | Partial — and the general path leaks an empty body (D4) |
| Is it Ben's? | ✅ four independent ways | ✅ |
| What is the move? | ❌ fused with the words | ❌ only "is this intent permitted", never "is it right" |
| What are the words? | ❌ fused with the move | ✅ eleven detectors in `guards.ts` |

Evidence for the Ben lane being sound: `triageRules` lexicons (`triage.ts:110-140`), the Haiku model
which can only *add* exceptions, `decide.ts:88` above everything, and the Scoper's structural
auto-flag (`scoper.ts:481`).

Evidence for the fusion: `propose_reply({intent, body, …})` — one tool call, one forward pass
(`scoper.ts:283`).

## 4. The one structural change inside comms: split the move from the words

Three consequences, all wanted:

1. **The move becomes a small closed set** — answer / ask for a named gap / point to the quote page /
   hold / hand to Ben. A classification problem, not a generation problem. Cheap and testable.
2. **The words become mostly rendering.** With the move fixed, a large share of replies are a
   template with a slot, which pushes more of the surface down to *rung zero* (fixed words, no
   generation) — where anything unsupervised belongs.
3. **Evals sharpen.** "Was that a good reply?" becomes two clean questions. The rubric already
   exists: `verifier.ts` scores `moveRight` / `voiceRight` / `unsafe` separately. It has never run
   before a send — only in the morning sampler, on sends already made, and only when
   `spine.sampler.enabled` is true (off).

### Why this gates autonomy rather than merely improving it

Ben's verdict chips are `tone` / `wrong_move` / `unsafe` / `missing_info`, applied to a single
artifact that conflates a decision and a sentence. When he taps `wrong_move` the ladder cannot tell
whether the reply asked the wrong question or phrased the right one badly. **The evidence that
promotes an intent to SEND is muddy by construction.**

Split, the ladder means something: an intent can earn autonomy over the *move* while the *words* stay
templated — a far safer thing to promote than "the model may now write freely to customers".

Autonomy is eligible from 17 Sep. This plan says it should arrive after the split, not before.

## 5. Entity extraction — "tools in the van"

The entities come out as **modules, not services**. One repo, one process, hard internal boundaries.
Independence is about *knowledge*, not location: a separate server sharing a database and its
caller's assumptions is not independent, merely distant; a module that cannot name a conversation is.

### The test for a genuinely independent entity
1. **Its input type is not a `CaseFile` or a conversation id.** (The sharp one — the estimator and
   clerk fail this today.)
2. It can be exercised by a script with no database and no thread.
3. It returns a value; it does not write into conversation state.
4. Its tests do not need a conversation.

### Enforcement
`server/spine/architecture.test.ts` already fails the build on a forbidden import (it reads source
files and asserts, e.g. `estimate-routes.ts` never imports a pricing engine). Extend the same
mechanism: one public entry file per entity, everything else internal, and an assertion that no
entity module imports a conversation type. This is the same rigour a network boundary gives, at zero
runtime cost, using a mechanism the repo already owns.

### Where an API genuinely belongs
- **Browser → server** for the second caller (`POST /api/estimate` when Ben types a job in by hand).
- **LLM → entity** as a schema-validated tool definition, the same shape as `propose_reply`'s
  `input_schema` with its refusals.

Neither requires a network hop between our own modules.

### Order and the second caller that proves each
| Entity | Independent today? | Second caller |
|---|---|---|
| **Price** | Nearly — rules over an estimate | A script pricing a hand-typed line list |
| **Estimate** | No — a spine agent taking a case file | Ben's builder measuring a job he typed in |
| **Scope** | No — produced inside the spine run | The admin "new job" form |
| **Job Pack** | Partly — already its own record | Has two already (desk + contractor portal) ✅ |

Price first, deliberately: it is closest to clean, so it proves the seam shape cheaply and teaches us
the contract before we touch the tangled one. **An entity with exactly one caller has not been proven
independent, it has only been moved.**

## 6. What a run looks like afterwards

```
inbound
  → record it
  → Is there anything to say?        <- cheap, explicit, can end here
  → Whose is it?                     <- triage (already sound, four checks)
  → [ask the tools: scope? estimate? price? pack?]
  → What is the move?                <- closed set, judged separately
  → What are the words?              <- render the move, often a template
  → Guards on the words
  → Tier: send / draft / flag
  → One door
```

## 7. Order of work, given live customers

1. **D4 — the empty body.** `scoper.ts:497` returns `{intent:'holding', body:[]}`; `decide.ts:100`
   only catches an empty body when `proposal.artifact` is set; `holding` is not caught by
   `FORBIDDEN_INTENT_SMELL` so autonomy can promote it; no guard, `deliverable()` or
   `sendCustomerMessage` refuses an empty string. Harmless while everything is DRAFT. Arms itself on
   17 Sep.
2. **Extract the entities** — Price → Estimate → Scope, in place, each with its second caller,
   boundaries enforced by the architecture test. Behaviour unchanged; comms shrinks.
3. **D5 — run the move-quality rubric on drafts**, advisory, before the send. Measures how good the
   current fused move actually is *before* restructuring around it.
4. **Split move from words**, using what D5 measured.
5. **D6 — the explicit "anything to say?" step.**
6. **Then** turn the autonomy dial, per intent, per move.

## 8. Invariants this plan must not break

1. **One door.** No extracted entity gains its own path to the wire.
2. **One read of the world.** Entities receive what they are given; none fetches its own context.
3. **Silence is a failure state.**
4. **No dead ends** — every handback to a human is a pause with a resume condition.
5. **Facts are looked up, never generated** (prices, dates, promises).
6. **Quote acceptance and editing stay human. Permanently.** A policy decision, not a capability gap.

## 9. What this plan says NOT to do

- Do not build a v4 alongside. Strangle in place.
- Do not split into services.
- Do not touch the exit.
- Do not move quote acceptance.
