/**
 * Run ONE full GMB posting cycle right now — generate, publish to Google,
 * log to gmb_posts. This POSTS FOR REAL to the live Business Profile.
 *
 *   npx tsx scripts/_gmb-post-once.ts
 */
import 'dotenv/config';
import { runGmbPostCycle } from '../server/gmb-posts';

async function main() {
    const results = await runGmbPostCycle('manual');
    for (const r of results) {
        console.log(`\n[${r.location}] ${r.status.toUpperCase()} — theme=${r.theme}`);
        if (r.summary) console.log(r.summary);
        if (r.error) console.error(`error: ${r.error}`);
    }
    process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
