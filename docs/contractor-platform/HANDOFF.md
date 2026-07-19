# Contractor Platform — planning brief (parallel worktree)

> This worktree is **isolated** for this workstream. Rules of the road:
> - **Stay in `/Users/courtneebonnick/v6-switchboard-contractor`** on branch
>   `feat/contractor-platform`. Do **not** edit `/Users/courtneebonnick/v6-switchboard`
>   or `/Users/courtneebonnick/v6-switchboard-deployed` — another chat owns those.
> - Commit to `feat/contractor-platform`. It'll be merged to `main` when ready.
> - `node_modules` and `.env` are symlinked from the main repo, so `npx tsc`,
>   `npx tsx scripts/…`, and a dev server all work here. If you start a dev
>   server, it will pick its own port (57520 is taken by the other chat).

## The goal

Design the infrastructure for how **contextual quotes interlink with the
contractor structure** — handymen at different tiers: **partner · core ·
ad-hoc**. End state:

1. A **contractor app for Craig** — plot his working days, see assigned jobs,
   accept/decline, mark complete — feeding the main system in real time.
2. **Admin oversight** — see the whole system (quotes ↔ contractors ↔ bookings),
   with the ability to override assignments, availability, and pricing.

Start with the **model + data flow** (a design doc in this folder), then schema,
then the app + admin surfaces. Don't boil the ocean in code first — the
interlink model is the hard part.

## What already exists (read these before designing)

**Quote ↔ contractor matching**
- `server/lib/quote-fit.ts` → `resolveQuoteCandidatePoolForQuote(quote)` — the
  single source of truth for "which contractors can do this quote". The public
  availability endpoint and the admin fit panel both use it.
- ⚠️ **Multi-trade zero-pool bug**: a quote spanning trades no single contractor
  covers resolves to an EMPTY pool → every date blocked → unbookable. This is
  THE structural problem your tiering model must solve (partner/core can cover
  more; ad-hoc pool fills gaps). See `project-first-available-flex` memory.

**Schema (`shared/schema.ts`)**
- `handyman_profiles` — contractor records (Craig = `hp_aa21264a-9143-4116-bda2-2da998255929`).
  Has bio / hero_image_url / trust_badges / certs / reviews columns, mostly null.
- `contractor_availability_dates` — per-date availability overrides (what the
  quote picker actually reads). Craig's seeded via `scripts/_seed-craig-availability.ts`.
- `handyman_availability` — weekly recurring patterns (contractors have none →
  dry calendars). 
- `contractor_booking_requests` — the availability + assignment source of truth.
- Booking tables are fragmented: `contractorBookingRequests` (canonical),
  `contractorJobs` (legacy), `v2Bookings` (separate unintegrated flow). Consolidation is open.

**Assignment / dispatch**
- `server/auto-assignment-engine.ts`, `server/dispatch-sweep.ts`,
  `server/dispatch-optimizer.ts`, `server/dispatch-cron.ts`,
  `server/booking-engine.ts`, `server/job-assignment.ts`.

**Existing contractor/admin surfaces (prior art for the app)**
- `client/src/pages/admin/availability-mobile` (Ben's mobile availability tool).
- `client/src/pages/contractor/DispatchLinkPage.tsx`,
  `client/src/pages/contractor/ContractorJobSheet.tsx`.
- `requireAdmin` accepts role `va` (Ben).

## Key context from memory (ask the user or read `.claude/.../memory/`)

- **`project-committed-capacity-agreement`** — contractor floor + top-up +
  residual-book + ladder design; worker-status legal flag. This is the economic
  spine of the tiering model — read it first.
- **`project-availability-architecture`** — quote picker reads ONLY per-contractor
  overrides/weekly patterns (NOT a master schedule); contractors have no weekly
  patterns → dry calendars.
- **`project-booking-data-model`** — the 4 booking tables and how they relate.
- **`project-scheduling-auto-assign`** — seamless booking, deterministic engine +
  slack governor; right-size to a small roster.
- **`project-strategy-2026h2`** — hybrid delivery = **core techs + vetted pool**;
  **delivery is the bottleneck, not leads**. This is why the tiering matters.

## Tiering — the thing to define

- **Partner** — ? (equity/committed capacity? guaranteed floor of hours?)
- **Core** — Craig today: the reliable spine, gets first pick, committed windows.
- **Ad-hoc** — vetted pool, tap-to-accept, fills coverage gaps (multi-trade).

Define for each tier: how they set availability, how quotes route to them, how
they're paid, what admin can override, and what the app shows them. That model
is the deliverable; the app + schema follow from it.

## Coordination with the other chat

The other chat (in `-deployed`) is doing customer-facing quote/landing/checkout
work. Overlap risk is **`shared/schema.ts`** and the **matching/availability**
server code. Since you're on a separate branch, git will merge cleanly unless you
both edit the same lines — so if you change `schema.ts`, keep changes additive
(new tables/columns) and flag them so the merge is trivial.
