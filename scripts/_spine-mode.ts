/**
 * Flip the comms spine switch (Phase 3): off | shadow | live.
 *
 *   npx tsx scripts/_spine-mode.ts --status
 *   npx tsx scripts/_spine-mode.ts --off      # legacy only (default)
 *   npx tsx scripts/_spine-mode.ts --shadow   # spine runs dry + records; legacy still drafts
 *   npx tsx scripts/_spine-mode.ts --live     # spine only; runCommsAgent never called
 *   npx tsx scripts/_spine-mode.ts --live --by courtnee
 *
 * Writes app_settings.spine via setSpineMode → setSpineConfig, which logs a config_change
 * system event. Refuses unless the flag is explicit. NODE_ENV=production and a --live flip
 * additionally require --yes, because it changes who answers real customers.
 */
import 'dotenv/config';
import { parseSpineMode, setSpineMode, spineMode } from '../server/spine/switch';
import { getSpineConfig } from '../server/spine/config';

async function main() {
    const argv = process.argv.slice(2);
    const by = argv.includes('--by') ? String(argv[argv.indexOf('--by') + 1] ?? 'script') : `script:${process.env.USER ?? 'unknown'}`;
    if (argv.includes('--status') || !argv.some((a) => parseSpineMode(a))) {
        const cfg = await getSpineConfig();
        console.log(`spine mode: ${await spineMode()}`);
        console.log(JSON.stringify({ enabled: cfg.enabled, shadow: cfg.shadow, mode: cfg.mode ?? '(derived)', autonomy: cfg.autonomy, sampler: cfg.sampler, agents: cfg.agents }, null, 2));
        if (!argv.includes('--status')) console.log('\nPass --off, --shadow or --live to change it.');
        process.exit(0);
    }
    const mode = argv.map(parseSpineMode).find((m): m is NonNullable<typeof m> => !!m)!;
    if (mode === 'live' && process.env.NODE_ENV === 'production' && !argv.includes('--yes')) {
        console.error('Refusing to go LIVE on production without --yes (this changes who answers real customers).');
        process.exit(2);
    }
    const before = await spineMode();
    const cfg = await setSpineMode(mode, by);
    console.log(`spine mode: ${before} → ${mode} (by ${by})`);
    console.log(JSON.stringify({ enabled: cfg.enabled, shadow: cfg.shadow, mode: cfg.mode }, null, 2));
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
