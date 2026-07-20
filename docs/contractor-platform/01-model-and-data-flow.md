# Contractor Platform — model & data flow (design)

> Deliverable #1 from `HANDOFF.md`: **how contextual quotes interlink with the
> contractor tier structure**. This is the model; schema (`02-schema.md`) and the
> app + admin surfaces follow from it. Grounded in current code as of Jul 2026 —
> file:line citations verified in this worktree.
>
> **Update (20 Jul, founder review):** [`00-PRD.md`](./00-PRD.md) is the canonical
> product spec. Two corrections supersede text below: **Core = Craig, Bezent, Joe
> (Craig first)** — not Craig alone; Bezent/Joe are committed Core, ad-hoc = Dwaine
> + warm pool. And the build approach is **clean-spine strangler**, not a rewrite.

---

## 0. TL;DR

- **Three delivery tiers**: `partner` (equity / city P&L, future) · `core`
  (Craig — the committed spine) · `adhoc` (vetted tap-to-accept pool).
- **The interlink is a routing decision, not a static field.** A quote resolves
  to a *team* of one or more assignments, not to a single contractor.
- **The multi-trade zero-pool bug is structural, and this model fixes it**: today
  a quote is bookable only if **one** contractor covers **100%** of categories
  (`quote-fit.ts:62`). We change the rule to *"every category is covered by
  **someone** on the assigned team"* — a Core lead takes what he can, uncovered
  specialist lines route to the ad-hoc pool as tap-to-accept offers. A quote is
  unbookable only on a **true capacity gap** (a category with zero in-radius
  contractor at any tier).
- **Availability is expressed differently per tier**: Core/Partner publish
  *committed weekly windows* (fixes the dry calendar); ad-hoc publish nothing and
  signal availability by *accepting an offer*.
- **Schema changes are additive** (new tables + nullable columns) so the merge
  with the `-deployed` chat's `shared/schema.ts` edits stays trivial.

---

## 1. Why tiers exist (the constraint)

Per `project-strategy-2026h2`: **delivery is the bottleneck, not leads.** The
demand machine is top-1%; every failure is delivery-side. Hybrid model =
**1–2 core trained techs + small vetted overflow pool**, all paid through the
platform with performance-gated rates.

Per `project-committed-capacity-agreement` (14–15 Jul): the economic spine is
**floor + top-up + residual book + a promotion ladder**, and the match policy is
**Craig-first concentration** — don't spread work thin (odd jobs buy zero
loyalty); fill Craig's week to ~85%, overflow to a small warm pool, exceptions to
the owner.

The tier is the contract shape between the platform and a person. It determines
four things, and everything downstream (routing, app, admin) is a projection of
these:

| Dimension | `partner` | `core` (Craig) | `adhoc` (flex pool) |
|---|---|---|---|
| **Availability model** | Committed weekly windows + governance | Committed weekly windows (2wk rolling notice) | None — availability = accepting an offer |
| **Routing priority** | With Core, by P&L area | **First pick.** Quotes route here first | Overflow + uncovered specialist lines only |
| **Pay** | Floor + top-up + book + profit share | **Floor** (~70–75% of full week) + **top-up** (% of labour/job) + **residual book** (% on rebookings) | **Per-job % of labour only** — no floor |
| **Commitment** | Equity/vesting, city P&L | Honour windows + acceptance SLA → floor guaranteed | Tap-to-accept, no obligation |

`partner` is deliberately thin here — nobody occupies it yet, and it's an
ownership tier layered on top of the `core` delivery mechanics (same availability
& routing, plus profit share and governance). **Design for `core` and `adhoc`
now; `partner` = `core` + a compensation/governance overlay later.**

**Ladder (promotion):** `adhoc` (tap-to-accept audition) → `core` (earn a floor +
book + priority) → `partner`. Scale trigger already decided: Craig fill-rate >85%
for 4 rolling weeks → open Core seat #2 from the pool.

---

## 2. The interlink model — quote ↔ tier

### 2.1 What exists today (and its structural flaw)

`resolveQuoteCandidatePoolForQuote(quote)` (`server/lib/quote-fit.ts`) is the
single source of truth both the customer date picker and the admin fit panel
read. It:

1. `findCandidateContractors({categorySlugs, lat, lng})` — contractors with *any*
   required skill, active/verified, within their own service radius
   (`contractor-matcher.ts`).
