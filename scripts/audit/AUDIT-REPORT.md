# Conversion Audit — Why Booked Jobs Dropped & How to Fix It
**June 2026 · a 13-stage investigation of the quote funnel (initial call → WhatsApp → quote link → payment)**

---

## The answer in one paragraph

Booked jobs fell from ~44/month in April to ~27 because **big jobs (£300+) stopped converting** — they crashed from **36% → 10%**, while small jobs stayed healthy at ~40% the entire time. It is **not** fewer enquiries, **not** pricing, **not** the team, and **not** the payment system. The evidence points to one change: in **late April the quote page began showing big jobs as a long itemised wall of line-items**, and big-job customers now bounce off that page *before they ever reach payment*.

---

## What's NOT wrong (so we stop chasing ghosts)

| Suspect | Verdict | The evidence |
|---|---|---|
| Fewer enquiries | ✅ Cleared | Leads & calls steady (~185–260/mo) |
| Prices too high | ✅ Cleared | Average quote price actually *fell* |
| Ben / slow replies | ✅ Cleared | First reply is **1 minute**, flat every month |
| The quote-send delay | ✅ Cleared | Real, but caused by the *availability system*, not Ben — and big jobs still converted at 41% right after it launched |
| Apple/Google Pay & checkout | ✅ Cleared | Big deposits that reach Stripe **pay through fine (41–80%)** |
| Off-platform / cash payments | ✅ Cleared | Invoices match deposits 1:1 — no hidden jobs |
| The 15-minute quote timer | ✅ Cleared (as a *cause*) | It's been there since launch — present in April's good months too |

**Small jobs convert fine. Enquiries are steady. The team is responsive.** The problem is narrow and specific.

---

## What IS wrong

In **late April** two changes hit the quote page: line-items got detailed descriptions (Apr 22), and the **10-item cap was removed (May 6)**. From that point, a big job stopped showing as a clean headline price and instead became a **long, scrollable list of every individual line-item**.

Big jobs have lots of line-items. Small jobs don't. So the change hit big jobs hard and left small jobs untouched — which is **exactly** the pattern in the data:

> **Big-job conversion by quote-page version:** 36% (early Apr) → 32% (mid Apr) → **17%** (late Apr) → **10%** (late May rewrite).
> **Small-job conversion across the same versions:** 34% → 42% → 44% → 32%. *Steady.*

Customers see the wall of line-items, feel the total is being itemised and scrutinised, and leave — **before** they ever get to the payment step.

---

## The biggest surprise (and why audits matter)

The payment system looked **guilty**: Apple/Google Pay was switched on **April 28 — the exact day big-job conversion broke.** The first cut of the Stripe data seemed to confirm it: 104 big payment attempts, only 17% successful.

But digging into the payment metadata flipped it completely. Those failed payments were **unpaid invoices, not quote deposits.** When we isolated actual quote deposits, big jobs paid through at **41–80%** with no dip after April 28. **The payment step was innocent.** The real problem sits one step earlier — customers don't even reach checkout.

*Lesson: the obvious coincidence (a payment change on the break date) was a red herring. Only the stage-by-stage data caught it.*

---

## What was working — the April formula to restore

April converted at 43% overall and 36% on big jobs. Here's what was different then, and what the data says drives conversion:

1. **A clean quote page** — big jobs shown as an outcome + one price, *not* an itemised wall. *(The single highest-leverage fix.)*
2. **Fast quotes** — before the availability system added a ~1-day delay to sending the link.
3. **Following up** — chased leads convert **60% vs 24%**. The biggest behavioural lever, and it's coachable/automatable.
4. **A photo before quoting** — customers who send one convert **40% vs 23%**.
5. **Materials included** — quotes where we supply materials convert **56% vs 32%**.

---

## What to do — in priority order

| # | Action | Why | Effort |
|---|---|---|---|
| 1 | **Redesign the big-job quote page** — lead with one clear price, tuck line-items behind a "see breakdown" toggle | The cause of the collapse | Medium |
| 2 | **Automate a 3-touch follow-up** (≈3h, next day, day 3) | +36pt lever, currently manual | Medium |
| 3 | **Send quotes fast** — provisional/holding quote so the availability check doesn't delay the link | Restores April speed | Medium |
| 4 | **Make "send a photo" + materials-included the default** | +17pt / 56% vs 32% | Low |
| 5 | **Fix the chronic friction** — extend the 15-min timer, add deposit flexibility, fix the rare price-on-reload glitch | Standing leaks | Low |
| 6 | **Recover un-quoted leads** — only ~35–40% of enquiries ever get a quote | Biggest volume opportunity | Medium |

---

## How confident are we?

**High confidence on what it ISN'T** — payment, pricing, demand, the team, and the availability gating are all ruled out with direct evidence.

**Strong (not yet proven) on what it IS** — the line-item quote page is identified by elimination and exact timing. The one test that would *prove* it is the **PostHog quote-page funnel for big jobs** (do they drop at the line-item/price section?), which needs a PostHog read key we don't currently have.

**Two paths forward:** build the big-job quote-page fix and A/B test it against the current version, **or** add the PostHog read key and confirm the cause first.

---

## Side-findings worth banking
- **Channel quality:** AI-voice leads convert at 45% and web at 38%, but raw human-call leads only 23% — the biggest channel is the weakest.
- **The lead→quote leak:** ~60% of enquiries never receive a quote at all. Stable, so not the recent cause — but the single largest opportunity in the funnel.
- **WhatsApp is a nurture channel, not a source** — barely any jobs originate there; it's where the call-led relationship is carried.

---
*Full working detail, scripts and live dashboard in this folder: `findings.md`, `13-dashboard.ts`, `instrumentation-plan.md`.*
