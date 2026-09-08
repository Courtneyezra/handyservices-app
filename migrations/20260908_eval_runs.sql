-- 0.7 (8 Sep 2026): the eval scoreboard moves onto the server.
--
-- The daily autonomy job (server/spine/autonomy.ts) reads its eval evidence from
-- eval-results/latest.json on the worker's filesystem. `eval-results/` is gitignored
-- (.gitignore:67) and the container build has no step that runs the harness, so on Railway that
-- file has never existed: every intent's evalFamily read `missing` and only the two fast-tracked
-- intents (ask_gap, confirm_received) could ever be promoted. The evidence half of the promotion
-- gate had never run.
--
-- eval_runs holds what latest.json holds, per run: the families with their green and red counts,
-- the commit it was measured on, the prompt digest it graded, and when. The job reads the newest
-- row first and falls back to the file; with neither it still reads `missing`, never a green.
--
-- One row per harness run; run_id is the harness's ISO-stamp id, so a re-publish of the same run
-- updates rather than duplicates.
--
-- Additive and idempotent. Apply with
--   npx tsx scripts/_apply-migration.ts migrations/20260908_eval_runs.sql
-- never db:push. Apply BEFORE deploying the code that writes it.

CREATE TABLE IF NOT EXISTS eval_runs (
    id                text PRIMARY KEY,
    run_id            text NOT NULL,
    git_ref           text,
    prompt_hash       text,
    prompt_hashes     jsonb,
    adapters          text[] NOT NULL DEFAULT '{}',
    trials_requested  integer,
    families          jsonb NOT NULL DEFAULT '{}'::jsonb,
    regression_red    integer,
    capability_red    integer,
    case_count        integer,
    started_at        timestamptz,
    finished_at       timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_runs_run_id ON eval_runs (run_id);
CREATE INDEX IF NOT EXISTS idx_eval_runs_finished_at ON eval_runs (finished_at DESC);
