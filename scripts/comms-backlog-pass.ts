/**
 * One-off backlog revival: triages the long-unanswered threads the SLA sweep never reaches
 * (it only looks at recent activity — these have been sitting for days or weeks).
 *
 * Per thread the worker decides: dead/spam → closed with a reason tag; worth reviving →
 * revive_candidate tag + ask-Ben; window somehow open → a draft. It never drafts into a shut
 * window. Batched and resumable — threads that get agent work parked on them are skipped on
 * the next run, so rerunning until "eligible=0" finishes the job.
 *
 *   npx tsx scripts/comms-backlog-pass.ts --dry-run       # list who would be triaged
 *   npx tsx scripts/comms-backlog-pass.ts --limit 10      # triage a batch (default 10)
 */
import 'dotenv/config';
import { db } from '../server/db';
import { conversations, messageDrafts, agentQuestions } from '@shared/schema';
import { and, ne, desc, eq, inArray, sql } from 'drizzle-orm';
import { runCommsAgent } from '../server/agents/comms';
import { loadActivity } from '../server/inbox-board';
import { computeWaitState } from '../server/comms-sla';

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1]) || 10) : 10;

    // Old = last customer contact more than 3 days ago; the SLA sweep owns anything fresher.
    const convs = await db.select().from(conversations)
        .where(and(
            ne(conversations.status, 'blocked'),
            ne(conversations.stage, 'closed'),
            sql`${conversations.lastCustomerContactAt} < now() - interval '3 days'`,
        ))
        .orderBy(desc(conversations.lastCustomerContactAt))
        .limit(300);

    const activity = await loadActivity(convs.map((c) => c.id));
    const eligible: typeof convs = [];

    for (const conv of convs) {
        const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
        if (!digits || digits.includes('7700900')) continue;

        const act = activity.get(conv.id);
        const wait = computeWaitState(act?.lastInbound ?? null, act?.lastOutbound ?? null);
        if (!wait.awaitingReply) continue;

        const [draft] = await db.select({ id: messageDrafts.id }).from(messageDrafts)
            .where(and(eq(messageDrafts.phone, `+${digits}`), inArray(messageDrafts.status, ['pending', 'approved'])))
            .limit(1);
        if (draft) continue;
        const [question] = await db.select({ id: agentQuestions.id }).from(agentQuestions)
            .where(and(eq(agentQuestions.conversationId, conv.id), inArray(agentQuestions.status, ['open', 'answered'])))
            .limit(1);
        if (question) continue;

        eligible.push(conv);
    }

    console.log(`backlog: ${eligible.length} unanswered thread(s) older than 3 days${dryRun ? ' (dry run)' : `, processing ${Math.min(limit, eligible.length)}`}`);
    if (dryRun) {
        for (const c of eligible) {
            console.log(`  ${c.id}  ${c.phoneNumber.padEnd(20)}  last: ${c.lastCustomerContactAt?.toISOString().slice(0, 10)}  "${(c.lastMessagePreview || '').slice(0, 50)}"`);
        }
        process.exit(0);
    }

    let closed = 0, revived = 0, drafted = 0, asked = 0;
    for (const conv of eligible.slice(0, limit)) {
        try {
            const outcome = await runCommsAgent(conv.id, 'backlog_revival');
            for (const a of outcome.actions) {
                if (a.tool === 'set_board_state' && a.input?.stage === 'closed') closed++;
                if (a.tool === 'set_board_state' && (a.input?.add_tags ?? []).includes('revive_candidate')) revived++;
                if (a.tool === 'queue_draft') drafted++;
                if (a.tool === 'ask_ben') asked++;
            }
            console.log(`  ✓ ${conv.phoneNumber}: ${outcome.result.finalText.slice(0, 110)}`);
        } catch (error: any) {
            console.log(`  ✗ ${conv.phoneNumber}: ${error?.message}`);
        }
    }
    console.log(`\nclosed=${closed} revive_candidates=${revived} drafts=${drafted} questions=${asked}`);
    console.log('Rerun until "backlog: 0" to finish the pass.');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
