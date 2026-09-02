/**
 * OUTCOME REPLAY — how far does each REAL past conversation travel through the built system?
 *
 *   PUSHOVER_APP_TOKEN='' npx tsx scripts/_outcome-replay-test.ts
 *
 * Where _wa-replay-test.ts grades individual replies, this grades OUTCOMES. Each historical
 * thread from whatsapp-export/wa-dump-full.json is staged whole on the Ofcom rig, the pipeline
 * runs to its natural conclusion (triage → conversing → needs_quote → clerk verdict → intake),
 * and the result is scored:
 *
 *   outcome        what the system concluded (quote_ready + the lines it would build /
 *                  needs_info + the exact questions it would ask / stalled + why)
 *   failure point  the first place the thread could not advance, named
 *   reality check  what actually happened to this customer (quotes table, by phone)
 *
 * TOKEN DISCIPLINE: one comms run per thread on the full staged history (not per turn), plus
 * the clerk and at most one gap-round the pipeline itself triggers. Six threads ≈ 15-20 model
 * calls, pennies under caching. Run with PUSHOVER_APP_TOKEN='' so verdict pings stay silent.
 *
 * SAFETY: Ofcom +447700900960, autosend forced OFF (nothing sends), quotePrep ON (the verdict is
 * the point), everything restored and wiped in a finally.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions, personalizedQuotes } from '@shared/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getCommsAgentConfig, runCommsAgent } from '../server/agents/comms';

const PHONE = '+447700900960';
const CONV_KEY = '447700900960@c.us';
const CONV_ID = 'wa_outcome_447700900960';

const THREADS: Record<string, string> = {
    '447534814163': 'doors won\'t close after new carpet (Ben never replied)',
    '447500441110': 'camera install request',
    '447794661687': 'quote promised and chased',
    '447757664426': 'first job + second bathroom hinted',
    '447811346936': 'thinking about doors, upstairs later',
    '447434577030': 'tile clean, still wanting a price',
};

interface DumpMsg { phone: string; ts: string; fromMe: boolean; type: string; hasMedia: boolean; body: string }
const contentFor = (m: DumpMsg) =>
    m.type === 'ptt' ? '[voice note]'
    : m.type === 'call_log' ? '[call]'
    : (m.hasMedia && !m.body) ? '[photo]'
    : (m.body || `[${m.type}]`);

async function wipe(drop = false) {
    await db.delete(messages).where(eq(messages.conversationId, CONV_ID));
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, PHONE));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, PHONE));
    if (drop) await db.delete(conversations).where(eq(conversations.id, CONV_ID));
}

(async () => {
    if (process.env.PUSHOVER_APP_TOKEN) {
        console.warn('NOTE: PUSHOVER_APP_TOKEN is set — quote_ready verdicts will buzz a phone. Prefix with PUSHOVER_APP_TOKEN=\'\' to silence.');
    }
    const dump: DumpMsg[] = JSON.parse(readFileSync('whatsapp-export/wa-dump-full.json', 'utf8'));
    const saved = await getCommsAgentConfig();
    // Process-local override only — the shared DB row the deployed agent reads is never written.
    process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
        ...saved,
        autosend: { enabled: false },
        firstContactAutoAck: { ...saved.firstContactAutoAck, enabled: false },
        quotePrep: { ...saved.quotePrep, enabled: true, minHoursBetweenRuns: 0 },
    });
    console.log('OUTCOME REPLAY — autosend OFF, clerk ON, verdicts silent (this process only)\n');

    const summary: string[] = [];
    try {
        for (const [phone, label] of Object.entries(THREADS)) {
            const thread = dump.filter((m) => m.phone === phone)
                .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
            if (!thread.length) continue;

            console.log('═'.repeat(92));
            console.log(`${phone} — ${label}`);
            console.log('═'.repeat(92));

            await wipe(true);
            await db.insert(conversations).values({
                id: CONV_ID, phoneNumber: CONV_KEY, contactName: 'Outcome replay',
                status: 'active', stage: 'enquiry', priority: 'normal', tags: [],
            });
            const base = Date.now() - 5 * 60_000 - thread.length * 45_000;
            for (let i = 0; i < thread.length; i++) {
                const m = thread[i];
                const at = new Date(base + i * 45_000);
                await db.insert(messages).values({
                    id: `wo_${at.getTime()}_${Math.random().toString(36).slice(2, 5)}`,
                    conversationId: CONV_ID,
                    direction: m.fromMe ? 'outbound' : 'inbound',
                    channel: 'whatsapp', content: contentFor(m), type: 'text',
                    status: m.fromMe ? 'sent' : 'delivered',
                    senderName: m.fromMe ? null : 'Outcome replay', createdAt: at,
                });
            }
            const lastIn = thread.filter((m) => !m.fromMe).pop();
            const lastAt = new Date(base + thread.length * 45_000);
            await db.update(conversations).set({
                lastInboundAt: lastAt, lastCustomerContactAt: lastAt, lastMessageAt: lastAt,
                lastMessagePreview: (lastIn ? contentFor(lastIn) : '').slice(0, 50), canSendFreeform: true,
            }).where(eq(conversations.id, CONV_ID));

            // One pipeline pass on the whole thread.
            let outcome: any = null;
            try {
                outcome = await runCommsAgent(CONV_ID, 'inbound_message');
            } catch (e: any) {
                console.log('RUN FAILED: ' + e?.message?.slice(0, 160));
            }

            const [conv] = await db.select().from(conversations).where(eq(conversations.id, CONV_ID));
            const tags = conv?.tags ?? [];
            const intake = (conv?.metadata as any)?.quotePrepIntake ?? null;
            const [draft] = await db.select().from(messageDrafts)
                .where(and(eq(messageDrafts.phone, PHONE), eq(messageDrafts.status, 'pending')))
                .orderBy(desc(messageDrafts.createdAt)).limit(1);
            const qs = await db.select().from(agentQuestions)
                .where(and(eq(agentQuestions.phone, PHONE), eq(agentQuestions.status, 'open')));

            // Score the outcome + name the failure point.
            let verdictLine: string;
            let failure: string;
            if (intake?.readiness === 'quote_ready') {
                verdictLine = `QUOTE WOULD BE BUILT — ${intake.lines.length} line(s)`;
                failure = 'none: lands on Ben\'s desk priced-ready';
            } else if (intake?.readiness === 'visit_first') {
                verdictLine = 'VISIT FIRST — unpriceable remotely, survey gate';
                failure = 'none: honest dead-end by design';
            } else if (intake?.readiness === 'needs_info') {
                verdictLine = `NEEDS INFO — clerk wants ${intake.gaps.length} answer(s)`;
                failure = 'waiting on customer answers (agent asks them itself)';
            } else if (tags.includes('needs_quote')) {
                verdictLine = 'needs_quote tagged, clerk did not conclude';
                failure = 'clerk run failed or skipped — investigate';
            } else {
                verdictLine = 'still SCOPING — agent gathering';
                failure = draft
                    ? 'needs customer to answer the agent\'s question'
                    : qs.length ? 'escalated to Ben' : 'agent took no action — investigate';
            }

            console.log(`  stage=${conv?.stage} tags=${JSON.stringify(tags)}`);
            console.log(`  OUTCOME: ${verdictLine}`);
            if (intake?.lines?.length) for (const l of intake.lines) console.log(`     line: ${l.title}`);
            if (intake?.readiness === 'needs_info') for (const g of intake.gaps) console.log(`     gap(${g.audience}): ${g.question ?? g.text}`);
            if (draft) console.log(`  agent's next message: ${draft.body.split(/\n\s*---\s*\n/)[0].slice(0, 90)}…`);
            for (const q of qs) console.log(`  ask_ben: ${q.question.slice(0, 100)}`);
            console.log(`  FAILURE POINT: ${failure}`);

            // Reality check: did this real customer ever actually get a quote?
            const digits = phone.slice(-10);
            const real: any = await db.execute(sql`
                SELECT short_slug, is_draft, deposit_paid_at IS NOT NULL AS paid, created_at::date AS d
                FROM personalized_quotes
                WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${'%' + digits}
                ORDER BY created_at DESC LIMIT 2`);
            const rows = (real.rows ?? real) as any[];
            console.log(rows.length
                ? `  REALITY: ${rows.map((r) => `quote ${r.short_slug}${r.is_draft ? ' (draft)' : ''}${r.paid ? ' PAID' : ''} on ${r.d}`).join(' · ')}`
                : '  REALITY: no quote was ever built for this customer');
            summary.push(`${phone.slice(-6)}  ${verdictLine.padEnd(46)} reality: ${rows.length ? (rows[0].paid ? 'quoted+PAID' : 'quoted, unpaid') : 'NEVER QUOTED'}`);
            console.log();
        }
    } finally {
        await wipe(true).catch(() => {});
        delete process.env.COMMS_CONFIG_OVERRIDE;
        // With the override gone this reads the LIVE DB row — it should be untouched by this run.
        const back = await getCommsAgentConfig();
        console.log('─'.repeat(92));
        console.log('SUMMARY  (system verdict vs what really happened)');
        for (const s of summary) console.log('  ' + s);
        console.log(`LIVE CONFIG (untouched by this run): autosend=${back.autosend.enabled} quotePrep=${back.quotePrep.enabled} (min ${back.quotePrep.minHoursBetweenRuns}h) ack=${back.firstContactAutoAck.enabled}`);
        if (back.autosend.enabled !== saved.autosend.enabled || back.quotePrep.enabled !== saved.quotePrep.enabled
            || back.firstContactAutoAck.enabled !== saved.firstContactAutoAck.enabled) {
            console.error('*** LIVE CONFIG CHANGED DURING THE RUN — investigate ***');
        }
    }
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
