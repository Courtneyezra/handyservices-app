/**
 * Inspect / configure automated post-call WhatsApp video requests.
 *
 *   npx tsx scripts/_post-call-outreach-toggle.ts            # show current config
 *   npx tsx scripts/_post-call-outreach-toggle.ts on
 *   npx tsx scripts/_post-call-outreach-toggle.ts off
 *   npx tsx scripts/_post-call-outreach-toggle.ts set minDurationSeconds=30 dedupeDays=45
 *   npx tsx scripts/_post-call-outreach-toggle.ts suppress +447700900123
 */
import { getOutreachConfig, setOutreachConfig, type PostCallOutreachConfig } from '../server/post-call-outreach';

const NUMERIC: (keyof PostCallOutreachConfig)[] = [
    'minDurationSeconds', 'dedupeDays', 'quietHoursStart', 'quietHoursEnd',
];

async function main() {
    const [cmd, ...rest] = process.argv.slice(2);

    if (!cmd || cmd === 'show') {
        console.log(JSON.stringify(await getOutreachConfig(), null, 2));
        return;
    }

    if (cmd === 'on' || cmd === 'off') {
        const next = await setOutreachConfig({ enabled: cmd === 'on' });
        console.log(`Automated post-call video requests are now ${next.enabled ? 'ON' : 'OFF'}.`);
        console.log(JSON.stringify(next, null, 2));
        return;
    }

    if (cmd === 'set') {
        const patch: Record<string, unknown> = {};
        for (const arg of rest) {
            const [k, v] = arg.split('=');
            if (!k || v === undefined) { console.error(`Bad pair: ${arg}`); process.exit(1); }
            patch[k] = NUMERIC.includes(k as any) ? Number(v) : v;
        }
        console.log(JSON.stringify(await setOutreachConfig(patch), null, 2));
        return;
    }

    if (cmd === 'suppress') {
        const cfg = await getOutreachConfig();
        const merged = Array.from(new Set([...cfg.suppressedNumbers, ...rest]));
        const next = await setOutreachConfig({ suppressedNumbers: merged });
        console.log(`Suppressed numbers (${next.suppressedNumbers.length}):`, next.suppressedNumbers);
        return;
    }

    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
