/**
 * Run the Comms Agent and watch it work. Nothing is ever sent — drafts land in Ben's
 * approval queue, blocked decisions land in the ask-Ben queue.
 *
 *   npx tsx scripts/agent-comms.ts <conversationId>      # triage one conversation
 *   npx tsx scripts/agent-comms.ts --phone +447700900999 # ...found by phone
 *   npx tsx scripts/agent-comms.ts --sweep               # SLA sweep (respects config limit)
 *   npx tsx scripts/agent-comms.ts --window-sweep        # windows closing within 4h
 *   npx tsx scripts/agent-comms.ts --sweep --dry-run     # show who WOULD be processed, run nothing
 *   npx tsx scripts/agent-comms.ts --config              # show current config
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { db } from '../server/db';
import { conversations } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { runCommsAgent, sweepCommsAgent, windowClosingSweep, getCommsAgentConfig } from '../server/agents/comms';

function save(name: string, data: unknown): string {
    mkdirSync('agent-runs', { recursive: true });
    const file = `agent-runs/comms-${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(file, JSON.stringify(data, null, 2));
    return file;
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--config')) {
        console.log(JSON.stringify(await getCommsAgentConfig(), null, 2));
        process.exit(0);
    }

    if (args.includes('--sweep') || args.includes('--window-sweep')) {
        const dryRun = args.includes('--dry-run');
        const outcome = args.includes('--window-sweep')
            ? await windowClosingSweep({ dryRun })
            : await sweepCommsAgent({ dryRun });
        console.log('\n════════ SWEEP ════════');
        console.log(`scanned=${outcome.scanned} eligible=${outcome.eligible} processed=${outcome.processed.length} (dryRun=${dryRun})`);
        for (const s of outcome.skipped.slice(0, 20)) console.log(`  skip ${s.conversationId}: ${s.why}`);
        for (const p of outcome.processed) {
            console.log(`\n▶ ${p.conversationId}`);
            for (const a of p.actions) console.log(`  ${a.tool}(${JSON.stringify(a.input).slice(0, 140)})`);
            console.log(`  💬 ${p.result.finalText.slice(0, 200)}`);
        }
        console.log(`\ntranscripts → ${save('sweep', outcome)}`);
        process.exit(0);
    }

    let conversationId = args.find((a) => !a.startsWith('--'));
    const phoneIdx = args.indexOf('--phone');
    if (phoneIdx >= 0 && args[phoneIdx + 1]) {
        const key = `${args[phoneIdx + 1].replace(/\D/g, '')}@c.us`;
        const [conv] = await db.select({ id: conversations.id }).from(conversations)
            .where(eq(conversations.phoneNumber, key));
        if (!conv) { console.error(`No conversation for ${key}`); process.exit(1); }
        conversationId = conv.id;
    }
    if (!conversationId) { console.error('Usage: agent-comms.ts <conversationId> | --phone <e164> | --sweep [--dry-run]'); process.exit(1); }

    const outcome = await runCommsAgent(conversationId, 'manual');
    console.log('\n════════ ACTIONS ════════');
    for (const a of outcome.actions) console.log(`  ${a.tool}(${JSON.stringify(a.input).slice(0, 200)})`);
    console.log('\n════════ SUMMARY ════════');
    console.log(outcome.result.finalText);
    console.log(`\n(${outcome.result.turns} turns, autosent=${outcome.autosent}, transcript → ${save('run', outcome)})`);
    process.exit(0);
}
main().catch((err) => { console.error('Agent run failed:', err); process.exit(1); });
