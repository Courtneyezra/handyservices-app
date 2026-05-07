# Data Model

**Status:** Wave 1 — authoritative
**Depends on:** `master-plan.md` (domain model section)
**Owner:** Wave 1 Agent A

---

## 1. Overview

Complete schema for Booking & Dispatch v2. Every change is **additive-only**: new columns are NULL-default or take a safe default, new tables stand independent, no existing column is dropped/renamed/retyped, and no existing table gains an FK pointing at a new one. `git revert` of any migration leaves the DB forward-compatible. Cold rollback is a flag flip (`feature-flags.md`); schema rollback is optional cleanup. See `master-plan.md` "Branch + rollback strategy" for the broader safety model.

---

## 2. Existing tables touched (extensions)

### `personalized_quotes`

Quote becomes the booking record. New fields tag work for routing and track the lifecycle (`state-machine.md`).

| Column | Type | Default | Rationale |
|---|---|---|---|
| `flex_tier` | `flex_tier_enum` | NULL | Customer-chosen flex window. Discount applied at quote time; routing slack downstream. ADR-004. |
| `flex_window_days` | `integer` | NULL | Concrete window size (Fast=0, Flexible=3, Relaxed=7). Denormalised for solver speed. |
| `crew_size_required` | `integer` | `1` | Manual tag at quote time. Drives unit-vs-team filter in routing. |
| `skills_required` | `jsonb` | `'[]'` | Array of skill slugs (e.g. `["plumbing_minor","tiling"]`). Matches `handyman_profiles.skills`. |
| `cert_required` | `jsonb` | `'[]'` | Array of cert slugs (e.g. `["gas_safe"]`). Specialist gate. |
| `duration_estimate_minutes` | `integer` | NULL | Pricing-time estimate (what customer £/hr is calculated against). |
| `real_work_minutes` | `integer` | NULL | Solver-time estimate (honest minutes). See ADR-005 — the two diverge by design. |
| `complexity_flags` | `jsonb` | `'[]'` | Free-form tags (`["access_difficult","two_storey","heritage"]`) for human dispatcher. |
| `heavy_lifting` | `boolean` | `false` | Drives unit-type filter (single contractor vs team). |
| `booking_state` | `varchar(40)` | `'draft'` | The state-machine field. See `state-machine.md`. |

```ts
// shared/schema.ts additions
export const flexTierEnum = pgEnum('flex_tier', ['fast', 'flexible', 'relaxed']);

// inside personalizedQuotes pgTable definition
flexTier: flexTierEnum('flex_tier'),
flexWindowDays: integer('flex_window_days'),
crewSizeRequired: integer('crew_size_required').default(1),
skillsRequired: jsonb('skills_required').default([]),
certRequired: jsonb('cert_required').default([]),
durationEstimateMinutes: integer('duration_estimate_minutes'),
realWorkMinutes: integer('real_work_minutes'),
complexityFlags: jsonb('complexity_flags').default([]),
heavyLifting: boolean('heavy_lifting').default(false),
bookingState: varchar('booking_state', { length: 40 }).default('draft'),
```

### `handyman_profiles` (the **Unit** entity)

New fields enable segmentation, routing geography, and capacity.

| Column | Type | Default | Rationale |
|---|---|---|---|
| `contractor_segment` | `contractor_segment_enum` | NULL | Builder / Gap-Filler / Specialist. Routing tier selector. ADR-003. |
| `unit_type` | `unit_type_enum` | `'single'` | Single contractor vs team — affects crew-size matching. |
| `crew_max` | `integer` | `1` | Max simultaneous people the unit can field. |
| `home_postcode` | `varchar(10)` | NULL | Travel anchor for distance calcs. |
| `area_catchment` | `jsonb` | `'[]'` | Postcode prefixes the unit will travel to (e.g. `["NG2","NG5","NG7"]`). |
| `skills` | `jsonb` | `'[]'` | Skill slugs the unit performs. Matches `personalized_quotes.skills_required`. |
| `accepts_skus` | `jsonb` | NULL | Optional explicit SKU allow-list (overrides `skills`). |
| `certs` | `jsonb` | `'[]'` | Cert slugs (gas_safe, niceic, etc.) for specialist gating. |
| `min_job_value_pence` | `integer` | NULL | Below this, unit declines. Used by Gap-Filler segment. |
| `day_rate_target_pence` | `integer` | NULL | Builder segment — what the unit wants to earn for a full day. |
| `reliability_score` | `decimal(3,2)` | `1.00` | 0.00–1.00, tracked by completions. Routing weight. |
| `priority_routing_score` | `decimal(5,2)` | NULL | Computed nightly. Ranks units within segment for offer order. |

