/**
 * Owner's view of the promotion / demotion job (Phase 3).
 *
 *   npx tsx scripts/_autonomy-report.ts --dry-run     # the table, writes nothing (default)
 *   npx tsx scripts/_autonomy-report.ts --apply       # write tiers + events + ping; refused unless
 *                                                     # the spine autonomy switch is on
 *   npx tsx scripts/_autonomy-report.ts --json        # machine-readable
 *   npx tsx scripts/_autonomy-report.ts --demote-only # B6: what the 07:30 job does while
 *                                                     # autonomy.enabled is off — demotions only,
 *                                                     # promotions shown as held. With --apply it
 *                                                     # needs only spine.enabled (the mode's purpose).
 */
import 'dotenv/config';
import { evaluateAutonomy } from '../server/spine/autonomy';
import { autonomyJobMode, getSpineConfig } from '../server/spine/config';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const json = args.includes('--json');
const demoteOnly = args.includes('--demote-only');

(async () => {
    if (apply) {
        const mode = autonomyJobMode(await getSpineConfig());
        if (mode === 'off') {
            console.error('Refusing --apply: app_settings.spine.enabled is false (nothing in the spine runs).');
            process.exit(2);
        }
        if (!demoteOnly && mode !== 'full') {
            console.error('Refusing --apply: app_settings.spine.enabled and spine.autonomy.enabled must both be true (or pass --demote-only).');
            process.exit(2);
        }
    }
    const report = await evaluateAutonomy({ dryRun: !apply, mode: demoteOnly ? 'demote_only' : 'full' });
    if (json) console.log(JSON.stringify({ ...report, table: undefined }, null, 2));
    else console.log(report.table);
    process.exit(report.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
