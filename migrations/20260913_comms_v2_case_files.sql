-- Goal 3 (13 Sep 2026): the new comms desk's case files outlive the process.
--
-- The desk's store (server/comms-v2/desk/store.ts) held every case file in a Map for the length of
-- the process: right for the sandbox door host, wrong for a server that runs for weeks, where a
-- restart or a redeploy would drop every open thread. The intake (server/comms-v2/channels/intake.ts)
-- refused to start until a persistent store landed; this table is that store.
--
-- One row per case file. `file` is the whole CaseFile record (Contract 2, docs/comms-v2/contracts.md)
-- as the store last put it, written whole on every put. `stage`, `opened_at` and `person_ids` are
-- copied out of it on the same write, so a row can be found by stage and by party in SQL without
-- opening the record.
--
-- Written only on the Neon branch COMMS_V2_DATABASE_URL names (server/comms-v2/live-database.ts)
-- until cutover.
--
-- Additive and idempotent. Apply with
--   npx tsx scripts/_apply-migration.ts migrations/20260913_comms_v2_case_files.sql
-- never db:push. Apply BEFORE deploying the code that writes it.

CREATE TABLE IF NOT EXISTS comms_v2_case_files (
    id          text PRIMARY KEY,
    stage       text NOT NULL,
    opened_at   timestamptz NOT NULL,
    person_ids  text[] NOT NULL DEFAULT '{}',
    file        jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comms_v2_case_files_person_ids ON comms_v2_case_files USING gin (person_ids);
CREATE INDEX IF NOT EXISTS idx_comms_v2_case_files_open ON comms_v2_case_files (opened_at DESC) WHERE stage <> 'done';
