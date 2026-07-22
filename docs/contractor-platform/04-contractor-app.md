# Contractor app — availability harvesting (solo v1)

> **Status: BUILT (22 Jul 2026), API verified live; teams variant pending.**
> PRD §5/§6: the contractor app, Craig first, the template every Core
> contractor copies. This doc covers v1 = the harvest surface. Jobs,
> accept/decline, en-route and earnings come later.

## The problem it solves

The operating model (locked 22 Jul) sells customers a **buffered calendar of
confirmed contractor availability** — but availability capture depended on
Ben manually keying days into `/admin/availability-mobile` ("needs
per-contractor discipline"). Contractors had no self-serve surface: the old
portal's CalendarTab required an email+password account nobody has. Discipline
dies at a password prompt.

## The model

**Two provider types: solo and team.** Solo is built; the teams variant forks
on `provider.type` in the same payload (a team will harvest crew capacity per
day — heads available — rather than one person's AM/PM; no schema for that
yet, deliberately).

**Entry = an unguessable per-contractor link, no login** — the dispatch-link
trust model, not the portal-login one:

- `handyman_profiles.app_token` (varchar 80, unique, nullable — additive).
- Issued lazily and idempotently: `POST /api/admin/contractor-hub/:id/app-link`
  (the **App link** button in the Hub contractor modal copies the full URL),
  or `npx tsx scripts/_issue-app-token.ts [contractorId]`.
- The link is durable — texting it twice is fine; it IS the credential.

**Surface = `/my-week/:token`** (`client/src/pages/contractor/MyWeekPage.tsx`),
mobile-first, dark, based on the old portal CalendarTab:

- **3 week rows** (this week / next week / w/c …), 7 day-cells each. Tap a
  day → bottom sheet: Morning 9–1 / Afternoon 2–6 / Full day / Not available.
- **Booked slots are locked** (blue, padlock) — bookings always overlay.
  Past days are dimmed and dead.
- **"Your usual week"** — 7 pattern chips (tap cycles Full → AM → PM → Off),
  explicit save. Single-day taps above override the pattern (engine
  precedence: override wins → weekly pattern → off).
- Freshness footer shows `lastAvailabilityRefresh`.

## Writes land where the engine already reads

No new availability model — the app writes the exact rows the customer quote
day-picker, the Hub grid and Ben's mobile tool already share:

| Action | Table | Semantics |
|---|---|---|
| Day tap | `contractor_availability_dates` | one override row per calendar day, slot-typed via `@shared/slot-times`; **off = explicit `isAvailable:false` row** (must beat the weekly pattern) |
| Usual week | `handyman_availability` | one row per weekday, `off` → `isActive:false` |
| Every write | `handyman_profiles.lastAvailabilityRefresh` | bumped — feeds the staleness accountability punch-list item |

An opened day is **immediately bookable** by customers (same
`buildAvailabilityResponse` sources); a day the contractor closes drops out
of the customer calendar on next recompute.

## Pieces

| Piece | File |
|---|---|
| Routes (GET week / POST day / POST pattern) | `server/contractor-app-routes.ts` (mounted `/api/contractor-app`, public — token is the credential) |
| Pure helpers + validation | `server/lib/contractor-app.ts` (+ `.test.ts`, 7 vitest cases incl. off-beats-pattern round-trip through `resolveWeek`) |
| Grid resolution | reuses `server/lib/contractor-week.ts` `resolveWeek` |
| Page | `client/src/pages/contractor/MyWeekPage.tsx`, route `/my-week/:token` in `App.tsx` |
| Link issuance | `POST /:id/app-link` in `server/contractor-hub-routes.ts` + Hub modal button in `OperatingSystem.tsx` |
| Ops script | `scripts/_issue-app-token.ts` |
| DDL | `scripts/_apply-contractor-platform-ddl.ts` (applied 22 Jul) |

Verified live 22 Jul: GET returns Craig's real resolved grid (booked 29 Jul
locked, 30–31 open), day write round-trips, past-date and bad-token rejected.

## Next (teams variant + beyond)

1. **Teams variant** — `provider.type: 'team'`: a team lead marks how many
   heads are free per day (crew capacity), needs a team/crew model in schema
   first (none exists — greenfield, per the Explore audit).
2. WhatsApp nudge loop — weekly "top up your week" message carrying the link;
   staleness alert drops stale contractors from the buffered picker.
3. Grow `/my-week` into the full contractor app: jobs, accept/decline,
   en-route, complete + photos, earnings (PRD §5).
