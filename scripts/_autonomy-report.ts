/**
 * Owner's view of the promotion / demotion job (Phase 3).
 *
 *   npx tsx scripts/_autonomy-report.ts --dry-run     # the table, writes nothing (default)
 *   npx tsx scripts/_autonomy-report.ts --apply       # write tiers + events + ping; refused unless
 *                                                     # the spine autonomy switch is on
 *   npx tsx scripts/_autonomy-report.ts --json        # machine-readable
 */
import 'dotenv/config';
import { evaluateAutonomy } from '../server/spine/autonomy';
import { isAutonomyEnabled } from '../server/spine/config';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const json = args.includes('--json');

(async () => {
    if (apply && !(await isAutonomyEnabled())) {
        console.error('Refusing --apply: app_settings.spine.enabled and spine.autonomy.enabled must both be true.');
        process.exit(2);
    }
    const report = await evaluateAutonomy({ dryRun: !apply });
    if (json) console.log(JSON.stringify({ ...report, table: undefined }, null, 2));
    else console.log(report.table);
    process.exit(report.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
