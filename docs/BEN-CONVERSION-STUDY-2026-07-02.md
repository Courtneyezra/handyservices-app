# Ben Conversion Study — 2 July 2026

**Phase 0, Step 1 of BUSINESS_ROADMAP_2026H2.**
Data: `personalized_quotes` (606 rows, Jan–Jun 2026), test data scrubbed
(07700900xxx phones, `test_q_*` ids, @example.com, Test/QA names — null-safe filters).
Conversion = `deposit_paid_at` as % of `viewed_at`, per the standing definition.

---

## Verdict

**Ben's conversion has NOT massively dropped, and the UI changes did not hurt it.
The real decline is top-of-funnel: leads are down ~25% and calls down ~35% since April.**

The "started well then dropped" perception is an anchoring artifact from one outlier
week (w/c 6 Apr: 71% conversion — also his cheapest-mix week, avg quote £348).

## Evidence

### 1. Ben's weekly paid-% of viewed is a stable ~30–40% band

| Period | Viewed | Paid | Paid % |
|---|---|---|---|
| April (excl. outlier week) | 82 | 24–36 | ~37–44% |
| w/c 6 Apr (outlier) | 17 | 12 | **71%** |
| May | 67 | 22 | 33% |
| June | 73 | 26 | 36% |

Weekly values Mar 23 → Jun 29: 33, 36, **71**, 47, 32, 35, 31, 46, 38, 25, 35, 29, 46, 40, 20.
No sustained downtrend. June ≈ May ≈ April-without-the-outlier.

### 2. UI changes are exonerated (for conversion)
Big quote-page overhauls shipped 25 May–1 Jun (SKU architecture, brand re-skin,
booking gate) and 15–16 Jun (WhatsApp selector, drop Pay-in-3). Conversion after
each: 35%, 29%, 46%, 40% — indistinguishable from before. No break in the series.

### 3. Price band dominates conversion (Ben, all-time)

| Quote price | Quotes | Paid % of viewed |
|---|---|---|
| <£250 | 133 | **46%** |
| £250–500 | 60 | 36% |
| £500–1k | 30 | 34% |
| £1k+ | 37 | **14%** |

Weekly conversion swings mostly track price mix, not effort. The 71% week averaged
£348/quote; the 47% week averaged £1,234 — mix explains the "good early weeks."
**£1k+ quotes are where money dies: 37 quotes, 5 paid.** Big jobs likely need a
different close motion (visit, phone follow-up, staged payment) — the quote link
alone isn't closing them.

### 4. The real decline is demand

| Period | Leads/wk | Calls/wk | Ben quotes/wk | Quotes per lead |
|---|---|---|---|---|
| April | ~57 | ~54 | ~22 | 39% |
| May | ~45 | ~42 | ~17 | 38% |
| June | ~42 | ~40 | ~18 | 43% |

Ben's quoting rate per lead is stable-to-improving. Lead volume is the falling
input. Roadmap says constraint is delivery not leads — this isn't "add channels,"
it's "the existing channel is degrading": needs a cause (seasonality, Google
ranking, ad spend, landing page, call answering) before it compounds.

### 5. Ben's response speed: medians fine, tail worth watching
Median lead→quote: 0.8h (Apr), 2.3h (May), 0.8h (Jun) — healthy.
P90 grew 260h → 423h → 1,105h. Ambiguous: could be slow follow-up on hard leads,
or re-quoting old leads (which is good behaviour). Step 2 instrumentation should
separate first-touch speed from re-engagement.

### 6. Side finding: the unattributed quote stream died 9 May
293 quotes with no `created_by_name` (Jan 6–May 9, 47% viewed, 3% paid) then stop
completely. If that was a self-serve/auto-quote flow, something turned it off —
worth confirming it was intentional.

## Actions this study convicts

1. **Drop the "Ben is slacking on conversion" thesis.** His close rate is stable.
   The metrics dashboard (Step 2) is still right — but as a management tool,
   not a corrective one.
2. **Investigate the lead decline** (new: promote into Phase 0 as Step 5).
   Compare call answer rates, lead sources, and search visibility Apr vs Jun.
3. **Build a big-job close motion** for £1k+ quotes (14% close rate on the
   highest-revenue segment is the single biggest conversion opportunity found).
4. Confirm the 9-May death of the unattributed quote stream was intentional.
5. UI work can continue without conversion anxiety — no change moved the number.
