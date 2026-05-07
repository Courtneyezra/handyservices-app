# Module 09: Contractor App v2

**Status:** Wave 4 — authoritative
**Phase:** 7
**Primary flag:** `FF_CONTRACTOR_APP_V2`
**Depends on:** Modules 03, 04, 06, 07, 13, 15; ADR-002, ADR-003

---

## 1. Purpose

The current portal is one-size-fits-all. ADR-003 splits supply into three
segments (Builder / Gap-Filler / Specialist) and ADR-002 locks the contractor
surface on one number per offer plus a visible promise. Module 09 is where
those two decisions become an app: a segment-aware dashboard that lands
contractors on the tab matching how their segment earns. Builders see
committed day-packs, Gap-Fillers see an urgency-sorted single-offer feed,
Specialists see a cert-gated queue. Earnings, Pay Protection, Calendar and
Settings are shared. Every visual primitive comes from Module 13.

Ships in Phase 7. Until `FF_CONTRACTOR_APP_V2=1`, contractors land on the
legacy `/contractor/dashboard/calendar` exactly as today.

## 2. Routing logic

After auth, `SegmentDashboardRouter` reads `contractor_segment`
(Module 03 column on `handyman_profiles`) and redirects:

| Segment | Default landing |
|---|---|
| `builder` | `/contractor/dashboard/day-packs` |
| `gap_filler` | `/contractor/dashboard/jobs` |
| `specialist` | `/contractor/dashboard/specialist-queue` |
| `null` / legacy | `/contractor/dashboard/calendar` |

URL structure under `/contractor/dashboard`:

```
/day-packs          Builder default
/jobs               Gap-Filler default / generic single-offer feed
/specialist-queue   Specialist default
/calendar           availability scheduler (all)
/earnings           NEW (all)
/pay-protection     Module 07 surface (all)
/settings           profile + skills + certs + segment + bank
```

`SegmentDashboardRouter` is a thin component mounted at the index that
issues a `<Redirect>` once auth + segment load. Direct deep-links work for
any segment; the router only governs the *default* landing.
`ContractorPortalLayout.tsx` reads segment from the same auth context to
render a five-tab bottom bar — first tab swaps per segment (Day-Packs /
Jobs / Queue), Calendar / Earnings / Pay Protection / Settings shared.

## 3. Per-segment dashboards

### Builder dashboard (`/day-packs`)

Hero: "Hi {firstName} — your week", then a 14-day calendar strip joining
`day_commitments` (Module 06) to `unit_availability` (Module 04). Each
day card shows status badge (✓ accepted / ⚠ pending / — open /
· unavailable), date, area chip, target £; tap → Module 15 offer page.
Today's pack, if active, is featured atop in `<HeroNavyCard>`.
**"Commit a new day"** CTA opens a modal (date + area postcode +
`day_rate_target_pence` from Settings); POSTs to Module 06's
`/api/contractor/day-commitments`. Stats row with `<CounterTicker>`:
days booked this week · total earnings target · bonus eligible (Module 07
pending completion bonuses).

### Gap-Filler dashboard (`/jobs`)

Reskin of `MyJobsTab.tsx` into three sections: **Active offers** —
`routing_offers` with `status='pending'` sorted by `expires_at ASC`, each
card with job summary, area, pay, time-window, expiry countdown, tapping
to existing `/contractor/dispatch/:linkId`; **Upcoming** — accepted
dispatches where `scheduledStartAt > now`; **Recent** — last 10 completed
or in-progress. Stats row: open offers · earnings this week ·
**reliability score** (visible — ADR-003 makes this an explicit incentive
lever; from `handyman_profiles.reliability_score`). Empty state links
`/calendar`.

### Specialist dashboard (`/specialist-queue`)

Cert-gated. Query filters jobs whose `cert_required` matches one of this
unit's `verified` certs. A cert panel above the queue shows each cert with
badge and expiry; any cert expiring <30 days pins a yellow "Update cert"
CTA — a stale cert silently zeroes the queue. Stats row: specialist jobs
this month · average £/hr (uses `real_work_minutes` per ADR-005, never
pricing-time) · renewal countdown. When no specialist is available,
Module 05 escalates manually.

## 4. Earnings tab (all segments)

`/earnings` — `EarningsView.tsx`. Sections: this week (day-by-day), this
month (+MoM delta), 30-day £/hr average
(`sum(contractor_pay)/sum(real_work_minutes/60)` per ADR-005), pending
payouts (dispatches in `completed_pending_review` with 24h hold timer),
last 10 `contractor_payouts`, tax-ready CSV export at
`/api/contractor/earnings/csv`. Module 13 styling — `<CounterTicker>` for
totals, `<DetailsCollapsible>` for per-payout breakdowns.

## 5. Pay Protection tab (all segments)

`/pay-protection` — direct mount of the Module 07 §7 surface (active
claims, recent adjustments, disputes log, 48h pay tracker). Module 09
owns *placement*; Module 07 owns implementation.

## 6. Calendar tab (segment-aware)

`/calendar` — Module 04's `AvailabilityScheduler.tsx` when
`FF_AVAILABILITY_ENGINE` is on; legacy `CalendarTab.tsx` otherwise.
Module 09 adds: Builders see "Commit this day" on each available day
(same modal as Day-Packs hero CTA); Gap-Fillers see only the AM/PM/Full
slot toggle (Module 04 §6); Specialists see slot toggle plus a banner
reminding them their queue is cert-filtered.

## 7. Settings tab

