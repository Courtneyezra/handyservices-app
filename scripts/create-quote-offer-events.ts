/**
 * Create the quote_offer_events analytics table (idempotent).
 *
 * drizzle-kit push hangs on slow Neon schema introspection in this env, so this
 * applies the one new table directly. Mirrors the `quoteOfferEvents` definition
 * in shared/schema.ts exactly. Safe to re-run (IF NOT EXISTS throughout).
 *
 * Usage: npx tsx scripts/create-quote-offer-events.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../server/db";

async function main() {
    console.log("[create-quote-offer-events] Creating table…");
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS quote_offer_events (
            id            SERIAL PRIMARY KEY,
            quote_id      VARCHAR(255) NOT NULL,
            short_slug    VARCHAR(50),
            offer_id      VARCHAR(100) NOT NULL,
            offer_type    VARCHAR(50),
            template      VARCHAR(50),
            customer_type VARCHAR(30),
            event         VARCHAR(20) NOT NULL,
            device_type   VARCHAR(20),
            created_at    TIMESTAMP NOT NULL DEFAULT now()
        )
    `);
    // customer_type was added after the initial table shipped — backfill the
    // column on pre-existing tables (offers are now configured per customer type).
    await db.execute(sql`ALTER TABLE quote_offer_events ADD COLUMN IF NOT EXISTS customer_type VARCHAR(30)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_offer_events_quote   ON quote_offer_events (quote_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_offer_events_offer   ON quote_offer_events (offer_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_offer_events_event   ON quote_offer_events (event)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_offer_events_ctype   ON quote_offer_events (customer_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_offer_events_created ON quote_offer_events (created_at)`);

    const check = await db.execute(sql`SELECT to_regclass('public.quote_offer_events') AS tbl`);
    console.log("[create-quote-offer-events] Done. Table:", (check.rows as any[])[0]?.tbl);
    process.exit(0);
}

main().catch((err) => {
    console.error("[create-quote-offer-events] Failed:", err);
    process.exit(1);
});
