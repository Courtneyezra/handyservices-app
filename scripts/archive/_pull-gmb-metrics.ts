/**
 * _pull-gmb-metrics.ts — CLI runner for the Google Business Profile connector.
 *
 * Pulls per-location GBP performance + review metrics and writes a gmb_metrics
 * snapshot row for each configured location.
 *
 * Usage:
 *   npx tsx scripts/_pull-gmb-metrics.ts            # all configured locations
 *   npx tsx scripts/_pull-gmb-metrics.ts nottingham # single location by key
 *
 * Requires GBP env vars (see server/seo-gmb-connector.ts header). If unset, the
 * connector logs "skipped — GBP not configured" and exits cleanly.
 */

import { db } from '../server/db';
import { pullGmbMetrics } from '../server/seo-gmb-connector';

async function main() {
    const location = process.argv[2];
    const results = await pullGmbMetrics(location ? { location } : undefined);

    if (results.length === 0) {
        console.log('[gmb] no rows written (not configured, or no matching location).');
    } else {
        console.log(`\n[gmb] wrote ${results.length} snapshot row(s):`);
        for (const r of results) {
            console.log(
                `  ${r.location.padEnd(12)} search ${r.searchViews}  maps ${r.mapsViews}  ` +
                `calls ${r.calls}  directions ${r.directionRequests}  web ${r.websiteClicks}  ` +
                `bookings ${r.bookings}  reviews ${r.reviewCount}` +
                (r.avgRatingTenths != null ? ` @ ${(r.avgRatingTenths / 10).toFixed(1)}★` : '')
            );
        }
    }

    process.exit(0);
}

main().catch((e) => {
    console.error('[gmb] fatal:', e);
    process.exit(1);
});
