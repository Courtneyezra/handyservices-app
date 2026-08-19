# What the real WhatsApp corpus says

**Analysis date:** 19 August 2026
**Corpus:** `whatsapp-export/wa-dump.json` — 10,267 messages, 406 conversations, 1 Apr to 11 Jun 2026
**Reproduce:** `npx tsx scripts/_wa-corpus-analyse.ts`

This is the only honest record of how this business talks to customers. The `messages` /
`conversations` tables are an automation log with a 99.9% phantom outbound side. Everything the
comms agent and the brand-voice file currently assume was inferred from marketing copy. This
document replaces inference with evidence.

Customer names are first-name-only. Phone numbers are not reproduced.

---

## The headline, up front

Three things matter, and one of them is uncomfortable.

1. **Almost nothing Ben does in the conversation separates a sale from a loss.** Every
   behavioural "lever" we looked for collapsed under a confound check. What survives is the
   **price on the quote**.
2. **The follow-up agent's market is 104 conversations worth £83,391 where the customer read the
   quote repeatedly and Ben never wrote again.** 43 of them got zero further messages.
3. **The decision window is days, not hours.** Median 39 hours from quote link to deposit;
   the upper quartile is five days. Nobody paid within the first hour.

And the finding that most directly contradicts a thing we have already built: **the em-dash ban is
being broken by our own generated copy, not by Ben.** He typed an em dash in 3 of 1,532 messages
(0%). Our auto-composed quote message contains one in 56% of sends.

---

## 1. The real state machine

### How conversations actually start

Ben speaks first in **103 of 216** substantial conversations (48%). We modelled this flow as
"customer messages in, agent triages". Half the time it is the reverse: a phone call was missed,
and WhatsApp is the recovery channel.

The stock opener, sent 28 times verbatim:

> Hi Ben here from handy services.
>
> Sorry we missed your call.
>
> Let us know if you are still interested in a quote and we can get one sent over.
>
> Thanks
> Ben

**It performs exactly like every other opener.** Missed-call opener: 87 threads, 69% got a reply.
All other Ben-initiated openers: 106 threads, 69% got a reply. There is no magic in the wording,
and no penalty either.

### The actual sequence

Measured across 216 customer conversations with 6+ messages:

| Stage | Evidence |
|---|---|
| Opening | Ben first 48%, customer first 52% |
| Ben's first reply | median **under 1 minute** |
| Customer's reply | median **6 minutes** |
| Ask for photo/video | 69% of threads, median at **message index 1** — the first thing he does |
| Ask for postcode | 39% of threads, median at **message index 8** — much later |
| Ask for name | 2% — he mostly does not, and it shows |
| Ask about access/keys | 12%, median index 21 — post-booking, not triage |
| Customer sends media | 83% |
| Turns before a price | median **5** |
| First message to quote link | median **5.6 hours** |

The order is: **photo first, postcode later, name barely, access only after money.** Our designed
flow front-loads qualification. Ben front-loads one thing — get me a picture — and defers
everything else until he needs it.

A clean example, start to finish in 31 minutes:

> **Ben:** Hi its handy services. Sorry we missed your call. Let us know if you're still interested in a quote.
> **Bally:** Hi Ben, just need replacing a tap in the kitchen. Already bought.
> **Ben:** Great, could you send me a picture of the current tap you have and a picture of the new one you have, and I'll send you a post code over.
> **Bally:** *[image]* De72 3TL *[image]*
> **Ben:** I will send your quote over shortly.
> **Ben:** Sorry forgot to get your name
> **Bally:** Bally
> **Ben:** Hey Bally, We'll swap your kitchen tap for a reliable one... Here's the link: [quote]

Note "Sorry forgot to get your name" arriving *after* the quote was already promised. The name is
needed by the quote generator, not by the conversation.

### What we never modelled

- **Ben initiates half of all conversations.** The triage agent as designed has no outbound
  missed-call recovery state at all.
- **Voice notes are a primary channel.** 65% of substantial threads contain a `ptt` from Ben, 769
  across the corpus. They cluster at exactly the moments a text agent would need to handle:
  objections, scoping, awkward news. An agent that can only emit text cannot reproduce this, and
  should not pretend to.
- **The postcode comes before the price, the full address comes after the deposit.** That
  sequencing is correct and worth encoding.
- **A large post-sale stage exists that we treat as out of scope.** In the 73 PAID threads Ben's
  own messages contain ETA language in 60%, review requests in 68%, balance/invoice talk in 58%,
  completion photos in 41%. The job is not "done" at deposit; roughly half the labour is after it.

### What a completed job looks like

