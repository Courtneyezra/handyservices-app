/**
 * Creates agent_questions — the comms agent's ask-Ben queue.
 *
 * Targeted DDL only; this repo never runs db:push (schema is entangled with legacy tables).
 *
 *   npx tsx scripts/migrate-agent-questions.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS agent_questions (
            id              varchar PRIMARY KEY NOT NULL,
            conversation_id varchar NOT NULL,
            phone           varchar NOT NULL,
            question        text NOT NULL,
            context         text,
            options         jsonb,
            answer          text,
            answered_by     varchar,
            answered_at     timestamp,
            status          varchar(16) NOT NULL DEFAULT 'open',
            source          varchar(40) NOT NULL DEFAULT 'comms_agent',
            created_at      timestamp NOT NULL DEFAULT now()
        )
    `);
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_agent_questions_status
        ON agent_questions (status, created_at)
    `);
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_agent_questions_conversation
        ON agent_questions (conversation_id)
    `);

    const check: any = await db.execute(sql`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'agent_questions' ORDER BY ordinal_position
    `);
    console.log('agent_questions columns:');
    for (const r of (check.rows ?? check)) console.log(`  ${r.column_name}  ${r.data_type}`);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
