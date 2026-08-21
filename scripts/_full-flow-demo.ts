/**
 * FULL FLOW DEMO — one customer, one continuous conversation, first message to post-quote.
 *
 *   npx tsx scripts/_full-flow-demo.ts
 *
 * The suites prove pieces in isolation. This walks the whole journey the way a real customer
 * would live it, printing every message verbatim as the thread grows:
 *
 *   T1  "my kitchen tap is dripping"          → agent replies, asks for a photo
 *   T2  photo arrives                          → agent reacts to it, asks for the postcode
 *   T3  postcode + name arrive                 → agent tags needs_quote → QUOTE-PREP HANDOFF →
 *                                                Ben gets the prefilled intake + a Pushover ping
 *   ——  Ben builds and sends the quote (staged here, exactly as the builder writes it)
 *   T4  "does the price include the new tap?"  → agent holds the line + asks Ben the question
 *   ——  Ben answers the question in one tap
 *   T5  "any news?"                            → agent carries Ben's answer back to the customer
 *   T6  "bit steep, whats your best price?"    → hold-with-reason, never a discount
 *   T7  "leave it till next month"             → graceful hold + a recontact is scheduled
 *
 * After every agent turn it prints the DIRECT-SEND VERDICT the live system would have made for
 * that exact draft: SENDS (no human reads it) or HELD FOR BEN (money/date/hours). Direct send is
 * forced OFF for the run so nothing touches Twilio — each approved draft is promoted into the
 * thread by hand, which is byte-identical to what approveAndSendDraft would have recorded.
 *
 * SAFETY. Ofcom reserved number +447700900950 (no other suite uses it), fixtures deleted in a
 * finally, config restored whatever happens. quotePrep stays ON because the handoff is the point —
 * if PUSHOVER_APP_TOKEN is set in .env your phone WILL get one real "quote prep ready" ping at T3.
 * That is the demo working, not a stray alert.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions, personalizedQuotes } from '@shared/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
    getCommsAgentConfig, setCommsAgentConfig, runCommsAgent, maySendDirect,
    type CommsAgentConfig,
} from '../server/agents/comms';

const PHONE = '+447700900950';
const CONV_KEY = '447700900950@c.us';
const CONV_ID = 'full_flow_demo_447700900950';
const DIGITS = '447700900950';
const SLUG = 'ffdemo1';
const PHOTO = 'https://www.handyservices.app/assets/quote-images/handy-tradesman-1.webp';

function isoDay(offset: number) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
}

async function retry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
    let last: any;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); } catch (e: any) {
            last = e;
            if (!/ETIMEDOUT|ECONNRESET|timeout|terminating connection|fetch failed/i.test(String(e?.message))) throw e;
            console.log(`  (${label} timed out, retry ${i + 1})`);
            await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        }
    }
    throw last;
}

async function wipe(dropConversation = false) {
    await db.delete(messages).where(eq(messages.conversationId, CONV_ID));
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, PHONE));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, PHONE));
    await db.delete(personalizedQuotes).where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${DIGITS}`);
    if (dropConversation) await db.delete(conversations).where(eq(conversations.id, CONV_ID));
}

async function inbound(content: string, opts: { mediaUrl?: string } = {}) {
    const at = new Date();
    await db.insert(messages).values({
        id: `ffd_in_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        conversationId: CONV_ID, direction: 'inbound', channel: 'whatsapp',
        content, type: opts.mediaUrl ? 'image' : 'text', status: 'delivered',
        senderName: 'Sarah (full-flow smoke)', mediaUrl: opts.mediaUrl ?? null, createdAt: at,
    });
    await db.update(conversations).set({
        lastInboundAt: at, lastCustomerContactAt: at, lastMessageAt: at,
        lastMessagePreview: content.slice(0, 50), canSendFreeform: true,
    }).where(eq(conversations.id, CONV_ID));
}

async function outbound(content: string) {
    await db.insert(messages).values({
        id: `ffd_out_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        conversationId: CONV_ID, direction: 'outbound', channel: 'whatsapp',
        content, type: 'text', status: 'sent', createdAt: new Date(),
    });
    await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, CONV_ID));
}

/**
 * Run the agent on the thread, print what it did, and — because direct send is forced off for the
 * demo — promote its draft into the thread exactly as approveAndSendDraft would have recorded it,
 * WITH the verdict the live gate would have reached printed alongside. A draft the live gate would
 * hold is promoted anyway (Ben approving it is the live path), just labelled honestly.
 */
