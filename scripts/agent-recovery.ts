/**
 * Run the Recovery Agent and watch it work:
 *
 *   npx tsx scripts/agent-recovery.ts
 *
 * It reads the funnel, decides nudge-or-skip per candidate, and writes
 * PROPOSED rows to nudge_queue — nothing is sent to any customer. Console
 * shows the live trace; the transcript is saved to agent-runs/.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { runRecovery } from '../server/agents/recovery';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    const started = Date.now();
    const { finalText, transcript, turns } = await runRecovery();

    mkdirSync('agent-runs', { recursive: true });
    const file = `agent-runs/recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(file, JSON.stringify({ finalText, transcript, turns }, null, 2));

    console.log('\n════════ AGENT SUMMARY ════════\n');
    console.log(finalText);

    const queue = await db.execute(sql.raw(`
        SELECT slug, status, lever, left(COALESCE(message, reason), 220) AS text
        FROM nudge_queue WHERE created_at >= now() - interval '10 minutes'
        ORDER BY status, created_at`));
    console.log('\n════════ QUEUE (this run) ════════\n');
    for (const r of queue.rows as any[]) {
        console.log(`[${r.status}${r.lever ? '/' + r.lever : ''}] ${r.slug}\n  ${r.text}\n`);
    }
    console.log(`════════ (${turns} turns, ${((Date.now() - started) / 1000).toFixed(1)}s, transcript → ${file}) ════════`);
    process.exit(0);
}

main().catch((err) => { console.error('Agent run failed:', err); process.exit(1); });
