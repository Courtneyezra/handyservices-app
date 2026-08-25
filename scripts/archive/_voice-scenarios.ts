/**
 * VOICE SCENARIOS — does the agent, as it actually runs, sound like Ben?
 *
 *   npx tsx scripts/_voice-scenarios.ts
 *
 * The other suites prove the agent is SAFE. Nothing proved it was not stiff, and stiff is now a
 * live problem rather than a cosmetic one: since 20 Aug 2026 these replies go straight to the
 * customer, so "Thank you for your enquiry. We will respond shortly." is what the business sounds
 * like, not a draft somebody would have rewritten.
 *
 * Five staged threads, one live agent run each, every reply printed VERBATIM and scored against the
 * corpus register in brand-voice/whatsapp-comms.md (10,267 real messages, 1,532 typed by Ben):
 *   median 15 words per message · 2-3 bursts · one question · his vocabulary · his sign-off
 *
 * SAFETY. One Ofcom reserved number (+447700900940), never used by another suite. Direct send and
 * the quote-prep handoff are FORCED OFF for the duration and restored afterwards, so a run writes
 * drafts and reads them back rather than messaging anyone. Every fixture is deleted in a finally.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions, personalizedQuotes } from '@shared/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { getCommsAgentConfig, setCommsAgentConfig, runCommsAgent } from '../server/agents/comms';

const PHONE = '+447700900940';
const CONV_KEY = '447700900940@c.us';
const CONV_ID = 'voice_scenarios_conv_447700900940';
const DIGITS = '447700900940';
const SLUG = 'voicesc1';

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

// ---------------------------------------------------------------- the register, measured

/** His words, by count across the corpus. Their presence is a good sign, not a requirement. */
const HIS_WORDS = /\b(no problem|perfect|proper|sorted|pop round|turn up|put it right|one visit|send (?:your|the) quote over|get one sent over|cheers)\b/i;
/** The tells of a machine: brochure language, filler, and the phrases a corpus check killed. */
const SYSTEM_TELLS: [RegExp, string][] = [
    [/\bthank you for (?:your|the) (?:enquiry|message|patience)\b/i, '"thank you for your enquiry" (brochure opener)'],
    [/\bwe (?:will|shall) (?:respond|be in touch|revert)\b/i, '"we will respond" (corporate future tense)'],
    [/\bplease (?:do not hesitate|feel free)\b/i, 'do-not-hesitate filler'],
    [/\bat your earliest convenience\b/i, 'at your earliest convenience'],
    [/\bwe (?:aim|strive|endeavour) to\b/i, 'mission-statement verb'],
    [/\bour team\b/i, '"our team" (he says we, or a name)'],
    [/\bkind regards|best regards|yours (?:sincerely|faithfully)\b/i, 'corporate sign-off'],
    [/\b(?:solutions|utilise|facilitate|assistance)\b/i, 'corporate filler'],
    [/\bwe(?:'| a)re (?:the best|100%|unbeatable)\b/i, 'puffery'],
    [/\bwe(?:'| wi)ll price it up\b/i, '"we\'ll price it up" (0 occurrences in 10,267 messages)'],
    [/\bthe price we quote is the price\b/i, 'slogan he has never typed'],
    [/\bnot right\? we come back and fix it free\b/i, 'slogan he has typed twice'],
    [/\band more\b|\betc\b/i, '"and more" / "etc"'],
    [/\b(?:let me know when suits|ready when you are|shout when you'?re ready)\b/i, 'scheduling ping-pong (banned house rule)'],
    [/\b24\/7|same day guaranteed\b/i, 'availability lie'],
];

function scoreVoice(body: string): void {
    const parts = body.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter(Boolean);
    const words = parts.map((p) => p.split(/\s+/).filter(Boolean).length);
    const median = (xs: number[]) => {
        if (!xs.length) return 0;
        const s = [...xs].sort((a, b) => a - b);
        return s.length % 2 ? s[s.length >> 1] : Math.round((s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2);
    };
    const questions = (body.match(/\?/g) ?? []).length;
    const emoji = (body.match(/\p{Extended_Pictographic}/gu) ?? []).length;
    const bangs = (body.match(/!/g) ?? []).length;
    const signoff = /\n\s*thanks\s*\n\s*ben\s*$/i.test(body.trim());

    const flag = (ok: boolean, s: string) => `${ok ? '  ok ' : '  !! '} ${s}`;
    console.log('\n  VOICE CHECK');
    console.log(flag(parts.length >= 2 && parts.length <= 3, `${parts.length} burst(s) — house rule is 2 or 3`));
    console.log(flag(median(words) <= 25, `median ${median(words)} words per burst (corpus median 15, longest here ${Math.max(0, ...words)})`));
    console.log(flag(questions <= 1, `${questions} question(s) — house rule is one`));
    console.log(flag(emoji <= 1, `${emoji} emoji — at most one, at the end`));
    console.log(flag(bangs <= 1, `${bangs} exclamation mark(s) — at most one`));
    console.log(`   ..  sign-off "Thanks / Ben": ${signoff ? 'yes' : 'no'} (observed on 34% of his, right on a reply that closes something)`);
    const his = body.match(HIS_WORDS);
    console.log(`   ..  his vocabulary: ${his ? `"${his[0]}"` : 'none of his marker words'}`);
    const tells = SYSTEM_TELLS.filter(([re]) => re.test(body));
    if (tells.length) {
        for (const [, why] of tells) console.log(`  !!  SOUNDS LIKE A SYSTEM: ${why}`);
    } else {
        console.log('  ok  no system tells');
    }
}

// ---------------------------------------------------------------- staging

function isoDay(offset: number) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
}

async function wipe(dropConversation = false) {
    await db.delete(messages).where(eq(messages.conversationId, CONV_ID));
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, PHONE));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, PHONE));
    await db.delete(personalizedQuotes).where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${DIGITS}`);
    if (dropConversation) await db.delete(conversations).where(eq(conversations.id, CONV_ID));
}

async function ensureConversation() {
    const [existing] = await db.select().from(conversations).where(eq(conversations.phoneNumber, CONV_KEY));
    if (existing) return;
    await db.insert(conversations).values({
        id: CONV_ID, phoneNumber: CONV_KEY, contactName: 'Voice Scenario (smoke)',
        status: 'active', stage: 'enquiry', priority: 'normal', tags: [],
    });
}

async function msg(direction: 'inbound' | 'outbound', content: string, opts: { minutesAgo?: number; mediaUrl?: string } = {}) {
    const at = new Date(Date.now() - (opts.minutesAgo ?? 0) * 60_000);
    await db.insert(messages).values({
        id: `voice_${direction}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        conversationId: CONV_ID, direction, channel: 'whatsapp',
        content, type: opts.mediaUrl ? 'image' : 'text', status: 'delivered',
        senderName: direction === 'inbound' ? 'Voice Scenario (smoke)' : null,
        mediaUrl: opts.mediaUrl ?? null, createdAt: at,
    });
    if (direction === 'inbound') {
        await db.update(conversations).set({
            lastInboundAt: at, lastCustomerContactAt: at, lastMessageAt: at,
            lastMessagePreview: content.slice(0, 50), canSendFreeform: true,
        }).where(eq(conversations.id, CONV_ID));
    }
}