async function agentTurn(label: string, liveConfig: CommsAgentConfig): Promise<void> {
    console.log(`\n  … agent runs (${label})`);
    const outcome = await runCommsAgent(CONV_ID, 'inbound_message');

    const [draft] = await db.select().from(messageDrafts)
        .where(and(eq(messageDrafts.phone, PHONE), eq(messageDrafts.status, 'pending')))
        .orderBy(desc(messageDrafts.createdAt)).limit(1);

    if (draft) {
        // A pending draft has by definition passed the guard chain — refusals throw at the tool
        // boundary and never reach the queue — so guardsPassed is true for anything we read back.
        const verdict = maySendDirect({
            config: { ...liveConfig, autosend: { ...liveConfig.autosend, enabled: true } },
            intent: 'demo', body: draft.body, ukHour: 12,
            postQuoteThread: /\/q\//.test(draft.body),
            reactive: true,
            guardsPassed: true,
        });

        console.log('\n  ┌─ AGENT REPLY ─────────────────────────────────────────────');
        for (const part of draft.body.split(/\n\s*---\s*\n/)) {
            console.log(`  │ ${part.trim().replace(/\n/g, '\n  │ ')}`);
            console.log('  │');
        }
        console.log('  └───────────────────────────────────────────────────────────');
        console.log(`  LIVE VERDICT: ${verdict.send ? '✅ SENDS DIRECT' : '✋ HELD FOR BEN'} — ${verdict.reason}`);

        await outbound(draft.body);
        await db.update(messageDrafts).set({ status: 'sent', sentAt: new Date(), approvedBy: 'full_flow_demo' })
            .where(eq(messageDrafts.id, draft.id));
    } else {
        console.log('  (no reply drafted this turn)');
    }

    const questions = await db.select().from(agentQuestions)
        .where(and(eq(agentQuestions.phone, PHONE), eq(agentQuestions.status, 'open')));
    for (const q of questions) {
        console.log(`  ❓ ASK BEN: ${q.question}${q.options ? `  [${(q.options as string[]).join(' / ')}]` : ''}`);
    }

    if (outcome.handoff?.ran) {
        console.log(`  🤝 QUOTE-PREP HANDOFF FIRED — readiness=${outcome.handoff.readiness}`);
    }

    const [board] = await db.select({ stage: conversations.stage, tags: conversations.tags, priority: conversations.priority })
        .from(conversations).where(eq(conversations.id, CONV_ID));
    console.log(`  📋 BOARD: stage=${board?.stage} priority=${board?.priority} tags=${JSON.stringify(board?.tags ?? [])}`);
}

function customer(text: string) {
    console.log(`\n${'─'.repeat(90)}`);
    console.log(`  CUSTOMER: ${JSON.stringify(text)}`);
}

