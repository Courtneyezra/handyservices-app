/**
 * THE END-TO-END PIPELINE TEST — one customer, one thread, inbound to ledger.
 *
 *   npx tsx scripts/_pipeline-e2e-test.ts             full run (4 LLM conversations)
 *   npx tsx scripts/_pipeline-e2e-test.ts --no-llm    deterministic stages only, no model spend
 *
 * WHY THIS EXISTS. Two workstreams landed in parallel and had never been run together:
 *
 *   9e83212  post-quote quote context + objection levers (server/agents/quote-context.ts,
 *            objection-levers.ts, draft-guards.ts, and the new post-quote DRAFT_INTENTS)
 *   85e61df  the agent_outcomes closed-loop ledger (server/agent-outcomes.ts)
 *
 * They typecheck and build together. That is not the same as working together, and the interesting
 * failures are exactly at the seam: the ledger learns an agent's capability by parsing a prefix out
 * of a free-text `reason` string that a DIFFERENT commit writes. Nothing enforces that contract at
 * compile time, so it is asserted here (stage 8).
 *
 * SAFETY, and it is absolute:
 *   · Every number is inside the Ofcom reserved drama range (+447700900xxx), which is permanently
 *     unallocated. No real customer can be reached by this script.
 *   · Cleanup deletes TRACKED IDS ONLY, never "everything matching a pattern", so another suite's
 *     rows and any real data are left alone.
 *   · firstContactAutoAck is enabled for stage 1 and RESTORED TO DISABLED in the finally block, then
 *     read back from the database and printed. It has been left on by testing before; the read-back
 *     is there so a run can never end without the true state on screen.
 *   · Sends go out over WhatsApp, which Twilio accepts and queues for any number (it fails later via
 *     a status callback that never reaches a dev machine). SMS to this range fails at request time
 *     with 21211 and fires a REAL Pushover alert at the owner's phone, so this suite never uses SMS.
 *     A full run of THIS script fires zero immediate Pushover alerts.
 *
 * THE JOURNEY, in order, on ONE conversation:
 *
 *   1. inbound arrives     the lanes fire: opt-out gate 0, first-contact ack, ack-reply triage
 *   2. STOP                on a SEPARATE thread, gate 0 short-circuits everything — and it must beat
 *                          the ack lane, which is enabled and would otherwise answer a first contact
 *   3. triage with a photo the agent reads the thread WITH the image embedded (media-context.ts)
 *   4. quote prep          runQuotePrep returns structured lines and a readiness verdict
 *  4b. the handoff        tagging needs_quote fires the clerk by itself, routes the verdict onto
 *                         the board, stores the intake and pushes Ben — the event that replaced
 *                         the "Prep quote" button when nobody was left reading the thread
 *   5. quote sent          the thread moves to quote_sent, the quote is live and non-draft
 *   6. price objection     the agent answers with a LEVER and invents no figure
 *   7. the £1,000 wall     a £1,200 objection goes to Ben instead of being improvised
 *   8. the ledger          every proposal above is in agent_outcomes with the right agent and
 *                          capability and a frozen body; unedited vs edited approval; supersede;
 *                          reply attribution
 *   9. the board           the SLA clock, the funnel stages, the unanswered headline
 *
 * Stages 3 (agent run), 4, 6 and 7 need a model. Everything else is deterministic and runs under
 * --no-llm, including the whole of stage 8 — which is where the seam between the two commits is.
 */
import 'dotenv/config';
import express from 'express';
import type { Server } from 'http';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { db } from '../server/db';
import {
    conversations, messages, messageDrafts, agentQuestions, personalizedQuotes, firstContactAckLog,
} from '@shared/schema';
import { and, desc, eq, sql } from 'drizzle-orm';

import { scheduleInboundTriage } from '../server/agents/comms-lanes';
import {
    getCommsAgentConfig, runCommsAgent, DRAFT_INTENTS,
    maySendDirect, neverSendDirectReason, maybeAutoQuotePrep, routeIntakeVerdict,
    READY_TO_PRICE_TAG, QUOTE_READY_TAG, VISIT_FIRST_TAG, NEEDS_BEN_TAG,
    type CommsAgentOutcome,
} from '../server/agents/comms';
import { runQuotePrep } from '../server/agents/quote-prep';
import { loadQuoteContexts } from '../server/agents/quote-context';
import { buildMediaBlocks } from '../server/agents/media-context';
import { detectCapitulation, detectDatePromise, detectUnseenImplication, detectDiscountOffer, extractMoneyFigures } from '../server/agents/draft-guards';
import { isFirstContact } from '../server/first-contact-ack';
import { queueDraft, approveAndSendDraft, messageDraftsRouter } from '../server/message-drafts';
import { askBen, agentQuestionsRouter } from '../server/agent-questions';
import { reconcileOutcomes, refreshOutcomes, outcomeMetrics } from '../server/agent-outcomes';
import { loadActivity, toCard } from '../server/inbox-board';
import { computeWaitState } from '../server/comms-sla';

const NO_LLM = process.argv.includes('--no-llm');

// ---------------------------------------------------------------------------------- fixtures
//
// 9209xx is chosen because no other suite in this repo uses it: _outcome-loop-test and
// _auto-ack-sla-test live on 9009xx, _call-thread-test on 9009xx + 91x, _post-quote-test on 900997.
// Two suites sharing a test number is how a green run starts depending on run order.
const MAIN = '+447700900920';
const STOP_PHONE = '+447700900921';
const MAIN_KEY = '447700900920@c.us';
const STOP_KEY = '447700900921@c.us';
const CONV_MAIN = 'pipe2e_conv_main';
const CONV_STOP = 'pipe2e_conv_stop';
const SLUG_SMALL = 'pe2esml1';
const SLUG_BIG = 'pe2ebig1';
const MEDIA_DIR = path.join(process.cwd(), 'server/storage/media');
const MEDIA_FILE = 'pipe2e-tap-leak.jpg';

/** Everything this run created, so cleanup never guesses. */
const created = {
    drafts: [] as string[],
    questions: [] as string[],
    messages: [] as string[],
    quotes: [] as string[],
    conversations: [] as string[],
    mediaFiles: [] as string[],
};

// ---------------------------------------------------------------------------------- reporting

interface Stage { n: string; title: string; passed: number; failed: number; skipped: boolean; notes: string[] }
const stages: Stage[] = [];
let cur: Stage | null = null;

function stage(n: string, title: string): void {
    cur = { n, title, passed: 0, failed: 0, skipped: false, notes: [] };
    stages.push(cur);
    console.log(`\n${'='.repeat(78)}\nSTAGE ${n} — ${title}\n${'='.repeat(78)}`);
}
function skipStage(why: string): void {
    if (cur) { cur.skipped = true; cur.notes.push(why); }
    console.log(`SKIP  ${why}`);
}
function check(label: string, ok: boolean, detail?: string): boolean {
    if (cur) { ok ? cur.passed++ : cur.failed++; }
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${String(detail).replace(/\n/g, '\n      ').slice(0, 500)}` : ''}`);
    return ok;
}
/** A seam finding: recorded in the summary whether or not it is a failure. */
function seam(label: string, ok: boolean, detail?: string): boolean {
    if (cur) cur.notes.push(`${ok ? 'OK  ' : 'LEAK'} ${label}${detail ? ` — ${detail}` : ''}`);
    return check(`SEAM: ${label}`, ok, detail);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Neon drops connections under load. A timeout is not a test failure. */
async function retry<T>(label: string, fn: () => Promise<T>, tries = 5): Promise<T> {
    let last: any;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); } catch (e: any) {
            last = e;
            if (!/ETIMEDOUT|ECONNRESET|timeout|terminating connection|fetch failed/i.test(String(e?.message))) throw e;
            console.log(`      (${label} timed out, retry ${i + 1}/${tries})`);
            await sleep(1500 * (i + 1));
        }
    }
    throw last;
}

/** Ledger writes are fire-and-forget by design, so every read polls rather than sleeps a guess. */
async function ledgerRow(kind: string, refId: string, done: (r: any) => boolean = () => true, timeoutMs = 15_000): Promise<any | null> {
    const deadline = Date.now() + timeoutMs;
    let row: any = null;
    while (Date.now() < deadline) {
        const r: any = await db.execute(sql`SELECT * FROM agent_outcomes WHERE kind = ${kind} AND ref_id = ${refId} LIMIT 1`);
        row = (r.rows ?? r)[0] ?? null;
        if (row && done(row)) return row;
        await sleep(250);
    }
    return row;
}

