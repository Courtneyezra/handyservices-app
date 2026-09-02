/**
 * Vitest setup: refuse to run the suite against the production database.
 *
 * Runs before every test file (vitest `setupFiles`). `server/db.ts` calls dotenv.config() at import
 * time and throws without DATABASE_URL, so any test that imports the db module in a checkout with a
 * `.env` will happily open a pool on whatever that file points at. On this project that has been
 * production (Neon `ep-broad-king`). Loading dotenv here first means this check sees exactly what
 * the test would see, and throwing here fails the file before a single import runs.
 *
 * Deliberate opt-out only: ALLOW_PROD_DB_TESTS=1.
 */
import 'dotenv/config';

const PROD_DB_MARKER = 'ep-broad-king';

const url = process.env.DATABASE_URL ?? '';
if (url.includes(PROD_DB_MARKER) && !process.env.ALLOW_PROD_DB_TESTS) {
    throw new Error(
        `[vitest setup] DATABASE_URL points at the production database (${PROD_DB_MARKER}). ` +
        'Tests must not run against production. Point DATABASE_URL at a Neon branch or local ' +
        'Postgres, or set ALLOW_PROD_DB_TESTS=1 if you really mean it.'
    );
}