async function main() {
    console.log('FULL FLOW DEMO — first contact to post-quote, one continuous thread');
    console.log(`Ofcom reserved range only: ${PHONE}. Nothing here can reach a person.`);

    const saved = await retry('read config', getCommsAgentConfig);
    await retry('force queue mode', () => setCommsAgentConfig({
        autosend: { enabled: false, intents: [] },
        firstContactAutoAck: { ...saved.firstContactAutoAck, enabled: false },
    }));
    console.log(`\nDirect send forced OFF for the run (drafts are promoted by hand); quotePrep stays ${saved.quotePrep.enabled ? 'ON' : 'OFF'}.`);

    try {
        await retry('wipe', () => wipe(true));
        await db.insert(conversations).values({
            id: CONV_ID, phoneNumber: CONV_KEY, contactName: 'Sarah (full-flow smoke)',
            status: 'active', stage: 'enquiry', priority: 'normal', tags: [],
        });

        // ------------------------------------------------- T1: first message
        customer('Hi, my kitchen tap is dripping constantly and its driving me mad. Do you sort that kind of thing?');
        await inbound('Hi, my kitchen tap is dripping constantly and its driving me mad. Do you sort that kind of thing?');
        await agentTurn('T1 fresh enquiry', saved);

        // ------------------------------------------------- T2: photo
        customer('here you go, its coming from underneath where it joins the sink  [photo]');
        await inbound('here you go, its coming from underneath where it joins the sink', { mediaUrl: PHOTO });
        await agentTurn('T2 photo received', saved);

        // ------------------------------------------------- T3: postcode → handoff
        customer("Im Sarah, postcode is NG1 6DQ. How soon could someone come?");
        await inbound("Im Sarah, postcode is NG1 6DQ. How soon could someone come?");
        await agentTurn('T3 postcode arrives', saved);

        const [afterHandoff] = await db.select({ metadata: conversations.metadata })
            .from(conversations).where(eq(conversations.id, CONV_ID));
        const intake = (afterHandoff?.metadata as any)?.quotePrepIntake;
        if (intake) {
            console.log('\n  📥 WHAT BEN SEES (the prefilled intake in his slide-over):');
            console.log(`     readiness: ${intake.readiness}`);
            for (const line of intake.lines ?? []) console.log(`     line: ${line.title}${line.detail ? ` — ${line.detail}` : ''}`);
            for (const gap of intake.gaps ?? []) console.log(`     gap (${gap.audience}): ${gap.question ?? gap.text ?? JSON.stringify(gap)}`);
        }

        // ------------------------------------------------- Ben builds + sends the quote
        console.log(`\n${'─'.repeat(90)}`);
        console.log('  BEN: builds the quote from the intake and sends it (staged exactly as the builder writes it)');
        await db.insert(personalizedQuotes).values({
            id: `full_flow_demo_${SLUG}`, shortSlug: SLUG,
            customerName: 'Sarah', phone: PHONE,
            jobDescription: 'Replace leaking kitchen mixer tap; reseal around the sink',
            basePrice: 22_000, selectedTierPricePence: 22_000, depositAmountPence: 6_600,
            pricingLineItems: [
                { lineId: `${SLUG}_0`, description: 'Replace leaking kitchen mixer tap', guardedPricePence: 14_000, materialsWithMarginPence: 0, assumptions: [] },
                { lineId: `${SLUG}_1`, description: 'Reseal around the sink and worktop join', guardedPricePence: 8_000, materialsWithMarginPence: 0, assumptions: [] },
            ],
            viewCount: 2, viewedAt: new Date(), lastViewedAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
            availableDates: [isoDay(3), isoDay(5)],
            createdAt: new Date(), updatedAt: new Date(),
        });
        await outbound(`Here's your quote: https://www.handyservices.app/q/${SLUG}\n\nThe full breakdown is on the link, happy to answer any questions here.\n\nThanks\nBen`);
        await db.update(conversations).set({ stage: 'quote_sent' }).where(eq(conversations.id, CONV_ID));

        // ------------------------------------------------- T4: quote question → ask_ben
        customer('Thanks. Does the price include the new tap or do I need to buy one myself?');
        await inbound('Thanks. Does the price include the new tap or do I need to buy one myself?');
        await agentTurn('T4 quote question', saved);

        // ------------------------------------------------- Ben answers in one tap
        const [openQ] = await db.select().from(agentQuestions)
            .where(and(eq(agentQuestions.phone, PHONE), eq(agentQuestions.status, 'open')))
            .orderBy(desc(agentQuestions.createdAt)).limit(1);
        if (openQ) {
            console.log(`\n${'─'.repeat(90)}`);
            console.log('  BEN: answers the question — "Yes, supplying a standard chrome mixer tap is included."');
            await db.update(agentQuestions).set({
                answer: 'Yes, supplying a standard chrome mixer tap is included. If she wants a specific designer tap she buys it and we knock the supply cost off.',
                answeredBy: 'ben', answeredAt: new Date(), status: 'answered',
            }).where(eq(agentQuestions.id, openQ.id));
        } else {
            console.log('\n  (agent did not raise an ask_ben at T4 — it answered from the quote itself)');
        }

        // ------------------------------------------------- T5: customer nudges, agent carries Ben's answer
        customer('any news on that?');
        await inbound('any news on that?');
        await agentTurn('T5 Ben-answer relay', saved);

        // ------------------------------------------------- T6: price objection
        customer('Hmm its a bit steep to be honest. My mate reckons he could do it for half that. Whats your best price?');
        await inbound('Hmm its a bit steep to be honest. My mate reckons he could do it for half that. Whats your best price?');
        await agentTurn('T6 price objection', saved);

        // ------------------------------------------------- T7: timing hold
        customer('Ok let me talk to my husband, were away till next month anyway. Leave it with me.');
        await inbound('Ok let me talk to my husband, were away till next month anyway. Leave it with me.');
        await agentTurn('T7 timing hold', saved);

        // ------------------------------------------------- the thread, as the customer lived it
        console.log(`\n${'='.repeat(90)}`);
        console.log('THE WHOLE CONVERSATION, AS THE CUSTOMER SAW IT');
        console.log('='.repeat(90));
        const thread = await db.select().from(messages)
            .where(eq(messages.conversationId, CONV_ID)).orderBy(messages.createdAt);
        for (const m of thread) {
            const who = m.direction === 'inbound' ? 'CUSTOMER' : '   HANDY';
            const media = m.mediaUrl ? ' [photo]' : '';
            for (const part of (m.content ?? '').split(/\n\s*---\s*\n/)) {
                console.log(`  ${who}: ${part.trim().replace(/\n/g, ' / ')}${media}`);
            }
        }
        const allQ = await db.select().from(agentQuestions).where(eq(agentQuestions.phone, PHONE));
        console.log(`\n  ask_ben raised across the flow: ${allQ.length}`);
        for (const q of allQ) console.log(`    [${q.status}] ${q.question}`);
    } finally {
        await retry('cleanup', () => wipe(true)).catch((e) => console.error('cleanup failed:', e?.message));
        await retry('restore config', () => setCommsAgentConfig({
            autosend: saved.autosend,
            firstContactAutoAck: saved.firstContactAutoAck,
        })).catch((e) => console.error('config restore failed:', e?.message));
        const back = await retry('read back', getCommsAgentConfig).catch(() => null);
        console.log(`\nCONFIG READ BACK: autosend=${back?.autosend.enabled} quotePrep=${back?.quotePrep.enabled} ack=${back?.firstContactAutoAck.enabled}`);
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