async function waitFor(label: string, cond: () => Promise<boolean>, timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await cond().catch(() => false)) return true;
        await sleep(300);
    }
    console.log(`      (timed out waiting for ${label})`);
    return false;
}

// ---------------------------------------------------------------------------------- staging

function isoDay(offset: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
}

async function freshConversation(id: string, key: string, name: string): Promise<void> {
    await db.delete(conversations).where(eq(conversations.id, id));
    await db.insert(conversations).values({
        id, phoneNumber: key, contactName: name,
        status: 'active', stage: 'enquiry', priority: 'normal', tags: [],
    });
    created.conversations.push(id);
}

async function inbound(convId: string, text: string, opts: { mediaUrl?: string; mediaType?: string; at?: Date } = {}): Promise<string> {
    const at = opts.at ?? new Date();
    const id = `pipe2e_in_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await db.insert(messages).values({
        id, conversationId: convId, direction: 'inbound', channel: 'whatsapp',
        content: text, type: opts.mediaUrl ? 'image' : 'text', status: 'delivered',
        senderName: 'Pipeline E2E (reserved number)',
        mediaUrl: opts.mediaUrl ?? null, mediaType: opts.mediaType ?? null,
        createdAt: at,
    });
    created.messages.push(id);
    await db.update(conversations).set({
        lastInboundAt: at, lastCustomerContactAt: at, lastMessageAt: at,
        lastMessagePreview: text.slice(0, 50), canSendFreeform: true,
    }).where(eq(conversations.id, convId));
    return id;
}

async function outboundMsg(convId: string, text: string, at: Date): Promise<string> {
    const id = `pipe2e_out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await db.insert(messages).values({
        id, conversationId: convId, direction: 'outbound', channel: 'whatsapp',
        content: text, type: 'text', status: 'delivered', createdAt: at,
    });
    created.messages.push(id);
    await db.update(conversations).set({ lastMessageAt: at, lastMessagePreview: text.slice(0, 50) })
        .where(eq(conversations.id, convId));
    return id;
}

/** A quote shaped like a real one: priced lines with their own assumptions, views, expiry, dates. */
async function stageQuote(opts: {
    slug: string; totalPence: number; sentDaysAgo: number; viewCount: number;
    lines: { description: string; pence: number; assumptions?: string[] }[];
    offeredDates: string[]; isDraft?: boolean;
}): Promise<void> {
    const created_at = new Date(Date.now() - opts.sentDaysAgo * 86_400_000);
    const id = `pipe2e_quote_${opts.slug}`;
    await db.insert(personalizedQuotes).values({
        id, shortSlug: opts.slug, customerName: 'Pipeline E2E', phone: MAIN,
        jobDescription: opts.lines.map((l) => l.description).join('; '),
        basePrice: opts.totalPence, selectedTierPricePence: opts.totalPence,
        depositAmountPence: Math.round(opts.totalPence * 0.3),
        pricingLineItems: opts.lines.map((l, i) => ({
            lineId: `${opts.slug}_${i}`, description: l.description,
            guardedPricePence: l.pence, materialsWithMarginPence: 0,
            assumptions: l.assumptions ?? [],
        })),
        viewCount: opts.viewCount,
        viewedAt: new Date(created_at.getTime() + 3600_000),
        lastViewedAt: new Date(Date.now() - 4 * 3600_000),
        expiresAt: new Date(Date.now() + 5 * 86_400_000),
        availableDates: opts.offeredDates,
        isDraft: opts.isDraft ?? false,
        createdAt: created_at, updatedAt: created_at,
    });
    created.quotes.push(id);
}

async function latestDraft(phone = MAIN) {
    const [d] = await db.select().from(messageDrafts).where(eq(messageDrafts.phone, phone))
        .orderBy(desc(messageDrafts.createdAt)).limit(1);
    return d ?? null;
}
async function openQuestions(phone = MAIN) {
    return db.select().from(agentQuestions).where(eq(agentQuestions.phone, phone));
}

/** The get_thread tool_result event itself. */
function threadEvent(o: CommsAgentOutcome): any {
    return o.result.transcript.find((e) => e.type === 'tool_result' && e.detail?.tool === 'get_thread') ?? null;
}
/**
 * The data half of get_thread. When a tool returns { data, mediaBlocks } the runner logs
 * `result: data` and `mediaBlocks: <count>` (server/agents/runner.ts), so the payload is the data
 * object either way and the media count is read from the event, not from here.
 */
function threadPayload(o: CommsAgentOutcome): any {
    return threadEvent(o)?.detail?.result ?? null;
}
function toolsUsed(o: CommsAgentOutcome): string[] {
    return o.result.transcript.filter((e) => e.type === 'tool_call').map((e) => e.detail.tool);
}

/** Rules that must hold for ANY draft this suite provokes. */
function assertDraftIsSafe(label: string, body: string): void {
    check(`${label}: does not imply the quote was never seen`, detectUnseenImplication(body) === null, detectUnseenImplication(body) ?? undefined);
    check(`${label}: offers no discount`, detectDiscountOffer(body) === null, detectDiscountOffer(body) ?? undefined);
    check(`${label}: promises no date`, detectDatePromise(body) === null, detectDatePromise(body) ?? undefined);
}

// ---------------------------------------------------------------------------------- stages

async function stage1_inboundLanes(): Promise<void> {
    stage('1', 'Inbound arrives and the lanes fire (opt-out gate 0 → first-contact ack → ack-reply)');

    await retry('fresh main conversation', () => freshConversation(CONV_MAIN, MAIN_KEY, 'Pipeline E2E (reserved number)'));
    const first = await retry('is first contact', () => isFirstContact({ conversationId: CONV_MAIN, phone: MAIN }));
    check('a number we have never messaged reads as a first contact', first === true);

    const text = 'Hi, is that Handy Services? My kitchen tap has been dripping for about a week and the cupboard underneath is going damp.';
    const msgId = await retry('stage inbound', () => inbound(CONV_MAIN, text));

    // The real hot path: this is what the Twilio/Meta webhooks call on every stored inbound.
    scheduleInboundTriage(CONV_MAIN, MAIN, {
        channel: 'whatsapp', contactName: 'Pipeline E2E (reserved number)',
        hasMedia: false, text, messageId: msgId,
    });

    // GATE 0 must find nothing to suppress here.
    const supp: any = await db.execute(sql`SELECT count(*)::int n FROM comms_opt_outs WHERE phone_key = '7700900920'`);
    check('gate 0 records no suppression for an ordinary enquiry', Number((supp.rows ?? supp)[0].n) === 0);

    // The ack lane is instant and fire-and-forget, so poll for its audit row.
    const acked = await waitFor('the first-contact ack lane to decide', async () => {
        const rows = await db.select().from(firstContactAckLog).where(eq(firstContactAckLog.phone, MAIN));
        return rows.length > 0;
    });
    const ackRows = await db.select().from(firstContactAckLog).where(eq(firstContactAckLog.phone, MAIN));
    check('the first-contact ack lane ran and left an audit row', acked && ackRows.length > 0,
        ackRows.map((r) => `${r.decision ?? r.reason ?? '?'}`).join(', '));
    check('the ack lane did not refuse for a reason that would hide a bug',
        ackRows.every((r) => !/DISABLED|CHANNEL_NOT_ENABLED/i.test(String(r.reason ?? ''))),
        ackRows.map((r) => String(r.reason)).join(', '));

    // Whatever pipe it left by, an acknowledged thread is no longer a first contact — or the next
    // inbound acks them a second time.
    const stillFirst = await retry('re-check first contact', () => isFirstContact({ conversationId: CONV_MAIN, phone: MAIN }));
    check('an acknowledged thread is no longer a first contact', stillFirst === false);

    // The debounced LLM lane is deliberately NOT armed for test numbers (comms-lanes.ts isTestNumber),
    // which is why every stage below drives runCommsAgent directly. Proven by what is NOT in the
    // drafts table: the ack lane's row is there, an agent-triage row is not. If that guard is ever
    // removed this fails loudly, rather than the suite quietly starting to spend money on smoke
    // traffic on every ingest.
    const draftsNow = await db.select().from(messageDrafts).where(eq(messageDrafts.phone, MAIN));
    check('the debounced LLM lane did not arm for the Ofcom range (by design)',
        !draftsNow.some((d) => d.source === 'comms_agent'),
        draftsNow.map((d) => d.source).join(', ') || 'no drafts');
}

