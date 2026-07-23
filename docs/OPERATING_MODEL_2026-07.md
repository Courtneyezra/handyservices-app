# Operating Model — Contractor-Delivered, Handy-Fronted (LOCKED 22 Jul 2026)

_The game plan, scrutinised and locked. Decisions below were made explicitly; change them
deliberately, not by drift. Related: [DELIVERY_OS_ROADMAP_2026-07.md](DELIVERY_OS_ROADMAP_2026-07.md),
[TWO-SIDED-PRICING-LOOP-2026-07.md](TWO-SIDED-PRICING-LOOP-2026-07.md),
[CONTRACTOR_PAY_MODELS_RESEARCH_2026-07.md](CONTRACTOR_PAY_MODELS_RESEARCH_2026-07.md)._

## The model in one paragraph

Handy Services owns demand and the customer: we market, we quote (AI engine), we sell, we
guarantee. Subcontractors and small teams deliver all work as self-employed businesses, paid
an agreed **piece rate per job** derived from the WTBP engine (share + floors + visit
minimums), boosted short-term with **explicit expiring launch bonuses** to accelerate
onboarding. Contractors supply **live availability**; customer quotes offer **pick-a-day +
flex** against a buffered version of that availability. We group jobs and propose **routed
bundles** contractors accept as blocks.

## Locked decisions (with the why)

1. **Quote skin = Handy brand + the contractor's face.** The page, price, and guarantee are
   Handy's; the assigned contractor/team is *featured* (photo, name, reviews) like the Craig
   skin. Personalisation without transferring the customer relationship — our marketing must
   never build a brand that can disintermediate us.

2. **Handy is principal.** The customer contracts with and pays Handy; contractors are our
   subcontractors. Consequences accepted: VAT on the full invoice, Consumer Rights Act
   liability for subcontractor workmanship, our guarantee honoured by us (BFSC terms make the
   contractor fix defects at their cost — Craig agreement §8). Everything customer-facing
   (invoice, complaints line, guarantee) must say Handy, consistently — principal in
   substance AND in presentation.

3. **Allocation: two lanes, not one rule.**
   - **Pool (self-employed default): free accept/decline.** Declining has *market
     consequences, not penalties*: honouring declared windows is self-scored and drives
     routing priority, first pick, and ladder progression. Near-must-take behaviour emerges
     commercially without creating mutuality of obligation.
   - **Core (the must-take lane): binding scheduling only in exchange for guaranteed money,
     papered as committed-capacity or PAYE employment.** Must-take + a floor is an
     employment-shaped exchange; we price and paper it as one instead of pretending
     otherwise. Contractors *graduate into* this lane; it is never the pool default.
   - ⚠️ USER ORIGINALLY WANTED must-take-within-availability for everyone. Amended to the
     two-lane rule because must-take across a self-employed pool + Handy-as-principal + our
     pricing + our routing = the Pimlico worker-status fact pattern. Solicitor to confirm.

4. **Booking risk: buffered calendar.** The customer date-picker only shows days with
   confirmed contractor availability plus safety margin; thin days show flex options. A
   picked day is always honourable — the anti-handyman promise survives contact with the
   calendar.

## Mechanics (already built or designed)