Deposit → address and site contact → ETA on the morning → "on the way" → completion photos →
balance/invoice → review ask. The failure mode visible in the corpus is the ETA promise:

> **Ben:** Hi Jwong, There's a slight issue and we won't be able to complete the tap swap today! We can gurentee tomorrow at 5.30pm if this works for you? Apologies for any inconvenience caused!
> **Jwong:** I was just about to text you. I did leave work early for this appointment. Tomorrow at 5:30pm should be ok. if you miss this appointment again I would need some compensation.

---

## 2. Outcomes

Joined on the last 10 digits of the number in `chatName` (the `phone` field in the dump is a
WhatsApp `@lid` and joins to nothing), plus the quote `short_slug` Ben pastes into the thread.
Where both keys fire they agree 144 times out of 155.

| Bucket | Conversations | Value |
|---|---|---|
| **PAID** | 73 | **£27,684** collected, median job **£198** |
| **QUOTED-THEN-QUIET** | 104 | **£83,391** quoted and unrealised, median quote **£325** |
| **DIED-BEFORE-QUOTE** | 110 | — |
| **NO-QUOTE-BUT-ENGAGED** | 50 | — |
| *(internal: contractors, suppliers)* | *69* | *excluded from all figures* |

**Three pounds are sitting in the quiet bucket for every one collected.**

### DIED-BEFORE-QUOTE is mostly a different problem

110 conversations, median 2 messages. Ben spoke first in 87 of them and **58 customers never
replied at all**. This is not a triage failure; it is cold outreach to people who did not answer.
Do not let the triage agent's success metric be polluted by it.

### QUOTED-THEN-QUIET is not indifference

| | |
|---|---|
| Opened the quote | **102 / 104** |
| Opened it **3+ times** | **69 / 104** |
| Never opened it | **2** |
| Ben never messaged again after sending the link | **43 / 104** |

They read it. They read it repeatedly. Then nothing happened, and in 41% of cases nothing was
sent to them either. This is the entire case for the follow-up agent, and it is a strong one.

---

## 3. What actually differs in the ones that converted

**Measured in the pre-quote phase only.** Comparing whole threads is worthless: a PAID thread runs
for days of ETAs and completion photos, so any "PAID does more of X" is really "paying generates
logistics". The confound is large enough to have produced three false findings before we caught it.

| Pre-quote measure | PAID (n=63) | QUIET (n=89) |
|---|---|---|
| Messages before the quote | 12 | 11 |
| Ben's median reply | 6.1 min | 5.3 min |
| Customer's median reply | 2.5 min | 2.8 min |
| Hours to quote | 7.3 | 4.2 |
| Customer words before quote | 52 | 45 |
| Ben sent a voice note | 32/63 | 50/89 |
| Customer sent photos | 55/63 | 75/89 |
| Ben offered a call | 10/63 | 12/89 |

**These groups are indistinguishable.** Not one difference is large enough or clean enough to
build on. Note especially that quotes went out *faster* in the ones that did not convert — speed
to quote is not a lever.

### Three levers that looked real and are not

Each of these has a striking raw number. Each dissolves when you stratify by thread length,
because long threads accumulate every behaviour *and* are long because the job went ahead.

| Lever | Raw | <20 msgs | 20-39 msgs | 40+ msgs | Verdict |
|---|---|---|---|---|---|
| Ben sent a voice note | 47% vs 26% | 3% vs 3% | 59% vs 55% | 87% vs 83% | **Artefact.** Restricted to pre-quote it reverses: 39% vs 44%. |
| Ben offered a phone call | 79% vs 32% | 0/1 vs 3% | 75% vs 55% | 82% vs **93%** | **Artefact.** Reverses in the largest band. |
| Quote amended (2+ versions) | 100% vs 37% | — | 1/1 | 8/8 | **Directional only.** See below. |

I would rather you have three findings you can trust than twenty you cannot. Voice notes and
phone calls are not conversion levers on this evidence. They may still be good practice; the data
does not say so either way.

### The one thing that does survive: price

| Quote value | Paid | Unpaid | Conversion |
|---|---|---|---|
| under £100 | 12 | 22 | 35% |
| **£100-200** | **35** | **24** | **59%** |
| £200-350 | 14 | 28 | 33% |
| £350-600 | 11 | 18 | 38% |
| £600-1000 | 6 | 11 | 35% |
| **£1000+** | **5** | **29** | **15%** |

Median PAID job £198. Median QUIET quote £325. This independently replicates
`docs/PRICE-BARRIER-ANALYSIS-2026-07-02.md` from a completely separate data source — the £100-200
sweet spot, the flat plateau, the hard wall above £1,000.

