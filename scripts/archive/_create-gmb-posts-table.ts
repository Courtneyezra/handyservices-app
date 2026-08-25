/**
 * Targeted DDL for the gmb_posts table (automated GMB posting log).
 * This repo NEVER runs drizzle db:push (schema is entangled) — additive,
 * idempotent CREATE TABLE IF NOT EXISTS only, mirroring shared/schema.ts.
 *
 *   npx tsx scripts/_create-gmb-posts-table.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS gmb_posts (
            id           serial PRIMARY KEY,
            location     text NOT NULL,
            topic_type   text NOT NULL DEFAULT 'STANDARD',
            theme        text NOT NULL,
            theme_detail text,
            summary      text NOT NULL,
            cta_type     text,
            cta_url      text,
            media_url    text,
            status       text NOT NULL DEFAULT 'draft',
            google_name  text,
            search_url   text,
            error        text,
            model        text,
            created_at   timestamp NOT NULL DEFAULT now(),
            posted_at    timestamp
        )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_gmb_posts_location ON gmb_posts (location)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_gmb_posts_created ON gmb_posts (created_at)`);

    const check = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'gmb_posts' ORDER BY ordinal_position
    `);
    console.log('gmb_posts columns:', (check.rows as any[]).map((r) => r.column_name).join(', '));
    process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
