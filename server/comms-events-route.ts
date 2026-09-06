/**
 * GET /api/comms/events — the SSE view over the in-process comms event bus.
 *
 * Replaces CommsPage's aggressive polling (board every 30s, drafts every 15s) with server
 * push. The stream is a VIEW, never the source of truth: the client refetches a snapshot on
 * connect/reconnect and treats each event purely as a cache-invalidation hint, so a dropped
 * event costs freshness, not correctness.
 *
 * Auth is the SAME requireAdmin session check as /api/drafts. One accommodation: the browser
 * EventSource API cannot set request headers, so this route also accepts the session token as
 * `?token=` and copies it into the Authorization header BEFORE requireAdmin runs — the
 * verification itself is unchanged and header auth (curl) still works.
 *
 * Registered in server/index.ts ABOVE the `/api/comms` mount (whose mount-level requireAdmin
 * would otherwise 401 the query-token request before it ever reached this shim) and therefore
 * well before the SPA catch-all.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAdmin } from './auth';
import { emitCommsEvent, onCommsEvent } from './comms-events';

export const commsEventsRouter = Router();

/** EventSource cannot set headers — lift `?token=` into the header requireAdmin reads. */
function tokenFromQuery(req: Request, _res: Response, next: NextFunction): void {
    if (!req.headers.authorization && typeof req.query.token === 'string' && req.query.token) {
        req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
}

const HEARTBEAT_MS = 25_000;

commsEventsRouter.get('/api/comms/events', tokenFromQuery, requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // A first comment so the client's `open` fires with bytes on the wire immediately.
    res.write(': connected\n\n');

    const unsubscribe = onCommsEvent((evt) => {
        try {
            res.write(`data: ${JSON.stringify(evt)}\n\n`);
        } catch (error: any) {
            // A broken pipe mid-write must never reach the emitter's caller.
            console.warn('[CommsEvents] SSE write failed:', error?.message);
        }
    });

    const heartbeat = setInterval(() => {
        try {
            res.write(': ping\n\n');
        } catch { /* close handler below does the cleanup */ }
    }, HEARTBEAT_MS);

    req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
});