```ts
export const contractorSegmentEnum = pgEnum('contractor_segment', ['builder', 'gap_filler', 'specialist']);
export const unitTypeEnum = pgEnum('unit_type', ['single', 'team']);

// added to handymanProfiles
contractorSegment: contractorSegmentEnum('contractor_segment'),
unitType: unitTypeEnum('unit_type').default('single'),
crewMax: integer('crew_max').default(1),
homePostcode: varchar('home_postcode', { length: 10 }),
areaCatchment: jsonb('area_catchment').default([]),
skills: jsonb('skills').default([]),
acceptsSkus: jsonb('accepts_skus'),
certs: jsonb('certs').default([]),
minJobValuePence: integer('min_job_value_pence'),
dayRateTargetPence: integer('day_rate_target_pence'),
reliabilityScore: decimal('reliability_score', { precision: 3, scale: 2 }).default('1.00'),
priorityRoutingScore: decimal('priority_routing_score', { precision: 5, scale: 2 }),
```

### `productized_services` (SKUs)

Each SKU now carries the time decomposition the solver needs.

| Column | Type | Default | Rationale |
|---|---|---|---|
| `pricing_time_minutes` | `integer` | NULL | What customer £/hr is calculated against (mirrors legacy `time_estimate_minutes`). ADR-005. |
| `real_work_minutes` | `integer` | NULL | Honest on-tools minutes. Drives day-pack capacity. |
| `materials_collection_minutes` | `integer` | NULL | Pre-job pickup time, if any. ADR-008. |
| `setup_minutes` | `integer` | `12` | Park, kit out, talk to customer. |
| `cleanup_minutes` | `integer` | `15` | Tidy, photo, sign-off. |
| `customer_supplied_materials` | `boolean` | `false` | Hint that pickup may be skippable. |
| `requires_specialist_cert` | `boolean` | `false` | Gates routing to Specialist segment. |
| `parking_difficulty` | `varchar(20)` | NULL | `easy`/`moderate`/`hard` — adds buffer minutes. |

```ts
pricingTimeMinutes: integer('pricing_time_minutes'),
realWorkMinutes: integer('real_work_minutes'),
materialsCollectionMinutes: integer('materials_collection_minutes'),
setupMinutes: integer('setup_minutes').default(12),
cleanupMinutes: integer('cleanup_minutes').default(15),
customerSuppliedMaterials: boolean('customer_supplied_materials').default(false),
requiresSpecialistCert: boolean('requires_specialist_cert').default(false),
parkingDifficulty: varchar('parking_difficulty', { length: 20 }),
```

---

## 3. New tables

All new tables use `text` PKs with prefixed UUIDs for log-greppability.

### `unit_availability` — daily slot per unit × date × slot

```sql
CREATE TYPE slot_enum AS ENUM ('am','pm','full');
CREATE TYPE availability_status_enum AS ENUM ('available','held','booked','unavailable');

CREATE TABLE unit_availability (
  id text PRIMARY KEY,
  unit_id varchar NOT NULL REFERENCES handyman_profiles(id) ON DELETE RESTRICT,
  date date NOT NULL,
  slot slot_enum NOT NULL,
  status availability_status_enum NOT NULL DEFAULT 'available',
  crew_available_count integer NOT NULL DEFAULT 1,
  hold_expires_at timestamptz,
  hold_for_booking_id varchar,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, date, slot)
);
```