**The follow-up agent's job is not to write better messages. It is to notice that a £1,400 quote
has an 85% chance of dying and do something structural about it.**

### The amendment signal

9 threads contained more than one quote version. All 9 paid. In 6 of them the new version was sent
**before** the deposit, so it is not purely a post-booking scope change.

n=6 is not proof. But it is the only candidate lever that survived the confound check with its
direction intact, and it is mechanically plausible: re-quoting is the only move in the corpus that
changes the number the customer is deciding about. Worth building; worth measuring honestly once
built.

---

## 4. Objection handling, verbatim

142 pushback moments found. Distribution:

| Objection | Instances | Occurring in threads that paid |
|---|---|---|
| payment terms / deposit | 58 | 43 |
| think about it / get back to you | 30 | 16 |
| timing / not right now | 18 | 9 |
| too expensive | 14 | 3 |
| asked for a discount | 11 | 2 |
| shopping around | 7 | 3 |
| scope confusion / hourly rate | 4 | 1 |

Where a conversation had both a quote link and an objection (n=19 — small, treat as directional):

| Ben's move | n | Paid |
|---|---|---|
| Amended or re-quoted | 3 | 2 (67%) |
| Held the price with a reason | 6 | 2 (33%) |
| **Capitulated politely** | **8** | **1 (13%)** |
| No reply at all | 1 | 0 |

**The most common response to a price objection is a graceful exit.** It is also the worst
performing. This is the single clearest thing to change.

### Pattern A — capitulate and close the door (dominant, weak)

> **Customer:** Hi sorry the price is too much thankyou tho
> **Ben:** No problem

> **Customer:** No sorry thats too expensive! ... that's nearly the price of the desk! Far too expensive.
> **Ben:** Ok no problem at all. Thanks, Ben
> **Ben:** If you do choose to come back always happy to help 🙂

> **Customer:** Thanks Ben but that is far too expensive. Thanks anyway.
> **Ben:** No problem. We are here in the future if you require our services. Thanks, Ben

None of these converted. The customer has said the number is wrong and Ben has agreed to end the
conversation rather than change anything about the offer.

### Pattern B — hold the price, justify with craft (works)

The best line in the entire corpus, and it should be a lever verbatim:

> **Customer:** Sorry, rather too expensive for us, thanks anyway.
> **Ben:** No problem at all! Understand it may seem abit high but ensuring tiles are not broken in the process is paramount to us. Also achieving a clean finish means the job wouldn't be rushed. **Get a few more quotes and happy to book you in if you come back.** Cheers 🙂

And the resourcing version, which converted at £182 from a flat "too expensive":

> **Customer:** Wow is a bit expensive
> **Customer:** I book it during Christmas sessions for £200 now paying almost same amount to set ut up xx
> **Ben:** Hi. Unfortunately this is the price that we would charge for **2 people** to come and install it. Thanks, Ben
> **Customer:** Okay that's fine
> **Customer:** I will book it

The move: name the concrete thing the money buys (two people, unbroken tiles, an unrushed
finish), then invite comparison rather than fear it.

### Pattern C — re-segment or re-scope (best performing)

> **Customer:** Some of the things on there are a little pricey for this one
> **Ben:** Yeah no problem let us edit it for you
> **Ben:** We just noticed you quote is set to home owner not property manager. When we set it to property manager then Thats will bring the price down, let me edit and do that and then you can view it again.

> **Customer:** Can you also pls let me know if for now I just want to put the fly screens for 4 windows what will be your best price?
> **Ben:** yes I can do this for you
> **Ben:** I will amend the quote to add one more window and take out the other jobs

Both changed the number without conceding the rate. This is the discount-free discount, and it is
what the `allowLineSplit` and line-deferral work already supports.

### Pattern D — flat refusal with no bridge (fails)

> **Jackie:** ...got all paint ready forget the doors do you have anyone who would do it for me for £160 as £325 far too much and if you can get me someone I will definitely put more work your way
> **Ben:** Hi, unfortunately 325 is as low as we can go. Thanks, Ben

Jackie later came back with a different job, so the relationship survived, but the £325 was lost.
Compare with Pattern B: same refusal, no reason given, no invitation.

### Pattern E — bundling (converted, customer-initiated)

> **Mike:** we are going to replace another shed (6x4) round the back... If we asked you to do both as one job would it be cheaper than two separate jobs?
> **Ben:** Yeah we can definitely offer some discount if we do it together.

Ben will discount for volume but never for pressure. That is a coherent policy and the agent
should inherit it exactly.

