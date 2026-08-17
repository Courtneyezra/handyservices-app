/**
 * View or change the comms agent's config (appSettings key 'comms_agent').
 *
 *   npx tsx scripts/_comms-agent-config.ts                       # show
 *   npx tsx scripts/_comms-agent-config.ts --enable              # cron sweep ON
 *   npx tsx scripts/_comms-agent-config.ts --disable             # cron sweep OFF
 *   npx tsx scripts/_comms-agent-config.ts --autosend ack_photos,ack_enquiry   # autosend ON for intents
 *   npx tsx scripts/_comms-agent-config.ts --no-autosend         # autosend OFF
 *   npx tsx scripts/_comms-agent-config.ts --sweep-limit 10
 */
import 'dotenv/config';
import { getCommsAgentConfig, setCommsAgentConfig, DRAFT_INTENTS } from '../server/agents/comms';

async function main() {
    const args = process.argv.slice(2);
    let patch: any = null;

    if (args.includes('--enable')) patch = { ...patch, enabled: true };
    if (args.includes('--disable')) patch = { ...patch, enabled: false };
    if (args.includes('--no-autosend')) patch = { ...patch, autosend: { enabled: false, intents: [] } };

    const autosendIdx = args.indexOf('--autosend');
    if (autosendIdx >= 0) {
        const intents = (args[autosendIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
        const invalid = intents.filter((i) => !DRAFT_INTENTS.includes(i as any) || i === 'other');
        if (invalid.length || intents.length === 0) {
            console.error(`Invalid intents: ${invalid.join(', ') || '(none given)'}. Whitelistable: ${DRAFT_INTENTS.filter((i) => i !== 'other').join(', ')}`);
            process.exit(1);
        }
        patch = { ...patch, autosend: { enabled: true, intents } };
    }

    const limitIdx = args.indexOf('--sweep-limit');
    if (limitIdx >= 0) {
        const n = Number(args[limitIdx + 1]);
        if (!Number.isInteger(n) || n < 1 || n > 50) { console.error('sweep-limit must be 1-50'); process.exit(1); }
        patch = { ...patch, sweepLimit: n };
    }

    const config = patch ? await setCommsAgentConfig(patch) : await getCommsAgentConfig();
    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
