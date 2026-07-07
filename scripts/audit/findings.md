# Conversion Audit — Running Findings Log
_Accumulates conclusions as tasks complete. Scripts in this folder; funnel/filter defs in `lib.ts`._

## Foundation (Tasks 1–2) ✓
- **Clean funnel** (`01-foundation.ts`): conv (paid/viewed) Jan 0% · Feb 7.5% · Mar 8.2% · **Apr 42.6%** · May 30.1% · Jun 26.3%. Big-job (£300+) conv: Mar 7% · **Apr 37%** · May 14% · Jun 11%. 51 rows still match dummy filter (delete candidates).
- **Change-timeline** (`change-timeline.md`, `change-points.ts`): 9 change-points A–I. Big-job break ≈ **Apr 28**, clustered suspects: **F** Apple/Google Pay (Apr 28), **D** dispatch-pool/availability gating (Apr 14), **E** line-item UI (Apr 22–25). 15-min expiry is **chronic** (since Dec 2025), not a trend cause. May–June changes compound, not trigger.

## Stage 1 — Initial call/message (Tasks 3–4) ✓
**Quant (`03-stage1-quant.ts`):**
- **Top-of-funnel is steady → the drop is NOT fewer enquiries.** Leads ~185–260/mo (Jun run-rate ~235); calls ~158–236/mo; productive calls steady (113→195→171). Confirms cause is downstream.
- **Channel → conversion ranking (Apr+):** eleven_labs AI-voice **45%** > contextual/web **38%** > voice_monitor human-call **23%**. The biggest channel (calls) converts *worst*. (eleven_labs n small.)
- **Biggest chronic leak = lead→quote rate ~35–40%** (only ~1 in 3 enquiries gets a quote). Stable Mar–Jun, so not the recent-drop cause — but the largest standing volume opportunity in the whole funnel.
- WhatsApp is barely an origination *source* (3 leads) — it's a nurture/delivery channel. `scored_by` is unused (null).

**Qual (`04-stage1-qual.ts`):**
- **The initial-contact stage does NOT differentiate conversion.** Both paid and lost run the same path: **call → VIDEO_QUOTE outcome → WhatsApp (send video/photos) → quote link.** Call job-summaries look similar for paid vs lost.
- Subtle signals only: paid WhatsApp first-messages are **longer (150 vs 118 chars)** and more often reference a **warm call handoff** ("thanks for your call / for coming back to me"); lost skews to cold low-effort openings ("Hi", "got your number from Google") and **small / customer-supplied-material jobs** (tap, toilet seat) = low value/margin.
- Implication: because the call almost always routes to "send a video/photo on WhatsApp," the **photo-before-quote** lever (Stage 2, +17pt) is literally the next step the call sets up — reinforce that handoff.

**Stage-1 verdict:** not where the drop happened. Entry volume and call handling are healthy; the leaks here are *chronic* (lead→quote rate) not *new*. Focus stays downstream (quote page / payment, Stage 3).

## Stage 2 — WhatsApp conversation (Tasks 5–6) ✓
**Quant (`05-stage2-quant.ts`):**
- **Ben's first-reply is 1 min and FLAT across all months** → his raw responsiveness is excellent and unchanged. The blowout is entirely the **gated quote-send: 2.5h → 5.8h → 15.9h** = the contractor-availability system delay, NOT Ben's attentiveness. (Cleanly separates system delay from operator performance.)
- Converted vs lost is decided **post-link:** post-link-silent **2% (won) vs 53% (lost)**; followed-up **59% (won) vs 23% (lost)**; msgs 38.5 vs 14.

**Qual / behavioural lift (`06-stage2-qual.ts`, n=151, base 37%):**
- **Follow-up = +36pt** (60% vs 24%) — biggest lever, an action.
- **Customer photo before quote = +17pt** (clean, pre-link).
- Ben voice note = +13pt (marker). Ben asks questions pre-quote = −14pt (marks job *complexity*, not a cause).

**Stage-2 verdict:** the conversation is where the deal is won/lost, but the failure mode is *post-link silence on slow-arriving big quotes*, and the slowness is the **availability gating**, not Ben. Levers: follow-up discipline + photo-first + faster quote-send.

## Stage 3 — Quote link / page / payment (Tasks 7–10)
**Attributes (`07-stage3-attributes.ts`):** conversion declines with price (**£600+ worst, 19%**); **materials-included quotes convert 56% vs 32% labour-only** (ties to Stage 1: customer-supplied jobs skew lost). Scheduling-tier/extras/weekend/regeneration all unpopulated; payment/deposit/timeslot fields are tautological (set at conversion).

**Version cohorts (`08-version-cohorts.ts`) — the core attribution:**
| version group | big £300+ | small |
|---|---|---|
| C: contextual, pre-gating (Mar28–Apr13) | **36%** | 34% |
| D,E: gating+line-item (Apr14–27) | 32% | 42% |
| F,G: ApplePay+ (Apr28–May25) | **17%** | 44% |
| H,I: rewrite+flex (May26+) | **10%** | 32% |
- **Small jobs steady across all versions; big jobs collapse ~Apr 22–28.** The **availability gating (D, Apr 14) did NOT break it** (big = 41% in cohort D). Surviving suspects: **E (line-item UI, Apr 22)** and **F (Apple/Google Pay, Apr 28)**.