### The deposit is a real, recurring objection

58 instances — the largest category by far, and mostly resolved.

> **Bally:** Hi Ben, I would prefer to pay cash once the job is done. Is there any chance you could do it for £60? Sorry to sound cheeky. 🤣
> **Ben:** Hi unfortunately we do have to take a deposit up front. And that is our fixed price on a tap swap. Any other questions let us know.

> **Lauren:** the quot says it's only valid for 15 minutes but I physically can't afford to pay until pay day tomorrow, is there a way to extend the quote until then?

Lauren paid. **The quote expiry timer is actively fighting customers who intend to buy** — and given
that the median time from link to deposit is 39 hours, a 15-minute countdown is telling almost
everyone something untrue.

### Timing objections are usually not objections

> **Louise:** the tenants have conceded 50% of the deposit... until the dispute is resolved they can't tell us what the budget is. Appreciate your quote will be out of date, but not to worry. I'll let you know when I have an update.

> **Mike:** I have just heard from shed people and the missing parts are being dispatched today... We are away Sunday to Saturday next week so think we will have to leave until following week

Mike paid £984. These are scheduling states, not lost deals, and an agent that treats "not right
now" as a rejection will destroy value. They need a dated re-contact, not a rescue message.

---

## 5. Voice: Ben versus `brand-voice/whatsapp-comms.md`

The critical methodological point: **Ben's typing and our generated copy must be scored
separately.** Mixed together the human looks far more corporate than he is. Split apart, the
picture inverts.

| | Ben, hand-typed (n=1,532) | Our templates (n=350) |
|---|---|---|
| Median length | **77 chars / 15 words** | 348 chars / 57 words |
| Over 400 chars | 2% | 9% |
| **Em dash** | **3 (0%)** | **195 (56%)** |
| Sign-off ("Thanks / Ben") | 28% | 1% |
| Opens "Hi/Hey/Hello" | 39% | 50% |
| Exclamation mark | 20% | 39% |
| Emoji | 20% | 48% |
| Two or more questions | 1% | 0% |
| Contractions | 12% | 47% |

### Where the brand-voice file is right

- **Short messages.** Median 15 words. 25% of his messages are one-liners under 60 characters.
- **One question per reply.** Only 1% of his messages contain two question marks. He genuinely
  does not write forms.
- **No em dashes.** Three in 1,532 messages. The ban describes what he already does.
- **Postcode before price.** 89 postcode asks, and they land at message index 8, after the photo.

### Where the brand-voice file is wrong about him

**Sign-offs.** The file says "No sign-offs, no signatures. It's a text." Ben signs off in **34%**
of messages, 432 of them the exact block:

> Thanks
> Ben

This is his most consistent habit. It is not corporate drift, it is how he identifies himself on
a number that is also his personal phone. Stripping it from the agent makes the agent sound less
like him, not more.

**Emoji.** The file says "almost never, one 👍 at most". Ben uses emoji in **20%** of messages —
🙂 😊 😀 🎉 — as warmth markers, exactly where the file bans them:

> Payment had been received 🎉 We've had a few technical issues with our booking system, sorry about that!

**Exclamation marks.** The file says "at most one, usually none". 20% of his messages have one.

**Full addresses.** The file says "NEVER ask for a full address. Postcode only." Ben asks for the
full address **32 times** in hand-typed messages:

> Hi Mike, Can you just send over your full address please 🙂
> Hi, we have this booked in for tomorrow! Could you please send over the full address and site contact please.

Crucially, **28 of those 32 fall strictly after the deposit**, at the point of dispatch — precisely
the carve-out the file intends ("The full address comes later, at booking, not at enquiry"). The
remaining 4 sit in threads with no deposit recorded in our data, and at least one of those is
explicitly post-booking ("we have this booked in for tomorrow"). The rule is right; it is stated
in a way that will make an agent refuse a legitimate dispatch ask.

**Canonical lines.** "We'll price it up" appears **zero** times in the entire corpus. "Not right?
We come back and fix it free" appears twice. "Fixed price" appears once in Ben's own typing and
41 times in our templates. These are marketing lines that have never survived contact with a
customer. Do not put them in an agent's mouth as though they were his.

Words he does use: *no problem* (137), *perfect* (68), *proper* (41), *sorted* (33).

### Two live violations in shipped copy

**1. The quote-send template uses em dashes in 56% of sends.**

> We'll strip out the cubicle and tiling, repair the plasterboards, re-tile and regrout, re install the cubicle, seal it, and fix that leaking toilet **—** all in one coordinated visit. Fixed price, no surprises.

