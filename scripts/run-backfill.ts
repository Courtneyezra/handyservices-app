// scripts/run-backfill.ts
//
// CLI entrypoint for Module 11 one-shot backfills. Run individually or
// all together. Always opt-in — never invoked from server boot.
//
// Usage:
//   npx tsx scripts/run-backfill.ts segments
//   npx tsx scripts/run-backfill.ts real-work
//   npx tsx scripts/run-backfill.ts booking-state-log
//   npx tsx scripts/run-backfill.ts route-cache
//   npx tsx scripts/run-backfill.ts all
//   npx tsx scripts/run-backfill.ts validate-cutover

import {
    backfillContractorSegments,
    backfillRealWorkMinutes,
    backfillBookingStateLog,
    backfillRouteDistanceCache,
    runAllBackfills,
} from '../server/migration/data-backfill';
import {
    validateCutoverReadiness,
    formatCutoverReport,
} from '../server/migration/cutover-validator';

async function main(): Promise<void> {
    const action = (process.argv[2] || '').trim();

    switch (action) {
        case 'segments': {
            const r = await backfillContractorSegments();
            console.log(`segments: updated=${r.updated} skipped=${r.skipped}`);
            break;
        }
        case 'real-work': {
            const r = await backfillRealWorkMinutes();
            console.log(`real-work: updated=${r.updated} skipped=${r.skipped}`);
            break;
        }
        case 'booking-state-log': {
            const r = await backfillBookingStateLog();
            console.log(`booking-state-log: updated=${r.updated} skipped=${r.skipped}`);
            break;
        }
        case 'route-cache': {
            const r = await backfillRouteDistanceCache();
            console.log(`route-cache: count=${r.count}`);
            break;
        }
        case 'all': {
            const all = await runAllBackfills();
            console.log(JSON.stringify(all, null, 2));
            break;
        }
        case 'validate-cutover': {
            const report = await validateCutoverReadiness();
            console.log(formatCutoverReport(report));
            process.exit(report.ready ? 0 : 1);
            return;
        }
        default:
            console.log('Usage: run-backfill.ts <segments|real-work|booking-state-log|route-cache|all|validate-cutover>');
            process.exit(1);
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(2);
});
