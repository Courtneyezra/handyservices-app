# Handy Services — Contractor Platform PRD

> The concise product spec for the contractor OS. The **why + what + scope**.
> Detailed model + data flow lives in [`01-model-and-data-flow.md`](./01-model-and-data-flow.md);
> schema in [`02-schema.md`](./02-schema.md). Founder-confirmed via interview + hand
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

## 5. Surfaces

Three audiences, three surfaces:

| Surface | User | Role |
|---|---|---|
| **Admin OS** | Owner + Ben (`va`) | The command center — runs the whole operation. See §5a. |
| **Contextual quote** | Customer | Exists. Add: Craig's contractor skin + honest team-aware calendar. Plus a new **job-tracking** page ("where's my handyman" + live photos). |
| **Contractor app** | Craig first | Week view, accept/decline, en-route, complete + photos + sign-off, earnings. Ad-hoc = stripped offer inbox. Craig is the template every future Core contractor copies. |

## 5a. Admin OS — UX architecture

**No CRM sidebar sprawl.** The ~135 existing pages (70 admin) collapse to
**five workspaces + contextual overlays**, all in one shell.

**The five workspaces** (menu = 5 items, not 70):

| Workspace | Absorbs |
|---|---|
| **Dashboard** | The command center (see below). The 4 old analytics/business dashboards. |
| **Pipeline** | Lead → quote → job → invoice lifecycle, + clients + disputes (~18 pages). |
| **Contractor Hub** | Bands, contractor lanes, availability, capacity gaps, assignment (contractor + 3 availability + 9 dispatch pages). |
| **Send** | Build + send a contextual quote (skills + time + manual contractor/team pick, skinned to Craig) + comms inbox / WhatsApp (3 builder + 3 comms pages). |
| **Settings** | Pricing config, landing + content, VA console, team + roles, integrations (~15 config pages). |

**Three interaction levels on one data spine** — build the domain once, render it
at three densities:

1. **Panel** — a live section on the Dashboard (at-a-glance state + quick actions).
2. **Modal / drawer** — click any row → its detail + actions **slide out over**
   the current context. Detail, edit, create, and assign never navigate away.
3. **Workspace** — the panel's "expand to full width" view, for sustained deep
   work (working a whole pipeline, building a quote, editing the roster).

**Dashboard = the command center.** Each menu area is a live panel on the
Dashboard — you operate ~80% of the day from home: read state in the panel, act
in a modal, expand to a workspace only when you need room. Cockpit for speed,
workspace for depth — same records either way.

**Rule of thumb:** quick read or single action → modal; multi-record or
build-heavy work → expand to the workspace. Never force deep work into a small
modal.

Canonical page count: **~34** (≈8 customer + ≈8 contractor + ≈18 admin folding
into the 5 workspaces). ~12 dev/test pages (`TestLab`, `QuoteTestLab`,
`LiveCallTest*`, `LeadPipelinePage.old`, …) are **deleted**, not migrated.

## 6. v1 scope & build order

Manual-first, highest-leverage first:

1. **Admin OS shell + Contractor Hub** — the one-page shell (5 workspaces, drawer
   pattern, dashboard cockpit) with the Hub as the first full workspace: see +
   override the whole system, run it by hand. Depends on `delivery_tier` + the
   assignment spine.
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

## 10. Proposed defaults (confirmable, not blocking)

These carry a recommended position so the schema can proceed; flag if you'd
change one.

1. **Multi-trade compose timing + date promise** — *DECIDED (20 Jul):* the team is
   composed **at quote generation** (`resolveQuoteTeam` writes `team_plan` +
   `lead_contractor_id`), and the calendar is **anchored on the lead's
   availability**. Rationale: ad-hoc specialists hold **no** availability records
   (they signal availability by accepting an offer), so "team-keepable dates" is
   uncomputable — there is nothing to intersect. The lead's real windows drive the
   calendar; the specialist line is coordinated by Ben post-confirm (WhatsApp,
   manual — matching v1). "Team-keepable dates" only becomes possible once
   specialists carry committed availability, so it's a post-v1 enhancement.