**2. The first-contact auto-ack (128 sends) breaks three rules at once** — two em dashes, and the
scheduling ping-pong close the file explicitly bans:

> 👋 Hi there! Thanks for reaching out to Handy Services.
> *We have 300+ 5⭐️ Reviews*
> You can skip the queue and get a free instant quote by sending us a quick video of the job.
> 🎥 Just show the area you'd like help with and explain what needs doing **—** we'll reply with your price today.
> ✅ Ready when you are **—** send your video below! 👇

"Ready when you are" is the banned pattern. So is the quote template's closer, which appears in
**64** sends:

> Just let me know when suits and we'll get it done.

The brand-voice file is loaded verbatim into the comms agent's standing orders. The generated copy
that ships alongside it has never been checked against it.

---

## Recommendations

**For the triage agent**

1. Add the missed-call recovery state. It is half the volume and it is not currently modelled.
2. Ask for a photo in the first reply. Nothing else. Postcode at turn 8, name when the quote
   generator needs it, access only after the deposit.
3. Do not optimise for speed to quote. It does not correlate with conversion, and the fast quotes
   were disproportionately the ones that died.
4. Accept that voice notes are a channel it cannot use, and do not substitute long text for them.

**For the follow-up agent**

5. Its addressable market is the 104 quiet quotes, 102 of which were opened and 69 opened three
   or more times. Target the 43 that received no follow-up at all.
6. Cadence must match a 39-hour median and a five-day upper quartile. A nudge at hour 4 is
   arriving before anyone has decided anything.
7. Route by price band before routing by message content. £1,000+ needs a structural response
   (split, defer, de-scope, survey), not a warmer paragraph.
8. Encode the four levers below. Never encode a discount.

**Levers, in Ben's words**

| Objection | Move | Line to riff on |
|---|---|---|
| "too expensive" | Name what the money buys | "Understand it may seem abit high but ensuring tiles are not broken in the process is paramount to us. Also achieving a clean finish means the job wouldn't be rushed." |
| "too expensive" | Invite the comparison | "Get a few more quotes and happy to book you in if you come back." |
| "why so much" | Name the resourcing | "This is the price that we would charge for 2 people to come and install it." |
| "a bit pricey" | Re-scope, don't discount | "Yeah no problem let us edit it for you." / "I will amend the quote to add one more window and take out the other jobs." |
| "can you do two jobs" | Volume discount is allowed | "Yeah we can definitely offer some discount if we do it together." |
| "not right now" | Dated re-contact, not a rescue | treat as a scheduling state |
| **never** | capitulate | "No problem." — 8 uses, 1 conversion |

**Fix before shipping either agent**

9. Strip em dashes from the contextual quote generator and the auto-ack. 56% of quote sends
   currently violate a rule the human has never once broken.
10. Replace "Just let me know when suits" and "Ready when you are" in shipped templates.
11. Fix or remove the quote expiry countdown. It reads "valid for 15 minutes" against a 39-hour
    median decision time, and it has already been visibly disbelieved by a customer who paid.
12. Reconcile `brand-voice/whatsapp-comms.md` with the evidence: allow the "Thanks / Ben"
    sign-off, allow light emoji, permit the post-deposit full-address ask, and delete the three
    canonical lines that no customer has ever received.

---

## Method and limits

- **Window:** 10 weeks, 1 Apr to 11 Jun 2026. Seasonality is not controlled for.
- **Join keys:** last 10 digits of `chatName` (matching the `DIGITS10` convention in
  `server/agents/recovery.ts`), plus quote `short_slug` scraped from message bodies. 164 of 179
  quote-bearing conversations matched on phone; slug recovers the rest. Agreement 144/155.
- **`phone` in the dump is a WhatsApp `@lid`** and joins to nothing. Anyone re-running this must
  use `chatName`.
- **Internal threads** (69) are excluded by a saved-contact + trade-keyword heuristic. It is not
  perfect; a handful of named customers may be misfiled as internal, which would slightly
  understate the customer counts.
- **PAID** means a `deposit_paid_at` on a matched quote or a `paid_at` invoice. Cash jobs settled
  off-system are invisible here and some "quiet" conversations may in truth have been paid.
- **Sample sizes are small** wherever an objection is involved (n=19 for the objection-response
  table, n=6 for the amendment signal). Those tables are directional. The price-band table
  (n=215 quotes) and the corpus-wide voice statistics (n=1,532 messages) are solid.
- **The confound guard matters.** Three plausible levers survived a naive analysis and died under
  stratification. `stratify()` in the script exists so the next candidate lever gets the same
  treatment before anyone builds on it.