```ts
export const slotEnum = pgEnum('slot', ['am','pm','full']);
export const availabilityStatusEnum = pgEnum('availability_status', ['available','held','booked','unavailable']);

export const unitAvailability = pgTable('unit_availability', {
  id: text('id').primaryKey().$defaultFn(() => `ua_${crypto.randomUUID()}`),
  unitId: varchar('unit_id').notNull().references(() => handymanProfiles.id, { onDelete: 'restrict' }),
  date: date('date').notNull(),
  slot: slotEnum('slot').notNull(),
  status: availabilityStatusEnum('status').notNull().default('available'),
  crewAvailableCount: integer('crew_available_count').notNull().default(1),
  holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
  holdForBookingId: varchar('hold_for_booking_id'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_ua_unit_date_slot').on(t.unitId, t.date, t.slot),
  index('idx_ua_date_status').on(t.date, t.status),
]);
```

### `day_commitments` — Builder pre-commits a day to be filled (one row per unit × date)

```sql
CREATE TYPE day_commitment_status_enum AS ENUM ('open','assembling','offered','accepted','released','expired');

CREATE TABLE day_commitments (
  id text PRIMARY KEY,
  unit_id varchar NOT NULL REFERENCES handyman_profiles(id) ON DELETE RESTRICT,
  date date NOT NULL,
  start_time time NOT NULL DEFAULT '08:00',
  end_time time NOT NULL DEFAULT '17:00',
  area_filter jsonb DEFAULT '[]'::jsonb,
  target_pence integer NOT NULL,
  status day_commitment_status_enum NOT NULL DEFAULT 'open',
  locked_at timestamptz,
  released_at timestamptz,
  released_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, date)
);
```

### `day_packs` — the bin-packed bundle offered to a Builder

```sql
CREATE TYPE day_pack_status_enum AS ENUM ('proposed','offered','accepted','declined','cancelled','completed');

CREATE TABLE day_packs (
  id text PRIMARY KEY,
  commitment_id text NOT NULL REFERENCES day_commitments(id) ON DELETE RESTRICT,
  unit_id varchar NOT NULL REFERENCES handyman_profiles(id) ON DELETE RESTRICT,
  date date NOT NULL,
  status day_pack_status_enum NOT NULL DEFAULT 'proposed',
  job_ids jsonb NOT NULL DEFAULT '[]'::jsonb,        -- ordered array of personalized_quotes.id
  total_contractor_pay_pence integer NOT NULL,
  total_customer_pay_pence integer NOT NULL,
  estimated_hours decimal(4,2) NOT NULL,
  travel_minutes integer NOT NULL DEFAULT 0,
  route_summary jsonb,                                -- { polyline, mapStaticUrl, deepLink }
  top_up_pence integer DEFAULT 0,
  offered_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  declined_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `materials_pickups` — mirrors `MaterialsPickup` from `DispatchPreviewPage.tsx`. ADR-008.

```sql
CREATE TYPE materials_pickup_status_enum AS ENUM ('pending','collected','skipped');