async function stage2_stopShortCircuit(): Promise<void> {
    stage('2', 'A STOP stops everything — gate 0 beats the ack lane on a separate thread');

    await retry('fresh stop conversation', () => freshConversation(CONV_STOP, STOP_KEY, 'Pipeline E2E STOP (reserved number)'));
    const stopText = 'STOP';
    const msgId = await retry('stage stop inbound', () => inbound(CONV_STOP, stopText));

    // This thread is a FIRST CONTACT and the ack lane is currently ENABLED. If gate 0 did not
    // short-circuit, an automated message would go to someone who just asked, in writing, for no
    // more automated messages. That is the single worst outcome available in this system.
    const wasFirst = await retry('stop thread first contact', () => isFirstContact({ conversationId: CONV_STOP, phone: STOP_PHONE }));
    check('the STOP thread is a first contact, so the ack lane would otherwise answer it', wasFirst === true);

    scheduleInboundTriage(CONV_STOP, STOP_PHONE, {
        channel: 'whatsapp', contactName: 'Pipeline E2E STOP (reserved number)',
        hasMedia: false, text: stopText, messageId: msgId,
    });

    const recorded = await waitFor('the opt-out to be recorded', async () => {
        const r: any = await db.execute(sql`SELECT count(*)::int n FROM comms_opt_outs WHERE phone_key = '7700900921'`);
        return Number((r.rows ?? r)[0].n) > 0;
    });
    const rows: any = await db.execute(sql`SELECT * FROM comms_opt_outs WHERE phone_key = '7700900921'`);
    const supp = (rows.rows ?? rows)[0] ?? null;
    check('the suppression is recorded', recorded && !!supp, supp ? `scope=${supp.scope} keyword=${supp.matched_keyword}` : 'none');
    check('the words that caused it are kept verbatim', !!supp?.trigger_text, supp?.trigger_text);

    // Give the (skipped) ack lane the same wall-clock it had on the main thread before concluding
    // that nothing was sent.
    await sleep(2500);
    const outs = await db.select().from(messages)
        .where(and(eq(messages.conversationId, CONV_STOP), eq(messages.direction, 'outbound')));
    check('NOTHING was sent back to a number that said STOP', outs.length === 0, `${outs.length} outbound message(s)`);

    const ackLog = await db.select().from(firstContactAckLog).where(eq(firstContactAckLog.phone, STOP_PHONE));
    check('the ack lane never even composed an acknowledgement', ackLog.length === 0, `${ackLog.length} ack log row(s)`);

    const drafts = await db.select().from(messageDrafts).where(eq(messageDrafts.phone, STOP_PHONE));
    check('no draft was queued for a suppressed number', drafts.length === 0, `${drafts.length} draft(s)`);

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, CONV_STOP));
    check('the thread is closed on the board', conv?.stage === 'closed', `stage=${conv?.stage}`);
    check('the thread is tagged so a human can see why', ((conv?.tags as string[]) ?? []).some((t) => /opt|stop|unsub/i.test(t)),
        JSON.stringify(conv?.tags));
}

async function stage3_triageWithPhoto(): Promise<CommsAgentOutcome | null> {
    stage('3', 'Triage: the agent reads the thread WITH the photo embedded');

    // A real file on disk, because media-context.ts resolves /api/media/<name> to server/storage/media.
    mkdirSync(MEDIA_DIR, { recursive: true });
    const filePath = path.join(MEDIA_DIR, MEDIA_FILE);
    const png = await sharp({
        create: { width: 900, height: 700, channels: 3, background: { r: 210, g: 214, b: 219 } },
    }).composite([{
        input: Buffer.from(
            `<svg width="900" height="700"><rect x="330" y="120" width="240" height="300" rx="24" fill="#8a9096"/>`
            + `<rect x="420" y="420" width="60" height="150" fill="#6b7177"/>`
            + `<circle cx="450" cy="620" r="42" fill="#3b82f6"/>`
            + `<text x="450" y="680" font-size="34" text-anchor="middle" fill="#111">leaking mixer tap</text></svg>`),
    }]).jpeg({ quality: 80 }).toBuffer();
    writeFileSync(filePath, png);
    created.mediaFiles.push(filePath);

    const mediaUrl = `/api/media/${MEDIA_FILE}`;
    await retry('stage photo inbound', () => inbound(CONV_MAIN, 'Here it is, you can see the drip', { mediaUrl, mediaType: 'image/jpeg' }));

    // Deterministic half: the vision blocks are actually built. Runs under --no-llm.
    const blocks = await buildMediaBlocks([{ mediaUrl, mediaType: 'image/jpeg', direction: 'inbound', createdAt: new Date(), content: 'Here it is' }]);
    const imageBlocks = blocks.filter((b: any) => b.type === 'image');
    check('media-context turns the photo into vision blocks', imageBlocks.length >= 1, `${blocks.length} block(s), ${imageBlocks.length} image(s)`);
    check('the image block is base64 JPEG as the model expects',
        (imageBlocks[0] as any)?.source?.media_type === 'image/jpeg' && !!(imageBlocks[0] as any)?.source?.data);

    if (NO_LLM) { skipStage('--no-llm: the live triage run is skipped'); return null; }

    await db.delete(messageDrafts).where(eq(messageDrafts.phone, MAIN));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, MAIN));
    const outcome = await retry('triage run', () => runCommsAgent(CONV_MAIN, 'inbound_message'));

    const payload = threadPayload(outcome);
    check('the agent called get_thread', toolsUsed(outcome).includes('get_thread'), toolsUsed(outcome).join(', '));
    // The runner splices mediaBlocks into the SAME tool_result the model reads, and records how many
    // it spliced. A non-zero count is the proof that the model got pixels rather than "hasMedia: true".
    const mediaCount = Number(threadEvent(outcome)?.detail?.mediaBlocks ?? 0);
    check('get_thread handed the agent the actual pixels, not "hasMedia: true"', mediaCount > 0,
        `${mediaCount} media block(s) spliced into the tool result`);
    check('the thread timeline also flags the message as carrying media',
        (payload?.timeline ?? []).some((t: any) => t.hasMedia === true));
    check('with no quote on the number, the agent is told it may not mention a price',
        /No quote for this number/i.test(String(payload?.data?.postQuoteNote ?? payload?.postQuoteNote ?? '')),
        String(payload?.data?.postQuoteNote ?? payload?.postQuoteNote ?? '').slice(0, 160));

    const d = await latestDraft();
    const q = await openQuestions();
    check('the agent triaged: it drafted or asked, it did not go silent', !!d || q.length > 0,
        d ? `draft ${d.id}` : `${q.length} question(s)`);
    if (d) {
        console.log(`\ndraft:\n${d.body}\n`);
        // Direct send is off for this suite, so the reply must queue. Under the live config it
        // would have gone straight out, which is exactly what the second line records.
        check('with direct send off, the reply queued instead of sending', d.status === 'pending', `status=${d.status}`);
        const held = neverSendDirectReason(d.body);
        check('and the reply commits to nothing, so under the live config it would have SENT',
            held === null, held ? `would be HELD FOR BEN: ${held}` : 'no money, no date, no liability');
        assertDraftIsSafe('triage', d.body);
        created.drafts.push(d.id);
    }
    for (const row of q) created.questions.push(row.id);
    return outcome;
}

