/**
 * T5: /api/comms-sandbox — type as a customer, watch the desk think, nothing sent.
 *
 * Mounted in server/index.ts behind requireAdmin (NOT dev-only: the owner uses it in production
 * to reproduce the wrong-move shapes by hand and watch the spine handle them). The page is
 * client/src/pages/admin/SandboxPage.tsx; the live feed it watches is the spine's own
 * run_started / run_event / run_finished stream (server/spine/run-events.ts).
 *
 *   GET  /            the sandbox thread as it stands: messages, quote, recent runs
 *   POST /reset       delete everything on the sandbox number and start a clean thread
 *   POST /message     { text } → inbound message on the thread, then runOnce(..., { dryRun, sandbox })
 *                     returns the whole pass (triage, pack, proposal, guards, decision, exit note, cost)
 *   POST /quote       { totalPence?, title? } → a synthetic UNPAID quote on the thread plus the
 *                     "here's your quote" outbound that would have carried it, so the post-quote
 *                     pack and the four quote-dependent wrong-move shapes are reachable
 *
 * HARD SAFETY RULE (the dev board demo's rule, inherited): every read and write here is keyed on
 * the sandbox number (server/spine/sandbox.ts) and NEVER on a conversation id from the client.
 * There is no parameter that names a thread. The thread is created WITHOUT metadata.nextTriageAt,
 * so no scheduled pass can ever pick it up; runOnce itself refuses a sandbox pass on any other
 * number and never reaches the exit. Three layers, each independent — see the brief.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { agentOutcomes, agentQuestions, agentRuns, conversations, messageDrafts, messages, nudgeQueue, personalizedQuotes } from '@shared/schema';
import { runOnce, type RunOnceResult } from './index';
import { SANDBOX_DIGITS, SANDBOX_PHONE_E164, SANDBOX_PHONE_WA, isSandboxPhone } from './sandbox';

export const commsSandboxRouter = Router();

// ---------------------------------------------------------------- pure helpers (tested)

export const SANDBOX_CONTACT_NAME = 'Sandbox customer (not real)';
export const SANDBOX_QUOTE_MARK = 'SANDBOX (synthetic quote, not a customer)';
export const SANDBOX_DEFAULT_TOTAL_PENCE = 48_000;
export const MAX_MESSAGE_CHARS = 2_000;

/** The one line the customer types, checked. Returns the clean text or the refusal. */
export function validateCustomerText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
    if (typeof raw !== 'string') return { ok: false, error: 'text must be a string' };
    const text = raw.replace(/\r\n/g, '\n').trim();
    if (!text) return { ok: false, error: 'text is empty' };
    if (text.length > MAX_MESSAGE_CHARS) return { ok: false, error: `text is over ${MAX_MESSAGE_CHARS} characters` };
    return { ok: true, text };
}

/** A synthetic quote's numbers, checked: a whole number of pence between £1 and £20,000. */
export function validateQuoteSeed(body: unknown): { ok: true; totalPence: number; title: string } | { ok: false; error: string } {
    const b = (body && typeof body === 'object' ? body : {}) as { totalPence?: unknown; title?: unknown };
    const totalPence = b.totalPence === undefined ? SANDBOX_DEFAULT_TOTAL_PENCE : Number(b.totalPence);
    if (!Number.isInteger(totalPence) || totalPence < 100 || totalPence > 2_000_000) return { ok: false, error: 'totalPence must be a whole number of pence between 100 and 2000000' };
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 120) : 'Replace bathroom extractor fan';
    return { ok: true, totalPence, title };
}

/** The slug is 8 chars max on the column; `sbx` marks it at a glance. */
export function sandboxSlug(): string {
    return `sbx${randomUUID().replace(/-/g, '').slice(0, 5)}`;
}

/** What the page shows of a pass: everything the spine decided, none of the case file's bulk. */
export function summariseRun(run: RunOnceResult, cost: { costPence: number | null; model: string | null; turns: number | null } | null) {
    return {
        runId: run.runId,
        agent: run.agent,
        trigger: run.trigger,
        pack: run.pack,
        triage: run.triage,
        proposal: run.proposal ?? null,
        guards: run.guards ?? null,
        decision: run.decision,
        dryRun: run.dryRun ?? true,
        sandbox: run.sandbox ?? true,
        exitNote: run.exitNote ?? null,
        skipped: run.skipped ?? [],
        error: run.error ?? null,
        durationMs: run.durationMs ?? null,
        costPence: cost?.costPence ?? null,
        model: cost?.model ?? null,
        turns: cost?.turns ?? null,
        caseFile: {
            stage: run.caseFile.stage, tags: run.caseFile.tags, quote: run.caseFile.quote ?? null,
            window: run.caseFile.window, openFlags: run.caseFile.openFlags, openPromises: run.caseFile.openPromises,
            timelineItems: run.caseFile.timeline.length,
        },
        benLaneClerk: run.benLaneClerk ?? null,
        routeA: run.routeA ?? null,
    };
}