async function stageQuote() {
    const created = new Date(Date.now() - 3 * 86_400_000);
    await db.insert(personalizedQuotes).values({
        id: `voice_scenarios_${SLUG}`,
        shortSlug: SLUG,
        customerName: 'Voice Scenario',
        phone: PHONE,
        jobDescription: 'Replace leaking kitchen mixer tap; reseal around the sink',
        basePrice: 22_000,
        selectedTierPricePence: 22_000,
        depositAmountPence: 6_600,
        pricingLineItems: [
            { lineId: `${SLUG}_0`, description: 'Replace leaking kitchen mixer tap', guardedPricePence: 14_000, materialsWithMarginPence: 0, assumptions: [] },
            { lineId: `${SLUG}_1`, description: 'Reseal around the sink and worktop join', guardedPricePence: 8_000, materialsWithMarginPence: 0, assumptions: [] },
        ],
        viewCount: 3,
        viewedAt: new Date(created.getTime() + 3600_000),
        lastViewedAt: new Date(Date.now() - 5 * 3600_000),
        expiresAt: new Date(Date.now() + 6 * 86_400_000),
        availableDates: [isoDay(4), isoDay(6)],
        createdAt: created,
        updatedAt: created,
    });
}

interface Scenario {
    id: string;
    title: string;
    why: string;
    setup: () => Promise<void>;
}

