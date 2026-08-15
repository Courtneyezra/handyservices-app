/**
 * Kanban board over WhatsApp conversations.
 *
 * Columns are conversations.stage. The 24-hour window is computed per row at read time rather than
 * read from conversations.can_send_freeform — that column is only refreshed when a conversation is
 * written to, so it goes stale as the window ages out and would show a shut window as open.
 */
import { Router } from 'express';
import { db } from './db';
import { conversations, messages } from '@shared/schema';
import { eq, desc, ne, and, asc, inArray, sql } from 'drizzle-orm';
import { computeWaitState, DEFAULT_SLA_WORKING_HOURS, type WaitState } from './comms-sla';

export const inboxBoardRouter = Router();

/** Column order is the lifecycle order Ben works left-to-right. */
export const BOARD_STAGES = ['new', 'active', 'waiting', 'closed'] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];

const WINDOW_HOURS = 24;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export type BoardCard = {
    id: string;
    phoneNumber: string;
    displayPhone: string;
    contactName: string | null;
    lastMessagePreview: string | null;
    lastMessageAt: string | null;
    lastInboundAt: string | null;
    unreadCount: number;
    stage: string;
    priority: string;
    assignedTo: string | null;
    tags: string[];
    leadId: string | null;
    /** Live 24h window state — freeform is only sendable while this is true. */
    windowOpen: boolean;
    /** ISO timestamp the window shuts, or null when it was never opened. */
    windowExpiresAt: string | null;
    /** Whole hours left in the window; 0 when shut. Drives the countdown pill. */
    windowHoursLeft: number;
    /** Hours since the customer last said anything — the "going cold" signal. */
    hoursSinceLastMessage: number | null;
    /** Channels seen on this thread, e.g. ['whatsapp','sms']. */
    channels: string[];
    /** When the customer last said anything on ANY channel — unlike lastInboundAt, which is
     *  WhatsApp-only and stays null on an SMS-only thread. */
    lastCustomerMessageAt: string | null;
    /** Working-hours SLA state — the primary sort key for "nothing gets missed". */
    wait: WaitState;
};

/** Per-conversation last inbound/outbound and channel mix, for SLA + thread badges. */
type Activity = { lastInbound: Date | null; lastOutbound: Date | null; channels: string[] };

async function loadActivity(conversationIds: string[]): Promise<Map<string, Activity>> {
    const map = new Map<string, Activity>();
    if (conversationIds.length === 0) return map;

    // One grouped pass rather than a query per card — the board renders hundreds of rows.
    // Ids are parameterized via inArray rather than interpolated into the SQL text.
    const rows = await db
        .select({
            conversationId: messages.conversationId,
            lastInbound: sql<string | null>`max(${messages.createdAt}) FILTER (WHERE ${messages.direction} = 'inbound')`,
            lastOutbound: sql<string | null>`max(${messages.createdAt}) FILTER (WHERE ${messages.direction} = 'outbound')`,
            channels: sql<string[]>`array_agg(DISTINCT ${messages.channel})`,
        })
        .from(messages)
        .where(inArray(messages.conversationId, conversationIds))
        .groupBy(messages.conversationId);

    for (const r of rows.map((r) => ({
        conversation_id: r.conversationId,
        last_inbound: r.lastInbound,
        last_outbound: r.lastOutbound,
        channels: r.channels,
    }))) {
        map.set(r.conversation_id, {
            lastInbound: r.last_inbound ? new Date(r.last_inbound) : null,
            lastOutbound: r.last_outbound ? new Date(r.last_outbound) : null,
            channels: (r.channels ?? []).filter(Boolean),
        });
    }
    return map;
}

