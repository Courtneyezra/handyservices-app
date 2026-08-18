# WhatsApp templates to submit for review

Templates are the ONLY way to message someone once the 24-hour window has shut. Every one of
these is written to the house voice (brand-voice/whatsapp-comms.md): no em dashes, no sign-offs,
one question at most, plain UK English, and only claims from the approved list.

## Submission rules that get templates rejected (read before pasting)

- **Never start or end the body with a variable.** `{{1}}` at position 1 or as the last character
  is an automatic rejection. All bodies below open and close with real words.
- **Every variable needs a sample value** at submission time. Samples are given per template.
- **Category matters.** A template that follows up on something the customer themselves started
  is UTILITY (cheaper, approves easily). A template whose job is "come back to us" is MARKETING
  (needs opt-out language in the UK).
- **Marketing templates carry the opt-out line.** Keep `Reply STOP to opt out.` on the marketing
  ones. Do not add it to utility ones.
- Twilio Content API uses `{{1}}`, `{{2}}` positional variables. Submit under Content Template
  Builder → WhatsApp → Text.

---

## A. Missed enquiry, we never replied (the revival cases)

Category: **MARKETING** (we are restarting a dead conversation). Include the opt-out line.

**A1 — owns the mistake, names the job**
> Hi {{1}}, you got in touch about {{2}} and we never got back to you. Sorry about that. If it
> still needs doing, reply here and we will get you a fixed price. Reply STOP to opt out.

Samples: `{{1}}` Sarah, `{{2}}` a leaking kitchen tap

**A2 — shorter, same apology**
> Hi {{1}}, we owe you a reply about {{2}}. If it still needs sorting, message us here and we
> will price it up, no call-out fee. Reply STOP to opt out.

Samples: `{{1}}` Marc, `{{2}}` your fence panels

**A3 — no job variable (safest to approve, works for any thread)**
> Hi {{1}}, you messaged us about a job a while back and never heard anything back. Sorry about
> that. Still need it doing? Reply here and we will sort you a fixed price. Reply STOP to opt out.

Samples: `{{1}}` Ava

---

## B. Quote sent, gone quiet

Category: **UTILITY** (follows up on a quote the customer asked for). No opt-out line needed.

**B1 — still live**
> Hi {{1}}, your quote for {{2}} is still live. Everything is on the link, itemised price and
> booking: {{3}}. Any questions, just reply here.

Samples: `{{1}}` Roshan, `{{2}}` the grab rails and bathroom light, `{{3}}` https://handyservices.app/quote/ab12cd34

**B2 — expiry heads-up, honest not pushy**
> Hi {{1}}, quick heads up that your quote expires on {{2}}. It is all here if you want another
> look: {{3}}. Reply here if anything needs changing.

Samples: `{{1}}` Ava, `{{2}}` Friday, `{{3}}` https://handyservices.app/quote/ab12cd34

---

## C. Sending a quote when the window has shut

Category: **UTILITY**. This closes the known gap: the in-chat Send Quote currently queues instead
of sending when the window is shut, because no template carries the link.

**C1 — quote ready**
> Hi {{1}}, your quote is ready. Everything is on the link, the itemised price and the booking:
> {{2}}. Any questions, just reply here.

Samples: `{{1}}` Courtnee, `{{2}}` https://handyservices.app/quote/ab12cd34

---

## D. We need one more thing before we can price it

Category: **UTILITY**.

**D1 — photo chase**
> Hi {{1}}, we need one more thing before we can price your job. Reply here with a photo of
> {{2}} and we will get it quoted.

Samples: `{{1}}` Marc, `{{2}}` the pipework under the sink

**D2 — postcode chase** (postcode only, never the full address)
> Hi {{1}}, we are nearly ready to price your job. What is the postcode? Just so we can quote it
> properly and get the right person out.

Samples: `{{1}}` Ava

---

## E. After a call

Category: **UTILITY**. Replaces the current post-call video request when the window is shut.

**E1 — video request**
> Hi {{1}}, thanks for your call earlier. Send us a quick video of the job and we will price it
> up for you. Just reply here with it.

Samples: `{{1}}` Sarah

---

## Priority if you only submit a few

1. **C1** — unblocks quote sending out of hours (a real feature gap today).
2. **A3** — covers all 25 revival candidates with one template.
3. **B1** — the quote follow-up, the highest-£ column on the board.
4. **D2** — the postcode chase, the most common thing blocking a quote.