CREATE TABLE materials_pickups (
  id text PRIMARY KEY,
  day_pack_id text NOT NULL REFERENCES day_packs(id) ON DELETE RESTRICT,
  supplier varchar(60) NOT NULL,
  branch_name varchar(120),
  postcode varchar(10) NOT NULL,
  open_from time,
  estimated_minutes integer NOT NULL DEFAULT 30,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  status materials_pickup_status_enum NOT NULL DEFAULT 'pending',
  collected_at timestamptz,
  collected_by_unit_id varchar REFERENCES handyman_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `routing_offers` — per-round offer envelope (distinct from `contractor_job_links`, the post-accept dispatch link)

```sql
CREATE TYPE routing_offer_status_enum AS ENUM ('pending','accepted','declined','expired','cancelled');

CREATE TABLE routing_offers (
  id text PRIMARY KEY,
  booking_id varchar NOT NULL,                         -- personalized_quotes.id
  job_dispatch_id text REFERENCES job_dispatches(id) ON DELETE SET NULL,
  day_pack_id text REFERENCES day_packs(id) ON DELETE SET NULL,
  unit_id varchar NOT NULL REFERENCES handyman_profiles(id) ON DELETE RESTRICT,
  round integer NOT NULL DEFAULT 1,
  status routing_offer_status_enum NOT NULL DEFAULT 'pending',
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  decline_reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### `routing_decisions` — append-only audit log of every routing decision (assigned, skipped, escalated)

```sql
CREATE TABLE routing_decisions (
  id text PRIMARY KEY,
  booking_id varchar NOT NULL,
  decision_type varchar(40) NOT NULL,        -- 'segment_select','candidate_filter','offer_dispatch','escalate_admin'
  inputs jsonb NOT NULL,
  outputs jsonb NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  decided_by varchar(40) NOT NULL DEFAULT 'system'
);
```

### `routing_weights` — hot-tunable engine config (no code deploy to retune)

```sql
CREATE TABLE routing_weights (
  id text PRIMARY KEY,
  weight_key varchar(60) NOT NULL,
  weight_value decimal(8,4) NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### `pay_adjustments` — the 7 pay-protection guarantees materialise as rows here. Module 07.

```sql
CREATE TYPE pay_adjustment_type_enum AS ENUM (
  'misscope_uplift','callout_fee','cancellation_comp',
  'materials_reimbursement','day_rate_topup','completion_bonus'
);
CREATE TYPE pay_adjustment_status_enum AS ENUM (
  'auto_approved','pending_review','admin_approved','rejected'
);

CREATE TABLE pay_adjustments (
  id text PRIMARY KEY,
  dispatch_id text NOT NULL REFERENCES job_dispatches(id) ON DELETE RESTRICT,
  unit_id varchar NOT NULL REFERENCES handyman_profiles(id) ON DELETE RESTRICT,
  type pay_adjustment_type_enum NOT NULL,
  amount_pence integer NOT NULL,
  reason text NOT NULL,
  evidence_photos jsonb DEFAULT '[]'::jsonb,
  variance_pct decimal(5,2),
  status pay_adjustment_status_enum NOT NULL DEFAULT 'pending_review',
  resolved_at timestamptz,
  resolved_by varchar,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### `booking_state_log` — append-only history for `personalized_quotes.booking_state`. Powers state-machine audit + timeout sweepers.

```sql
CREATE TABLE booking_state_log (
  id text PRIMARY KEY,
  booking_id varchar NOT NULL,                 -- personalized_quotes.id
  from_state varchar(40),
  to_state varchar(40) NOT NULL,
  triggered_by varchar(40) NOT NULL,           -- 'customer','admin','system','contractor'
  trigger_metadata jsonb DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 4. Indexes

| Index | Table | Columns | Serves |
|---|---|---|---|
| `idx_pq_booking_state` | `personalized_quotes` | `(booking_state)` partial WHERE state IN routing states | Inbound queue + state sweepers. |
| `idx_pq_flex_tier` | `personalized_quotes` | `(flex_tier, completion_date)` | Solver candidate filter. |
| `idx_hp_segment` | `handyman_profiles` | `(contractor_segment)` | Segment-tier routing. |
| `idx_hp_home_postcode` | `handyman_profiles` | `(home_postcode)` | Distance pre-filter. |
| `idx_ua_unit_date_slot` | `unit_availability` | UNIQUE `(unit_id, date, slot)` | Slot lookup + conflict prevention. |
| `idx_ua_date_status` | `unit_availability` | `(date, status)` | Solver capacity scan for a day. |
| `idx_dc_date_status` | `day_commitments` | `(date, status)` | Builder week view + assembler. |
| `idx_dc_unit_date` | `day_commitments` | UNIQUE `(unit_id, date)` | Idempotent commitment per unit per day. |
| `idx_dp_status` | `day_packs` | `(status)` | Active offers dashboard. |
| `idx_dp_unit_date` | `day_packs` | `(unit_id, date)` | Builder app "my packs". |
| `idx_mp_day_pack` | `materials_pickups` | `(day_pack_id)` | Pickup lookup from pack. |
| `idx_ro_status` | `routing_offers` | `(status)` | Pending offers sweep. |
| `idx_ro_expires` | `routing_offers` | `(expires_at)` partial WHERE status='pending' | Cron expiry sweeper. |
| `idx_ro_booking` | `routing_offers` | `(booking_id, round)` | Round-history per booking. |
| `idx_pa_dispatch` | `pay_adjustments` | `(dispatch_id)` | Per-dispatch adjustments view. |
| `idx_pa_status` | `pay_adjustments` | `(status)` partial WHERE status='pending_review' | Admin queue. |
| `idx_bsl_booking` | `booking_state_log` | `(booking_id, occurred_at DESC)` | State history viewer. |
| `idx_routing_decisions_booking` | `routing_decisions` | `(booking_id, decided_at DESC)` | Replay debugger. |

---

## 5. Foreign keys + cascade rules

| From | To | ON DELETE | Why |
|---|---|---|---|
| `unit_availability.unit_id` | `handyman_profiles.id` | RESTRICT | Force soft-delete; never lose a contractor. |
| `day_commitments.unit_id` | `handyman_profiles.id` | RESTRICT | Same. |
| `day_packs.commitment_id` | `day_commitments.id` | RESTRICT | Pack is meaningless without commitment. |
| `day_packs.unit_id` | `handyman_profiles.id` | RESTRICT | Same. |
| `materials_pickups.day_pack_id` | `day_packs.id` | RESTRICT | Preserve pickup history for audit. |
| `materials_pickups.collected_by_unit_id` | `handyman_profiles.id` | SET NULL | Survive contractor archival. |
| `routing_offers.unit_id` | `handyman_profiles.id` | RESTRICT | — |
| `routing_offers.job_dispatch_id` | `job_dispatches.id` | SET NULL | Offer history outlives dispatch deletion. |
| `routing_offers.day_pack_id` | `day_packs.id` | SET NULL | Same. |
| `pay_adjustments.dispatch_id` | `job_dispatches.id` | RESTRICT | Money rows must outlive dispatches. |
| `pay_adjustments.unit_id` | `handyman_profiles.id` | RESTRICT | Same. |

`booking_id` references on `routing_offers`, `routing_decisions`, `booking_state_log` are deliberately **not** FKs — these logs must outlive any future quote-archival flow. **No `CASCADE` anywhere.**

---

## 6. Migration order

Each is one file under `migrations/`, additive-only. **Critical rule: extensions before new tables, indexes after backfill.**

1. `001_extend_pq_booking.sql` — columns on `personalized_quotes` + `flex_tier_enum`.
2. `002_extend_handyman_profiles.sql` — columns + `contractor_segment_enum`, `unit_type_enum`.
3. `003_extend_productized_services.sql` — SKU time-decomposition columns.
4. `004_create_unit_availability.sql` — depends on `handyman_profiles`.
5. `005_create_day_commitments.sql` — depends on `handyman_profiles`.
6. `006_create_day_packs.sql` — depends on `day_commitments`.
7. `007_create_materials_pickups.sql` — depends on `day_packs`.
8. `008_create_routing_offers.sql` — depends on `job_dispatches`, `day_packs`.
9. `009_create_routing_decisions.sql` — independent.
10. `010_create_routing_weights.sql` — independent; seeds starter weights.
11. `011_create_pay_adjustments.sql` — depends on `job_dispatches`.
12. `012_create_booking_state_log.sql` — independent.
13. `013_indexes.sql` — all of §4, after backfill so partial indexes have realistic stats.

---

## 7. Backfill plan

`scripts/backfill-booking-v2.ts` runs after each extension migration. All updates idempotent (`WHERE col IS NULL`).

| Field | Backfill rule |
|---|---|
| `personalized_quotes.flex_tier` | `'fast'` for all existing rows — zero discount, zero behaviour change. |
| `personalized_quotes.flex_window_days` | `0` (matches `'fast'`). |
| `personalized_quotes.crew_size_required` | `1`. |
| `personalized_quotes.skills_required` | `[]`. Admin tags new quotes going forward. |
| `personalized_quotes.cert_required` | `[]`. |
| `personalized_quotes.duration_estimate_minutes` | Copy from sum-of-SKU `time_estimate_minutes` on linked SKUs; otherwise NULL (unknown is fine). |
| `personalized_quotes.real_work_minutes` | Same as `duration_estimate_minutes` initially — diverge as ADR-005 rolls out. |
| `personalized_quotes.heavy_lifting` | `false`. |
| `personalized_quotes.booking_state` | Computed: `bookedAt IS NOT NULL` → `'dispatched'`; else `selectedAt IS NOT NULL` → `'quoted'`; else `'draft'`. |
| `handyman_profiles.contractor_segment` | `'gap_filler'` — most permissive; can be re-segmented in admin once the unit-bench module ships. |
| `handyman_profiles.unit_type` | `'single'`. |
| `handyman_profiles.crew_max` | `1`. |
| `handyman_profiles.home_postcode` | Copy from `postcode` if present. |
| `handyman_profiles.area_catchment` | `[]` — admin curates per unit during onboarding to v2. |
| `handyman_profiles.skills` | Derived from `handyman_skills.categorySlug` aggregated. |
| `handyman_profiles.reliability_score` | `1.00`. Dynamic from completions thereafter. |
| `productized_services.pricing_time_minutes` | Copy from `time_estimate_minutes`. |
| `productized_services.real_work_minutes` | Initially same as pricing — manually adjusted SKU-by-SKU. |
| `productized_services.setup_minutes` / `cleanup_minutes` | Use defaults (12 / 15). |

No backfill needed for new tables — they start empty and fill organically.

---

## 8. Rollback safety

- Every new column is nullable or has a safe default — no NOT NULL retrofits.
- No existing column is dropped, renamed, or retyped.
- No existing table gains an FK pointing at a new table — new tables `DROP`-able without breaking legacy paths.
- No CASCADE on FKs we add — RESTRICT-only.
- All new behaviour is feature-flagged (`feature-flags.md`). Schema present + flags off = system runs as today.

If Phase 9 reverses everything, drop in reverse order: `booking_state_log`, `pay_adjustments`, `routing_weights`, `routing_decisions`, `routing_offers`, `materials_pickups`, `day_packs`, `day_commitments`, `unit_availability`. Added columns on `personalized_quotes` / `handyman_profiles` / `productized_services` are inert — drop or leave indefinitely.

---

## 9. Cross-references

| Artefact | What it locks down |
|---|---|
| `adrs/adr-001-legacy-table.md` | `contractor_booking_requests` consolidation strategy. This doc does **not** modify that table — it is consolidated separately. |
| `adrs/adr-005-real-vs-pricing-time.md` | Why `pricing_time_minutes` AND `real_work_minutes` exist as separate fields on both `productized_services` and `personalized_quotes`. |
| `adrs/adr-008-materials-collection.md` | Why `materials_pickups` is its own table rather than a `day_packs.materials` jsonb column. |
| `modules/03-unit-bench.md` | Consumes the extended `handyman_profiles` columns. |
| `modules/04-availability-engine.md` | Owns `unit_availability` lifecycle. |
| `modules/06-day-pack-solver.md` | Owns `day_commitments`, `day_packs`, `routing_decisions`, `routing_weights`. |
| `modules/07-pay-protection.md` | Owns `pay_adjustments`. |
| `state-machine.md` | Owns the `booking_state` field semantics + `booking_state_log` write rules. |
| `master-plan.md` | Big-picture context. **Conflicts with this doc must be resolved here**, not papered over. |

## Open questions

None at time of writing. The master-plan domain-model table (lines 124-138) lists the same entities at a higher level; this doc supersedes it on column names, types, and defaults. If a conflict surfaces in Wave 2, treat **this** doc as authoritative and update master-plan to match.