**Payment step (`09`/`09b`, Stripe LIVE) — exonerates F:**
- PI metadata: 138 quote-deposits, 182 invoice-balance, 16 dispatch. The April PI spike (104×£200+, 17% success) was **invoice balances, not quote deposits** — a trap avoided.
- Clean quote-deposit success, BIG (≥£150): Apr1-27 **41%**, Apr28-30 **80%**, May **57%** → **no post-Apr-28 collapse**. Big deposits that reach Stripe pay fine.
- **Conclusion: the payment step is NOT the leak. Big jobs fail BEFORE reaching payment — on the quote page.** ⇒ E (line-item UI) is the prime suspect, not F. (PostHog `cq_*` would confirm directly but only the ingest key is available.)

**Quote-page code (Task 10):**
- **Price-on-reload bug is minor:** the dynamic scheduling fee is **BUSY_PRO-only** (`PersonalizedQuotePage.tsx:3549`) and the live product is CONTEXTUAL; regeneration/extension barely used (Task 7). So price ≈ basePrice + chosen extras; the "gone up on 2nd click" complaints are real but low-volume.
- **Line-item UI is the leading big-job suspect:** `lineItems.map(...)` renders every item (10-item cap removed May 6), so big/multi-item jobs became a long itemized wall (vs a clean single price). Aligns with the Apr 22–28 break and "bounce before payment."
- **Reveal-on-commit gate (phase 37, Jun 1) was a FIX attempt** ("form up-front depressed bookings"), not a regression — and big-job conv stayed ~10%, so it didn't address the real (line-item) issue.
- Limitation: line-item causation is by *elimination + correlation*, not proven; PostHog `cq_*` scroll/section data would confirm (needs a read key — see Task 13).

## SYNTHESIS — change-point attribution (Task 11) ✓

**What the drop IS:** a **big-job (£300+) conversion collapse** — 36% (early Apr) → 17% (late Apr–May) → 10% (Jun). **Small jobs are steady the whole time** (~34–44%). Overall conversion fell 42.6% → 26% purely because big jobs stopped closing.

**What it is NOT (ruled out with evidence):**
- ❌ Fewer enquiries — top-of-funnel steady (Stage 1).
- ❌ Pricing increase — avg price *fell*; not "too expensive" as a trend.
- ❌ Ben / responsiveness — first-reply 1 min, flat (Stage 2).
- ❌ Availability gating (D, Apr 14) — big jobs were 41% in that cohort; it slows quote-*send* but doesn't kill conversion.
- ❌ Payment step / Apple-Google Pay (F, Apr 28) — big deposits that reach Stripe pay fine (41–80%, no post-Apr-28 dip).
- ❌ Off-platform payment — ruled out (invoices ⇔ deposits 1:1).
- ❌ 15-min expiry — chronic since Dec 2025, present in the April peak too.
- ❌ Reveal-on-commit gate (H/I, June) — was a fix *attempt*, not the trigger.

**What it most likely IS:** the **line-item quote-page UI for big jobs** (change-point **E**, Apr 22–25 line-item detail + **G** May 6 "remove 10-item cap"). Big jobs render as a long itemised wall instead of a clean price; customers **bounce on the quote page before reaching payment** (Stage 3 / Task 9). The **May 26–Jun 1 rewrite (H)** compounded it to ~10%. _Confidence: strong-circumstantial (elimination + timing); not A/B-proven — needs PostHog quote-page funnel to nail it (Task 13)._

## WINNING FORMULA — what produced the best conversion (Task 12) ✓

**The April peak config to restore (big jobs ~36%, overall ~43%):**
1. **Quote page:** the pre-Apr-22 presentation — a clean, single-price-forward quote, NOT a full itemised line-item list for big jobs. → *Highest-leverage fix: collapse/secondary the line items for big multi-item jobs; lead with the outcome + one price.*
2. **Fast quote turnaround:** before the availability gating lengthened quote-send to ~1 day. → *Send a provisional/holding quote fast; don't let supply-checking block the link.*
3. **Follow-up discipline:** chased threads convert **60% vs 24%**. → *Automate a 3-touch follow-up.*
4. **Photo-first intake** (+17pt) and **materials-included** quoting (**56% vs 32%**). → *Standardise "send a photo"; quote with materials supplied where possible.*
5. **Lean on the best channels:** AI-voice (45%) + web (38%) over raw human-call leads (23%).

**Prioritised action list (roll back / restore / build):**
| Priority | Action | Type | Evidence |
|---|---|---|---|
| 1 | A/B the big-job quote page: clean single-price vs current line-item wall | restore | Tasks 8–10 |
| 2 | Automate 3-touch follow-up | build | +36pt (Task 6) |
| 3 | Fast/provisional quote-send (de-gate) | fix | Stage 2 / TTQ |
| 4 | Photo-first + materials-included as defaults | build | +17pt / 56% |
| 5 | Fix chronic friction: extend 15-min expiry, deposit flexibility, price-on-reload | fix | Qual reads |
| 6 | Recover the ~60% of leads never quoted (lead→quote rate) | build | Stage 1 |

## INSTRUMENTATION (Task 13) ✓ — see `instrumentation-plan.md` + `13-dashboard.ts`