2. **`coveragePercent === 100` filter** (`quote-fit.ts:62`) — keeps only
   contractors who cover **every** line-item category.

Step 2 is the bug. A quote with `["plumbing_minor", "electrical_part_p"]` where
Craig covers plumbing but not Part P → **zero** full-coverage candidates →
`candidates: []` → the availability engine blocks **every** date → the quote is
**unbookable**. The customer sees a dead calendar with no explanation.

This is not an edge case — it's the default outcome for any genuinely
multi-trade job, which is exactly the work a single generalist *can't* absorb.

### 2.2 The new rule: cover the quote with a team, not a person

Replace *"one contractor covers 100%"* with a **coverage-composition** step:

```
resolveQuoteTeam(quote):
  requiredCats = distinct(line item categories)
  poolByCat   = { cat -> [in-radius contractors who cover cat, by tier] }

  # true capacity gap: a category NOBODY in radius covers, any tier
  uncovered = [cat for cat in requiredCats if poolByCat[cat] is empty]
  if uncovered: return { bookable: false, reason: "no supply", uncovered }

  # 1. Craig-first: can ONE core contractor cover everything? (preserve concentration)
  soloCore = core contractors with coveragePercent == 100
  if soloCore: return { bookable: true, plan: SOLO(bestCore), team: [that one] }

  # 2. Compose: a lead takes the fat middle, specialists take the rest
  lead        = core/partner contractor covering the MOST required cats
  leadCats    = cats lead covers
  residualCats = requiredCats - leadCats
  specialists = for each residual cat, the adhoc pool that covers it
  return { bookable: true, plan: COMPOSED(lead, specialists), team: [...] }
```

Key consequences:

- **The customer still books one date and pays once.** Composition is a
  behind-the-scenes fulfilment plan, not a customer-facing choice.
- **"Bookable" now means "coverable"**, not "one person is free". The dead
  calendar only appears on a real supply gap (`uncovered` non-empty), and now
  it can say *which trade* is missing — a recruiting signal, per
  `project-scheduling-auto-assign` ("customers wanting unofferable dates = a
  capacity signal, not a UX bug").
- **Availability of a composed job** = the intersection the offer engine can
  actually keep. v1 recommendation: the calendar reflects the **lead's**
  committed availability; specialist lines are dispatched as tap-to-accept
  offers *after* the deposit, with the lead's visit as the anchor date. (Hard
  same-day multi-trade coordination is a later refinement — see §6 open Qs.)

### 2.3 Routing priority (the Craig-first stack)

From `project-committed-capacity-agreement` match-policy pivot, encoded as the
order `resolveQuoteTeam` tries plans:

1. **Fill Core first.** Prefer a solo-Core plan (Craig covers 100%) over any
   split. If multiple Core, least-loaded-toward-floor first.
2. **Compose with ad-hoc for the residual.** Lead = Core; specialist lines →
   ad-hoc tap-to-accept pool.
3. **Exception → owner/Ben.** No Core can lead (Core off-skill for the fat
   middle, or fully booked) → surface to admin rather than silently splitting
   across strangers.

---

## 3. Availability by tier (fixing the dry calendar)

Per `project-availability-architecture`: the picker reads **only** per-contractor
sources — a `contractorAvailabilityDates` override wins, else the
`handymanAvailability` weekly pattern, else Off. **No master fallback.**
Contractors have no weekly patterns → calendars run dry past hand-entered dates.

The tier model resolves this cleanly:

- **Core / Partner — committed windows.** The committed-capacity agreement's
  "fixed weekly windows (2wk rolling notice)" *are* `handymanAvailability` weekly
  rows. Signing Craig to a floor writes his windows as recurring patterns → his
  calendar stops being dry. Per-date exceptions (holiday, sick, one-off extra
  day) stay as `contractorAvailabilityDates` overrides — the exact mechanism
  Ben's mobile tool already writes (`/admin/availability-mobile`).
- **Ad-hoc — no standing availability.** They deliberately hold **no**
  `handymanAvailability` rows, so they never surface in the passive calendar
  pool. They are reachable *only* via tap-to-accept offers. Their "availability"
  is the act of accepting — which doubles as the audition signal for promotion to
  Core.

This means **the calendar the customer sees is the Core roster's committed
capacity** — promises the system can actually keep — while the ad-hoc pool is
elastic coverage that never over-promises a date it hasn't confirmed.

