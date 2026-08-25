/**
 * Idempotent DDL for the SEO tables — a safe substitute for `drizzle-kit push`,
 * which is interactive (prompts create-vs-rename for every new enum) and can't
 * run headless. This creates ONLY the 5 SEO enums + 4 SEO tables + their
 * indexes, guarded so re-running is a no-op. It never touches any other table.
 *
 *   npx tsx scripts/_create-seo-tables.ts
 *
 * Mirrors the definitions in shared/schema.ts (keywordTargets, rankSnapshots,
 * gmbMetrics, seoLeadAttributions). Keep in sync if those change.
 */
import { db } from '../server/db';

const ENUMS: { name: string; values: string[] }[] = [
    { name: 'seo_engine', values: ['google_organic', 'google_pack', 'ai_overview', 'chatgpt', 'perplexity', 'gemini'] },
    { name: 'seo_intent', values: ['service_head', 'trade_service', 'trade_supply', 'upmarket', 'emergency', 'brand_competitor', 'informational'] },
    { name: 'seo_deliverability', values: ['core', 'sub', 'out_of_scope'] },
    { name: 'seo_competition', values: ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] },
    { name: 'seo_tier', values: ['T1_city_hub', 'T2_service_city', 'T3_job_suburb', 'T4_segment', 'T5_emergency'] },
];

const STATEMENTS: string[] = [
    // ── enums (guarded: skip if the type already exists) ──────────────────────
    ...ENUMS.map(
        (e) => `DO $$ BEGIN
  CREATE TYPE ${e.name} AS ENUM (${e.values.map((v) => `'${v}'`).join(', ')});
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
    ),

    // ── keyword_targets ───────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS keyword_targets (
      id serial PRIMARY KEY,
      city text NOT NULL,
      trade text NOT NULL,
      keyword text NOT NULL,
      intent seo_intent NOT NULL,
      tier seo_tier,
      deliverability seo_deliverability NOT NULL,
      avg_monthly_searches integer DEFAULT 0 NOT NULL,
      competition seo_competition DEFAULT 'UNKNOWN' NOT NULL,
      cpc_low_micros integer,
      cpc_high_micros integer,
      priority_score integer,
      track_rankings boolean DEFAULT true NOT NULL,
      page_published boolean DEFAULT false NOT NULL,
      booking_enabled boolean DEFAULT false NOT NULL,
      target_url text,
      source text DEFAULT 'google_keyword_planner' NOT NULL,
      notes text,
      created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_targets_city_keyword ON keyword_targets (city, keyword);`,
    `CREATE INDEX IF NOT EXISTS idx_keyword_targets_city_trade ON keyword_targets (city, trade);`,
    `CREATE INDEX IF NOT EXISTS idx_keyword_targets_deliverability ON keyword_targets (deliverability);`,

    // ── rank_snapshots ────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS rank_snapshots (
      id serial PRIMARY KEY,
      keyword_target_id integer NOT NULL REFERENCES keyword_targets(id) ON DELETE CASCADE,
      engine seo_engine NOT NULL,
      position integer,
      url text,
      ranked_feature text,
      cited boolean DEFAULT false NOT NULL,
      raw_meta jsonb,
      captured_at timestamp DEFAULT now() NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_rank_snapshots_keyword ON rank_snapshots (keyword_target_id);`,
    `CREATE INDEX IF NOT EXISTS idx_rank_snapshots_captured ON rank_snapshots (captured_at);`,
    `CREATE INDEX IF NOT EXISTS idx_rank_snapshots_keyword_engine ON rank_snapshots (keyword_target_id, engine);`,

    // ── gmb_metrics ───────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS gmb_metrics (
      id serial PRIMARY KEY,
      location text NOT NULL,
      profile_id text,
      search_views integer DEFAULT 0 NOT NULL,
      maps_views integer DEFAULT 0 NOT NULL,
      calls integer DEFAULT 0 NOT NULL,
      direction_requests integer DEFAULT 0 NOT NULL,
      website_clicks integer DEFAULT 0 NOT NULL,
      bookings integer DEFAULT 0 NOT NULL,
      review_count integer DEFAULT 0 NOT NULL,
      avg_rating_tenths integer,
      captured_at timestamp DEFAULT now() NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_gmb_metrics_location ON gmb_metrics (location);`,
    `CREATE INDEX IF NOT EXISTS idx_gmb_metrics_captured ON gmb_metrics (captured_at);`,

    // ── seo_lead_attributions ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS seo_lead_attributions (
      id serial PRIMARY KEY,
      lead_id varchar NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      keyword_target_id integer REFERENCES keyword_targets(id) ON DELETE SET NULL,
      landing_url text,
      raw_keyword text,
      engine seo_engine,
      captured_at timestamp DEFAULT now() NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_seo_lead_attr_lead ON seo_lead_attributions (lead_id);`,
    `CREATE INDEX IF NOT EXISTS idx_seo_lead_attr_keyword ON seo_lead_attributions (keyword_target_id);`,
];

async function main() {
    const client = (db as any).$client;
    let ok = 0;
    for (const stmt of STATEMENTS) {
        const label = stmt.replace(/\s+/g, ' ').slice(0, 70);
        try {
            await client.query(stmt);
            ok++;
            console.log(`  ✓ ${label}…`);
        } catch (e) {
            console.error(`  ✗ FAILED: ${label}…`);
            throw e;
        }
    }
    console.log(`\nDone — ${ok}/${STATEMENTS.length} statements applied (idempotent).`);
    await client.end?.().catch(() => {});
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
