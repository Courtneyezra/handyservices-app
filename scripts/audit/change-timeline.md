# Conversion Audit — Master Change Timeline
_Built for Task 2. Overlay these dated change-points on the funnel (Task 1) to attribute conversion shifts. Source: git history Dec 2025 – Jun 2026._

## Conversion reference (clean funnel, from Task 1)

| Month | Conv (paid/viewed) | Big-job (£300+) conv |
|---|---|---|
| Jan | 0% (Stripe not live) | – |
| Feb | 7.5% (ramping) | – |
| Mar | 8.2% | 7% |
| **Apr** | **42.6%** | **37%** |
| May | 30.1% | 14% |
| Jun | 26.3% | 11% |

Big-job break is **late April (~Apr 28–30)**, within the April cohort. Real comparisons start April.

## Key change-points (cohort boundaries for Task 8)

⭐ = prime suspect for a conversion shift.

| # | Date | Area | Change | Why it matters |
|---|---|---|---|---|
| A | 2026-03-12 | Pricing | **EVE single-price** — stripped Essential/Enhanced/Elite tiers | Pricing model the April peak ran on |
| B | 2026-03-18 | Quote page | Quote-page overhaul — **15-min timer surfaced**, job summary; **PostHog + conversion dashboard** added | Expiry timer becomes prominent; analytics begin |
| C | 2026-03-28 | Quote page | **CONTEXTUAL quote system overhaul** (6-phase) + UX overhaul | The current product begins; "CONTEXTUAL is the only quote type" starts here |
| D | 2026-04-14 | Availability | **Dispatch-pool flow** — quote stops pre-matching a contractor; Daily Planner dispatch; checkout UX reorder | ⭐ Start of the **availability gating** that delays quote-send |
| E | 2026-04-22→25 | Quote page | Line-item detailed descriptions, optional-extras library, **QuoteSkeleton** loader | UI density + load behaviour change |
| F | 2026-04-28 | Payment | **Apple Pay / Google Pay express checkout** added (restricted to those) | ⭐ **Exactly at the big-job conversion break** |
| G | 2026-05-06 | Quote page | **Remove 10-item cap** + **"improve large-job quote display"** | ⭐ Big-job-specific display change as big-job conv stayed down |
| H | 2026-05-26→06-01 | Quote+Booking | **Phases 22–37 mega-rewrite**: SKU-driven architecture, fit-panel requires contractors cover ALL line items, multi-day booking, **reveal-on-commit booking gate** (Jun 1) | ⭐ Largest single change burst; compounds into June |
| I | 2026-05-31→06-05 | Booking | **Flex option** — homeowner-default flexible booking (May 31), business flex lane = deadline guarantee (Jun 5) | Changes the post-link booking choice |

## Earlier context (pre-April, for completeness)
- **Dec 2025:** initial build — `expiresAt` 15-min expiry exists from day one (NOT a recent change; only the *timer UI* is recent, change-point B).
- **Jan–Feb:** HHH tiered pricing, segment work (PROP_MGR, LANDLORD, OLDER_WOMAN), payment UI as pills, multi-tier headlines.
- **Mar 10–17:** remove HHH tiers → EVE pricing engine; reference-prices.ts; contextual pricing engine.
- **Mar 25–31:** contractor app "supply-driven availability"; "master availability switch for quotes" → foundation of the availability system.
- **Apr 3–8:** booking availability extended to 4 weeks; pay-in-full fixes; 3% pay-in-full discount.
- **Apr 15:** "Secure your slot" → "Complete your booking" rename.

## Candidate causes to test (feeds Task 11)

**The big-job break (~Apr 28):** three changes cluster here —
1. ⭐ **F — Apple/Google Pay express checkout (Apr 28)** — best timing fit; the post-link/payment step we couldn't test from the DB (→ Task 9).
2. ⭐ **D — dispatch-pool / availability gating (Apr 14)** — quotes stop pre-matching a contractor; lengthens time-to-quote (user-confirmed). Front-runs the break by ~2 weeks.
3. **E — line-item UI density + QuoteSkeleton (Apr 22–25)** — changes what the customer sees just before.

**The sustained May–June decline:** G (large-job display, May 6) → H (mega-rewrite + reveal-on-commit gate) → I (flex option). All land *after* the break, so they likely **compound** rather than trigger.

**The April "good" config to reverse-engineer:** C (contextual overhaul Mar 28) + A (EVE pricing) + B (timer/analytics), running **before** D/F. That's the baseline Task 12 should aim to restore.

## How to use this in Task 8
Split quotes into cohorts by `created_at` between these change-points and compare conversion **within job-size band** (so a mix shift can't masquerade as a UI effect). Machine-readable boundaries in `change-points.ts`.
