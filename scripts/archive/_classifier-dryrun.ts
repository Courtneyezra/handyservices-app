/**
 * PRE-DEPLOY DRY RUN — the classifier judged against real history, harmlessly.
 *
 *   npx tsx scripts/_classifier-dryrun.ts [n]
 *
 * Takes the n (default 12) most recent answered inbound calls that have a transcript, classifies
 * each IN MEMORY (classifyTranscript — the DB-free hook; nothing is stored on the call rows), and
 * prints: the verdict, the card preview line it would produce, and what the outreach decision
 * WOULD have been with the feature switched on. No writes, no sends, no config changes — the only
 * cost is one haiku call per transcript.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { calls } from '@shared/schema';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { classifyTranscript } from '../server/call-classifier';
import { decideOutreach, getOutreachConfig } from '../server/post-call-outreach';
import { classificationLine } from '../server/call-thread';

const N = Number(process.argv[2] ?? 12);

(async () => {
    const rows = await db.select().from(calls)
        .where(and(
            eq(calls.direction, 'inbound'),
            isNotNull(calls.transcription),
            sql`length(${calls.transcription}) > 50`,
        ))
        .orderBy(desc(calls.createdAt)).limit(N);
    console.log(`DRY RUN over ${rows.length} real answered inbound calls (in memory, nothing stored, nothing sent)\n`);

    const cfg = { ...(await getOutreachConfig()), enabled: true }; // simulated ON, in memory only
    const tally: Record<string, number> = {};

    for (const c of rows) {
        const when = c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 16).replace('T', ' ') : '?';
        const result = await classifyTranscript(c.transcription!);
        if (!result.ok) {
            console.log(`── ${when} · ${c.phoneNumber} · ${c.duration ?? '?'}s\n   UNCLASSIFIABLE: ${result.reason}\n`);
            tally['unclassifiable'] = (tally['unclassifiable'] ?? 0) + 1;
            continue;
        }
        const v = result.classification;
        const decision = decideOutreach(v, cfg);
        const line = classificationLine(v);
        tally[v.kind] = (tally[v.kind] ?? 0) + 1;
        tally[decision.send ? 'WOULD SEND' : 'would not send'] = (tally[decision.send ? 'WOULD SEND' : 'would not send'] ?? 0) + 1;
        console.log(`── ${when} · ${c.phoneNumber} · ${c.duration ?? '?'}s`);
        console.log(`   verdict : ${v.kind} · whatsapp ${v.whatsappAgreed}${v.messagingObjection ? ' · OBJECTED' : ''}${v.urgency === 'high' ? ' · urgent' : ''}${v.callbackPromised ? ' · callback promised' : ''}`);
        console.log(`   card    : ${line || '(no line)'}`);
        console.log(`   outreach: ${decision.send ? '📤 WOULD SEND video request' : '🚫 no send'} — ${decision.reason}\n`);
    }

    console.log('TALLY:', JSON.stringify(tally));
    const live = await getOutreachConfig();
    console.log(`config untouched: enabled=${live.enabled} (must be false)`);
    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