// ---------------------------------------------------------------------------------------------
// Dev-only board-animation demo (kept on purpose, T5 6 Sep 2026: it is still the only way to
// review the board animation without a real customer; the canned run replay that used to sit
// beside it is gone — real spine runs now drive the LiveRunPanel, and the comms sandbox at
// /admin/sandbox is the place to watch one). A bare board_delta only makes the client refetch —
// for a card to visibly appear/move/re-badge the DB row must actually change first, and the emit
// must happen IN-PROCESS (a script's bus is not the server's bus). So each action mutates the
// DEMO conversation and then emits the matching event.
//
// HARD SAFETY RULE: every action operates ONLY on the conversation whose phone_number is the
// Ofcom drama number below (no real subscriber). An arbitrary conversation id is never accepted
// for mutation. The demo conversation is created WITHOUT metadata.nextTriageAt, so no real agent
// run ever fires on it. The comms sandbox (server/spine/sandbox.ts) uses the NEXT number in the
// range, …942, so this demo's cleanup and a sandbox session can never touch each other's thread.
if (process.env.NODE_ENV !== 'production') {
    //
    //   POST /api/comms/events/dev-board-demo?action=<action>&token=<admin>
    //     action=new-card                                  create demo conv + inbound msg → board_delta:inbound
    //     action=move-stage&stage=enquiry|scoping|quote_sent  move the card              → board_delta:stage
    //     action=set-tags&tags=a,b[&priority=low|normal|high|urgent]                     → board_delta:tags
    //     action=new-message                               one more inbound msg          → board_delta:inbound
    //     action=cleanup                                   delete everything for the number → board_delta:other
    const DEMO_PHONE_WA = '447700900941@c.us';
    const DEMO_PHONE_E164 = '+447700900941';
    const DEMO_STAGES = ['enquiry', 'scoping', 'quote_sent'] as const;
    const DEMO_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
    const DEMO_MESSAGES = [
        'Hi, do you fit bathroom extractor fans? Just checking that is something you cover before I send photos.',
        'Here are the photos — the old fan is a 100mm ceiling unit venting into the loft.',
        'Also while you are here, could you look at the sealant round the bath? It has gone black in the corners.',
        'What is the earliest you could come out? Tenant moves in a week on Friday.',
        'Great, that works for us. Please go ahead and book it in.',
    ];

    commsEventsRouter.post('/api/comms/events/dev-board-demo', tokenFromQuery, requireAdmin, async (req, res) => {
        try {
            const { db } = await import('./db');
            const { conversations, messages, messageDrafts, agentQuestions, agentOutcomes, nudgeQueue } = await import('@shared/schema');
            const { eq, sql } = await import('drizzle-orm');
            const { randomUUID } = await import('node:crypto');

            const action = String(req.query.action ?? '');
            const now = new Date();
            const at = now.toISOString();

            // The ONLY row this route will ever mutate: looked up by the drama number, never by id.
            const [demo] = await db.select({ id: conversations.id, stage: conversations.stage })
                .from(conversations).where(eq(conversations.phoneNumber, DEMO_PHONE_WA));

            const insertInbound = async (conversationId: string, content: string) => {
                await db.insert(messages).values({
                    id: `msg_demo_${randomUUID().slice(0, 13)}`,
                    conversationId,
                    direction: 'inbound',
                    channel: 'whatsapp',
                    content,
                    status: 'received',
                    senderName: 'Board Anim Demo',
                    createdAt: new Date(),
                });
                await db.update(conversations).set({
                    lastMessageAt: new Date(),
                    lastMessagePreview: content,
                    lastCustomerContactAt: new Date(),
                    lastInboundAt: new Date(), // channel IS whatsapp, so the 24h-window pill is honest
                    unreadCount: sql`coalesce(${conversations.unreadCount}, 0) + 1`,
                    updatedAt: new Date(),
                }).where(eq(conversations.id, conversationId));
            };

            switch (action) {
                case 'new-card': {
                    if (demo) { res.status(409).json({ error: 'demo conversation already exists — run action=cleanup first', conversationId: demo.id }); return; }
                    const convId = randomUUID();
                    // Same shape as _demo-live-run-panel.ts setup, WITHOUT metadata.nextTriageAt —
                    // nothing must arm the triage ticker on this row.
                    await db.insert(conversations).values({
                        id: convId,
                        phoneNumber: DEMO_PHONE_WA,
                        contactName: 'Board Anim Demo',
                        stage: 'enquiry',
                        lastMessageAt: now,
                        lastCustomerContactAt: now,
                    });
                    await insertInbound(convId, DEMO_MESSAGES[0]);
                    emitCommsEvent({ type: 'board_delta', conversationId: convId, reason: 'inbound', at });
                    res.json({ ok: true, action, conversationId: convId });
                    return;
                }
                case 'move-stage': {
                    if (!demo) { res.status(404).json({ error: 'demo conversation not found — run action=new-card first' }); return; }
                    const stage = String(req.query.stage ?? '');
                    if (!(DEMO_STAGES as readonly string[]).includes(stage)) {
                        res.status(400).json({ error: `stage must be one of ${DEMO_STAGES.join('|')}` }); return;
                    }
                    await db.update(conversations).set({ stage, updatedAt: now })
                        .where(eq(conversations.id, demo.id));
                    emitCommsEvent({ type: 'board_delta', conversationId: demo.id, reason: 'stage', at });
                    res.json({ ok: true, action, conversationId: demo.id, stage, previousStage: demo.stage });
                    return;
                }
                case 'set-tags': {
                    if (!demo) { res.status(404).json({ error: 'demo conversation not found — run action=new-card first' }); return; }
                    const tags = String(req.query.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
                    const patch: Record<string, unknown> = { tags, updatedAt: now };
                    const priority = req.query.priority;
                    if (typeof priority === 'string' && priority) {
                        if (!(DEMO_PRIORITIES as readonly string[]).includes(priority)) {
                            res.status(400).json({ error: `priority must be one of ${DEMO_PRIORITIES.join('|')}` }); return;
                        }
                        patch.priority = priority;
                    }
                    await db.update(conversations).set(patch).where(eq(conversations.id, demo.id));
                    emitCommsEvent({ type: 'board_delta', conversationId: demo.id, reason: 'tags', at });
                    res.json({ ok: true, action, conversationId: demo.id, tags, ...(patch.priority ? { priority: patch.priority } : {}) });
                    return;
                }
                case 'new-message': {
                    if (!demo) { res.status(404).json({ error: 'demo conversation not found — run action=new-card first' }); return; }
                    // Vary the text: pick by how many demo messages already exist, wrap past the end.
                    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
                        .from(messages).where(eq(messages.conversationId, demo.id));
                    const content = DEMO_MESSAGES[n % DEMO_MESSAGES.length];
                    await insertInbound(demo.id, content);
                    emitCommsEvent({ type: 'board_delta', conversationId: demo.id, reason: 'inbound', at });
                    res.json({ ok: true, action, conversationId: demo.id, content });
                    return;
                }
                case 'cleanup': {
                    // Same pattern as _demo-live-run-panel.ts cleanup: everything for the drama number.
                    const convs = await db.select({ id: conversations.id })
                        .from(conversations).where(eq(conversations.phoneNumber, DEMO_PHONE_WA));
                    for (const c of convs) {
                        await db.delete(messages).where(eq(messages.conversationId, c.id));
                        await db.delete(agentQuestions).where(eq(agentQuestions.conversationId, c.id));
                        await db.delete(agentOutcomes).where(eq(agentOutcomes.conversationId, c.id));
                        await db.delete(conversations).where(eq(conversations.id, c.id));
                    }
                    await db.delete(messageDrafts).where(eq(messageDrafts.phone, DEMO_PHONE_E164));
                    await db.delete(nudgeQueue).where(eq(nudgeQueue.phone, DEMO_PHONE_E164));
                    // 'other' so the board refetches and watches the card leave.
                    for (const c of convs) emitCommsEvent({ type: 'board_delta', conversationId: c.id, reason: 'other', at });
                    res.json({ ok: true, action, deletedConversations: convs.length });
                    return;
                }
                default:
                    res.status(400).json({ error: 'action must be one of new-card|move-stage|set-tags|new-message|cleanup' });
            }
        } catch (error: any) {
            console.error('[CommsEvents] dev-board-demo failed:', error);
            res.status(500).json({ error: error?.message ?? 'dev-board-demo failed' });
        }
    });
}
