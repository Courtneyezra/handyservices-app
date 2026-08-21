/**
 * WA REPLAY — real past customer conversations, replayed against the live agent.
 *
 *   npx tsx scripts/_wa-replay-test.ts
 *
 * Takes real threads from whatsapp-export/wa-dump-full.json, replays each onto an Ofcom-staged
 * conversation message by message, and at every point where Ben actually replied (or visibly
 * didn't), runs the agent and prints the two answers side by side:
 *
 *     WHAT THE AGENT WOULD SEND (instantly)   vs   WHAT BEN ACTUALLY SENT (or never did)
 *
 * The graders are conversations that really happened. Voice notes are staged as "[voice note]"
 * because the agent is deaf to them (known plug) — where Ben's answer clearly used the audio,
 * that gap shows honestly.
 *
 * SAFETY: Ofcom number +447700900960 only (no other suite uses it), autosend + quotePrep forced
 * OFF for the run and restored after, fixtures deleted in a finally. Nothing can reach a person.
 * Cost: one agent run per decision point, capped.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions } from '@shared/schema';
import { and, desc, eq } from 'drizzle-orm';
import { getCommsAgentConfig, setCommsAgentConfig, runCommsAgent } from '../server/agents/comms';

const PHONE = '+447700900960';
const CONV_KEY = '447700900960@c.us';
const CONV_ID = 'wa_replay_447700900960';
const MAX_POINTS_PER_THREAD = 2;

/** Real threads chosen from the dump survey: multi-turn, clearly customers, varied shapes. */
const REPLAY_PHONES: Record<string, string> = {
    '447534814163': 'Doors won\'t close after new carpet — 4 customer messages, Ben never replied',
    '447500441110': 'Camera install + break-in context — real back-and-forth',
    '447794661687': 'Quote chase — "please do send through the quote"',
    '447757664426': 'First job with a new customer, media-heavy',
    '447811346936': 'Post-quote thinking — "would there be a slight..."',
    '447434577030': 'Tile clean — "still wanting a price"',
};

interface DumpMsg { chatName: string; phone: string; ts: string; fromMe: boolean; type: string; hasMedia: boolean; body: string }

function contentFor(m: DumpMsg): string {
    if (m.type === 'ptt') return '[voice note]';
    if (m.type === 'call_log') return '[call]';
    if (m.hasMedia && !m.body) return m.type === 'image' ? '[photo]' : `[${m.type}]`;
    return m.body || `[${m.type}]`;
}

async function wipe(drop = false) {
    await db.delete(messages).where(eq(messages.conversationId, CONV_ID));
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, PHONE));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, PHONE));
    if (drop) await db.delete(conversations).where(eq(conversations.id, CONV_ID));
}

async function stageMessage(direction: 'inbound' | 'outbound', content: string, at: Date) {
    await db.insert(messages).values({
        id: `warp_${direction}_${at.getTime()}_${Math.random().toString(36).slice(2, 6)}`,
        conversationId: CONV_ID, direction, channel: 'whatsapp',
        content, type: 'text', status: direction === 'inbound' ? 'delivered' : 'sent',
        senderName: direction === 'inbound' ? 'Replay customer' : null,
        createdAt: at,
    });
    if (direction === 'inbound') {
        await db.update(conversations).set({
            lastInboundAt: at, lastCustomerContactAt: at, lastMessageAt: at,
            lastMessagePreview: content.slice(0, 50), canSendFreeform: true,
        }).where(eq(conversations.id, CONV_ID));
    }
}

