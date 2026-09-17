-- 17 Sep 2026: only an admin activates a contractor, and the partner login code is issued by an admin.
--
-- The captain's answer on adding contractors was "Keep self-signup": anyone can sign up, but only
-- Ben can activate. Nothing recorded activation until now, so a self-signed-up contractor with a
-- public profile was matched to quotes, and anyone holding a login code could log in.
--
-- `activated_at` / `activated_by` record the admin act that lets a contractor in. A contractor is
-- activated only while `activated_at` is set; the admin activate and deactivate routes
-- (server/contractor-desk/routes.ts) are the only writers besides an admin creating a contractor.
-- Code login (POST /api/contractor/code-login) and the matcher (server/contractor-matcher.ts)
-- refuse a contractor who is not activated.
--
-- Every contractor already on the table is backfilled as activated, in the same statement that
-- adds the column, so the live contractors keep logging in and being matched. The backfill runs
-- only when the column is created: a re-run never activates a contractor who signed up since.
--
-- `access_code` is widened from 12 to 80 characters because an issued code is now stored as
-- `sha256:<hex>` (server/lib/contractor-access.ts). Codes already stored in plain text keep working
-- and are rewritten to the hashed form on their next successful login. Widening a varchar is a
-- catalogue change only; the code running before this deploy is unaffected.
--
-- A partial unique index keeps one contractor per stored code. It fails if two contractors
-- already share a code; check first with
--   SELECT access_code, count(*) FROM handyman_profiles
--   WHERE access_code IS NOT NULL AND access_code <> '' GROUP BY 1 HAVING count(*) > 1;
--
-- Additive and idempotent. Apply with
--   npx tsx scripts/_apply-migration.ts migrations/20260917_contractor_activation_access_code.sql
-- never db:push. Apply BEFORE deploying the code that reads it.

-- The runner (scripts/_apply-migration.ts) splits on a semicolon at a line end, so the block's
-- inner statements share one line.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'handyman_profiles' AND column_name = 'activated_at') THEN ALTER TABLE handyman_profiles ADD COLUMN activated_at timestamp; ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS activated_by varchar(120); UPDATE handyman_profiles SET activated_at = coalesce(created_at, now()), activated_by = 'migration:20260917' WHERE activated_at IS NULL; END IF; END $$;

ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS activated_by varchar(120);

ALTER TABLE handyman_profiles ALTER COLUMN access_code TYPE varchar(80);

CREATE UNIQUE INDEX IF NOT EXISTS idx_handyman_profiles_access_code
    ON handyman_profiles (access_code)
    WHERE access_code IS NOT NULL AND access_code <> '';