2. **Fill meter** — *Proposed:* **hard (booked) only**, with soft (pipeline) shown
   as a separate faint number. Avoids phantom-fill inflating the week.
3. **Craig's floor** — remains theoretical; **tiers route work now, floor money is
   papered later**. No blocker — `contractor_commitments` supports it the day it's
   signed.

## 11. Acceptance criteria — v1 routing core

`resolveQuoteTeam(requiredCategories, candidates)`
([`server/lib/quote-team.ts`](../../server/lib/quote-team.ts)) replaces the
`coveragePercent === 100` filter. It MUST:

- **AC1 — solo.** One contractor covering every category → a `solo` plan with
  that contractor as `lead`.
- **AC2 — Craig-first.** When several could lead, the committed (core) contractor
  with the lowest `delivery_priority` wins — Craig before an ad-hoc that also
  covers the whole job.
- **AC3 — compose (the bug fix).** A quote spanning trades no single contractor
  covers → a `composed` plan (committed lead + one `specialist` per residual
  category) → `bookable: true`. Old behaviour was empty pool → dead calendar.
- **AC4 — no supply.** A category no candidate covers → `bookable: false`,
  `kind: 'no_supply'`, missing category surfaced (the recruiting signal).
- **AC5 — steer.** The lead stays a committed contractor even when an ad-hoc
  covers more lines; ad-hoc fills only the residual.
- **AC6 — dedupe.** Duplicate category slugs (multi-line quotes) don't break
  coverage — deduped to the required set.

Covered by [`server/lib/quote-team.test.ts`](../../server/lib/quote-team.test.ts)
(vitest, 8 tests, all green).

## 12. Build status

Spec: `00-PRD.md` + [`01-model-and-data-flow.md`](./01-model-and-data-flow.md)
+ [`02-schema.md`](./02-schema.md). v1 is **built + tested**:

| Piece | Status |
|---|---|
| Additive schema | **Done** — `shared/schema.ts`; applied to the DB via `scripts/_apply-contractor-platform-ddl.ts` (additive, `IF NOT EXISTS`). |
| Routing core `resolveQuoteTeam` | **Done + tested** — `server/lib/quote-team.ts`; 14 vitest cases (AC1–AC6 + deriveTeamFit). |
| Live wiring | **Done** — `quote-fit.ts` composes a team; `public-routes.ts` date picker reads `availabilityContractorIds` (multi-trade bug fixed); quote generation persists `lead_contractor_id` + `team_plan`. Live DB smoke: solo + no_supply verified end-to-end. |
| Admin OS shell + Contractor Hub | **Done** — `client/src/pages/admin/OperatingSystem.tsx` (route `/admin/os`) reading `GET /api/admin/contractor-hub` (`server/contractor-hub-routes.ts` + pure `lib/contractor-hub.ts`, 5 tests). |
| Pipeline + Send workspaces | **Done** — `GET /api/admin/os/pipeline` + `/send` (`server/os-routes.ts` + pure `lib/os-summary.ts`, 4 tests); wired into the shell with a unified drawer. |
| Lead `booking_assignments` | **Done** — `confirmBooking` writes the `lead` row atomically in the booking tx (covered categories from `team_plan`). |
| Roster tiers | **Done** — Core = Craig(1), Bezent(2), Joe(3); rest ad-hoc (`scripts/_seed-contractor-tiers.ts`). |
| Decision §10.1 | **Settled** — compose at generation, anchor calendar on lead. |

**Next:** build the Dashboard cockpit + Settings workspace; add specialist
`booking_assignments` rows when composed teams dispatch (WhatsApp/manual);
broaden `/admin/os` access to `va` (Ben); coordinate a proper `db:push` at merge.
