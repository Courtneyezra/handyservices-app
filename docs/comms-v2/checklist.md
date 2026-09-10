# The comms desk: what should happen, stage by stage

Goal 1 of the build is judged against the WhatsApp lines of Stage 1 (1.1, 1.6, 1.7) and all of
Stage 2. Lines 1.2 to 1.5 belong to Goal 2, once a second channel exists.

The test oracle for sandbox threads. A thread either matches a line here or it does not, and a
mismatch is a finding rather than a discussion.

Sources, marked per line: **[C]** the captain's direct answer (`comms-expected-behaviour.md`),
**[O]** an owner decision already in PRD v3, **[?]** firstmate's inference and NOT yet confirmed.
Correct any **[?]** and it becomes **[C]**.

Written 8 Sep 2026 against `941f467` plus PRs 17, 19 and 20 pending.

---

## Cross-cutting, true at every stage

1. If a customer writes, they hear something back. Silence is almost never correct. **[C]**
2. One reply per customer turn, up to three bubbles. Not one reply per inbound message. **[C]**
3. Hours do not decide whether we reply. Inside the messaging window we answer at any hour. **[C]**
   Outside the 24h window only an approved Meta template can send at all. Platform limit, not policy.
4. Never a figure that was not looked up, a date, a time, a duration, a commitment, an admission of
   fault, or a claim we cannot evidence. **[O]** (PRD §5.2)
5. Gas is the only work we turn away. Plumbing, roofing, structural and electrical are ours. **[C]**
6. Quote acceptance and editing stay human, permanently. **[O]** (PRD §11.7)
7. We never ask twice for the same thing, and never thank twice for the same photo. **[C]**

## Stage 1 - First contact

| # | Expected | How you see it |
|---|---|---|
| 1.1 | **Inbound WhatsApp**: the customer's own message opens the window; they get one acknowledgement that quotes their enquiry back and offers a call, freeform **[O]** | Sandbox WhatsApp door, type the opening line |
| 1.2 | **Webform**: acknowledgement carries the enquiry's context **[O]** | Webform door |
| 1.3 | **Post-call**: template opens WhatsApp with the name and context from the call **[O]** | Post-call door |
| 1.4 | **Inbound SMS**: reply on SMS, try to move them to WhatsApp **[O]** | SMS door |
| 1.5 | A customer who already rang us is **not** asked "is it OK if we give you a call" **[O]** (§4.2) | Missed-call and post-call doors |
| 1.6 | A `prefers_text` customer is never asked for a call again **[O]** (§4.2) | Reply "text only please", then continue |
| 1.7 | Photos arriving with the first message are acknowledged as photos, not as a bare enquiry **[C]** | WhatsApp door, attach on the opening message |

## Stage 2 - Scoping

| # | Expected | How you see it |
|---|---|---|
| 2.1 | It replies to every customer turn, whether or not the reply is a question **[C]** | Answer its question with a statement; expect a reply |
| 2.2 | It asks for a photo **once**. If they reply without sending one, it proceeds **[C]** | Ignore the photo ask and answer in words |
| 2.3 | It asks about the job, one thing at a time, in its own words **[O]** (§5.1) | Any scoping thread |
| 2.4 | A short pause ("one sec", "let me check") does not stop it **[C]** | Send that, then a real answer |
| 2.5 | A real promise ("I'll send photos tomorrow") gets **one acknowledgement, then quiet** until the customer writes. Not silence. **[C]** | Send that and expect one reply, then nothing until you write again |
| 2.6 | A date question gets "dates come with your quote" and scoping continues; no lead-time guess **[O]** (§7) | Ask "when can you come?" |
| 2.7 | Anything about money or price goes to Ben, not answered **[O]** (§8, under review) | Ask "how much roughly?" |
| 2.8 | It never sends a second **reply** without the customer writing in between. One reply per customer turn, however many bubbles. **[?]** | Watch after any reply |

## Stage 3 - The call