async function stage4_quotePrep(): Promise<void> {
    stage('4', 'Quote prep turns the thread into a quote-ready intake');
    if (NO_LLM) { skipStage('--no-llm: quote prep needs a model'); return; }

    const { intake, summary, turns } = await retry('quote prep run', () => runQuotePrep(CONV_MAIN));
    console.log(`turns=${turns} summary=${String(summary).slice(0, 200)}`);
    if (!check('runQuotePrep produced an intake', !!intake)) return;

    console.log(JSON.stringify(intake, null, 2).slice(0, 1200));
    check('the intake has at least one structured job line', (intake!.lines?.length ?? 0) >= 1, `${intake!.lines.length} line(s)`);
    check('every line title is a quote line item, not a paragraph',
        intake!.lines.every((l) => l.title.length > 0 && l.title.length <= 60),
        intake!.lines.map((l) => `${l.title.length}c`).join(', '));
    check('no line title or detail carries a price (pricing is not quote-prep\'s job)',
        intake!.lines.every((l) => !/£\s*\d/.test(l.title) && !/£\s*\d/.test(l.detail)));
    check('the readiness verdict is one of the three known values',
        ['quote_ready', 'needs_info', 'visit_first'].includes(intake!.readiness), intake!.readiness);
    check('the verdict agrees with the gaps',
        intake!.readiness !== 'quote_ready' || !intake!.gaps.some((g) => g.audience === 'customer'),
        `${intake!.readiness} with ${intake!.gaps.length} gap(s)`);
    check('the phone on the intake is the thread\'s own', intake!.phone === MAIN, intake!.phone);
}

/**
 * The handoff that replaced the "Prep quote" button.
 *
 * Before 20 Aug 2026 a human read every reply, so a human clicking Prep quote cost nothing. The
 * agent now runs the conversation alone, and a thread that has become priceable will sit there
 * until somebody happens to look — so the handoff had to become an event. maybeAutoQuotePrep is
 * driven directly here rather than through an agent run, because what needs proving is the
 * ROUTING (verdict → board state → stored intake → push → rate limit), not that the model can
 * decide to type a tag.
 *
 * PUSHOVER_APP_TOKEN is unset for the duration. The whole notify path still executes; dispatch()
 * short-circuits at the documented no-token no-op instead of buzzing the owner's real phone, which
 * keeps this script's promise that a full run fires zero immediate alerts.
 */
async function stage4b_autoHandoff(): Promise<void> {
    stage('4b', 'The automatic handoff: triage tags it, the clerk runs, Ben gets a card and a push');
    if (NO_LLM) { skipStage('--no-llm: the handoff runs a real quote-prep model call'); return; }

    const cfg = { ...(await getCommsAgentConfig()), quotePrep: { enabled: true, minHoursBetweenRuns: 6 } };

    // Nothing happens without the tag. That is the whole trigger, so it is the first thing checked.
    await db.update(conversations).set({ tags: ['photos_received'] }).where(eq(conversations.id, CONV_MAIN));
    const untagged = await maybeAutoQuotePrep(CONV_MAIN, cfg);
    check('no needs_quote tag, no run — the clerk is not fired speculatively',
        untagged.ran === false && /needs_quote/.test(untagged.skipped ?? ''), untagged.skipped);

    const token = process.env.PUSHOVER_APP_TOKEN;
    delete process.env.PUSHOVER_APP_TOKEN;
    let handoff: Awaited<ReturnType<typeof maybeAutoQuotePrep>>;
    try {
        await db.update(conversations).set({ tags: ['photos_received', READY_TO_PRICE_TAG] })
            .where(eq(conversations.id, CONV_MAIN));
        handoff = await retry('auto handoff', () => maybeAutoQuotePrep(CONV_MAIN, cfg));
    } finally {
        if (token) process.env.PUSHOVER_APP_TOKEN = token;
    }

    console.log(`handoff: ${JSON.stringify(handoff)}`);
    if (!check('tagging needs_quote fired the clerk', handoff.ran === true, handoff.skipped)) return;
    check('it came back with a readiness verdict',
        ['quote_ready', 'needs_info', 'visit_first'].includes(handoff.readiness ?? ''), handoff.readiness);

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, CONV_MAIN));
    const tags = conv?.tags ?? [];
    const meta = (conv?.metadata ?? {}) as any;
    console.log(`board after handoff: stage=${conv?.stage} tags=${JSON.stringify(tags)}`);

    // The trigger tag is consumed, whatever the verdict. Leaving it set is how a thread re-preps
    // itself on every inbound until the rate limiter happens to catch it.
    check('the needs_quote trigger is consumed, so it cannot re-fire on the next message',
        !tags.includes(READY_TO_PRICE_TAG), JSON.stringify(tags));
    // The intake is stored, which is the only reason Ben's slide-over can open without paying for
    // a second identical run.
    check('the intake is stored on the conversation for the slide-over to open',
        Array.isArray(meta?.quotePrepIntake?.lines) && meta.quotePrepIntake.lines.length >= 1,
        `${meta?.quotePrepIntake?.lines?.length ?? 0} line(s) stored`);
    check('no price anywhere in the stored intake (the clerk never prices)',
        !/£\s*\d/.test(JSON.stringify(meta?.quotePrepIntake ?? {})));

    // The live run lands on ONE verdict, so the branch it happened to take is checked against the
    // board it actually left behind…
    const live = routeIntakeVerdict(handoff.readiness!, ['photos_received', READY_TO_PRICE_TAG]);
    check(`the board matches the routing for the verdict it returned (${handoff.readiness})`,
        live.tags.every((t) => tags.includes(t)) && (!live.stage || conv?.stage === live.stage),
        `expected ${JSON.stringify(live.tags)}${live.stage ? ` + stage ${live.stage}` : ''}, got ${JSON.stringify(tags)} stage=${conv?.stage}`);
    check('and Ben was buzzed exactly when the routing says he should be',
        !!handoff.notified === live.notify, `notified=${handoff.notified} expected=${live.notify}`);

    // …and all three branches are proved from the pure routing table, because paying for three
    // model runs to see three tag sets would be absurd.
    const before = ['photos_received', READY_TO_PRICE_TAG];
    const ready = routeIntakeVerdict('quote_ready', before);
    check('quote_ready: card to scoping, tagged for Ben, and he is notified',
        ready.stage === 'scoping' && ready.tags.includes(NEEDS_BEN_TAG)
        && ready.tags.includes(QUOTE_READY_TAG) && ready.notify === true, JSON.stringify(ready));
    const visit = routeIntakeVerdict('visit_first', before);
    check('visit_first: same card move, tagged visit_first so the panel pre-sets the survey gate',
        visit.stage === 'scoping' && visit.tags.includes(VISIT_FIRST_TAG)
        && visit.tags.includes(NEEDS_BEN_TAG) && visit.notify === true, JSON.stringify(visit));
    const info = routeIntakeVerdict('needs_info', before);
    check('needs_info stays with the agent: stage untouched, no needs_ben, no push',
        info.stage === null && !info.tags.includes(NEEDS_BEN_TAG)
        && info.tags.includes('quote_gaps') && info.notify === false, JSON.stringify(info));
    check('every verdict consumes the needs_quote trigger, so none of them can re-fire the clerk',
        [ready, visit, info].every((r) => !r.tags.includes(READY_TO_PRICE_TAG)));
    check('and none of them loses a tag that was already on the card',
        [ready, visit, info].every((r) => r.tags.includes('photos_received')));

    // The cost bound. A second call moments later must not spend another model run.
    const again = await maybeAutoQuotePrep(CONV_MAIN, cfg);
    check('a second call inside the window is refused (cost bound holds)',
        again.ran === false, again.skipped);
    // …unless something substantive arrived. A new photo is the commonest thing that turns
    // needs_info into quote_ready, so it must beat the timer.
    await db.update(conversations).set({ tags: [...tags, READY_TO_PRICE_TAG] }).where(eq(conversations.id, CONV_MAIN));
    const stillBarred = await maybeAutoQuotePrep(CONV_MAIN, cfg);
    check('re-tagging alone does not defeat the cost bound', stillBarred.ran === false, stillBarred.skipped);

    // Reset the board so stage 5 starts where it expects to.
    await db.update(conversations).set({ tags: [], metadata: null }).where(eq(conversations.id, CONV_MAIN));
}