(async () => {
    const dump: DumpMsg[] = JSON.parse(readFileSync('whatsapp-export/wa-dump-full.json', 'utf8'));
    const saved = await getCommsAgentConfig();
    await setCommsAgentConfig({
        autosend: { enabled: false, intents: [] },
        quotePrep: { ...saved.quotePrep, enabled: false },
        firstContactAutoAck: { ...saved.firstContactAutoAck, enabled: false },
    });
    console.log('WA REPLAY — config forced OFF (drafts read back, nothing sends)\n');

    try {
        for (const [phone, why] of Object.entries(REPLAY_PHONES)) {
            const thread = dump.filter((m) => m.phone === phone)
                .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
            if (!thread.length) continue;

            console.log('═'.repeat(94));
            console.log(`THREAD ${phone} — ${why}`);
            console.log('═'.repeat(94));

            await wipe(true);
            await db.insert(conversations).values({
                id: CONV_ID, phoneNumber: CONV_KEY, contactName: 'Replay customer',
                status: 'active', stage: 'enquiry', priority: 'normal', tags: [],
            });

            // Re-time the thread into the recent past, preserving order: last message ~4 min ago.
            const base = Date.now() - 4 * 60_000 - thread.length * 60_000;

            let points = 0;
            for (let i = 0; i < thread.length; i++) {
                const m = thread[i];
                const at = new Date(base + i * 60_000);
                const isReplyPoint = m.fromMe
                    && i > 0 && !thread[i - 1].fromMe
                    && contentFor(thread[i - 1]).trim().length > 0;

                if (isReplyPoint && points < MAX_POINTS_PER_THREAD) {
                    points++;
                    const tail = thread.slice(Math.max(0, i - 3), i)
                        .map((t) => `${t.fromMe ? '  us' : 'THEM'}: ${contentFor(t).slice(0, 90)}`);
                    console.log(`\n─ decision point ${points} ─ context:`);
                    for (const t of tail) console.log('   ' + t);

                    try {
                        await runCommsAgent(CONV_ID, 'inbound_message');
                    } catch (e: any) {
                        console.log('   AGENT RUN FAILED: ' + e?.message?.slice(0, 140));
                    }
                    const [draft] = await db.select().from(messageDrafts)
                        .where(and(eq(messageDrafts.phone, PHONE), eq(messageDrafts.status, 'pending')))
                        .orderBy(desc(messageDrafts.createdAt)).limit(1);
                    const qs = await db.select().from(agentQuestions)
                        .where(and(eq(agentQuestions.phone, PHONE), eq(agentQuestions.status, 'open')));

                    console.log('   ┌─ AGENT WOULD SEND (instantly) ──────────────');
                    if (draft) for (const part of draft.body.split(/\n\s*---\s*\n/)) console.log('   │ ' + part.trim().replace(/\n/g, '\n   │ '));
                    else console.log('   │ (no reply — ' + (qs.length ? 'escalated to Ben' : 'no action') + ')');
                    for (const q of qs) console.log('   │ [ask Ben: ' + q.question.slice(0, 100) + ']');

                    // Ben's actual reply block: consecutive fromMe messages from here.
                    const bens: string[] = [];
                    for (let j = i; j < thread.length && thread[j].fromMe; j++) bens.push(contentFor(thread[j]));
                    console.log('   ├─ BEN ACTUALLY SENT ─────────────────────────');
                    for (const b of bens) console.log('   │ ' + b.slice(0, 180).replace(/\n/g, ' / '));
                    console.log('   └──────────────────────────────────────────────');

                    // Clear the pending draft so the next point drafts fresh; keep questions history.
                    if (draft) await db.update(messageDrafts)
                        .set({ status: 'rejected', approvedBy: 'wa_replay' })
                        .where(eq(messageDrafts.id, draft.id));
                }
                await stageMessage(m.fromMe ? 'outbound' : 'inbound', contentFor(m), at);
            }

            // Thread ended on the customer with no Ben reply at all → the dropped-lead case.
            const lastM = thread[thread.length - 1];
            if (!lastM.fromMe && points < MAX_POINTS_PER_THREAD && contentFor(lastM).trim()) {
                console.log(`\n─ final state: customer spoke last${thread.every((t) => !t.fromMe) ? ' (Ben NEVER replied in this window)' : ''} ─`);
                try {
                    await runCommsAgent(CONV_ID, 'inbound_message');
                } catch (e: any) {
                    console.log('   AGENT RUN FAILED: ' + e?.message?.slice(0, 140));
                }
                const [draft] = await db.select().from(messageDrafts)
                    .where(and(eq(messageDrafts.phone, PHONE), eq(messageDrafts.status, 'pending')))
                    .orderBy(desc(messageDrafts.createdAt)).limit(1);
                const qs = await db.select().from(agentQuestions)
                    .where(and(eq(agentQuestions.phone, PHONE), eq(agentQuestions.status, 'open')));
                console.log('   ┌─ AGENT WOULD SEND (instantly) ──────────────');
                if (draft) for (const part of draft.body.split(/\n\s*---\s*\n/)) console.log('   │ ' + part.trim().replace(/\n/g, '\n   │ '));
                else console.log('   │ (no reply — ' + (qs.length ? 'escalated to Ben' : 'no action') + ')');
                for (const q of qs) console.log('   │ [ask Ben: ' + q.question.slice(0, 100) + ']');
                console.log('   ├─ BEN ACTUALLY SENT ─────────────────────────');
                console.log('   │ (nothing — the thread ends here)');
                console.log('   └──────────────────────────────────────────────');
            }
            console.log();
        }
    } finally {
        await wipe(true).catch(() => {});
        await setCommsAgentConfig({
            autosend: saved.autosend, quotePrep: saved.quotePrep,
            firstContactAutoAck: saved.firstContactAutoAck,
        }).catch((e) => console.error('config restore failed:', e?.message));
        const back = await getCommsAgentConfig();
        console.log(`CONFIG READ BACK: autosend=${back.autosend.enabled} quotePrep=${back.quotePrep.enabled} ack=${back.firstContactAutoAck.enabled}`);
    }
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
