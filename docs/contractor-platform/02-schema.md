# Contractor Platform — schema

> Deliverable #3. The additive schema powering the tier model, the hub, and the
> quote↔team link. Implemented in [`shared/schema.ts`](../../shared/schema.ts)
> (search `feat/contractor-platform`). Spec: [`00-PRD.md`](./00-PRD.md) §8 ·
> model: [`01-model-and-data-flow.md`](./01-model-and-data-flow.md).

## Principle — additive & merge-safe

Every change is a **new table** or a **nullable / defaulted column**. New tables
are appended at end-of-file; the only edits inside existing tables are two column
adds (`handyman_profiles`, `personalized_quotes`). This keeps the merge with the
`-deployed` chat's `shared/schema.ts` edits conflict-free — git only collides on
the same lines, and additive blocks don't share lines with their edits.

Nothing existing is renamed, moved, or dropped. `contractorJobs` (legacy) and
`v2Bookings` (separate flow) are untouched.

## What was added

### 1. `handyman_profiles.delivery_tier` + `delivery_priority` (columns)

```ts
deliveryTier: varchar("delivery_tier", { length: 20 }).notNull().default('adhoc'), // 'partner' | 'core' | 'adhoc'
deliveryPriority: integer("delivery_priority"), // routing order within a tier — lower = first (Craig = 1)
```

- `delivery_tier` groups contractors into the three bands. ⚠️ **Distinct from the
  existing `subscription_tier`** (`'free'|'partner'` — a freemium/marketing
  concept). They are not the same axis; do not overload.
- `delivery_priority` encodes the Craig-first stack *within* a tier
  (Craig → Bezent → Joe). `null` = unranked.
- `default('adhoc')` backfills every existing contractor safely on migration.

### 2. `personalized_quotes.lead_contractor_id` + `team_plan` (columns)

```ts
leadContractorId: varchar("lead_contractor_id").references(() => handymanProfiles.id), // soft-assigned lead
teamPlan: jsonb("team_plan"), // { lead, assignments:[{contractorId,role,coveredCategories}], uncoveredCategories }
```

- `lead_contractor_id` is the **soft** assignment set at quote generation — it
  drives the contractor skin and the hub's *pipeline* lane. It holds **no
  capacity** (hard reservation stays at deposit via `bookingSlotLocks`).
- `team_plan` persists the "steer, then compose" suggestion so Ben can confirm/
  edit it and the hub can render the proposed team before booking.
- Complements the existing `candidate_contractor_ids` (the *pool*); this names the
  *lead* out of that pool.

### 3. `contractor_commitments` (new table)

The Core/Partner floor agreement — the sketch's "weekly retainer agreed?" flag.
Versioned via `effective_from/to` + `status` so terms can change without losing
history. All money fields nullable → **the floor is theoretical today**; tiers
route work now, floor is papered later (`00-PRD.md` §10.3).

Key columns: `weekly_floor_pence`, `topup_percent_of_labour`,
`residual_book_percent`, `acceptance_sla_minutes`, `committed_days_per_week`,
`status` (`draft|proposed|active|ended`).

### 4. `booking_assignments` (new table)

The one-booking-to-many-contractors link that makes composition real.

- **Solo job** = one `role='lead'` row. `contractorBookingRequests.assignedContractorId`
  still points at the lead, so every existing downstream reader keeps working —
  the child table is purely additive.
- **Multi-trade** = the lead row + one `role='specialist'` row per off-skill line,
  each with its `covered_categories`, `payout_pence`, and its own
  `scheduled_date`/`scheduled_slot` (a specialist may follow on a different day).
- `offered_via` (`auto|whatsapp|manual`) records how it reached the contractor.
  **v1 = whatsapp/manual** — consistent with *no* `job_offers` table yet (offers
  are manual; `00-PRD.md` §3 non-goals).

## Deliberately NOT added

- **`job_offers`** — v1 offers are WhatsApp/manual; the `offered_via` column
  captures the channel without a table. Add when in-app tap-to-accept ships.
- **New enums** — tier/role/status use `varchar` + comment, matching the existing
  `subscription_tier` / `verification_status` convention. Keeps values flexible
  (new tiers, new statuses) without an ALTER TYPE migration.
- **Reverse relations on existing tables** — new relations are declared on the
  new tables only, so no existing `*Relations` block is edited (merge-safe). Add
  reverse relations later if relational queries need them.

## Applying it

Schema is pushed with Drizzle (`npm run db:push`), not migration files (repo
convention — no `drizzle-kit generate` step). **Do not push from this worktree
against the shared Neon DB** while the other chats are live — coordinate the push
when the branch merges. For reference, `db:push` will emit roughly:

```sql
ALTER TABLE "handyman_profiles" ADD COLUMN "delivery_tier" varchar(20) NOT NULL DEFAULT 'adhoc';
ALTER TABLE "handyman_profiles" ADD COLUMN "delivery_priority" integer;
ALTER TABLE "personalized_quotes" ADD COLUMN "lead_contractor_id" varchar REFERENCES "handyman_profiles"("id");
ALTER TABLE "personalized_quotes" ADD COLUMN "team_plan" jsonb;
CREATE TABLE "contractor_commitments" ( ... );
CREATE TABLE "booking_assignments" ( ... );
CREATE INDEX "idx_contractor_commitments_contractor" ON "contractor_commitments" ("contractor_id");
CREATE INDEX "idx_contractor_commitments_status" ON "contractor_commitments" ("status");
CREATE INDEX "idx_booking_assignments_booking" ON "booking_assignments" ("booking_id");
CREATE INDEX "idx_booking_assignments_contractor" ON "booking_assignments" ("contractor_id");
CREATE INDEX "idx_booking_assignments_status" ON "booking_assignments" ("status");
```

All adds are non-breaking (nullable columns, defaulted NOT NULL, new tables) —
safe to apply to the live DB without downtime.

## Verified

`shared/schema.ts` loads cleanly (all references resolve — `scheduledSlotEnum`,
`handymanProfiles`, `contractorBookingRequests`, `createInsertSchema`), new
exports (`contractorCommitments`, `bookingAssignments`, their insert schemas +
types) are present, and both new columns register on their tables. Project
typecheck surfaces no schema-related errors.

## Next

`resolveQuoteTeam` (the routing fix in `server/lib/quote-fit.ts`) writes
`lead_contractor_id` + `team_plan`; `confirmBooking` writes the `lead`
`booking_assignments` row. Then the Admin OS shell + Contractor Hub read all of
it. See `00-PRD.md` §6 build order.