async function stage5_quoteSent(): Promise<void> {
    stage('5', 'Quote sent: the thread moves to quote_sent and the send is recorded');

    const offeredDates = [isoDay(4), isoDay(5), isoDay(8)];
    await retry('stage the £180 quote', () => stageQuote({
        slug: SLUG_SMALL, totalPence: 18_000, sentDaysAgo: 3, viewCount: 4, offeredDates,
        lines: [
            { description: 'Swap kitchen mixer tap, customer supplying the tap', pence: 9_000, assumptions: ['Isolation valves under the sink are working'] },
            { description: 'Dry out and reseal the base of the sink cupboard', pence: 9_000 },
        ],
    }));
    // The link as Ben actually sends it — this, not createdAt, is how the agent learns when it went out.
    await retry('record the send', () => outboundMsg(CONV_MAIN,
        `Hey, here's your quote: https://www.handyservices.app/q/${SLUG_SMALL}\n\nThanks\nBen`,
        new Date(Date.now() - 3 * 86_400_000)));
    await db.update(conversations).set({ stage: 'quote_sent' }).where(eq(conversations.id, CONV_MAIN));

    const ctxs = await retry('load quote context', () => loadQuoteContexts({ digits: '447700900920', conversationId: CONV_MAIN }));
    const live = ctxs.find((c) => c.isLive) ?? null;
    check('the quote loads as agent-visible context', ctxs.length >= 1, `${ctxs.length} quote(s)`);
    if (!check('there is a LIVE quote on the thread', !!live)) return;
    check('the live quote is the one just sent', live!.slug === SLUG_SMALL, live!.slug);
    check('the context carries the real total', live!.totalGBP === 180, `£${live!.totalGBP}`);
    check('the context carries the priced line items', live!.lineItems.length === 2,
        live!.lineItems.map((l) => `${l.label} £${l.priceGBP}`).join(' | '));
    check('the context knows when the LINK went out, from the thread', !!live!.linkSentAt && live!.daysSinceSent === 3, `${live!.daysSinceSent}d`);
    check('the context knows they have opened it', live!.viewCount === 4, live!.viewNote);
    check('the context routes £180 to the sweet-spot band', live!.priceBand.id === 'sweet', live!.priceBand.playbook);
    check('no deposit yet', live!.depositPaid === false);

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, CONV_MAIN));
    check('the board card is in quote_sent', toCard(conv!, (await loadActivity([CONV_MAIN])).get(CONV_MAIN)).stage === 'quote_sent');

    // ---- the seam nobody was watching: an UNSENT draft quote must never become the live quote.
    // shared/schema.ts on is_draft: "must never reach the customer: customer-facing automations
    // skip it". server/agents/recovery.ts honours that. The post-quote context is customer-facing:
    // its figures are what the money guard authorises the agent to write to a person.
    await retry('stage a DRAFT quote', () => stageQuote({
        slug: 'pe2edrft', totalPence: 99_900, sentDaysAgo: 0, viewCount: 0, offeredDates: [],
        lines: [{ description: 'Unsent draft the customer has never seen', pence: 99_900 }],
        isDraft: true,
    }));
    const withDraft = await retry('reload quote context', () => loadQuoteContexts({ digits: '447700900920', conversationId: CONV_MAIN }));
    const draftVisible = withDraft.find((c) => c.slug === 'pe2edrft') ?? null;
    seam('an unsent DRAFT quote is not handed to the comms agent', draftVisible === null,
        draftVisible ? `draft quote pe2edrft is visible as live=${draftVisible.isLive}, £${draftVisible.totalGBP}` : 'excluded');
    const liveAfter = withDraft.find((c) => c.isLive) ?? null;
    seam('the draft did not displace the real quote as the live one', liveAfter?.slug === SLUG_SMALL,
        `live is ${liveAfter?.slug ?? 'none'}`);
    const allowsDraftMoney = withDraft.some((c) => c.allowedFigurePence.includes(99_900));
    seam('a draft quote\'s figures are NOT authorised for a customer message', !allowsDraftMoney,
        allowsDraftMoney ? '£999 from an unsent draft is writable to the customer' : 'not authorised');

    await db.delete(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'pe2edrft'));

    // The same question one step along: Ben withdrew the price. It may still be discussed, but it
    // may never be the quote the agent shapes a reply around.
    await db.update(personalizedQuotes).set({ revokedAt: new Date() })
        .where(eq(personalizedQuotes.shortSlug, SLUG_SMALL));
    const afterRevoke = await retry('reload after revoke', () => loadQuoteContexts({ digits: '447700900920', conversationId: CONV_MAIN }));
    const revoked = afterRevoke.find((c) => c.slug === SLUG_SMALL) ?? null;
    seam('a REVOKED quote is no longer the live one', revoked !== null && revoked.isLive === false,
        revoked ? `visible=${!!revoked} isLive=${revoked.isLive}` : 'not visible at all');
    await db.update(personalizedQuotes).set({ revokedAt: null })
        .where(eq(personalizedQuotes.shortSlug, SLUG_SMALL));
}

async function stage6_priceObjection(): Promise<void> {
    stage('6', 'A price objection is answered with a LEVER, and no figure is invented');
    if (NO_LLM) { skipStage('--no-llm: the objection reply needs a model'); return; }

    await db.delete(messageDrafts).where(eq(messageDrafts.phone, MAIN));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, MAIN));
    await retry('stage the objection', () => inbound(CONV_MAIN, "That's more than I expected to be honest."));

    const outcome = await retry('objection run', () => runCommsAgent(CONV_MAIN, 'inbound_message'));
    const payload = threadPayload(outcome);
    const lq = payload?.data?.liveQuote ?? payload?.liveQuote;
    check('the agent sees the live quote when it answers', !!lq, lq ? `${lq.slug} £${lq.totalGBP}` : 'none');

    const d = await latestDraft();
    const qs = await openQuestions();
    for (const row of qs) created.questions.push(row.id);
    check('the agent answered or escalated, it did not go silent', !!d || qs.length > 0);

    if (d) {
        created.drafts.push(d.id);
        console.log(`\ndraft:\n${d.body}\n`);
        check('the reply is NOT a capitulation', detectCapitulation(d.body) === null, detectCapitulation(d.body) ?? undefined);
        const leverish = /(?:edit|amend|adjust|which bits|which parts|2 people|two people|a few more quotes|other quotes|come back|because|means|ensur|covers)/i.test(d.body);
        check('the reply reaches for a lever (re-scope, resourcing, reason, or invite the comparison)', leverish);
        assertDraftIsSafe('price objection', d.body);

        // Since 21 Aug 2026 nothing the agent writes may be a number AT ALL — the quote page is
        // the numbers channel, and the guard refuses even the quote's own total at draft time.
        const figures = extractMoneyFigures(d.body);
        check('the reply carries NO money figure at all (money never transmits in chat)', figures.length === 0,
            figures.length ? `figures found: ${figures.map((f) => f.raw).join(', ')}` : 'figure-free');

        // The seam: the intent the post-quote commit invented has to survive into the ledger.
        const stamped = /^\[([a-z_]+)\]/.exec(d.reason ?? '')?.[1] ?? null;
        check('the draft reason is stamped with an intent the ledger can parse', !!stamped, d.reason ?? 'no reason');
        const row = await ledgerRow('draft', d.id);
        seam('a post-quote draft reaches the ledger with its real capability',
            !!row && row.capability === stamped && row.capability !== 'other',
            `intent=${stamped} capability=${row?.capability}`);
        seam('the ledger froze the post-quote draft body verbatim', row?.proposed_body === d.body);
    }
}