---

## 4. Data flow (end to end)

```
                        ┌─────────────────────────────────────────────┐
   CONTEXTUAL QUOTE     │  line items → distinct category slugs        │
   (customer-facing)    └───────────────────┬─────────────────────────┘
                                            │
                        resolveQuoteTeam(quote)   ← replaces the 100%-coverage filter
                                            │
                 ┌──────────────────────────┼───────────────────────────┐
                 │                           │                           │
           SOLO (Core)               COMPOSED (Core lead            NO SUPPLY
        Craig covers 100%             + adhoc specialists)        (true capacity gap)
                 │                           │                           │
                 ▼                           ▼                           ▼
        calendar = Craig's          calendar = lead's           dead calendar +
        committed windows           committed windows           "we don't yet cover
                 │                           │                    <trade> in <area>"
                 └────────────┬──────────────┘                    (recruiting signal)
                              ▼
              CUSTOMER PICKS ONE DATE + PAYS DEPOSIT
              (existing wired path: reserveSlot → lock →
               payment-intent metadata.lockId → webhook → confirmBooking)
                              │
                              ▼
              BOOKING HEADER  (contractorBookingRequests row, quoteId link)
                              │
             ┌────────────────┴─────────────────┐
             ▼                                   ▼
   LEAD ASSIGNMENT                     SPECIALIST ASSIGNMENT(S)
   (Core, auto-accepted:               (adhoc: tap-to-accept OFFER →
    it's his committed window)          first to accept wins → assigned)
             │                                   │
             └────────────────┬─────────────────┘
                              ▼
                   CRAIG'S APP / CONTRACTOR APP
             accept/decline · en-route · complete · photos · signature
                              │
                              ▼
              COMPLETION → invoice → payout split by tier
              (Core: floor reconciliation + top-up + book %;
               adhoc: per-job % — via Stripe Connect, already on profile)
                              │
                              ▼
                   ADMIN OVERSIGHT (see §5)
```

Today's wired happy path (Lane B) is single-assignment: `confirmBooking`
(`booking-engine.ts`) writes one `contractorBookingRequests` row. The **composed**
path adds *sibling* assignments to the same booking header — see schema (§7).
The flexible lane (Lane A → pending-dispatch pool) is unchanged; composition
happens at dispatch time there instead of at offer time.

---

## 5. Admin oversight (override surface)

Admin (and Ben, `role='va'` — `requireAdmin` accepts both) must be able to
override every automated decision:

| Object | Override |
|---|---|
| **Availability** | Already exists — availability board + `/admin/availability-mobile` write `contractorAvailabilityDates`. Extend to edit Core weekly windows (`handymanAvailability`). |
| **The team plan** | Re-run / hand-edit `resolveQuoteTeam`: force solo, force split, swap the lead, add/remove a specialist line. |
| **Assignment** | Reassign a booking (or one assignment) to another contractor; re-open a specialist line as a fresh offer. |
| **Tier** | Promote/demote (`adhoc`↔`core`), set/adjust a Core floor & acceptance SLA, activate `partner`. |
| **Pricing** | Override the per-job labour top-up %, the floor, and one-off adjustments. |
| **Capacity gaps** | A dashboard of quotes that hit `bookable:false` by uncovered trade × postcode = the recruiting/cross-training queue. |

The **whole-system view** the handoff asks for is: quotes ↔ team plans ↔
assignments ↔ bookings ↔ contractor calendars, filterable by tier, with the
capacity-gap queue as a first-class panel.

---

## 6. The contractor app (Craig first)

Projection of the model for a **Core** contractor:

