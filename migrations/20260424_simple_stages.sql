-- Migration: Add simplified lead stages ('new', 'pending', 'complete')
-- The value 'lost' already exists in the enum.
--
-- NOTE: Postgres requires ALTER TYPE ... ADD VALUE to commit before the new
-- label can be used in the same transaction. Run this file FIRST, then run
-- 20260424_simple_stages_migrate.sql in a separate transaction to reassign
-- existing leads to the new simplified stages.

ALTER TYPE lead_stage ADD VALUE IF NOT EXISTS 'new';
ALTER TYPE lead_stage ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE lead_stage ADD VALUE IF NOT EXISTS 'complete';
-- 'lost' already exists, no-op but included for completeness
ALTER TYPE lead_stage ADD VALUE IF NOT EXISTS 'lost';
