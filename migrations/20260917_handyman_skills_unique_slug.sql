-- Contractor desk skills (17 Sep 2026): one handyman_skills row per contractor per category.
--
-- Ben's Contractors page ticks a category on or off and sets its proficiency
-- (PUT/DELETE /api/admin/contractor-desk/contractors/:id/skills/:slug, server/contractor-desk/skills.ts).
-- The PUT is an upsert on (handyman_id, category_slug), which needs this unique index; until now
-- nothing stopped the same category being stored twice for one contractor.
--
-- Step 1 removes the duplicates. For each (handyman_id, category_slug) with more than one row it
-- keeps one row: the highest proficiency (expert, then competent, then basic, then anything else),
-- then a row that carries a per-skill rate, then the lowest id. The other rows are deleted. Nothing
-- references handyman_skills.id, so no other table changes. Rows with no category_slug (the legacy
-- SKU-linked rows) are left alone: NULLs are distinct in a unique index.
--
-- Step 2 adds the index. If a duplicate is written between the two steps the index build fails;
-- run the file again, it is idempotent.
--
-- No column is added or changed, so server/scrub/plan.ts needs no decision.
-- Apply with
--   npx tsx scripts/_apply-migration.ts migrations/20260917_handyman_skills_unique_slug.sql
-- never db:push. Apply BEFORE deploying the code that upserts on it.

DELETE FROM handyman_skills
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               row_number() OVER (
                   PARTITION BY handyman_id, category_slug
                   ORDER BY CASE proficiency WHEN 'expert' THEN 3 WHEN 'competent' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC,
                            (hourly_rate IS NOT NULL OR day_rate IS NOT NULL) DESC,
                            id ASC
               ) AS rn
        FROM handyman_skills
        WHERE category_slug IS NOT NULL
    ) ranked
    WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_handyman_skills_handyman_category
    ON handyman_skills (handyman_id, category_slug);
