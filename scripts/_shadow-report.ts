/**
 * Shadow report — spine shadow decisions vs what legacy actually did on the same threads.
 *
 *   npx tsx scripts/_shadow-report.ts            # last 7 days
 *   npx tsx scripts/_shadow-report.ts --days 14
 *   npx tsx scripts/_shadow-report.ts --days 7 --out docs/comms-build/shadow-report.md
 *
 * Read-only. Needs DATABASE_URL (a Neon branch or production read is fine: nothing is written).
 */
import 'dotenv/config';
import fs from 'node:fs';
import { compareShadow, loadLegacyRuns, loadShadowRuns, shadowReportMarkdown } from '../server/spine/shadow-report';

async function main() {
    const argv = process.argv.slice(2);
    const days = Math.max(1, Number(argv[argv.indexOf('--days') + 1] || 7) || 7);
    const outIdx = argv.indexOf('--out');
    const out = outIdx >= 0 ? argv[outIdx + 1] : null;
    const [spine, legacy] = await Promise.all([loadShadowRuns(days), loadLegacyRuns(days)]);
    const c = compareShadow(spine, legacy, days);
    const md = shadowReportMarkdown(c);
    if (out) { fs.writeFileSync(out, md); console.log(`wrote ${out}`); }
    console.log(md);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