export type SandboxRunSummary = ReturnType<typeof summariseRun>;

// ---------------------------------------------------------------- the thread, by number only

async function findSandboxConversation() {
    const [row] = await db.select({
        id: conversations.id, phoneNumber: conversations.phoneNumber, stage: conversations.stage, tags: conversations.tags,
        contactName: conversations.contactName, createdAt: conversations.createdAt, metadata: conversations.metadata,
    }).from(conversations).where(eq(conversations.phoneNumber, SANDBOX_PHONE_WA)).orderBy(desc(conversations.createdAt)).limit(1);
    // Belt: the row we found by number IS on the sandbox number. It cannot not be; this is the
    // check that would fire if the constants above ever drifted apart.
    if (row && !isSandboxPhone(row.phoneNumber)) throw new Error('sandbox conversation is not on the sandbox number');
    return row ?? null;
}

async function loadState() {
    const conv = await findSandboxConversation();
    const msgs = conv ? await db.select({
        id: messages.id, direction: messages.direction, content: messages.content, createdAt: messages.createdAt,
        senderName: messages.senderName, channel: messages.channel,
    }).from(messages).where(eq(messages.conversationId, conv.id)).orderBy(messages.createdAt).limit(200) : [];
    const quotes = await db.select({
        id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, jobDescription: personalizedQuotes.jobDescription,
        basePrice: personalizedQuotes.basePrice, expiresAt: personalizedQuotes.expiresAt, createdAt: personalizedQuotes.createdAt,
        depositPaidAt: personalizedQuotes.depositPaidAt, revokedAt: personalizedQuotes.revokedAt,
    }).from(personalizedQuotes)
        .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${SANDBOX_DIGITS}`)
        .orderBy(desc(personalizedQuotes.createdAt)).limit(5);
    const runs = conv ? await db.select({
        id: agentRuns.id, agent: agentRuns.agent, trigger: agentRuns.trigger, decision: agentRuns.decision, lane: agentRuns.lane,
        costPence: agentRuns.costPence, model: agentRuns.model, durationMs: agentRuns.durationMs, error: agentRuns.error,
        startedAt: agentRuns.startedAt, finishedAt: agentRuns.finishedAt, proposal: agentRuns.proposal, parentRunId: agentRuns.parentRunId,
    }).from(agentRuns).where(and(eq(agentRuns.conversationId, conv.id), sql`${agentRuns.parentRunId} IS NULL`))
        .orderBy(desc(agentRuns.startedAt)).limit(20) : [];
    return {
        phone: { e164: SANDBOX_PHONE_E164, wa: SANDBOX_PHONE_WA },
        conversation: conv ? { id: conv.id, stage: conv.stage, tags: conv.tags ?? [], contactName: conv.contactName, createdAt: conv.createdAt, hasTrigger: !!(conv.metadata as any)?.nextTriageAt } : null,
        messages: msgs,
        quote: quotes[0] ?? null,
        runs: runs.map((r) => {
            const p = (r.proposal ?? {}) as any;
            return {
                id: r.id, agent: r.agent, trigger: r.trigger, decision: r.decision, lane: r.lane, costPence: r.costPence, model: r.model,
                durationMs: r.durationMs, error: r.error, startedAt: r.startedAt, finishedAt: r.finishedAt,
                sandbox: p?.sandbox === true, intent: p?.proposal?.intent ?? null, bubbles: Array.isArray(p?.proposal?.body) ? p.proposal.body : [],
            };
        }),
    };
}

async function insertInbound(conversationId: string, content: string): Promise<string> {
    const id = `msg_sbx_${randomUUID().slice(0, 13)}`;
    const now = new Date();
    await db.insert(messages).values({
        id, conversationId, direction: 'inbound', channel: 'whatsapp', content, status: 'received',
        senderName: SANDBOX_CONTACT_NAME, createdAt: now,
    });
    await db.update(conversations).set({
        lastMessageAt: now, lastMessagePreview: content.slice(0, 200), lastCustomerContactAt: now,
        lastInboundAt: now, // channel IS whatsapp, so the 24h window reads as open — as it would live
        unreadCount: sql`coalesce(${conversations.unreadCount}, 0) + 1`, updatedAt: now,
    }).where(eq(conversations.id, conversationId));
    return id;
}

async function insertOutbound(conversationId: string, content: string): Promise<string> {
    const id = `msg_sbx_${randomUUID().slice(0, 13)}`;
    const now = new Date();
    await db.insert(messages).values({
        id, conversationId, direction: 'outbound', channel: 'whatsapp', content, status: 'sent',
        senderName: 'Sandbox (synthetic, never sent)', createdAt: now,
    });
    await db.update(conversations).set({ lastMessageAt: now, lastMessagePreview: content.slice(0, 200), updatedAt: now })
        .where(eq(conversations.id, conversationId));
    return id;
}

/** Everything on the sandbox number, gone. The dev board demo's cleanup, on the sandbox number. */
async function cleanupSandbox(): Promise<{ conversations: number; quotes: number }> {
    const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.phoneNumber, SANDBOX_PHONE_WA));
    const ids = convs.map((c) => c.id);
    if (ids.length) {
        await db.delete(messages).where(inArray(messages.conversationId, ids));
        await db.delete(agentQuestions).where(inArray(agentQuestions.conversationId, ids));
        await db.delete(agentOutcomes).where(inArray(agentOutcomes.conversationId, ids));
        await db.delete(agentRuns).where(inArray(agentRuns.conversationId, ids));
        await db.delete(conversations).where(inArray(conversations.id, ids));
    }
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, SANDBOX_PHONE_E164));
    await db.delete(nudgeQueue).where(eq(nudgeQueue.phone, SANDBOX_PHONE_E164));
    const quotes = await db.delete(personalizedQuotes)
        .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${SANDBOX_DIGITS}`)
        .returning({ id: personalizedQuotes.id });
    return { conversations: ids.length, quotes: quotes.length };
}

