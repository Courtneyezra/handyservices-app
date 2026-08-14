/**
 * Run the Morning Ops Brief agent from the shell and watch it work:
 *
 *   npx tsx scripts/agent-ops-brief.ts
 *
 * The console shows the live trace (every tool call + result + the model's
 * commentary); the full transcript is saved to agent-runs/ for reading back.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { runOpsBrief } from '../server/agents/ops-brief';

async function main() {
    const started = Date.now();
    const { finalText, transcript, turns } = await runOpsBrief();

    mkdirSync('agent-runs', { recursive: true });
    const file = `agent-runs/ops-brief-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(file, JSON.stringify({ finalText, transcript, turns }, null, 2));

    console.log('\n════════ THE BRIEF ════════\n');
    console.log(finalText);
    console.log(`\n════════ (${turns} turns, ${((Date.now() - started) / 1000).toFixed(1)}s, transcript → ${file}) ════════`);
    process.exit(0);
}

main().catch((err) => { console.error('Agent run failed:', err); process.exit(1); });