const SCENARIOS: Scenario[] = [
    {
        id: 'S1',
        title: 'Fresh enquiry',
        why: 'The first reply. 69% of his threads open with a photo ask and nothing else. Warmth only, no humour, one ask, no postcode.',
        setup: async () => {
            await db.update(conversations).set({ stage: 'enquiry', priority: 'normal', tags: [] }).where(eq(conversations.id, CONV_ID));
            await msg('inbound', 'Hi, my kitchen tap is dripping constantly and its driving me mad. Do you do that sort of thing?');
        },
    },
    {
        id: 'S2',
        title: 'Photo received',
        why: 'They did what we asked. The reply should react to what is IN the picture, not acknowledge receipt of an attachment.',
        setup: async () => {
            await db.update(conversations).set({ stage: 'scoping', priority: 'normal', tags: [] }).where(eq(conversations.id, CONV_ID));
            await msg('inbound', 'Hi, my kitchen tap is dripping constantly. Do you do that sort of thing?', { minutesAgo: 90 });
            await msg('outbound', 'Hiya, yeah we do those all the time.\n---\nCan you send me a photo of the tap?', { minutesAgo: 80 });
            await msg('inbound', 'here you go, its coming from underneath where it joins', {
                minutesAgo: 4,
                mediaUrl: 'https://www.handyservices.app/assets/quote-images/handy-tradesman-1.webp',
            });
        },
    },
    {
        id: 'S3',
        title: 'Question about the quote',
        why: 'Post-quote. A real question with a true answer on the quote. Should answer it plainly and NOT repeat the total (that is Ben\'s).',
        setup: async () => {
            await stageQuote();
            await db.update(conversations).set({ stage: 'quote_sent', priority: 'normal', tags: [] }).where(eq(conversations.id, CONV_ID));
            await msg('outbound', `Here's your quote: https://www.handyservices.app/q/${SLUG}\n\nThanks\nBen`, { minutesAgo: 4320 });
            await msg('inbound', 'Thanks for that. Does the price include the new tap or do I need to buy one?', { minutesAgo: 6 });
        },
    },
    {
        id: 'S4',
        title: 'Price objection',
        why: 'The worst-performing reply in the corpus is a bare "No problem". Must name what the money buys and invite the comparison, with no number and no discount.',
        setup: async () => {
            await stageQuote();
            await db.update(conversations).set({ stage: 'quote_sent', priority: 'normal', tags: [] }).where(eq(conversations.id, CONV_ID));
            await msg('outbound', `Here's your quote: https://www.handyservices.app/q/${SLUG}\n\nThanks\nBen`, { minutesAgo: 4320 });
            await msg('inbound', 'Bit steep that isnt it. My mate reckons he could do it for half. Whats your best price?', { minutesAgo: 5 });
        },
    },
    {
        id: 'S5',
        title: 'Timing hold',
        why: '"Not right now" is a scheduling state, not a rejection. Threads like this went on to pay £984 and £479. Agree a date to come back, promise nothing.',
        setup: async () => {
            await stageQuote();
            await db.update(conversations).set({ stage: 'quote_sent', priority: 'normal', tags: [] }).where(eq(conversations.id, CONV_ID));
            await msg('outbound', `Here's your quote: https://www.handyservices.app/q/${SLUG}\n\nThanks\nBen`, { minutesAgo: 4320 });
            await msg('inbound', 'Looks fine but were away till the end of the month and my partner wants to think about it. Can we leave it for now?', { minutesAgo: 7 });
        },
    },
];

