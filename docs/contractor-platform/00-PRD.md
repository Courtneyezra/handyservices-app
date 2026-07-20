# Handy Services — Contractor Platform PRD

> The concise product spec for the contractor OS. The **why + what + scope**.
> Detailed model + data flow lives in [`01-model-and-data-flow.md`](./01-model-and-data-flow.md);
> schema in `02-schema.md` (next). Founder-confirmed via interview + hand
> sketches, 20 Jul 2026.

---

## 1. Problem

The demand engine is top-1% (contextual quoting, pricing, landing pages convert).
**Every failure is delivery-side.** Two concrete breakages:

- **Multi-trade quotes are unbookable.** A quote spanning trades no single
  contractor covers resolves to an empty pool → dead calendar → lost job
  (`server/lib/quote-fit.ts`, the `coveragePercent === 100` filter).
- **No contractor OS.** No tiers, no committed capacity, dry calendars, and
  assignment/booking is fragmented across 4 tables with two parallel flows.
  There is no single surface to run delivery from.

## 2. The shift (strategic frame)

Invert from a **wide ad-hoc network** ("who's free that this job fits?") to a
**tight 3-tier network** ("can Craig do it? fill his week"). Ad-hoc is demoted
from *the model* to a *gap-filler + audition lane*. Concentration → a full
calendar → contractor loyalty → reliability-per-promise.

## 3. Goals / Non-goals

**Goals**
- Every quote is bookable if the work is *coverable by anyone* — solo or as a team.
- One place to run delivery: the **Contractor Hub** (bands → contractors → jobs).
- Craig gets a branded contractor **quote skin** and a **contractor app**; other
  Core contractors follow the same pattern.
- Keep the wired self-book + deposit path; never regress it.

**Non-goals (now)**
- No recurring-revenue / care plans (deferred behind the delivery gate).
- No `partner` tier mechanics yet (future overlay on `core`).
- No SKU-catalog rebuild.
- No in-app tap-to-accept (offers stay on WhatsApp in v1).

## 4. The model (summary)

Four ideas, detailed in `01`:

1. **Three delivery tiers.** `partner` (future) · **`core` = Craig, Bezent, Joe,
   with Craig first** · `adhoc` = Dwaine + warm pool. Routing stack:
   Craig → Bezent → Joe → ad-hoc pool → owner exception.
2. **Quote ↔ contractor is a routing decision that yields a *team*, not a static
   single contractor.** "Steer, then compose": steer to Craig's coverage; split
   only genuinely off-skill lines to a pool specialist (Craig = lead). Bookable
   = *every category covered by someone*; unbookable only on a true supply gap.
3. **Soft-at-generation / hard-at-deposit.** At generation, name the lead (soft) →
   drives the quote skin + an honest calendar, holds **no** capacity. At deposit,
   atomic reserve (hard) consumes capacity. Recompute-on-view keeps the soft pick
   live, never stale.
4. **The Hub and the quote are two faces of one assignment spine.** The hub reads
   the same records the quote writes; no separate sync.

## 5. Users & surfaces

| Surface | User | v1 role |
|---|---|---|
| **Contractor Hub (admin)** | Owner + Ben (`va`) | **v1 focus.** Bands, per-contractor lanes (availability · fill% · pipeline=soft · booked=hard), capacity-gap queue, overrides. |
| **Contextual quote** | Customer | Exists. Add: Craig's contractor skin + honest team-aware calendar. |
| **Contractor app** | Craig first | Week view, accept/decline, en-route, complete + photos + sign-off, earnings. Ad-hoc = stripped offer inbox. |

## 6. v1 scope & build order

Manual-first, highest-leverage first:

1. **Contractor Hub (admin oversight)** — see + override the whole system, run it
   by hand. Depends on `delivery_tier` + the assignment spine.
2. **Routing fix** (`resolveQuoteTeam`) — kills the multi-trade zero-pool bug;
   **auto-suggest, Ben confirms** (proposes team, Ben approves/edits).
3. **Contractor app (Craig)** — the template every future Core contractor copies.

## 7. Build strategy — clean spine + strangler (NOT a big-bang rewrite)

The mess is concentrated in **delivery plumbing**, not the demand engine. Do not
throw out working assets to escape it.

| Subsystem | Decision |
|---|---|
| Contextual quoting, pricing/EVE, segmentation | **Keep** |
| Landing pages | **Keep** |
| Live availability engine, wired Stripe → `confirmBooking` | **Keep** |
| Contractor OS (tiers, hub, app, commitments) | **Build fresh** on a clean schema |
| Booking/assignment (4-table fragmentation, 2 flows) | **Consolidate** onto the clean spine, subsystem-by-subsystem |

New OS is built *alongside* and migrated into piece by piece — the strangler-fig
pattern. No moment where the working system is off.

## 8. Data model (additive — details in `02-schema.md`)

Merge-safe vs the `-deployed` chat (new tables + nullable columns only):

- `handyman_profiles.delivery_tier` — `'partner'|'core'|'adhoc'` (⚠️ distinct
  from the existing freemium `subscriptionTier`).
- `personalized_quotes.leadContractorId` — advisory soft lead → the hub pipeline.
- `contractor_commitments` (new) — the Core floor / "weekly retainer agreed?"
  terms, versioned.
- `booking_assignments` (new) — one booking → many contractors (lead + specialists).
- `contractorBookingRequests.quoteId` — **exists**; the hard booked link.

## 9. Success metrics

- **Promise-kept rate** (on-time / on-quote) — the north star.
- **Craig's fill %** toward ~85% — trips the trigger to open Core capacity.
- **Multi-trade bookability** — % of multi-trade quotes that reach a bookable
  calendar (target: no more dead calendars from coverage gaps).

## 10. Open decisions (before schema)

1. **Multi-trade compose timing + date promise** — when Ben confirms the team on a
   *self-booked* quote, and whether the calendar shows only team-keepable dates or
   anchors on Craig with the specialist following. (This is the last real gap.)
2. **Fill meter** — hard-only (recommended; soft shown separately) vs hard+soft.
3. **Craig's floor** — remains theoretical; tiers route work now, floor money is
   papered later.