async function stage7_theWall(): Promise<void> {
    stage('7', 'A £1,000+ objection escalates to Ben rather than being improvised');
    if (NO_LLM) { skipStage('--no-llm: the escalation needs a model'); return; }

    await retry('swap in the £1,200 quote', async () => {
        await db.delete(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, SLUG_SMALL));
        await db.delete(messages).where(and(eq(messages.conversationId, CONV_MAIN), eq(messages.direction, 'outbound')));
        await stageQuote({
            slug: SLUG_BIG, totalPence: 120_000, sentDaysAgo: 2, viewCount: 5,
            offeredDates: [isoDay(4), isoDay(5)],
            lines: [
                { description: 'Strip out and replace bathroom cubicle and tiling', pence: 70_000 },
                { description: 'Re-plaster and paint the bathroom walls', pence: 30_000 },
                { description: 'Replace flooring and re-seal', pence: 20_000 },
            ],
        });
        await outboundMsg(CONV_MAIN, `Here's the quote: https://www.handyservices.app/q/${SLUG_BIG}\n\nThanks\nBen`,
            new Date(Date.now() - 2 * 86_400_000));
    });

    await db.delete(messageDrafts).where(eq(messageDrafts.phone, MAIN));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, MAIN));
    await retry('stage the big objection', () => inbound(CONV_MAIN, "That's way more than I was expecting. Can't really justify that."));

    await retry('wall run', () => runCommsAgent(CONV_MAIN, 'inbound_message'));
    const qs = await openQuestions();
    for (const row of qs) created.questions.push(row.id);
    const d = await latestDraft();
    if (d) created.drafts.push(d.id);

    // THE ESCALATION SHAPE CHANGED (21 Aug 2026): the tap-question relay is gone. An escalation is
    // now a FLAG — needs_ben tag on the conversation, an agent_questions row with status 'flagged'
    // as the audit note, a Pushover ping (silent here, no token) — and Ben replies in the thread.
    const flagRows = qs.filter((q) => q.status === 'flagged');
    const [wallConv] = await db.select().from(conversations).where(eq(conversations.id, CONV_MAIN));
    const wallTags = (wallConv?.tags as string[]) ?? [];
    check('a £1,200 objection FLAGS the thread for Ben (flag row written)', flagRows.length > 0,
        flagRows.map((q) => q.question.slice(0, 200)).join('\n'));
    check('the thread carries the needs_ben tag', wallTags.includes('needs_ben'), JSON.stringify(wallTags));
    check('the flag raised the priority', ['high', 'urgent'].includes(String(wallConv?.priority)), String(wallConv?.priority));
    const notes = flagRows.map((q) => q.question).join(' ');
    check('the note put to Ben names STRUCTURAL options', /split|defer|de-?scope|second visit|survey|phase|stage|restructur/i.test(notes), notes.slice(0, 300));
    check('nothing in the note proposes a discount', !/\b(?:offer (?:a |them )?discount|% off|reduce the price|lower the price)\b/i.test(notes), notes.slice(0, 300));
    if (d) {
        console.log(`\ndraft:\n${d.body}\n`);
        check('the £1,200 draft is not a capitulation', detectCapitulation(d.body) === null);
        assertDraftIsSafe('£1,200', d.body);
    }
}

