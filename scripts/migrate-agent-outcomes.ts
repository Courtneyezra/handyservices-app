/**
 * Creates agent_outcomes — the outcome ledger: every agent proposal, the human verdict on it,
 * and what the customer did next.
 *
 * Targeted DDL only; this repo NEVER runs db:push (the schema is entangled with legacy tables and
 * a push would try to reconcile all of it).
 *
 *   npx tsx scripts/migrate-agent-outcomes.ts            create/verify the table
 *   npx tsx scripts/migrate-agent-outcomes.ts --backfill  ... and reconstruct history from
 *                                                          message_drafts / agent_questions / nudge_queue
 *
 * Safe to re-run: every statement is IF NOT EXISTS and the backfill is keyed on (kind, ref_id).
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS agent_outcomes (
            id                       varchar PRIMARY KEY NOT NULL,

            agent                    varchar(32) NOT NULL,
            capability               varchar(40) NOT NULL,
            kind                     varchar(16) NOT NULL,
            source                   varchar(40),

            ref_id                   varchar NOT NULL,
            conversation_id          varchar,
            phone                    varchar,
            phone_key                varchar(20),
            quote_slug               varchar(24),

            proposed_body            text NOT NULL,
            reason                   text,
            proposed_at              timestamp NOT NULL DEFAULT now(),

            verdict                  varchar(24) NOT NULL DEFAULT 'pending',
            decided_by               varchar,
            decided_at               timestamp,
            time_to_action_seconds   integer,

            final_body               text,
            edit_distance            integer,
            edit_ratio               double precision,

            send_status              varchar(16),
            sent_at                  timestamp,
            sent_message_id          varchar,

            customer_replied_at      timestamp,
            reply_latency_seconds    integer,
            converted_quote_id       varchar,
            converted_at             timestamp,
            conversion_value_pence   integer,
            outcome_checked_at       timestamp,

            meta                     jsonb,
            backfilled               boolean NOT NULL DEFAULT false,

            created_at               timestamp NOT NULL DEFAULT now(),
            updated_at               timestamp NOT NULL DEFAULT now()
        )
    `);

    // One row per proposal. This is what makes every hook idempotent: a double-fired capture
    // conflicts instead of duplicating, so a retry can never inflate the denominator.
    await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_outcomes_ref
        ON agent_outcomes (kind, ref_id)
    `);
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_agent_outcomes_agent
        ON agent_outcomes (agent, capability, proposed_at)
    `);
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_agent_outcomes_verdict
        ON agent_outcomes (verdict, proposed_at)
    `);
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_agent_outcomes_phone_key
        ON agent_outcomes (phone_key)
    `);

    const check: any = await db.execute(sql`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'agent_outcomes' ORDER BY ordinal_position
    `);
    console.log('agent_outcomes columns:');
    for (const r of (check.rows ?? check)) console.log(`  ${r.column_name}  ${r.data_type}`);

    if (process.argv.includes('--backfill')) {
        const { backfillOutcomes, refreshOutcomes } = await import('../server/agent-outcomes');
        console.log('\nBackfilling from message_drafts / agent_questions / nudge_queue…');
        const result = await backfillOutcomes();
        console.table(result);
        console.log('\nAttributing replies and conversions…');
        const refreshed = await refreshOutcomes({ limit: 2000 });
        console.table(refreshed);
    }

    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