function toCard(c: typeof conversations.$inferSelect, activity?: Activity): BoardCard {
    const lastInbound = c.lastInboundAt ? new Date(c.lastInboundAt) : null;
    const expiresAt = lastInbound ? new Date(lastInbound.getTime() + WINDOW_HOURS * 3600_000) : null;
    const msLeft = expiresAt ? expiresAt.getTime() - Date.now() : 0;
    const lastMsg = c.lastMessageAt ? new Date(c.lastMessageAt) : null;

    return {
        id: c.id,
        phoneNumber: c.phoneNumber,
        displayPhone: `+${c.phoneNumber.replace('@c.us', '')}`,
        contactName: c.contactName,
        lastMessagePreview: c.lastMessagePreview,
        lastMessageAt: lastMsg ? lastMsg.toISOString() : null,
        lastInboundAt: lastInbound ? lastInbound.toISOString() : null,
        unreadCount: c.unreadCount ?? 0,
        stage: c.stage || 'new',
        priority: c.priority || 'normal',
        assignedTo: c.assignedTo,
        tags: (c.tags as string[] | null) ?? [],
        leadId: c.leadId,
        windowOpen: msLeft > 0,
        windowExpiresAt: expiresAt ? expiresAt.toISOString() : null,
        windowHoursLeft: msLeft > 0 ? Math.floor(msLeft / 3600_000) : 0,
        hoursSinceLastMessage: lastMsg ? Math.floor((Date.now() - lastMsg.getTime()) / 3600_000) : null,
        channels: activity?.channels ?? [],
        lastCustomerMessageAt: (activity?.lastInbound ?? (c.lastCustomerContactAt ? new Date(c.lastCustomerContactAt) : null))?.toISOString() ?? null,
        // Falls back to the conversation's own timestamps when per-message activity wasn't loaded
        // (e.g. the single-card responses from PATCH), so the shape is always complete.
        wait: computeWaitState(
            activity?.lastInbound ?? (c.lastCustomerContactAt ? new Date(c.lastCustomerContactAt) : null),
            activity?.lastOutbound ?? null,
            DEFAULT_SLA_WORKING_HOURS
        ),
    };
}

// GET /api/inbox/board — every non-archived conversation, grouped into columns.
inboxBoardRouter.get('/board', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 300, 1000);

        const rows = await db.select().from(conversations)
            .where(ne(conversations.status, 'archived'))
            .orderBy(desc(conversations.lastMessageAt))
            .limit(limit);

        const activity = await loadActivity(rows.map((r) => r.id));
        const cards = rows.map((r) => toCard(r, activity.get(r.id)));

        // Seed every column so the board renders its full shape even when a stage is empty.
        const columns: Record<string, BoardCard[]> = Object.fromEntries(
            BOARD_STAGES.map((s) => [s, [] as BoardCard[]])
        );
        for (const card of cards) {
            (columns[card.stage] ??= []).push(card);
        }

        // Ordering within a column, and the reasoning behind it:
        //
        //   breached  -> FRESHEST first. Every breach here is currently months old (inbound capture
        //                was dead Apr-Aug and outbound was broken, so nobody could reply). Sorting
        //                these oldest-first would put a dead two-month-old enquiry above yesterday's
        //                live one. Among conversations that are already late, the recent enquiry is
        //                the one still worth money.
        //   due / ok  -> LONGEST-waiting first, so they get answered before they become breaches.
        //
        const SEVERITY_RANK: Record<string, number> = { breached: 0, due: 1, ok: 2, none: 3 };
        for (const stage of Object.keys(columns)) {
            columns[stage].sort((a, b) => {
                const rank = SEVERITY_RANK[a.wait.severity] - SEVERITY_RANK[b.wait.severity];
                if (rank !== 0) return rank;

                if (a.wait.severity === 'breached') {
                    return new Date(b.lastCustomerMessageAt || b.lastMessageAt || 0).getTime()
                         - new Date(a.lastCustomerMessageAt || a.lastMessageAt || 0).getTime();
                }
                if (a.wait.awaitingReply && b.wait.awaitingReply) {
                    return b.wait.waitingWorkingHours - a.wait.waitingWorkingHours;
                }
                return new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime();
            });
        }

        res.json({
            stages: BOARD_STAGES,
            columns,
            slaWorkingHours: DEFAULT_SLA_WORKING_HOURS,
            totals: {
                conversations: cards.length,
                unread: cards.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0),
                windowsOpen: cards.filter((c) => c.windowOpen).length,
                // Open window + nothing sent back yet = the queue that decays if ignored.
                closingSoon: cards.filter((c) => c.windowOpen && c.windowHoursLeft < 6).length,
                // The headline number for this platform: people we have not answered.
                awaitingReply: cards.filter((c) => c.wait.awaitingReply).length,
                breached: cards.filter((c) => c.wait.breached).length,
            },
        });
    } catch (error: any) {
        console.error('[InboxBoard] Failed to build board:', error);
        res.status(500).json({ error: 'Failed to load board' });
    }
});