- **Week builder** — his committed windows as columns (per the "Craig's week
  builder v1" note); paid jobs slotted into windows by category × postcode
  overlap. Editing a window edits `handymanAvailability`; one-off changes write
  `contractorAvailabilityDates`.
- **Assigned jobs** — accept/decline (Core windows can auto-accept; declines
  trip the acceptance-SLA counter that gates the floor), en-route, timer,
  complete + photos + signature (fields already on `contractorBookingRequests`).
- **Earnings-to-floor tracker** — progress toward the weekly floor, top-ups
  earned, residual book accruals. This is the retention surface — "a full
  calendar is the loyalty currency."

An **ad-hoc** contractor sees a stripped version: incoming offers (accept/
decline), accepted jobs, per-job earnings. No week builder, no floor tracker.
Prior art to reuse: `contractor/DispatchLinkPage.tsx`,
`contractor/ContractorJobSheet.tsx`.

---

## 7. Schema deltas (additive — detailed in `02-schema.md`)

All changes are **new tables or nullable columns** so the `shared/schema.ts`
merge with the `-deployed` chat stays conflict-free.

1. **`handyman_profiles.delivery_tier`** — `varchar` `'partner'|'core'|'adhoc'`,
   default `'adhoc'`. ⚠️ **Naming collision**: there is already a
   `subscriptionTier` (`'free'|'partner'`) — a *freemium/marketing* concept
   (`handyman_profiles.ts:522`), unrelated to delivery. Do **not** overload it.
   Introduce `delivery_tier` as a distinct column and leave `subscriptionTier`
   alone.

2. **`contractor_commitments`** (new table) — the Core/Partner floor agreement:
   `contractorId`, `weeklyFloorPence`, `topupPercentOfLabour`,
   `residualBookPercent`, `acceptanceSlaMinutes`, `effectiveFrom`, `effectiveTo`,
   `status`. Keeps the economics versioned (2-week rolling windows, ladder
   changes) instead of stamping mutable numbers on the profile.

3. **`booking_assignments`** (new table) — the one-booking-to-many-contractors
   link that makes composition real:
   `bookingId` (→ `contractor_booking_requests.id`), `contractorId`,
   `coveredCategories` (text[]), `role` (`'lead'|'specialist'`), `status`,
   `payoutPence`, `acceptedAt`. A solo job = one `lead` row (backward-compatible;
   the existing `contractorBookingRequests.assignedContractorId` stays populated
   for the lead so nothing downstream breaks).

4. **`job_offers`** (new table) — the tap-to-accept mechanic for ad-hoc + Lane-A
   overflow: `assignmentId` or `bookingId`, `contractorId`, `sentAt`,
   `respondedAt`, `status` (`sent|accepted|declined|expired`), `expiresAt`.
   ⚠️ **Verify first**: `contractor-dashboard-routes.ts` already has a
   pending→assigned tap-to-accept path — confirm whether an offers table exists
   before adding, to avoid duplicating a live primitive.

**Not touched / deliberately reused:** `contractorAvailabilityDates`,
`handymanAvailability` (Core windows), `contractorBookingRequests` (job header),
the wired `reserveSlot → confirmBooking` path. `contractorJobs` stays legacy;
`v2Bookings` stays out of scope (separate flow — `project-booking-data-model`).

---

## 8. Open decisions (need your call)

1. **Partner tier now or later?** Recommend: model `core`+`adhoc` fully now,
   stub `partner` as `core` + a profit-share overlay. Confirm you don't need
   partner mechanics in v1.
2. **Same-day multi-trade coordination.** v1 recommendation: anchor the calendar
   on the **lead's** date; dispatch specialist lines as offers post-deposit
   (they may land on a different day). True same-day multi-trade sequencing
   (plumber then electrician, one visit) is a later refinement. OK to defer?
3. **Composed-job pricing to the customer.** The quote is already one price. Do
   split payouts (lead top-up + specialist %) just divide that existing labour
   line, or does a specialist line ever change the customer price? Recommend:
   never changes customer price — payout is an internal split.
4. **Auto-accept for Core windows.** Should a job landing in Craig's committed
   window auto-accept (floor obligation) or still require a tap? Recommend
   auto-accept with a decline window, since the floor is the consideration for
   the commitment.

---

## 9. Build order (what follows this doc)

1. **`02-schema.md`** + additive migration (tier column, 3 new tables).
2. **Routing**: `resolveQuoteTeam` replacing the `coveragePercent===100` filter
   in `quote-fit.ts` — behind a flag; solo path stays identical, composition is
   the new branch. This alone kills the multi-trade zero-pool bug.
3. **Availability**: write Craig's committed windows as `handymanAvailability`
   rows (kills the dry calendar) once his floor terms are set.
4. **Admin**: team-plan view + capacity-gap queue + tier/floor controls.
5. **App**: Core week-builder + earnings-to-floor; ad-hoc offer inbox.

Nothing here rewrites the live booking write-path; it layers composition and
tiering on top of the primitives that already work end-to-end.
</content>
</invoke>