Extends existing `ProfileTab.tsx` (renamed `SettingsView`): profile (name,
photo, contact) + public profile slug (existing); **Segment** read-only
badge + "Request change" (§10); **Skills** multiselect from
`shared/categories.ts`; **Certs** list with verification + upload;
**Home postcode** (drives ADR-006 mobilisation); **Day-rate target**
(Builder only, £ → `day_rate_target_pence`); **Min job value**
(Gap-Filler / Specialist); **Notifications preferences** (Module 10);
**Bank details** (Stripe Connect link / re-link).

## 8. Files

```
NEW       client/src/pages/contractor/dashboard/DayPacksView.tsx
NEW       client/src/pages/contractor/dashboard/SpecialistQueueView.tsx
NEW       client/src/pages/contractor/dashboard/EarningsView.tsx
NEW       client/src/pages/contractor/dashboard/PayProtectionView.tsx
NEW       client/src/components/contractor/SegmentDashboardRouter.tsx
NEW       client/src/components/contractor/SegmentChangeRequestModal.tsx
NEW       server/contractor-segment-routes.ts
MODIFIED  client/src/pages/contractor/ContractorPortalLayout.tsx
MODIFIED  client/src/pages/contractor/dashboard/MyJobsTab.tsx
MODIFIED  client/src/pages/contractor/dashboard/CalendarTab.tsx
MODIFIED  client/src/pages/contractor/dashboard/ProfileTab.tsx
MODIFIED  client/src/App.tsx
```

## 9. Component reuse from Module 13

- `<BrandNavBar />`, `<BrandFooter />`, `<BrandAccentStrip />` — page chrome.
- `<HeroNavyCard />` — Builder today's pack, Earnings month total,
  Specialist cert-status hero.
- `<CounterTicker />` — every stats number.
- `<ToastStack />` + `useToast()` — accept / decline / claim feedback.
- `<ProgressBar />` — week-fill, bonus progress.
- `<TrophyUnlockNode />` — completion-bonus celebration on Day-Packs.
- `<DetailsCollapsible />` — payout and claim history rows.
- `<NumberedDot />`, `<TimelineConnector />`, `<MarkCompleteButton />` —
  inherited via Module 15.

No primitive is recreated; anything new visual belongs in Module 13 first.

## 10. Segment switching

Per ADR-003 a contractor holds one segment at a time and requests change.
Self-service direct write is not allowed — Module 03 §6 guards exist and
admin keeps oversight.

1. Settings → "Request segment change" opens `<SegmentChangeRequestModal>`
   (target segment + reason).
2. POST `/api/contractor/segment-change-request` writes a row to the
   admin queue (`GET /api/admin/units/segment-change-requests`).
3. Admin approves via Module 03's `POST /api/admin/units/segment-change`
   — running §6 guards (blocks Builder→Gap-Filler if open `day_commitments`).
4. Contractor notified via Module 10.
5. Segment column flips; next login lands on the new default.

## 11. Tests

| Area | Coverage |
|---|---|
| Routing | Each segment lands on its default tab; null/legacy → `/calendar`. |
| Deep-links | Any segment can navigate to any tab; only default differs. |
| Builder | Commit-day modal posts to Module 06; new card appears in strip. |
| Gap-Filler | Pending offer sorted by `expires_at`; expired offer drops out. |
| Specialist | Queue filtered to verified certs; expired cert collapses queue + surfaces renewal CTA. |
| Earnings | Pending + recent payouts render; CSV export valid; £/hr from `real_work_minutes`. |
| Pay protection | Tab mounts Module 07 surface from all three dashboards. |
| Component reuse | Lint asserts no inline brand colours in Module 09 files. |
| Segment change | Modal POSTs request; admin approval flips segment; Builder→Gap-Filler with open commitment rejected per Module 03 §6. |
| Flag fallback | Flag off → router bypassed; legacy CalendarTab renders; new routes 404. |

## 12. Rollback

`FF_CONTRACTOR_APP_V2=0`: router short-circuits to legacy `/calendar` for
everyone; new routes 404; bottom tab bar reverts to the three-tab legacy
layout (Calendar / My Jobs / Profile); segment-change endpoints 404, admins
continue setting segment manually via Module 03. No data loss —
`contractor_segment` is already populated by Module 03's backfill (default
`gap_filler`) and ignored when the flag is off. Module 07's pay-protection
surface remains accessible via its own flag.

## 13. Adoption plan

Phase 7 ships this module:

1. **Internal QA** — flag on for staff contractor accounts, one week.
   Validate routing and component parity across the three archetypes.
2. **Builder beta — 10% for 1 week.** Highest-leverage segment (50–60% of
   supply per ADR-003). Watch day-pack accept rate vs control,
   time-to-commit, drop-off into Module 15.
3. **Gap-Filler + Specialist beta — 10% each, week 2.** Watch
   offer-to-accept time, reliability-score impact, cert-renewal CTR.
4. **General rollout** if all metric sets hold.

Roll-back is one flag: `FF_CONTRACTOR_APP_V2=0` returns every contractor
to the legacy app instantly, no schema work required.

## 14. Cross-references

- **ADR-002** — one-number-per-offer rule.
- **ADR-003** — segmentation strategy defines the three dashboards.
- **Module 03** — `contractor_segment` + segment-change guards.
- **Module 04** — Calendar tab content (`AvailabilityScheduler`).
- **Module 06** — day-pack commitments consumed by `/day-packs`.
- **Module 07** — `/pay-protection` mounts its surface.
- **Module 10** — notifications for segment-change and offer arrival.
- **Module 13** — design system; every visual import.
- **Module 15** — day-pack offer page; `/day-packs` deep-links per row.
- **`master-plan.md`** Phase 7 — ship phase.
- **`feature-flags.md`** — `FF_CONTRACTOR_APP_V2`.
