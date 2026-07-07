# Psychological Price Barrier Analysis — 2 July 2026

Companion to BEN-CONVERSION-STUDY-2026-07-02. Same data hygiene.
Base: Ben + admin quotes with a `base_price`, conversion = paid-% of **viewed**.
Sample sizes are small (n=11–42 per band) — treat single-band numbers as ±10–15pp;
the *structure* across bands is the reliable signal.

## The conversion curve

| Price band | Viewed | Paid | Paid % |
|---|---|---|---|
| <£100 | 38 | 14 | 37% ← dip |
| £100–149 | 32 | 18 | **56%** ← sweet spot |
| £150–199 | 42 | 19 | **45%** ← sweet spot |
| £200–249 | 28 | 10 | 36% ┐ |
| £250–299 | 17 | 6 | 35% │ |
| £300–399 | 27 | 10 | 37% │ plateau ~35% |
| £400–499 | 16 | 5 | 31% │ |
| £500–749 | 16 | 6 | 38% │ |
| £750–999 | 13 | 4 | 31% ┘ |
| £1,000–1,499 | 11 | 3 | 27% ← soft barrier |
| £1,500–2,499 | 20 | 2 | 10% ← the wall |
| £2,500+ | 8 | 0 | 0% |

## Findings

### 1. There is NO barrier anywhere between £200 and £1,000
Conversion is flat (~35%) across the entire range. £250, £500, £750 — none of the
"obvious" round-number thresholds exist in this data. Customers treat the whole
range as one mental category ("a proper job, considered but doable").

**Implication: within the plateau, price to value, not to fear.** Cutting £450 to
£399 buys no conversion — it's pure margin giveaway. This validates EVE pricing:
capture the differentiator value freely inside £200–£1,000. Expected revenue per
viewed quote *rises* with price across the plateau (£81 at ~£225 → £228 at ~£600).

### 2. The sweet spot is £100–200, not "as cheap as possible"
£100–199 converts at ~50% (37/74). This is the no-deliberation zone: no spouse
sign-off, no second quote, "just sort it."

### 3. Sub-£100 quotes convert WORSE (37%) than £100–200
The counterintuitive one. Likely mix of value-doubt ("that should be cheaper /
I could DIY it") and shop-around behaviour on trivial jobs.
**Hypothesis to test: a ~£129–149 minimum-job package (call-out + first hour +
guarantee) would raise both conversion and average ticket at the bottom end.**

### 4. The wall is at £1,000 (soft) and £1,500 (hard)
27% at £1,000–1,500, 10% at £1,500–2,500, zero above £2,500.
~39 viewed quotes above £1k ≈ £70–80k of quoted work → 5 paid.
This is not a price-sensitivity problem — it's a **decision-process** problem.
Above ~£1k the purchase needs authorization (partner, budget cycle), comparison
quotes, and trust a web link alone doesn't carry. The self-serve quote-link motion
is structurally wrong for these jobs.

Note: Pay-in-3 existed but was NEVER used (0 installment payers, all-time) —
it was dropped on 16 Jun having carried nothing. Either it was badly surfaced or
installments don't address the real blocker (trust/authorization, not cashflow).

### 5. Price endings are random engine output
Top endings: 75, 80, 84, 90, 91, 55… — the pricing engine emits un-rounded values
(£484, £391). No charm structure, no consistency. Precise prices can read as
"calculated and fair," but random precision reads as noise. Worth standardizing.

## Recommendations (in order of expected impact)

1. **Big-job close motion (£1k+)** — take these OUT of the self-serve flow:
   visit-first or phone-walkthrough, quote presented as staged phases where honest
   (two £900 phases beat one £1,800 wall), deposit framed as small commitment
   ("secure your slot — £150"), remainder invoiced on completion.
2. **Minimum-job floor** — stop quoting under ~£120. Package small jobs at
   £129–£149 with explicit inclusions. Predicted: conversion up AND ticket up.
3. **Plateau pricing discipline** — inside £200–£1,000, never discount for
   conversion's sake; price the EVE differentiator value. Avoid landing just
   over the wall: nothing quoted £1,000–£1,150 (reprice to £985 or restructure).
4. **Standardize price endings** — pick one convention (suggest £X95 under £500,
   round £X50/£X00 above) and round engine output to it. Cheap A/B later.
5. Re-test the £100–200 sweet spot after the floor lands — it may shift.

## Caveats
- n is small; bands ±10–15pp. The plateau/wall/dip *shape* is consistent and
  decision-grade; exact band values are not.
- Viewed-not-paid includes jobs lost for non-price reasons (timing, went dark).
- Deposit-amount analysis was impossible retroactively (deposit only computed at
  selection). Once more volume flows, re-cut conversion by deposit-% shown upfront.