| # | Expected | How you see it |
|---|---|---|
| 3.1 | The call offer stands but never blocks; they can carry on by message **[C]** | Ignore the call offer and keep messaging |
| 3.2 | After **Ben's outbound call**, the thread continues and collects what he asked for on the phone **[C]** | Sandbox "Ben rings them", with a transcript |
| 3.3 | The assistant sees enough of the call to know what Ben asked for **[C]** | The follow-up should reference it |
| 3.4 | A customer's earlier "yes please call me" does not send the thread back to Ben after the call happened **[C]** | Same flow |
| 3.5 | A missed call gets one text back; an answered inbound call gets no acknowledgement **[O]** (§4.1) | Missed-call door |

## Stage 4 - Ready to quote

| # | Expected | How you see it |
|---|---|---|
| 4.1 | The job and the location are enough. Photos are optional **[C]** | Describe a job with a postcode, send no photo |
| 4.2 | Once it has that, the clerk builds a quote without further prompting **[C]** | Watch for the clerk running |
| 4.3 | Ben gets one notification with a link to the price screen **[O]** (§9) | The recorded push in the sandbox |
| 4.4 | Anything missing shows on the price screen for Ben to request **[C]** | "No photo, asked, none sent" |
| 4.5 | An unpriced quote is chased, not left after one notification **[O]** (§9) | Leave it and watch the chase |

## Stage 5 - The quote, and questions about it

| # | Expected | How you see it |
|---|---|---|
| 5.1 | Ben prices and sends; the customer gets a link to the quote **[O]** | Price and send in the sandbox |
| 5.2 | Questions **before** the quote about what is included get answered, not deflected **[C]** | Ask mid-scoping |
| 5.3 | Questions **after** the quote are answered **from the quote**: what is included and excluded, prices already on it, what happens on the day **[C]** | Ask after sending |
| 5.4 | Availability questions point at the picker **[O]** (§7) | Ask "what dates?" after the quote |
| 5.5 | Changing a **booked** date still goes to Ben **[O]** (§13, open) | Ask after acceptance |

## Stage 6 - Acceptance and after

| # | Expected | How you see it |
|---|---|---|
| 6.1 | Acceptance flips the thread and notifies Ben **[O]** | Accept in the sandbox |
| 6.2 | A customer not ready ("next month") gets one acknowledgement, then is left alone. No chasing **[C]** | Say that and watch |
| 6.3 | Any promise made to the customer about what happens next is one we actually keep **[O]** (§9) | Read what it says on acceptance |

## Stage 7 - When Ben has it

| # | Expected | How you see it |
|---|---|---|
| 7.1 | A thread goes to Ben for: unhappiness or doubt, regulated or high-risk work, a question we have no source for, or scoping that is not converging **[O]** (§6.1) | Trigger each |
| 7.2 | Plus, for now: money, refunds, and a customer asking for a call **[O]** (§6.2) | |
| 7.3 | The customer is not left silent while it sits with Ben **[C]** | Leave a flagged thread and watch |
| 7.4 | A thread comes back to automation when any human replies, from any surface **[C]** | Reply as Ben |
| 7.5 | Ben is chased if he does not act, and it escalates to the owner **[O]** (S15 rec A) | Leave it |

---

## Known conflicts between this and what is built

These are not test failures. They are places the captain's answer and the current code disagree,
and each needs work or a decision before a thread can match this document.

1. **2.1, 5.2, 5.3 versus the `neverSend` lock.** Restating scope, answering from knowledge and
   answering from the quote are permanently blocked in code (B7a, PR #6). The captain has since
   said unlock all of them. Not yet built.
2. **5.3 has no source of truth.** The s10 review established there is no knowledge base and
   nothing can check whether a claim about the business is true. Answering from the quote is the
   safest of the three because the figures are ones the customer already holds.
3. **1.1 out of hours.** "Reply at any hour" holds inside the 24h window only.
4. **4.2.** After a Scoper pass on a thread already tagged ready, the clerk does not re-run
   (T20 finding D14). This may be why Priya's quote was never built.
5. **Cross-cutting 1 versus the current tier act.** Only asking questions may send today, so most
   replies still wait for Ben. Stage 2 cannot fully pass until more intents send.
