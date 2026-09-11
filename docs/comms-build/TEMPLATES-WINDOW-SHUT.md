# The five window-shut WhatsApp templates (build plan v2, item 4.1)

WhatsApp carries free text for 24 hours after the customer's own last message. Outside that window
only a template Meta approved in advance may go out at all. That is a platform limit, not a policy
choice, and no amount of unlocking changes it (the captain's answer 6). Approval takes days to
weeks, which is why these are defined and submitted before anything reads them.

The definitions live in code, at `server/window-templates.ts`, with their category, trigger,
variables and exact wording. This file is the readable half, in the same shape as
`TEMPLATES-JOB-PACK.md`. The steps the owner runs are `docs/META-TEMPLATE-RUNBOOK.md`.

**Nothing here is wired.** Item 4.2 maps each trigger to a pack intent and gives template sends
their own rule (one per thread per N days, on the named trigger only, never after a STOP of any
scope). Until then these are definitions and a submission, and the desk behaves exactly as it does
today when a window is shut: the webform and call doors keep the fixed acknowledgement and a shut
window holds the reply for Ben.

Names must match exactly. One template per purpose, or Meta rejects it as a duplicate — that is
what killed `first_contact_generic` while its twin was approved.

---

## 1. `quote_ready_link` — UTILITY — **already on the account**

**Trigger.** Ben sends the finished quote from the price screen and the WhatsApp window is shut.
**Fires from** `server/agent-staff.ts` `deliverQuoteLink` (`QUOTE_LINK_TEMPLATE`), which already
resolves this name against the approved cache. **Wired today.**

```
Hi {{1}}, your quote is ready. Everything is on the link, the itemised price and the booking: {{2}}. Any questions, just reply here.
```

`{{1}}` the customer's first name, or `there` · `{{2}}` the quote link
(`https://handyservices.app/quote/<slug>`).
Samples: `Courtnee` · `https://handyservices.app/quote/ab12cd34`. Language `en_GB`.

**The new desk still needs it wired (a cutover item).** `server/comms-v2/desk/sender.ts` picks a
window-shut template by `purpose`, and the only purpose it knows is `service_reply`, whose body is a
generic re-open nudge with no link. So when Ben prices a quote on a shut window the new desk holds
for him and leaves the quote a draft, rather than delivering a nudge while recording every figure as
live (`server/comms-v2/quoting/quoting-door.ts`). Giving this template its own purpose in
`server/window-templates.ts`, with the quote URL as `{{2}}`, is the fix, and it belongs with cutover
because it is the old price screen's send path being re-pointed at the new sender.

**Why this name and not a new one.** It is already a Content resource on the account
(`scripts/archive/_wa-templates-submit.ts` submitted it) and it is already the name the price screen
reads. A second "your quote is ready" template would be the near-duplicate Meta rejects, and would
orphan the wiring that exists. The submission script skips it; the runbook only checks its status.

## 2. `answer_ready_reopen_v1` — UTILITY — **new**

**Trigger.** The customer asked something and the 24-hour window shut before the desk answered.
**Not wired**; 4.2 gives the spine exit a template rule (`server/spine/exit.ts`).

```
Hi {{1}}, you asked us about {{2}} and we have an answer for you. Reply to this message and we will send it straight over.
```

`{{1}}` first name, or `there` · `{{2}}` a short noun phrase for what they asked about, taken from
their own message. Samples: `Priya` · `the extractor fan`. Language `en_GB`.

**This is a RE-OPEN NUDGE, not the answer.** It cannot carry the answer: a template body is fixed
at approval and `{{2}}` is a subject, not a sentence. The real answer follows freeform on the pass
after the customer replies, because their reply re-opens the window and the exit re-runs its stale
check. Anyone wiring this in 4.2 must not treat the nudge as the reply.

## 3. `web_enquiry_ack_context` — UTILITY — **already on the account, reused**

**Trigger.** A webform enquiry. A webform submission never opens the WhatsApp window
(`server/leads.ts` leaves `lastInboundAt` alone), so without a template the desk cannot say anything
at all on that door. **Fires from** `server/first-contact-ack.ts`
`FIRST_CONTACT_TEMPLATE_PREFERENCE`, via `server/spine/packs/rules-first-contact.ts` (`ack_enquiry`).
**Wired today.**

```
Hi {{1}}, thanks for getting in touch. We got your message: "{{2}}". Is it OK if we give you a quick call {{3}} to run through it? Or just reply here with the details and we will price it up.
```

`{{1}}` first name, or `there` · `{{2}}` their enquiry, verbatim, truncated on a word boundary to
about 60 characters · `{{3}}` `shortly` or `in the morning`, by the UK hour at send time.
Samples: `there` · `need a new bathroom tap fitted` · `shortly`. Language **`en`**, not `en_GB` —
that is what it was submitted under on 22 Aug 2026, and the lookup finds nothing if that changes.

**Reused rather than replaced.** The plan allows either a new first-contact carrier or the existing
enquiry acknowledgement. This one already does the whole job: it quotes the enquiry back and offers
a call, which is the captain's answer 10 in his own words, and it already sits top of the
first-contact ladder. A new name would compete with it for the same purpose and be rejected.

## 4. `post_call_followup_v1` — UTILITY — **new** (fallback: `post_call_continuation_generic`)

**Trigger.** Ben's own outbound call was answered and left a transcript, and the follow-up collects
what he asked for on the phone. A call never opens the WhatsApp window. **Reaches the spine from**
`server/post-call-ladder.ts` as `call_ended` (T21); the template send itself is 4.2. **Not wired.**

```
Hi {{1}}, good to speak just now about {{2}}. Whenever you get a chance, send over the photos we talked about and we will get your price to you. Just reply to this message.
```

`{{1}}` first name, or `there` · `{{2}}` the job phrase from the call classification
(`calls.classification.jobPhrase`); no phrase means the second name instead, which is the shape
`pickContinuationTemplate` already has in `server/post-call-outreach.ts`.
Samples: `Marc` · `the kitchen door`. Language `en_GB`.

**This one sends unattended** (the captain's answer 20, reversing the one-tap draft T21 left in
place), so the wording has to stand alone with nobody reading it. It states only what is true of
every answered call Ben makes, asks for the one thing he asks for on the phone, and commits to
nothing: no date, no duration, no price, no method.

**Duplicate risk, named up front.** `post_call_continuation` is close enough that Meta may reject
this as a near-duplicate. That is survivable rather than blocking, because
`post_call_continuation_generic` is the second rung on the name list. If it is rejected, do **not**
resubmit a reworded twin: use the generic and record it in the runbook's log.

## 5. `enquiry_followup_optin_v1` — **MARKETING** — **new**

**Trigger.** The chase ladder reaches its customer-facing rung on an enquiry that went quiet.
Never on a customer who said they were not ready: that thread gets one acknowledgement and then
silence (answers 8 and 19). **Not wired, and there is nothing to wire it to yet** —
`server/agents/sla-sweep.ts` is the chase ladder today and every rung of it pings Ben, not the
customer. 4.2 names the customer-facing rung and owns the wiring.

```
Hi {{1}}, it's Handy Services. You got in touch about {{2}} and we have not heard back since. If you still want it doing, reply here and we will pick it up where we left off. If not, no problem at all. Reply STOP and we will not message you again.
```

`{{1}}` first name, or `there` · `{{2}}` a short noun phrase for the job they enquired about.
Samples: `Ava` · `the grab rails`. Language `en_GB`.

**The only marketing one, and it is marked so by a field.** Meta treats re-engagement after silence
as marketing whatever it is called and re-categorises on review, so it is submitted as MARKETING
from the start rather than submitted as utility and moved later. It therefore needs
consent-appropriate wording and a clear way out, which is the closing line, and it carries
`purpose: 'marketing'` in the definition so the send gate can branch on the FIELD rather than on the
name: a plain STOP recorded from any source blocks `marketing` while `service_reply` still reaches
that customer (`server/opt-out.ts` `blockedByOptOut`). It names the business because a message to
someone who has not written for weeks has to say who is messaging them.

---

## What is never in any of these bodies

A money figure, a date, a duration, a visit count, a credential, or a commitment to a time or a
method. `server/window-templates.test.ts` asserts every body against `shared/chat-voice.ts` (no em
dash, no spaced hyphen, no scheduling ping-pong closer) and against `checkDraft`
(`server/agents/draft-guards.ts`) with its own sample values filled in, and the submission script
refuses to send one that fails either. A template body is Meta's once approved: the only lever left
after that is to decline to send it.

## After approval

Nothing to deploy. The hourly sync (`server/whatsapp-template-sync.ts`, polled from
`server/cron.ts`) flips the cached status, fires a Pushover alert, and the name lookups start
finding it. The staff page's template table shows each of the five as `approved`, `pending`,
`rejected` or missing — they are listed there because `EXPECTED_TEMPLATES` in
`server/template-status.ts` derives its window-shut rows from `WINDOW_TEMPLATES`. All five are
`required: false`: nothing reads them until 4.2, so one still sitting in Meta's queue must not turn
the go-live check to NO-GO.
