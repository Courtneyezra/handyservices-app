# Contractor Platform — merge runbook

How to land `feat/contractor-platform` on `main` safely, including the
coordinated schema push. The branch's schema changes are **additive** (new
tables + nullable/defaulted columns), so the code merge is trivial; the only
care needed is the DB push.

## What's already applied to the DB

The additive DDL is **already live** on the shared Neon DB (applied via
`scripts/_apply-contractor-platform-ddl.ts`, all `IF NOT EXISTS`, non-destructive):

- `handyman_profiles.delivery_tier` (default `'adhoc'`), `delivery_priority`
- `personalized_quotes.lead_contractor_id`, `team_plan`
- tables `contractor_commitments`, `booking_assignments` (+ indexes)

Roster seed applied: Core = Craig (1), Bezent (2), Joe (3); rest ad-hoc.

So **at merge the schema already matches `shared/schema.ts`** for these objects —
no new migration is strictly required. The push below is the belt-and-braces
reconciliation.

## Merge steps

1. **Merge the branch** into `main` (additive — expect no `shared/schema.ts`
   conflicts; if any, keep both sides — every contractor-platform block is new
   tables/columns appended at end-of-file plus two isolated column adds).

2. **Reconcile the schema with the DB — do NOT run a blind `npm run db:push`
   against prod.** `drizzle-kit push` diffs the *entire* merged `schema.ts`
   against the live DB and will prompt to drop/alter anything that differs,
   including work from other branches. Instead:
   - Run `npx drizzle-kit push` in a session where you can **read every proposed
     statement**. Accept ONLY the additive statements for the four objects above
     (they should already be no-ops since the DDL is applied). **Reject any
     `DROP` / destructive `ALTER`.**
   - Or skip the push entirely — the DDL is already applied, so `main` is already
     in sync for these objects. Confirm with:
     ```sql
     SELECT column_name FROM information_schema.columns
     WHERE table_name='handyman_profiles' AND column_name IN ('delivery_tier','delivery_priority');
     SELECT to_regclass('contractor_commitments'), to_regclass('booking_assignments');
     ```

3. **Post-merge smoke** (read-only): `npx vitest run server/lib/quote-team.test.ts
   server/contractor-hub-routes.test.ts server/lib/os-summary.test.ts` (24 tests)
   and hit `GET /api/admin/contractor-hub` once behind an admin session.

4. **Tag the rest of the roster** as real contractors are onboarded
   (`scripts/_seed-contractor-tiers.ts` is the template).

## Rollback

All additive. To undo (only if truly needed): `DROP TABLE booking_assignments,
contractor_commitments;` and `ALTER TABLE … DROP COLUMN …` for the four columns.
No existing data depends on them.