| Leg | Status |
|---|---|
| Piece rate from WTBP (share/floors/visit minimums, materials on our card) | LIVE |
| Launch bonus (+10% first 10 jobs, explicit + expiring, per contractor) | LIVE |
| Per-job pay escalation (+5%/48h unclaimed, max 3, margin-guarded, post-epoch only) | LIVE |
| Lead uplift (+15%) for multi-person managed jobs | LIVE |
| Dispatch briefs (contractor headline, materials budget, media, Call-Ben accept) | LIVE (deploy pending) |
| Pricing loop dashboard (/admin/pricing-loop) + fortnightly review | LIVE |
| Completion sweep + weekly volume report (promise-kept metric) | LIVE |
| Availability capture (weekly patterns + overrides; Ben's mobile tool) | EXISTS — needs per-contractor discipline |
| Routed bundles (fill-up packs) | DESIGNED — manual first |
| Team lane (whole-job price + EL insurance + staged payments + non-solicit) | DESIGNED |

## Locked decisions — round 2 (22 Jul 2026, scrutiny Q&A #2)

5. **Supply pace: capped to demand.** Max 2–3 solos + 1 team onboarded until weekly sold
   work grows (current demand ≈ 25 contractor-days/month — feeds ~2 solos' spare days).
   Next onboarding wave requires demand evidence, not optimism. The "we fill your days"
   promise is the asset being protected.

6. **VAT: NOT registered — 🚨 URGENT accountant check.** Run-rate (~£12k/month paid ≈
   £144k/yr) is ABOVE the £90k rolling-12-month threshold. If rolling turnover has already
   crossed, registration is legally overdue (late registration = HMRC assesses VAT on past
   sales that can't be retro-charged, plus penalties). Even if not yet crossed, the cliff is
   months away at current pace and the pricing engine has no VAT strategy. Actions: (a)
   accountant computes rolling-12 turnover THIS WEEK; (b) VAT pricing plan before
   registration (standard scheme + input reclaim on materials; decide how much of the ~20%
   prices absorb vs margin); (c) principal model makes the full invoice VATable — factored
   into decision 2 economics.

7. **Cash: balance due on completion.** Customer pays the balance at photo sign-off
   (pay-by-link/card) — before the contractor leaves where possible. Kills the
   working-capital gap (was: contractors paid next-day vs 14-day customer terms with 61
   overdue invoices in 12 weeks) and most of the collections problem. Build: sign-off →
   payment-link flow; policy on quotes/invoices updated.

8. **Big team jobs: staged pay + retention.** Milestones (~40% at verified week-1) plus
   ~10% retention held 7 days post-completion for snags. Standard construction practice;
   bounds guarantee cost on £2k+ jobs.

## Additional holes logged (round 2, not yet resolved)

- **Plant/access hire has no owner.** Materials budget ≠ scaffold/tower/skip hire. On team
  refurbs this is £100s/job (Alicia's "high-level access" repointing prices £144 labour —
  a tower hire can exceed the line). Rule needed: plant either priced as a quote line item
  (engine change) or agreed per-job with the team BEFORE lock. Interim: agree explicitly in
  the WhatsApp negotiation for every team job.
- **Bundle visit-minimum stacking:** three bundled small jobs on one street currently pay
  3 × £40 visit minimums for one trip. Bundles need a bundle-level minimum (engine change
  when fill-up packs go live).
- **Post-accept abandonment protocol:** £40 bond ≠ brand damage of a no-show on a locked
  job. Needs: backup tap-to-accept pool + ladder consequence that bites (priority demotion),
  and a same-day customer-recovery play.
- **Team crew diligence:** we vet the lead; the crew is legally his (BFSC) but
  reputationally ours — minimum: lead confirms right-to-work + competence for crew in the
  agreement; spot-check on site day 1.
- **Insurance backstop:** broker to confirm Handy's own cover extends to
  subcontracted delivery while trading as principal.

## Punch list to "clean" (the gaps that remain)

1. **Solicitor pass** on: Craig agreement, the two-lane allocation rule, CIS registration,
   VAT treatment of labour+materials as principal.
2. **Payment leg**: manual same-day transfer now; Stripe Connect payouts later. First
   payment to a new contractor must be perfect (council verdict: #1 trust risk).
3. **Insurance-of-record per job**: contractor PLI verified before job 1; EL for teams;
   our policy positioned as backstop while we're principal.
4. **Calendar freshness accountability**: an availability-staleness alert (contractor whose
   pattern hasn't been touched in N days gets a WhatsApp nudge; stale calendars drop out of
   the buffered picker rather than showing false availability).
5. **Complaints/guarantee flow**: customer → Handy always; rework routed back to the
   delivering contractor at their cost (BFSC), our guarantee as the backstop.
6. **Disintermediation hygiene**: contractor numbers never on customer-facing surfaces
   pre-completion; personalisation stays face-not-phone; repeat demand routed through us.
7. **Skin infrastructure**: generalise the Craig skin — contractor profile (photo, name,
   short bio, rating) rendered into the quote hero for whichever contractor/team is
   soft-assigned. (Craig-only today.)

## What would break this model (standing warnings)

- Letting the pool's decline-freedom quietly erode into obligation ("you said you were free
  Tuesday") — that single habit converts the pool into workers.
- Skinning quotes with contractor phone numbers or brands — that converts the moat into a
  lead-gen service.
- Silently cutting boosted rates instead of letting explicit bonuses expire — that converts
  recruiting into Aspect.
- Auto-optimising pay/prices without the human veto — same.