// ---------------------------------------------------------------- run

async function main() {
    console.log('VOICE SCENARIOS');
    console.log(`Ofcom reserved range only: ${PHONE}. Nothing here can reach a person.\n`);

    const saved = await retry('read config', getCommsAgentConfig);
    await retry('force off', () => setCommsAgentConfig({
        autosend: { enabled: false, intents: [] },
        quotePrep: { ...saved.quotePrep, enabled: false },
        firstContactAutoAck: { ...saved.firstContactAutoAck, enabled: false },
    }));
    console.log(`config forced OFF for the run (was autosend=${saved.autosend.enabled}, quotePrep=${saved.quotePrep.enabled}, ack=${saved.firstContactAutoAck.enabled})\n`);

    try {
        await retry('ensure conversation', ensureConversation);
        for (const s of SCENARIOS) {
            console.log(`\n${'='.repeat(90)}`);
            console.log(`${s.id} — ${s.title}`);
            console.log(`${s.why}`);
            console.log('='.repeat(90));

            await retry('wipe', () => wipe());
            await retry('setup', s.setup);

            const inbounds = await db.select().from(messages)
                .where(sql`${messages.conversationId} = ${CONV_ID} AND ${messages.direction} = 'inbound'`)
                .orderBy(desc(messages.createdAt)).limit(1);
            console.log(`\n  CUSTOMER: ${JSON.stringify(inbounds[0]?.content ?? '')}`);

            let outcome;
            try {
                outcome = await runCommsAgent(CONV_ID, 'inbound_message');
            } catch (e: any) {
                console.log(`  RUN FAILED: ${e?.message}`);
                continue;
            }

            const [draft] = await db.select().from(messageDrafts).where(eq(messageDrafts.phone, PHONE))
                .orderBy(desc(messageDrafts.createdAt)).limit(1);
            const questions = await db.select().from(agentQuestions).where(eq(agentQuestions.phone, PHONE));
            const errs = outcome.result.transcript.filter((e) => e.type === 'tool_error').map((e) => String(e.detail.error));

            if (draft) {
                console.log('\n  ------------------------ REPLY, VERBATIM ------------------------');
                for (const part of draft.body.split(/\n\s*---\s*\n/)) {
                    console.log(`  │ ${part.trim().replace(/\n/g, '\n  │ ')}`);
                    console.log('  │');
                }
                console.log('  -----------------------------------------------------------------');
                scoreVoice(draft.body);
            } else {
                console.log('\n  NO REPLY WRITTEN.');
            }
            if (questions.length) {
                console.log(`\n  ASK BEN: ${questions.map((q) => q.question).join(' | ')}`);
            }
            if (errs.length) {
                console.log(`\n  GUARD REFUSALS THE MODEL SAW:\n    ${errs.join('\n    ').slice(0, 700)}`);
            }
            const board = await db.select({ stage: conversations.stage, tags: conversations.tags })
                .from(conversations).where(eq(conversations.id, CONV_ID));
            console.log(`\n  BOARD: stage=${board[0]?.stage} tags=${JSON.stringify(board[0]?.tags ?? [])}  escalated=${outcome.escalated}`);
        }
    } finally {
        await retry('cleanup', () => wipe(true)).catch((e) => console.error('cleanup failed:', e?.message));
        await retry('restore config', () => setCommsAgentConfig({
            autosend: saved.autosend,
            quotePrep: saved.quotePrep,
            firstContactAutoAck: saved.firstContactAutoAck,
        })).catch((e) => console.error('config restore failed:', e?.message));
        const back = await retry('read back', getCommsAgentConfig).catch(() => null);
        console.log(`\nCONFIG READ BACK: autosend=${back?.autosend.enabled} quotePrep=${back?.quotePrep.enabled} ack=${back?.firstContactAutoAck.enabled}`);
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
