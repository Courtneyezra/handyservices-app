/**
 * Manual backlog revival pass — same engine the weekly ageing cron runs (backlogSweep in
 * server/agents/comms.ts), exposed for hand-driven batches and dry runs.
 *
 * Per thread the worker decides: dead/spam → closed with a reason tag; worth reviving →
 * revive_candidate tag + ask-Ben; window somehow open → a draft. It never drafts into a shut
 * window. Batched and resumable — threads that get agent work parked on them are skipped on
 * the next run, so rerunning until "eligible=0" finishes the job.
 *
 *   npx tsx scripts/comms-backlog-pass.ts --dry-run       # list who would be triaged
 *   npx tsx scripts/comms-backlog-pass.ts --limit 10      # triage a batch (default 10)
 *   npx tsx scripts/comms-backlog-pass.ts --days 21       # age threshold (default 3 for manual passes)
 */
import 'dotenv/config';
import { backlogSweep } from '../server/agents/comms';

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1]) || 10) : 10;
    const daysIdx = args.indexOf('--days');
    // Manual passes default to the historical 3-day horizon; the weekly cron runs at 21.
    const olderThanDays = daysIdx >= 0 ? Math.max(1, Number(args[daysIdx + 1]) || 3) : 3;

    const outcome = await backlogSweep({ olderThanDays, limit, dryRun });

    console.log(`backlog: ${outcome.eligible} unanswered thread(s) older than ${olderThanDays} days${dryRun ? ' (dry run)' : `, processed ${outcome.processed.length}`}`);
    if (dryRun) {
        for (const c of outcome.eligibleConversations) {
            console.log(`  ${c.id}  ${c.phoneNumber.padEnd(20)}  last: ${c.lastCustomerContactAt?.toISOString().slice(0, 10)}  "${c.preview}"`);
        }
        process.exit(0);
    }

    for (const p of outcome.processed) {
        console.log(`  ✓ ${p.conversationId}: ${p.result.finalText.slice(0, 110)}`);
    }
    for (const s of outcome.skipped.filter((s) => s.why.startsWith('run failed'))) {
        console.log(`  ✗ ${s.conversationId}: ${s.why}`);
    }
    const t = outcome.tallies;
    console.log(`\nclosed=${t.closed} revive_candidates=${t.reviveCandidates} drafts=${t.drafts} questions=${t.questions}`);
    console.log('Rerun until "backlog: 0" to finish the pass.');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