async function stage8_ledger(base: string): Promise<void> {
    stage('8', 'The ledger: capability, frozen bodies, verdicts, the diff, and attribution');

    // ---- SEAM A. The headline question. The ledger learns the capability by regex-parsing a
    // prefix out of a free-text `reason` written by the OTHER commit. Nothing enforces that at
    // compile time, so every post-quote intent is driven through the real queueDraft here.
    const postQuote = ['quote_question', 'price_objection', 'rescope_offer', 'timing_hold'] as const;
    for (const intent of postQuote) {
        const body = `Deterministic ledger probe for ${intent}.`;
        const id = await retry(`queue ${intent}`, () => queueDraft({
            phone: MAIN, body, source: 'comms_agent', channel: 'whatsapp', dedupe: false,
            reason: `[${intent}] pipeline e2e probe (quote ${SLUG_BIG})`,
        }));
        if (!id) { check(`queueDraft returned an id for ${intent}`, false); continue; }
        created.drafts.push(id);
        const row = await ledgerRow('draft', id);
        seam(`post-quote intent "${intent}" is recorded as its own capability`,
            !!row && row.capability === intent,
            row ? `capability=${row.capability}` : 'NO LEDGER ROW');
        check(`${intent}: not silently filed as "other"`, row?.capability !== 'other');
        check(`${intent}: attributed to the comms agent`, row?.agent === 'comms', row?.agent);
        check(`${intent}: body frozen verbatim`, row?.proposed_body === body);
        check(`${intent}: the intent prefix is stripped from the human-readable reason`,
            typeof row?.reason === 'string' && !row.reason.startsWith('['), row?.reason);
        check(`${intent}: the phone key is stored for downstream joins`, row?.phone_key === '7700900920', row?.phone_key);
    }
    // Every intent the agent can choose must survive the trip, not only the four new ones.
    check('the four post-quote intents are actually in the agent\'s vocabulary',
        postQuote.every((i) => (DRAFT_INTENTS as readonly string[]).includes(i)));

    // Where the two commits meet on autonomy, REWRITTEN 20 Aug 2026.
    //
    // This used to assert that no post-quote intent could ever auto-send, because the intent list
    // was the gate. The owner removed per-draft approval and the gate moved to the body: a
    // post-quote reply now sends when every guard passes and it commits to no money and no date.
    // So the contract to assert is the one that replaced it — and it is stricter, because it does
    // not care what the model called its own draft.
    const cfgOn = { ...(await getCommsAgentConfig()), autosend: { enabled: true, intents: [] } };
    const gate = (body: string, intent: string) => maySendDirect({
        config: cfgOn, intent, body, ukHour: 12, postQuoteThread: true, reactive: true, guardsPassed: true,
    }).send;
    for (const intent of postQuote) {
        check(`${intent}: a reply carrying a price is held for Ben, post-quote`,
            gate('That comes to £340 all in.', intent) === false);
        check(`${intent}: a reply carrying a date is held for Ben, post-quote`,
            gate('We can come Tuesday.', intent) === false);
    }
    check('a post-quote reply that commits to nothing now SENDS (this is the policy change)',
        gate('Happy to edit it for you, which bits matter most?', 'rescope_offer') === true);
    check('and the money rail is content-based, so no intent can carry a figure out',
        (DRAFT_INTENTS as readonly string[]).every((i) => gate('I can do it for £150.', i) === false));
    check('neverSendDirectReason names why, so the log says what was held and what for',
        neverSendDirectReason('That comes to £340 all in.') !== null
        && neverSendDirectReason('Happy to edit it for you, which bits matter most?') === null,
        neverSendDirectReason('That comes to £340 all in.') ?? '');

    // ---- approval, unedited. WhatsApp (not SMS) so Twilio queues rather than hard-failing: an
    // SMS to this range returns 21211 at request time and fires a real Pushover alert.
    const uneditedBody = 'Thanks for that, I have got what I need.\n---\nI will come back to you shortly.';
    const dU = await retry('queue unedited', () => queueDraft({
        phone: MAIN, body: uneditedBody, source: 'comms_agent', channel: 'whatsapp', dedupe: false,
        reason: '[quote_question] pipeline e2e unedited approval',
    }));
    if (dU) {
        created.drafts.push(dU);
        await ledgerRow('draft', dU);
        const res = await approveAndSendDraft(dU, 'pipeline-e2e@handyservices.com');
        console.log(`  approveAndSendDraft(unedited) → ${res.ok ? 'sent' : (res as any).code}`);
        const row = await ledgerRow('draft', dU, (r) => r.verdict !== 'pending');
        check('an unedited approval is recorded as approved_unedited', row?.verdict === 'approved_unedited', row?.verdict);
        check('edit distance is 0', Number(row?.edit_distance) === 0, String(row?.edit_distance));
        check('the proposal is not duplicated into final_body when nothing changed', row?.final_body === null);
        check('delivery is recorded separately from the verdict', ['sent', 'failed'].includes(String(row?.send_status)), String(row?.send_status));
        check('the approver is recorded', row?.decided_by === 'pipeline-e2e@handyservices.com', row?.decided_by);
        seam('a post-quote capability keeps its identity through approval', row?.capability === 'quote_question', row?.capability);
    }

    // ---- approval, edited. The whole point of the ledger: what Ben changed.
    const proposed = 'Hiya, that price covers both jobs in the one visit.';
    const edited = 'Hi, that price covers both jobs in one visit. Thanks, Ben';
    const dE = await retry('queue edited', () => queueDraft({
        phone: MAIN, body: proposed, source: 'comms_agent', channel: 'whatsapp', dedupe: false,
        reason: '[price_objection] pipeline e2e edited approval',
    }));
    if (dE) {
        created.drafts.push(dE);
        await ledgerRow('draft', dE);
        const patch = await fetch(`${base}/api/drafts/${dE}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: edited }),
        });
        check('the PATCH route accepted Ben\'s edit', patch.ok, String(patch.status));
        await approveAndSendDraft(dE, 'pipeline-e2e@handyservices.com');
        const row = await ledgerRow('draft', dE, (r) => r.verdict !== 'pending');
        check('an edited approval is recorded as approved_edited', row?.verdict === 'approved_edited', row?.verdict);
        check('the agent\'s original wording survived the in-place edit', row?.proposed_body === proposed, row?.proposed_body);
        check('the text as actually sent is stored', row?.final_body === edited);
        check('the edit distance is a real number', Number(row?.edit_distance) > 0, String(row?.edit_distance));
        check('the edit ratio is a sane fraction', Number(row?.edit_ratio) > 0 && Number(row?.edit_ratio) < 1, String(row?.edit_ratio));
        seam('a price_objection keeps its capability through an edited approval', row?.capability === 'price_objection', row?.capability);
    }

    // ---- SEAM C. A superseded draft is not a rejection. The comms agent supersedes its own draft
    // by writing straight to message_drafts (comms.ts queue_draft), which no ledger hook watches —
    // reconcile is the only thing that ever classifies it.
    const dS = await retry('queue supersede', () => queueDraft({
        phone: MAIN, body: 'The first, incomplete half of a reply.', source: 'comms_agent', channel: 'whatsapp', dedupe: false,
        reason: '[rescope_offer] pipeline e2e supersede probe',
    }));
    if (dS) {
        created.drafts.push(dS);
        await ledgerRow('draft', dS);
        // Byte-for-byte what server/agents/comms.ts:414-418 does when the model queues twice in a run.
        await db.update(messageDrafts)
            .set({ status: 'rejected', approvedBy: 'comms_agent:superseded', approvedAt: new Date() })
            .where(eq(messageDrafts.id, dS));
        const before = await ledgerRow('draft', dS);
        seam('a superseded draft is left pending until reconcile runs (no hook watches that path)',
            before?.verdict === 'pending', `verdict before reconcile=${before?.verdict}`);
        await retry('reconcile', () => reconcileOutcomes({ limit: 200 }));
        const after = await ledgerRow('draft', dS, (r) => r.verdict !== 'pending');
        seam('an agent replacing its own draft is classified superseded, NOT rejected',
            after?.verdict === 'superseded', `verdict=${after?.verdict}`);
        check('the superseded row keeps its post-quote capability', after?.capability === 'rescope_offer', after?.capability);
    }

    // ---- an ask_ben raised directly, so the question path is proven even under --no-llm.
    const qId = await retry('ask ben', () => askBen({
        conversationId: CONV_MAIN, phone: MAIN,
        question: 'Customer wants the bathroom split over two visits. Split it?',
        context: 'pipeline e2e', options: ['Yes, split it', 'No, one visit'],
    }));
    if (qId) {
        created.questions.push(qId);
        const row = await ledgerRow('question', qId);
        seam('an ask_ben escalation is captured as a question proposal',
            !!row && row.kind === 'question' && row.capability === 'ask_ben', `capability=${row?.capability}`);
        const ans = await fetch(`${base}/api/agent-questions/${qId}/answer`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: 'Yes, split it' }),
        });
        check('the answer route returned 200', ans.ok, String(ans.status));
        const after = await ledgerRow('question', qId, (r) => r.verdict !== 'pending');
        check('the verdict is answered', after?.verdict === 'answered', after?.verdict);
        check('it recorded that Ben tapped an option the agent offered', after?.meta?.tappedOption === true, JSON.stringify(after?.meta));
    }

    // ---- attribution: a reply after a send belongs to the message that provoked it.
    //
    // The delivery is stood in for rather than relied on. refreshOutcomes only attributes replies to
    // rows with send_status='sent', and a send to an unallocated number is not guaranteed to reach
    // that state — WhatsApp queues it, SMS rejects it outright. The claim under test is the
    // attribution join (DIGITS10, the reply window), not Twilio's opinion of a drama number, so the
    // send is written in the exact shape a successful one leaves behind. Same reasoning, and the
    // same technique, as scripts/_outcome-loop-test.ts.
    if (dU) {
        await db.execute(sql`
            UPDATE agent_outcomes SET
                send_status='sent', sent_at = now() - interval '10 minutes',
                customer_replied_at = NULL, reply_latency_seconds = NULL, outcome_checked_at = NULL
            WHERE kind='draft' AND ref_id=${dU}`);
        const replyId = `pipe2e_reply_${Date.now()}`;
        await db.execute(sql`
            INSERT INTO messages (id, conversation_id, direction, content, channel, created_at)
            VALUES (${replyId}, ${CONV_MAIN}, 'inbound', 'Great, thanks Ben', 'whatsapp', now() - interval '5 minutes')`);
        created.messages.push(replyId);
        await retry('refresh outcomes', () => refreshOutcomes({ limit: 300 }));
        const row = await ledgerRow('draft', dU, (r) => !!r.customer_replied_at);
        check('a customer reply after a send is attributed to the draft', !!row?.customer_replied_at, String(row?.customer_replied_at));
        const lat = Number(row?.reply_latency_seconds);
        check('the reply latency is about five minutes', lat > 240 && lat < 360, `${lat}s`);
    }

    // ---- and none of this may pollute the trust ladder.
    const metrics = await retry('outcome metrics', () => outcomeMetrics({ days: 3650 }));
    const comms = metrics.byAgent.find((a) => a.agent === 'comms');
    check('this suite\'s Ofcom traffic is excluded from the default aggregates', !!comms, `${comms?.proposals} proposals counted`);
    const raw = await retry('outcome metrics raw', () => outcomeMetrics({ days: 3650, includeTest: true }));
    const commsRaw = raw.byAgent.find((a) => a.agent === 'comms');
    check('the same query with includeTest sees more, proving the scrub is real',
        !!commsRaw && !!comms && commsRaw.proposals > comms.proposals, `${comms?.proposals} scrubbed vs ${commsRaw?.proposals} raw`);
    const caps = raw.byCapability.map((c) => c.capability);
    seam('the post-quote capabilities are visible in the per-capability breakdown',
        postQuote.every((i) => caps.includes(i)), `present: ${postQuote.filter((i) => caps.includes(i)).join(', ') || 'none'}`);
    check('no capability was recorded as unknown/empty', raw.byCapability.every((c) => !!c.capability && c.capability !== 'unknown'));
}

async function stage9_board(): Promise<void> {
    stage('9', 'The board reflects reality: SLA clock, funnel stage, unanswered headline');

    // A machine acknowledgement must NOT stop the clock; a human reply must. The thread state is
    // read exactly as the board reads it.
    const now = new Date();
    const inboundAt = new Date(now.getTime() - 30 * 60_000);
    const machineAckAt = new Date(now.getTime() - 29 * 60_000);
    const humanReplyAt = new Date(now.getTime() - 5 * 60_000);

    const machineOnly = computeWaitState(inboundAt, null);
    check('an unanswered inbound leaves the clock running', machineOnly.awaitingReply === true,
        `waiting ${machineOnly.waitingClockHours}h, severity=${machineOnly.severity}`);

    // The board derives "answered" from the last HUMAN-visible outbound. An auto-ack is recorded as
    // an outbound message, so the rule that protects the SLA is the one asserted in
    // _auto-ack-sla-test.ts; here it is re-checked end to end on this suite's own thread.
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, CONV_MAIN));
    const activity = (await loadActivity([CONV_MAIN])).get(CONV_MAIN);
    const card = toCard(conv!, activity);
    check('the funnel stage reached quote_sent and stayed there', card.stage === 'quote_sent', card.stage);
    check('the card carries the WhatsApp window state', typeof card.windowOpen === 'boolean', `windowOpen=${card.windowOpen}`);
    check('the card knows the last inbound', !!card.lastInboundAt, String(card.lastInboundAt));

    const answered = computeWaitState(inboundAt, humanReplyAt);
    check('a human reply after the inbound stops the clock', answered.awaitingReply === false);
    const ackOnly = computeWaitState(inboundAt, machineAckAt);
    check('an outbound AFTER the inbound reads as answered (the auto-ack carve-out is the board\'s job, proven in _auto-ack-sla-test)',
        ackOnly.awaitingReply === false);

    // The unanswered headline: the STOP thread must not be sitting on it.
    const [stopConv] = await db.select().from(conversations).where(eq(conversations.id, CONV_STOP));
    check('a closed opt-out thread is out of the funnel', stopConv?.stage === 'closed', stopConv?.stage);
    const stopCard = toCard(stopConv!, (await loadActivity([CONV_STOP])).get(CONV_STOP));
    check('the opt-out card does not show as an open enquiry', stopCard.stage === 'closed', stopCard.stage);
}

// ---------------------------------------------------------------------------------- main

async function main(): Promise<void> {
    console.log(`\nPIPELINE END-TO-END TEST${NO_LLM ? ' (--no-llm)' : ''}\nOfcom reserved range only: ${MAIN}, ${STOP_PHONE}\n`);

    const savedConfig = await retry('read comms config', getCommsAgentConfig);
    console.log(`config at start: firstContactAutoAck=${JSON.stringify(savedConfig.firstContactAutoAck)} autosend=${JSON.stringify(savedConfig.autosend)}`);

    const app = express();
    app.use(express.json());
    app.use('/api/drafts', messageDraftsRouter);
    app.use('/api/agent-questions', agentQuestionsRouter);
    const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    try {
        // Direct send stays OFF throughout, which is the KILL SWITCH being exercised: under the live
        // config every agent reply in stages 3, 6 and 7 would leave for the customer, and this suite
        // asserts they queue instead. The gate's send-side is proven purely in stage 8, where it
        // costs nothing and reaches nobody. The automatic quote-prep handoff is off too — stage 4
        // drives runQuotePrep directly and a second automatic run would double the model spend.
        // The first-contact ack is switched ON only so stage 1 exercises the real lane.
        // All of it lives in this process's COMMS_CONFIG_OVERRIDE env var only — the shared DB row
        // the deployed agent reads is never written.
        process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
            ...savedConfig,
            autosend: { enabled: false, intents: [] },
            quotePrep: { ...savedConfig.quotePrep, enabled: false },
            firstContactAutoAck: { ...savedConfig.firstContactAutoAck, enabled: true, channels: ['whatsapp', 'sms', 'webform', 'post_call'] },
        });

        // A stage that THROWS is a failure of that stage, not a reason to abandon the journey and
        // lose every stage after it. The model API times out, Neon drops a connection: neither is a
        // reason to leave stages 7-9 unproven, and neither may be swallowed by the exit in `finally`.
        const run = async (fn: () => Promise<unknown>) => {
            try { await fn(); } catch (e: any) {
                const msg = e?.message ?? String(e);
                if (cur) { cur.failed++; cur.notes.push(`THREW ${msg}`); }
                console.error(`FAIL  stage threw: ${msg}`);
                if (e?.stack) console.error(String(e.stack).split('\n').slice(0, 4).join('\n'));
            }
        };

        await run(stage1_inboundLanes);
        await run(stage2_stopShortCircuit);

        // Back off immediately: every stage below drives the agent directly and none of them should
        // be able to auto-acknowledge anything. getCommsAgentConfig reads the env var on every
        // call, so reassigning it here takes effect for the rest of the run.
        process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
            ...savedConfig,
            autosend: { enabled: false, intents: [] },
            quotePrep: { ...savedConfig.quotePrep, enabled: false },
            firstContactAutoAck: { ...savedConfig.firstContactAutoAck, enabled: false },
        });

        await run(stage3_triageWithPhoto);
        await run(stage4_quotePrep);
        await run(stage4b_autoHandoff);
        await run(stage5_quoteSent);
        await run(stage6_priceObjection);
        await run(stage7_theWall);
        await run(() => stage8_ledger(base));
        await run(stage9_board);
    } finally {
        console.log(`\n${'='.repeat(78)}\nCLEANUP\n${'='.repeat(78)}`);
        const del = async (label: string, stmt: any) => {
            try { await db.execute(stmt); } catch (e: any) { console.warn(`  cleanup ${label}: ${e.message}`); }
        };
        for (const id of created.drafts) {
            await del('outcome', sql`DELETE FROM agent_outcomes WHERE kind='draft' AND ref_id = ${id}`);
            await del('draft', sql`DELETE FROM message_drafts WHERE id = ${id}`);
        }
        for (const id of created.questions) {
            await del('outcome', sql`DELETE FROM agent_outcomes WHERE kind='question' AND ref_id = ${id}`);
            await del('question', sql`DELETE FROM agent_questions WHERE id = ${id}`);
        }
        // Anything the agent queued that this script did not learn the id of.
        await del('stray drafts', sql`DELETE FROM agent_outcomes WHERE phone_key IN ('7700900920','7700900921')`);
        await del('stray drafts', sql`DELETE FROM message_drafts WHERE phone IN (${MAIN}, ${STOP_PHONE})`);
        await del('stray questions', sql`DELETE FROM agent_questions WHERE phone IN (${MAIN}, ${STOP_PHONE})`);
        for (const id of created.quotes) await del('quote', sql`DELETE FROM personalized_quotes WHERE id = ${id}`);
        await del('quotes by slug', sql`DELETE FROM personalized_quotes WHERE short_slug IN (${SLUG_SMALL}, ${SLUG_BIG}, 'pe2edrft')`);
        await del('ack log', sql`DELETE FROM first_contact_ack_log WHERE phone IN (${MAIN}, ${STOP_PHONE})`);
        // The opt-out this run created. Deleting it is right ONLY because the number is reserved and
        // the suppression was manufactured by the test; a real one is never removed.
        await del('opt-out', sql`DELETE FROM comms_opt_outs WHERE phone_key = '7700900921'`);
        for (const id of created.conversations) {
            await del('messages', sql`DELETE FROM messages WHERE conversation_id = ${id}`);
            await del('conversation', sql`DELETE FROM conversations WHERE id = ${id}`);
        }
        for (const f of created.mediaFiles) { try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ } }

        // CONFIG: the forced flags only ever lived in this process's env override, so dropping it
        // is the whole restore. The read-back below is the LIVE DB row — a run must never end
        // without proof on screen that it was untouched.
        delete process.env.COMMS_CONFIG_OVERRIDE;
        let restoredOk = false;
        try {
            const readBack = await retry('read back config', getCommsAgentConfig);
            restoredOk = readBack.firstContactAutoAck.enabled === savedConfig.firstContactAutoAck.enabled
                && readBack.autosend.enabled === savedConfig.autosend.enabled
                && readBack.quotePrep.enabled === savedConfig.quotePrep.enabled;
            console.log(`\nLIVE CONFIG READ BACK (override cleared): firstContactAutoAck.enabled=${readBack.firstContactAutoAck.enabled}`
                + ` autosend.enabled(DIRECT SEND)=${readBack.autosend.enabled}`
                + ` quotePrep.enabled=${readBack.quotePrep.enabled}`);
            console.log(restoredOk
                ? 'live config untouched by this run'
                : '*** LIVE CONFIG CHANGED DURING THE RUN — investigate ***');
        } catch (e: any) {
            console.error(`\n*** CONFIG READ-BACK FAILED: ${e?.message} — CHECK the live config BY HAND ***`);
        }
        server.close();

        // ------------------------------------------------------------------ summary
        console.log(`\n${'='.repeat(78)}\nSUMMARY\n${'='.repeat(78)}`);
        let totalPass = 0, totalFail = 0;
        for (const s of stages) {
            totalPass += s.passed; totalFail += s.failed;
            const verdict = s.failed > 0 ? 'FAIL' : s.skipped && s.passed === 0 ? 'SKIP' : 'PASS';
            console.log(`  ${verdict}  stage ${s.n}: ${s.title}  (${s.passed} passed, ${s.failed} failed)`);
            for (const n of s.notes) console.log(`          ${n}`);
        }
        const seams = stages.flatMap((s) => s.notes).filter((n) => n.startsWith('LEAK'));
        console.log(`\n  ${totalPass} passed, ${totalFail} failed across ${stages.length} stages`);
        console.log(`  config restored: ${restoredOk ? 'yes' : 'NO — CHECK BY HAND'}`);
        if (seams.length) {
            console.log(`\n  SEAM LEAKS (${seams.length}):`);
            for (const s of seams) console.log(`    ${s}`);
        }
        console.log(`\n${totalFail === 0 ? 'ALL GREEN' : `${totalFail} FAILURE(S)`}\n`);
        process.exit(totalFail === 0 && restoredOk ? 0 : 1);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