// PATCH /api/inbox/conversations/:id — move a card, or change who owns it.
inboxBoardRouter.patch('/conversations/:id', async (req, res) => {
    try {
        const { stage, priority, assignedTo, tags, notes, status } = req.body || {};
        const patch: Record<string, unknown> = { updatedAt: new Date() };

        if (stage !== undefined) {
            if (!BOARD_STAGES.includes(stage)) {
                return res.status(400).json({ error: `Invalid stage '${stage}'`, valid: BOARD_STAGES });
            }
            patch.stage = stage;
        }
        if (priority !== undefined) {
            if (!PRIORITIES.includes(priority)) {
                return res.status(400).json({ error: `Invalid priority '${priority}'`, valid: PRIORITIES });
            }
            patch.priority = priority;
        }
        if (assignedTo !== undefined) patch.assignedTo = assignedTo || null;
        if (tags !== undefined) patch.tags = Array.isArray(tags) ? tags : [];
        if (notes !== undefined) patch.notes = notes;
        if (status !== undefined) {
            patch.status = status;
            if (status === 'archived') patch.archivedAt = new Date();
        }

        const [updated] = await db.update(conversations)
            .set(patch)
            .where(eq(conversations.id, req.params.id))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Conversation not found' });
        res.json({ card: toCard(updated) });
    } catch (error: any) {
        console.error('[InboxBoard] Update failed:', error);
        res.status(500).json({ error: 'Failed to update conversation' });
    }
});

// GET /api/inbox/conversations/:id/thread — the unified timeline for one person.
//
// Newest-last so it reads like a chat. Limited because the messages table contains ~58k phantom
// rows written by a runaway loop in Feb-Mar 2026 (never sent — Twilio's own usage records show
// ~171 messages for that period), and an unbounded thread query on those conversations would
// return tens of thousands of rows.
inboxBoardRouter.get('/conversations/:id/thread', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 200, 500);

        const [conv] = await db.select().from(conversations).where(eq(conversations.id, req.params.id));
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        // Take the most recent N, then flip so the UI renders oldest-first.
        const recent = await db.select().from(messages)
            .where(eq(messages.conversationId, conv.id))
            .orderBy(desc(messages.createdAt))
            .limit(limit);

        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
            .from(messages)
            .where(eq(messages.conversationId, conv.id));

        const activity = await loadActivity([conv.id]);

        res.json({
            card: toCard(conv, activity.get(conv.id)),
            totalMessages: total,
            truncated: total > recent.length,
            messages: recent.reverse().map((m) => ({
                id: m.id,
                direction: m.direction,
                channel: m.channel,
                content: m.content,
                type: m.type,
                status: m.status,
                errorCode: m.errorCode,
                mediaUrl: m.mediaUrl,
                mediaType: m.mediaType,
                senderName: m.senderName,
                createdAt: m.createdAt,
            })),
        });
    } catch (error: any) {
        console.error('[InboxBoard] Thread load failed:', error);
        res.status(500).json({ error: 'Failed to load thread' });
    }
});

// POST /api/inbox/conversations/:id/read — clear the unread badge.
inboxBoardRouter.post('/conversations/:id/read', async (req, res) => {
    try {
        const [updated] = await db.update(conversations)
            .set({ unreadCount: 0, readAt: new Date(), updatedAt: new Date() })
            .where(eq(conversations.id, req.params.id))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Conversation not found' });
        res.json({ card: toCard(updated) });
    } catch (error: any) {
        console.error('[InboxBoard] Mark read failed:', error);
        res.status(500).json({ error: 'Failed to mark read' });
    }
});
