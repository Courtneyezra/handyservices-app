/**
 * Proves the comms agent's POST-QUOTE behaviour, against test numbers ONLY.
 *
 *   npx tsx scripts/_post-quote-test.ts
 *   npx tsx scripts/_post-quote-test.ts --guards-only   # no LLM calls, no spend
 *
 * Everything runs on a reserved Ofcom number (+447700900997) with no real subscriber. A quote is
 * staged against it, exercised, and deleted again at the end whatever happens. No customer is
 * ever messaged: auto-send and the first-contact exception are forced OFF for the duration and
 * restored afterwards, and every draft the agent writes stays pending in the approval queue.
 *
 * WHAT IS BEING PROVEN, and why each one is in the list (evidence:
 * docs/WHATSAPP-CONVERSATION-ANALYSIS.md, 10,267 real messages):
 *
 *   1. quote context     — the agent SEES the real quote in get_thread: slug, total, line items,
 *                          when the link was sent, how many times they opened it, expiry, deposit
 *                          status, amendment history. Without it it cannot answer a real question.
 *   2. price objection   — a £180 objection produces a LEVER, not a capitulation. "No problem." is
 *                          his commonest move and his worst: 8 threads, 1 sale.
 *   3. fabricated money  — a discount the agent invented is refused by the guard, with and without
 *                          a £ sign, and a figure that is not on the cited quote is refused too.
 *   4. the £1,000 wall   — a £1,200 objection goes to Ben rather than being improvised at the
 *                          customer. 15% of these convert; a warmer paragraph does not fix that.
 *   5. scheduling        — "can you come Tuesday" never comes back as a promised date.
 *   6. they HAVE seen it — no draft implies the quote went missing. 102 of 104 quiet customers had
 *                          opened theirs, 69 of them three or more times.
 *   7. voice             — no em dashes, at most one question, sign-off allowed.
 *
 * Cases 3 and 7 need no LLM. Cases 1, 2, 4, 5 run the real agent, so a full run costs four
 * sonnet-5 conversations. --guards-only skips them.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions, personalizedQuotes } from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getCommsAgentConfig, setCommsAgentConfig, runCommsAgent, type CommsAgentOutcome } from '../server/agents/comms';
import { loadQuoteContexts, checkDateSignal } from '../server/agents/quote-context';
import {
    checkDraft, detectCapitulation, detectDatePromise, detectUnseenImplication,
    detectDiscountOffer, extractMoneyFigures,
} from '../server/agents/draft-guards';
import { priceBandFor, OBJECTION_LEVERS, PRICE_BANDS } from '../server/agents/objection-levers';

/** Ofcom's reserved drama range. No subscriber exists on it, so nothing here can reach a person. */
const PHONE = '+447700900997';
const CONV_KEY = '447700900997@c.us';
const CONV_ID = 'postquote_test_conv_447700900997';
const SLUG_SMALL = 'ptq180aa'.slice(0, 8);
const SLUG_BIG = 'ptq1200b'.slice(0, 8);

let failures = 0;
function head(s: string) { console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`); }
function pass(ok: boolean, s: string, evidence?: string) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`);
    if (evidence) console.log(`      ${evidence.replace(/\n/g, '\n      ').slice(0, 600)}`);
    if (!ok) { failures++; process.exitCode = 1; }
}

/** Neon drops connections under load; the DB timing out is not a test failure. */
async function retry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
    let last: any;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); } catch (e: any) {
            last = e;
            if (!/ETIMEDOUT|ECONNRESET|timeout|terminating connection/i.test(String(e?.message))) throw e;
            console.log(`      (${label} timed out, retry ${i + 1}/${tries})`);
            await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
    }
    throw last;
}

// ---------------------------------------------------------------- staging

async function ensureConversation() {
    const [existing] = await db.select().from(conversations).where(eq(conversations.phoneNumber, CONV_KEY));
    if (existing) return existing.id;
    await db.insert(conversations).values({
        id: CONV_ID,
        phoneNumber: CONV_KEY,
        contactName: 'Post-Quote Test (smoke)',
        status: 'active',
        stage: 'quote_sent',
        priority: 'normal',
        tags: [],
    });
    return CONV_ID;
}