async function createSandboxConversation(): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    // Same shape as the dev board demo's new-card, WITHOUT metadata.nextTriageAt: nothing must
    // ever arm the triage ticker on this row.
    await db.insert(conversations).values({
        id, phoneNumber: SANDBOX_PHONE_WA, contactName: SANDBOX_CONTACT_NAME, stage: 'enquiry',
        tags: ['sandbox'], lastMessageAt: now, lastCustomerContactAt: now,
        notes: 'COMMS SANDBOX — a play thread on the Ofcom drama number. Not a customer. Nothing here is ever sent.',
    });
    return id;
}

async function ensureSandboxConversation(): Promise<string> {
    const conv = await findSandboxConversation();
    return conv?.id ?? createSandboxConversation();
}

/** The row's own cost (B2 records it; turns live on the ledger only, so they are not read here). */
async function costOf(runId: string) {
    const [row] = await db.select({ costPence: agentRuns.costPence, model: agentRuns.model })
        .from(agentRuns).where(eq(agentRuns.id, runId));
    return row ? { costPence: row.costPence ?? null, model: row.model ?? null, turns: null } : null;
}

// ---------------------------------------------------------------- routes

commsSandboxRouter.get('/', async (_req, res) => {
    try {
        res.json(await loadState());
    } catch (error: any) {
        console.error('[Sandbox] state failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox state failed' });
    }
});

commsSandboxRouter.post('/reset', async (_req, res) => {
    try {
        const deleted = await cleanupSandbox();
        const conversationId = await createSandboxConversation();
        res.json({ ok: true, deleted, conversationId, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] reset failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox reset failed' });
    }
});

commsSandboxRouter.post('/quote', async (req, res) => {
    try {
        const seed = validateQuoteSeed(req.body);
        if (!seed.ok) { res.status(400).json({ error: seed.error }); return; }
        const conversationId = await ensureSandboxConversation();
        const slug = sandboxSlug();
        const now = new Date();
        await db.insert(personalizedQuotes).values({
            id: `sbx_${randomUUID()}`,
            shortSlug: slug,
            customerName: SANDBOX_CONTACT_NAME,
            phone: SANDBOX_PHONE_E164,
            jobDescription: `${SANDBOX_QUOTE_MARK}: ${seed.title}`,
            basePrice: seed.totalPence,
            pricingLineItems: [{ description: seed.title, pricePence: seed.totalPence, sandbox: true }],
            expiresAt: new Date(now.getTime() + 48 * 3_600_000),
            isDraft: false,
            createdAt: now,
        } as any);
        // The message that would have carried the link (quote-context dates the quote from it).
        const outboundId = await insertOutbound(conversationId, `Hi! Here's your quote for £${(seed.totalPence / 100).toFixed(2)}. Click to view and book: https://www.handyservices.app/q/${slug}`);
        await db.update(conversations).set({ stage: 'quote_sent', updatedAt: new Date() }).where(eq(conversations.id, conversationId));
        res.json({ ok: true, slug, outboundId, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] quote seed failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox quote seed failed' });
    }
});

commsSandboxRouter.post('/message', async (req, res) => {
    try {
        const v = validateCustomerText(req.body?.text);
        if (!v.ok) { res.status(400).json({ error: v.error }); return; }
        const conversationId = await ensureSandboxConversation();
        const messageId = await insertInbound(conversationId, v.text);
        // Layer 1 at the call site AND inside runOnce (sandbox implies dryRun): the exit never runs.
        const run = await runOnce(conversationId, 'inbound_message', undefined, { dryRun: true, sandbox: true });
        const summary = summariseRun(run, await costOf(run.runId));
        res.json({ ok: true, messageId, run: summary, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] message failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox message failed' });
    }
});