/** Wipe every trace of a previous run so nothing carries over into an assertion. */
async function clearThread(convId: string) {
    await db.delete(messages).where(eq(messages.conversationId, convId));
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, PHONE));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, PHONE));
    await db.delete(personalizedQuotes).where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = '447700900997'`);
}

function isoDay(offsetDays: number) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

/** The next occurrence of a weekday (0=Sun). Used so "can you come Tuesday" means a real date. */
function nextWeekday(dow: number) {
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== dow);
    return d.toISOString().slice(0, 10);
}

/**
 * A quote that looks like a real one: priced line items with their own assumptions, a deposit, an
 * expiry, offered dates, and a view history. The view history is the point — the agent must write
 * to somebody who has already read it.
 */
async function stageQuote(opts: {
    slug: string; totalPence: number; lines: { description: string; pence: number; assumptions?: string[] }[];
    viewCount: number; sentDaysAgo: number; offeredDates: string[];
}) {
    const created = new Date(Date.now() - opts.sentDaysAgo * 86_400_000);
    await db.insert(personalizedQuotes).values({
        id: `postquote_test_${opts.slug}`,
        shortSlug: opts.slug,
        customerName: 'Test Lead',
        phone: PHONE,
        jobDescription: opts.lines.map((l) => l.description).join('; '),
        basePrice: opts.totalPence,
        selectedTierPricePence: opts.totalPence,
        depositAmountPence: Math.round(opts.totalPence * 0.3),
        pricingLineItems: opts.lines.map((l, i) => ({
            lineId: `${opts.slug}_${i}`,
            description: l.description,
            guardedPricePence: l.pence,
            materialsWithMarginPence: 0,
            assumptions: l.assumptions ?? [],
        })),
        viewCount: opts.viewCount,
        viewedAt: new Date(created.getTime() + 3600_000),
        lastViewedAt: new Date(Date.now() - 4 * 3600_000),
        expiresAt: new Date(Date.now() + 5 * 86_400_000),
        availableDates: opts.offeredDates,
        createdAt: created,
        updatedAt: created,
    });

    // The quote link as Ben actually sends it — this is how the agent learns when it went out.
    await db.insert(messages).values({
        id: `pq_link_${opts.slug}_${Date.now()}`,
        conversationId: CONV_ID,
        direction: 'outbound',
        channel: 'whatsapp',
        content: `Hey, here's your quote: https://www.handyservices.app/q/${opts.slug}\n\nThanks\nBen`,
        type: 'text',
        status: 'delivered',
        createdAt: created,
    });
}

/** An inbound message that opens the 24h window, so a freeform draft is deliverable. */
async function stageInbound(text: string) {
    const now = new Date();
    await db.insert(messages).values({
        id: `pq_in_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        conversationId: CONV_ID,
        direction: 'inbound',
        channel: 'whatsapp',
        content: text,
        type: 'text',
        status: 'delivered',
        senderName: 'Test Lead (smoke)',
        createdAt: now,
    });
    await db.update(conversations).set({
        lastInboundAt: now,
        lastCustomerContactAt: now,
        lastMessageAt: now,
        lastMessagePreview: text.slice(0, 50),
        canSendFreeform: true,
        stage: 'quote_sent',
        priority: 'normal',
        tags: [],
    }).where(eq(conversations.id, CONV_ID));
}

async function latestDraft() {
    const [d] = await db.select().from(messageDrafts)
        .where(eq(messageDrafts.phone, PHONE))
        .orderBy(desc(messageDrafts.createdAt)).limit(1);
    return d ?? null;
}

async function openQuestions() {
    return db.select().from(agentQuestions).where(eq(agentQuestions.phone, PHONE));
}

/** Pull the get_thread payload straight out of the run transcript. */
function threadPayload(outcome: CommsAgentOutcome): any {
    const ev = outcome.result.transcript.find((e) => e.type === 'tool_result' && e.detail?.tool === 'get_thread');
    return ev?.detail?.result ?? null;
}

function toolsUsed(outcome: CommsAgentOutcome): string[] {
    return outcome.result.transcript.filter((e) => e.type === 'tool_call').map((e) => e.detail.tool);
}

/** Errors the tools threw back at the model — where a refused draft shows up. */
function toolErrors(outcome: CommsAgentOutcome): string[] {
    return outcome.result.transcript.filter((e) => e.type === 'tool_error').map((e) => String(e.detail.error));
}

// ---------------------------------------------------------------- voice

function voiceProblems(body: string): string[] {
    const problems: string[] = [];
    if (/[—–]/.test(body)) problems.push('contains an em/en dash');
    if (/\S\s-\s\S/.test(body.replace(/^---$/gm, ''))) problems.push('uses a hyphen as punctuation');
    const questions = (body.match(/\?/g) ?? []).length;
    if (questions > 1) problems.push(`${questions} questions in one reply (max 1)`);
    if (/\b(?:kind regards|yours sincerely|best regards)\b/i.test(body)) problems.push('corporate sign-off');
    if (/\b(?:solutions|utilise|leverage|unbeatable|100%)\b/i.test(body)) problems.push('corporate filler / puffery');
    return problems;
}

/** Every rule that must hold for ANY draft the agent writes in this suite. */
function assertDraftIsSafe(label: string, body: string) {
    pass(detectUnseenImplication(body) === null,
        `${label}: does not imply the customer has not seen the quote`,
        detectUnseenImplication(body) ?? undefined);
    pass(detectDiscountOffer(body) === null,
        `${label}: offers no discount`,
        detectDiscountOffer(body) ?? undefined);
    pass(detectDatePromise(body) === null,
        `${label}: promises no date`,
        detectDatePromise(body) ?? undefined);
    const problems = voiceProblems(body);
    pass(problems.length === 0, `${label}: voice rules hold`, problems.join('; '));
}

// ---------------------------------------------------------------- guard cases (no LLM)

async function guardCases() {
    head('GUARDS — the money guard, in isolation. No LLM, no spend.');

    const [ctx] = await retry('load quote context', () => loadQuoteContexts({ digits: '447700900997', conversationId: CONV_ID }));
    pass(!!ctx, 'a staged quote loads as agent-visible context');
    if (!ctx) return;

    // 3a. A fabricated discount with no £ sign at all. The old money guard tested for "£\d" and
    // would have waved this straight through.
    const pctOff = 'No problem, I can do 10% off for you if that helps.';
    const v1 = checkDraft({ body: pctOff, intent: 'price_objection', allowedFigurePence: ctx.allowedFigurePence, quoteSlug: ctx.slug, quoteSeen: true, quoteViewCount: ctx.viewCount });
    pass(v1?.code === 'discount_offer', 'a fabricated percentage discount is refused', v1?.message);

    // 3b. A fabricated discount WITH a figure, citing a real quote. Citing a real slug is not the
    // same as quoting it correctly.
    const madeUp = `I can knock it down to £150 for you.`;
    const v2 = checkDraft({ body: madeUp, intent: 'price_objection', allowedFigurePence: ctx.allowedFigurePence, quoteSlug: ctx.slug, quoteSeen: true });
    pass(v2 !== null && (v2.code === 'discount_offer' || v2.code === 'figure_not_on_quote'),
        'a fabricated figure is refused even when a real quote is cited', v2?.message);

    // 3c. A figure that simply is not on the quote, with no discount language.
    const wrongFigure = `The total on that one comes to £222.`;
    const v3 = checkDraft({ body: wrongFigure, intent: 'quote_question', allowedFigurePence: ctx.allowedFigurePence, quoteSlug: ctx.slug, quoteSeen: true });
    pass(v3?.code === 'figure_not_on_quote', 'a figure that is not on the cited quote is refused', v3?.message);

    // 3d. The REAL total must still be writable, or the guard is useless.
    const realFigure = `That £${(ctx.totalPence ?? 0) / 100} covers both jobs in one visit.\n---\nThanks\nBen`;
    const v4 = checkDraft({ body: realFigure, intent: 'quote_question', allowedFigurePence: ctx.allowedFigurePence, quoteSlug: ctx.slug, quoteSeen: true });
    pass(v4 === null, 'the quote\'s OWN total is still allowed through', v4?.message);
    pass(extractMoneyFigures(realFigure)[0]?.pence === ctx.totalPence, 'money figures parse to the same pence the quote holds');

    // 3e. The losing move.
    const capitulation = 'No problem at all. Thanks anyway.\n---\nThanks\nBen';
    const v5 = checkDraft({ body: capitulation, intent: 'price_objection', allowedFigurePence: null, quoteSeen: true, quoteTotalPence: ctx.totalPence });
    pass(v5?.code === 'capitulation', 'a bare capitulation to a price objection is refused', v5?.message);

    // 3f. Ben's BEST line opens the same way and must survive. If the guard eats this, it has
    // banned the single best message in the corpus.
    const bensBestLine = 'No problem at all! Understand it may seem abit high but ensuring the tiles are not broken in the process is paramount to us.\n---\nGet a few more quotes and happy to book you in if you come back.\n---\nThanks\nBen';
    const v6 = checkDraft({ body: bensBestLine, intent: 'price_objection', allowedFigurePence: null, quoteSeen: true, quoteTotalPence: ctx.totalPence });
    pass(v6 === null, 'Ben\'s actual best-performing objection reply passes untouched', v6?.message);

    // 3g. "Did you get a chance to look?" to someone who has opened it four times.
    const unseen = 'Hi, just checking you got the quote we sent over?';
    const v7 = checkDraft({ body: unseen, intent: 'quote_followup', allowedFigurePence: null, quoteSeen: true, quoteViewCount: ctx.viewCount });
    pass(v7?.code === 'implies_unseen', 'a draft implying they have not seen the quote is refused', v7?.message);

    // 3h. A promised date.
    const promised = 'Yeah we can come Tuesday, see you then.';
    const v8 = checkDraft({ body: promised, intent: 'scheduling', allowedFigurePence: null, quoteSeen: true, offeredDates: ctx.offeredDates });
    pass(v8?.code === 'date_promise', 'a committed date is refused', v8?.message);

    // 3i. Refusing a discount is not the same as offering one.
    const refusal = 'We cannot do a discount on that one unfortunately.';
    pass(detectDiscountOffer(refusal) === null, 'declining a discount is NOT read as offering one');

    head('ROUTING — the price bands, and the read-only date signal.');
    pass(priceBandFor(18_000).id === 'sweet', 'a £180 quote routes to the £100-200 band', PRICE_BANDS.find((b) => b.id === 'sweet')!.playbook);
    pass(priceBandFor(45_000).id === 'plateau', 'a £450 quote routes to the flat plateau', PRICE_BANDS.find((b) => b.id === 'plateau')!.playbook);
    pass(priceBandFor(120_000).id === 'wall', 'a £1,200 quote routes to the structural band', PRICE_BANDS.find((b) => b.id === 'wall')!.playbook);
    pass(OBJECTION_LEVERS.filter((l) => l.authority === 'ask_ben').length >= 2, 'the levers that move money are marked ask_ben',
        OBJECTION_LEVERS.filter((l) => l.authority === 'ask_ben').map((l) => l.id).join(', '));

    const offered = ctx.offeredDates[0];
    const sigYes = await retry('check_date offered', () => checkDateSignal(offered, ctx));
    pass(sigYes.offeredOnQuote && sigYes.mayPromise === false,
        'check_date confirms an offered date but still refuses to promise it', sigYes.guidance);
    const sigNo = await retry('check_date unoffered', () => checkDateSignal(isoDay(45), ctx));
    pass(!sigNo.offeredOnQuote && sigNo.mayPromise === false,
        'check_date sends an unoffered date to Ben', sigNo.guidance);
}

// ---------------------------------------------------------------- live agent cases

async function agentCase(label: string, inbound: string): Promise<CommsAgentOutcome> {
    head(label);
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, PHONE));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, PHONE));
    await stageInbound(inbound);
    console.log(`customer: "${inbound}"`);
    return retry('agent run', () => runCommsAgent(CONV_ID, 'inbound_message'));
}

async function main() {
    const guardsOnly = process.argv.includes('--guards-only');

    const savedConfig = await retry('read config', getCommsAgentConfig);
    // Belt and braces: nothing in this suite may reach a phone, even one nobody owns.
    await retry('disable autosend', () => setCommsAgentConfig({
        autosend: { enabled: false, intents: [] },
        firstContactAutoAck: { ...savedConfig.firstContactAutoAck, enabled: false },
    }));

    try {
        await retry('ensure conversation', ensureConversation);
        await retry('clear thread', () => clearThread(CONV_ID));

        // The £180 quote: two priced lines, opened four times, sent three days ago. That is a
        // completely ordinary quiet quote by the corpus's own numbers (median 39h to deposit,
        // upper quartile five days).
        const offeredDates = [isoDay(4), isoDay(5), isoDay(8)];
        await retry('stage small quote', () => stageQuote({
            slug: SLUG_SMALL,
            totalPence: 18_000,
            lines: [
                { description: 'Swap kitchen mixer tap, customer supplying the tap', pence: 9_000, assumptions: ['Isolation valves under the sink are working'] },
                { description: 'Refit loose toilet seat and re-seal the pan', pence: 9_000 },
            ],
            viewCount: 4,
            sentDaysAgo: 3,
            offeredDates,
        }));

        await guardCases();

        if (guardsOnly) {
            console.log('\n--guards-only: skipping the four live agent runs.');
            return;
        }

        // ---- 1 + 2: the agent sees the quote, and answers a price objection with a lever ----
        const objection = await agentCase(
            'CASE 1+2 — £180 quote, customer says it is too expensive',
            'Sorry Ben, thats a bit too expensive for us. Thanks anyway',
        );

        const thread = threadPayload(objection);
        const lq = thread?.liveQuote;
        pass(!!lq, 'get_thread hands the agent the live quote');
        if (lq) {
            pass(lq.slug === SLUG_SMALL, `quote context carries the slug (${lq.slug})`);
            pass(lq.totalGBP === 180, `quote context carries the real total (£${lq.totalGBP})`);
            pass(Array.isArray(lq.lineItems) && lq.lineItems.length === 2,
                `quote context carries the line items (${lq.lineItems?.length})`,
                (lq.lineItems ?? []).map((l: any) => `${l.label} £${l.priceGBP}`).join(' | '));
            pass(!!lq.linkSentAt, `quote context knows when the link was SENT (${lq.linkSentAt})`);
            pass(lq.daysSinceSent === 3, `quote context knows it went out ${lq.daysSinceSent} days ago`);
            pass(lq.viewCount === 4 && !!lq.lastViewedAt, `quote context knows they opened it ${lq.viewCount} times`, lq.viewNote);
            pass(!!lq.expiresAt && lq.expired === false, 'quote context carries the expiry and that it is still live');
            pass(lq.depositPaid === false, 'quote context carries deposit status');
            pass(!!lq.amendment && typeof lq.amendment.priorQuotesForThisCustomer === 'number',
                'quote context says whether it has been amended before', JSON.stringify(lq.amendment));
            pass(lq.priceBand?.id === 'sweet', `quote context routes it to the ${lq.priceBand?.id} band`, lq.priceBand?.playbook);
        }

        const d1 = await latestDraft();
        const q1 = await openQuestions();
        pass(!!d1 || q1.length > 0, 'the agent either drafted or asked Ben — it did not go silent');
        if (d1) {
            console.log(`\ndraft:\n${d1.body}\n`);
            pass(detectCapitulation(d1.body) === null,
                'the price-objection draft is NOT a capitulation',
                detectCapitulation(d1.body) ?? undefined);
            const leverish = /(?:edit|amend|adjust|which bits|which parts|2 people|two people|a few more quotes|other quotes|come back|because|means|ensur)/i.test(d1.body);
            pass(leverish, 'the draft reaches for a lever (re-scope, resourcing, reason, or invite the comparison)');
            pass(d1.status === 'pending', `the draft is waiting for approval, not sent (status=${d1.status})`);
            assertDraftIsSafe('price objection', d1.body);
        }

        // ---- 4: the £1,000 wall ----
        await retry('swap in the big quote', async () => {
            await db.delete(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, SLUG_SMALL));
            await db.delete(messages).where(and(eq(messages.conversationId, CONV_ID), eq(messages.direction, 'outbound')));
            await stageQuote({
                slug: SLUG_BIG,
                totalPence: 120_000,
                lines: [
                    { description: 'Strip out and replace bathroom cubicle and tiling', pence: 70_000 },
                    { description: 'Re-plaster and paint the bathroom walls', pence: 30_000 },
                    { description: 'Replace flooring and re-seal', pence: 20_000 },
                ],
                viewCount: 5,
                sentDaysAgo: 2,
                offeredDates,
            });
        });

        const wall = await agentCase(
            'CASE 4 — £1,200 quote, the customer balks. 85% of these die.',
            'Thats way more than I was expecting to be honest. Cant really justify that',
        );
        const wallQuestions = await openQuestions();
        const wallDraft = await latestDraft();
        pass(wallQuestions.length > 0,
            'a £1,200 objection is escalated to Ben rather than improvised',
            wallQuestions.map((q) => `${q.question} | options: ${(q.options as string[] ?? []).join(' / ')}`).join('\n'));
        if (wallDraft) {
            console.log(`\ndraft:\n${wallDraft.body}\n`);
            pass(detectCapitulation(wallDraft.body) === null, 'the £1,200 draft is not a capitulation');
            assertDraftIsSafe('£1,200', wallDraft.body);
        }
        const wallOptions = wallQuestions.flatMap((q) => (q.options as string[] ?? []));
        pass(wallOptions.some((o) => /split|defer|de-?scope|second visit|survey|phase/i.test(o)),
            'the options put to Ben are STRUCTURAL, not "shall we drop the price"',
            wallOptions.join(' / '));
        pass(!wallOptions.some((o) => /discount|% off|reduce the price|lower the price/i.test(o)),
            'no option offered to Ben is a discount');
        if (toolErrors(wall).length) console.log(`      tool refusals seen: ${toolErrors(wall).join(' | ')}`);

        // ---- 5: scheduling, on a CLEAN thread. The price objection above would otherwise
        // dominate the run and the date question would never get a straight answer.
        await retry('reset for the scheduling case', async () => {
            await clearThread(CONV_ID);
            await stageQuote({
                slug: SLUG_SMALL,
                totalPence: 18_000,
                lines: [{ description: 'Swap kitchen mixer tap, customer supplying the tap', pence: 18_000 }],
                viewCount: 3,
                sentDaysAgo: 2,
                // Tuesday IS on their quote, which is the hard case: the agent is allowed to
                // acknowledge it and still may not confirm it.
                offeredDates: [nextWeekday(2), nextWeekday(4)],
            });
        });

        const sched = await agentCase(
            'CASE 5 — "can you come Tuesday". Tuesday is ON their quote and it must still not commit.',
            'Can you come Tuesday?',
        );
        const schedDraft = await latestDraft();
        const schedQuestions = await openQuestions();
        pass(toolsUsed(sched).includes('check_date') || schedQuestions.length > 0,
            'the agent checked the date read-only or took it to Ben',
            `tools: ${toolsUsed(sched).join(', ')}`);
        if (schedDraft) {
            console.log(`\ndraft:\n${schedDraft.body}\n`);
            pass(detectDatePromise(schedDraft.body) === null,
                'the scheduling draft promises no date',
                detectDatePromise(schedDraft.body) ?? undefined);
            assertDraftIsSafe('scheduling', schedDraft.body);
        } else {
            pass(schedQuestions.length > 0, 'no draft, but the date question is with Ben');
        }
    } finally {
        // Leave nothing behind: the quote, the thread and the config all go back.
        await retry('cleanup thread', () => clearThread(CONV_ID)).catch((e) => console.error('cleanup failed:', e?.message));
        await retry('restore config', () => setCommsAgentConfig({
            autosend: savedConfig.autosend,
            firstContactAutoAck: savedConfig.firstContactAutoAck,
        })).catch((e) => console.error('config restore failed:', e?.message));
        console.log(`\n${failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`}`);
    }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
