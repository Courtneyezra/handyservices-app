/**
 * Kanban board over WhatsApp conversations.
 *
 * Columns are conversations.stage. The 24-hour window is computed per row at read time rather than
 * read from conversations.can_send_freeform — that column is only refreshed when a conversation is
 * written to, so it goes stale as the window ages out and would show a shut window as open.
 */
import { Router } from 'express';
import { db } from './db';
import { conversations, messages, calls, messageDrafts, agentQuestions, nudgeQueue, personalizedQuotes } from '@shared/schema';
import { eq, desc, ne, and, asc, inArray, isNull, sql, gt } from 'drizzle-orm';
import { computeWaitState, DEFAULT_SLA_WORKING_HOURS, type WaitState } from './comms-sla';
import { callMessageId, classificationLine, readCallClassification } from './call-thread';
import { neverSentMeta } from './message-quarantine';
import {
    loadAutoAckSends, autoAckSpansByConversation, insideAnyAutoAckSpan, notWrittenByAnyAutoAck,
    type AutoAckSend,
} from './auto-ack-window';

export const inboxBoardRouter = Router();

/** Column order is the FUNNEL order Ben works left-to-right: enquiry → scoping → quote_sent → won.
 *  closed is the graveyard. See server/conversation-stage.ts for the transition rules. */
export const BOARD_STAGES = ['enquiry', 'scoping', 'quote_sent', 'won', 'closed'] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];

/**
 * Rows written by pre-funnel code (old deploys, old seeds) still carry the conversation-mechanics
 * vocabulary. Normalize at read time so the board never renders a phantom column: 'waiting' meant
 * "ball in their court", which is quote_sent when a quote actually went out, otherwise scoping.
 */
function normalizeStage(stage: string | null, tags: string[]): string {
    switch (stage) {
        case 'new': return 'enquiry';
        case 'active': return 'scoping';
        case 'waiting': return tags.includes('quote_sent') ? 'quote_sent' : 'scoping';
        case null: case '': return 'enquiry';
        default: return stage as string;
    }
}

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
    /**
     * The channel the CUSTOMER last used inbound, or null if they have never messaged.
     *
     * This is what the composer defaults to: replying by WhatsApp to someone who has only ever
     * texted us is how a reply ends up at a number that is not on WhatsApp. `channels` cannot
     * answer this — it is a set, with no order and no direction.
     */
    lastInboundChannel: string | null;
    /** When the customer last said anything on ANY channel — unlike lastInboundAt, which is
     *  WhatsApp-only and stays null on an SMS-only thread. */
    lastCustomerMessageAt: string | null;
    /** Working-hours SLA state — the primary sort key for "nothing gets missed". */
    wait: WaitState;

    // ── Derived agent-era fields (read-only, no DDL) ─────────────────────────
    // The agent replies to customers itself now, so the board's real question is no longer
    // "which card do I work next" but "whose move is it". Everything below is derived at read
    // time from tables the agents already write.
    /** Who owes the next action on this thread. */
    whoseMove: 'ben' | 'agent' | 'customer';
    /** whoseMove === 'ben' — the pinned strip filters on this. */
    bensDesk: boolean;
    /** True when the newest (non-quarantined, non-auto-ack) message in the thread is outbound. */
    lastMessageOutbound: boolean;
    /** The quote-prep clerk's verdict, from conversations.metadata.quotePrepIntake. */
    intakeReadiness: 'quote_ready' | 'needs_info' | 'visit_first' | null;
    /** Open agent_questions rows for this conversation. */
    openQuestionCount: number;
    /** Options length on the newest open question — "answer in {n} taps". */
    openQuestionOptions: number;
    /** Pending comms_agent message_drafts held for Ben's approval (phone match). */
    heldDraftCount: number;
    /** Nearest FUTURE proposed follow-up in nudge_queue for this number (ISO), or null. */
    recontactDate: string | null;
    /** £ value of the newest live (not draft, not revoked) quote for this number. */
    quoteValueGBP: number | null;
    /** view_count on that same quote. */
    quoteViewCount: number | null;
    /** Enquiry with a customer message >15 min old and no reply after it — the agent-health alarm. */
    agentDown: boolean;
    /** Urgent priority AND Ben's move — rendered angrier than a normal Ben card. */
    complaint: boolean;
    /** Tag callback_due — a promised (or interrupted) call not yet rung back. Ben's move. */
    callbackDue: boolean;
};

/** Per-conversation batch-derived agent signals. All zeros/nulls when not loaded. */
export type CardDerived = {
    openQuestionCount: number;
    openQuestionOptions: number;
    heldDraftCount: number;
    recontactDate: string | null;
    quoteValueGBP: number | null;
    quoteViewCount: number | null;
};

const EMPTY_DERIVED: CardDerived = {
    openQuestionCount: 0,
    openQuestionOptions: 0,
    heldDraftCount: 0,
    recontactDate: null,
    quoteValueGBP: null,
    quoteViewCount: null,
};

/** Last 10 digits of any phone spelling — the same normalisation the agents use
 *  (server/agents/recovery.ts DIGITS10), so '+447...' and '447...@c.us' meet in the middle. */
function digits10(phone: string | null | undefined): string {
    return (phone ?? '').replace('@c.us', '').replace(/\D/g, '').slice(-10);
}

/**
 * Batch-loads the agent-era signals for a set of board rows. Four grouped queries total,
 * whatever the board size — never a query per card.
 */
export async function loadCardDerived(
    rows: Array<{ id: string; phoneNumber: string }>,
): Promise<Map<string, CardDerived>> {
    const map = new Map<string, CardDerived>();
    if (rows.length === 0) return map;

    const conversationIds = rows.map((r) => r.id);
    const phoneKeys = [...new Set(rows.map((r) => digits10(r.phoneNumber)).filter(Boolean))];

    // 1. Held replies: pending comms_agent drafts, keyed by digits. The pending set is tiny
    //    (it is Ben's approval queue), so fetch it whole and bucket in JS.
    const heldByPhone = new Map<string, number>();
    const draftRows = await db.select({ phone: messageDrafts.phone })
        .from(messageDrafts)
        .where(and(eq(messageDrafts.status, 'pending'), eq(messageDrafts.source, 'comms_agent')));
    for (const d of draftRows) {
        const key = digits10(d.phone);
        if (key) heldByPhone.set(key, (heldByPhone.get(key) ?? 0) + 1);
    }

    // 2. Open ask-Ben questions, by conversation. Newest first so the first row seen per
    //    conversation is the one whose options count the card shows.
    const questionByConv = new Map<string, { count: number; options: number }>();
    const questionRows = await db.select({
        conversationId: agentQuestions.conversationId,
        options: agentQuestions.options,
    })
        .from(agentQuestions)
        .where(and(eq(agentQuestions.status, 'open'), inArray(agentQuestions.conversationId, conversationIds)))
        .orderBy(desc(agentQuestions.createdAt));
    for (const q of questionRows) {
        const cur = questionByConv.get(q.conversationId);
        if (cur) { cur.count += 1; continue; }
        questionByConv.set(q.conversationId, {
            count: 1,
            options: Array.isArray(q.options) ? (q.options as unknown[]).length : 0,
        });
    }

    // 3. Nearest future follow-up. Only rows with a future send_after count — a recontact IS a
    //    date, and the recovery agent's undated nudges are chase drafts, not appointments to
    //    come back. 'proposed' and 'approved' both qualify (Ben approving does not unbook the
    //    date); sent/dismissed/skipped rows are history.
    const recontactByPhone = new Map<string, string>();
    const nudgeRows = await db.select({ phone: nudgeQueue.phone, sendAfter: nudgeQueue.sendAfter })
        .from(nudgeQueue)
        .where(and(
            inArray(nudgeQueue.status, ['proposed', 'approved']),
            gt(nudgeQueue.sendAfter, new Date()),
        ))
        .orderBy(asc(nudgeQueue.sendAfter));
    for (const n of nudgeRows) {
        const key = digits10(n.phone);
        if (!key || !n.sendAfter || recontactByPhone.has(key)) continue; // ordered asc — first is nearest
        recontactByPhone.set(key, n.sendAfter.toISOString());
    }

    // 4. Newest live quote per number, one batched query for every board phone. Live means the
    //    customer could act on it: never a draft (they have never seen one) and never revoked
    //    (Ben withdrew that price). Paid quotes stay — a won card still wants its value shown.
    const quoteByPhone = new Map<string, { valueGBP: number | null; viewCount: number | null }>();
    const quoteDigits = sql<string>`right(regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g'), 10)`;
    const quoteRows = await db.select({
        digits: quoteDigits,
        valuePence: sql<number | null>`coalesce(${personalizedQuotes.selectedTierPricePence}, ${personalizedQuotes.basePrice})`,
        viewCount: personalizedQuotes.viewCount,
    })
        .from(personalizedQuotes)
        .where(and(
            inArray(quoteDigits, phoneKeys),
            sql`${personalizedQuotes.isDraft} IS NOT TRUE`,
            isNull(personalizedQuotes.revokedAt),
        ))
        .orderBy(desc(personalizedQuotes.createdAt));
    for (const q of quoteRows) {
        if (!q.digits || quoteByPhone.has(q.digits)) continue; // ordered newest-first
        quoteByPhone.set(q.digits, {
            valueGBP: q.valuePence != null ? Math.round(Number(q.valuePence) / 100) : null,
            viewCount: q.viewCount ?? null,
        });
    }

    for (const r of rows) {
        const key = digits10(r.phoneNumber);
        const question = questionByConv.get(r.id);
        const quote = key ? quoteByPhone.get(key) : undefined;
        map.set(r.id, {
            openQuestionCount: question?.count ?? 0,
            openQuestionOptions: question?.options ?? 0,
            heldDraftCount: key ? (heldByPhone.get(key) ?? 0) : 0,
            recontactDate: key ? (recontactByPhone.get(key) ?? null) : null,
            quoteValueGBP: quote?.valueGBP ?? null,
            quoteViewCount: quote?.viewCount ?? null,
        });
    }
    return map;
}

/** Per-conversation last inbound/outbound and channel mix, for SLA + thread badges. */
export type Activity = {
    lastInbound: Date | null;
    lastOutbound: Date | null;
    channels: string[];
    /** Channel of the most recent inbound message — the composer's default reply channel. */
    lastInboundChannel: string | null;
};

// Exported for the comms agent's SLA sweep, which needs the same wait-state inputs the board uses.
export async function loadActivity(conversationIds: string[]): Promise<Map<string, Activity>> {
    const map = new Map<string, Activity>();
    if (conversationIds.length === 0) return map;

    // One grouped pass rather than a query per card — the board renders hundreds of rows.
    // Ids are parameterized via inArray rather than interpolated into the SQL text.
    //
    // lastOutbound SKIPS QUARANTINED ROWS. 58,216 outbound rows written Feb-Aug 2026 never reached
    // anyone (server/message-quarantine.ts), and counting them here is what made 71 threads read as
    // ANSWERED when the customer had never been replied to. A message nobody received is not a
    // reply, so as far as this clock is concerned it does not exist. The thread view still shows
    // every one of them — see the /thread handler below.
    const rows = await db
        .select({
            conversationId: messages.conversationId,
            lastInbound: sql<string | null>`max(${messages.createdAt}) FILTER (WHERE ${messages.direction} = 'inbound')`,
            lastOutbound: sql<string | null>`max(${messages.createdAt})
                FILTER (WHERE ${messages.direction} = 'outbound' AND ${messages.quarantinedAt} IS NULL)`,
            channels: sql<string[]>`array_agg(DISTINCT ${messages.channel})`,
            // The channel attached to the newest inbound row. Same grouped pass — no extra query.
            lastInboundChannel: sql<string | null>`(array_agg(${messages.channel} ORDER BY ${messages.createdAt} DESC)
                FILTER (WHERE ${messages.direction} = 'inbound'))[1]`,
        })
        .from(messages)
        .where(inArray(messages.conversationId, conversationIds))
        .groupBy(messages.conversationId);

    for (const r of rows) {
        map.set(r.conversationId, {
            lastInbound: r.lastInbound ? new Date(r.lastInbound) : null,
            lastOutbound: r.lastOutbound ? new Date(r.lastOutbound) : null,
            channels: (r.channels ?? []).filter(Boolean),
            lastInboundChannel: r.lastInboundChannel ?? null,
        });
    }

    // AN AUTO-ACKNOWLEDGEMENT IS NOT A REPLY. See server/auto-ack-window.ts for the whole argument
    // and for why the discriminator is the message_drafts pair rather than the audit log or the
    // Twilio sid. Same shape as the quarantine rule above: nothing is mutated, the messages stay in
    // the thread, they just stop counting as an answer.
    //
    // Deliberately a second pass rather than one clever query. Auto-acks are rare, so the common
    // case costs one small indexed read and nothing else, and the correction only touches the
    // threads whose NEWEST outbound is actually a machine receipt.
    await excludeAutoAcksFromLastOutbound(conversationIds, map);
    return map;
}

/**
 * Re-derives `lastOutbound` for any thread whose newest outbound turns out to be the machine's own
 * acknowledgement. Best-effort by design: if this cannot run, the board is merely as wrong as it
 * was before, never broken.
 */
async function excludeAutoAcksFromLastOutbound(
    conversationIds: string[],
    map: Map<string, Activity>,
): Promise<void> {
    try {
        const sends: AutoAckSend[] = await loadAutoAckSends();
        if (!sends.length) return;

        const spansByConversation = await autoAckSpansByConversation(conversationIds, sends);
        if (!spansByConversation.size) return;

        for (const [conversationId, spans] of spansByConversation) {
            const activity = map.get(conversationId);
            if (!activity?.lastOutbound) continue;
            // Only threads whose LATEST outbound is an ack can be reading as answered because of
            // one. Everything else already has a real reply on top and needs no correction.
            if (!insideAnyAutoAckSpan(activity.lastOutbound, spans)) continue;

            const [row] = await db
                .select({
                    lastOutbound: sql<string | null>`max(${messages.createdAt})`,
                })
                .from(messages)
                .where(and(
                    eq(messages.conversationId, conversationId),
                    eq(messages.direction, 'outbound'),
                    isNull(messages.quarantinedAt),
                    notWrittenByAnyAutoAck(messages.createdAt, spans.map((s) => s.draftId)),
                ));

            activity.lastOutbound = row?.lastOutbound ? new Date(row.lastOutbound) : null;
        }
    } catch (error: any) {
        console.warn('[InboxBoard] Auto-ack exclusion failed, SLA falls back to raw outbound:', error?.message);
    }
}

// Exported so a test can assert on the SAME object the board counts, rather than on a
// reimplementation of it — the Unanswered headline is literally cards.filter(c => c.wait.awaitingReply).
export function toCard(
    c: typeof conversations.$inferSelect,
    activity?: Activity,
    derived?: CardDerived,
): BoardCard {
    const lastInbound = c.lastInboundAt ? new Date(c.lastInboundAt) : null;
    const expiresAt = lastInbound ? new Date(lastInbound.getTime() + WINDOW_HOURS * 3600_000) : null;
    const msLeft = expiresAt ? expiresAt.getTime() - Date.now() : 0;
    const lastMsg = c.lastMessageAt ? new Date(c.lastMessageAt) : null;
    const tags = (c.tags as string[] | null) ?? [];
    const stage = normalizeStage(c.stage, tags);
    const d = derived ?? EMPTY_DERIVED;

    // Whose move is it? 'ben' when anything is parked on his desk (the needs_ben tag, an open
    // ask-Ben question, or a held reply); 'customer' when the newest message is ours (the ball is
    // with them); 'agent' otherwise — the customer spoke last and the agent owes a reply.
    //
    // "Newest message" uses the same corrected clocks the SLA does (quarantined rows and auto-acks
    // do not count as us replying). Falls back to the conversation's own timestamps when
    // per-message activity wasn't loaded (single-card PATCH responses): lastMessageAt newer than
    // the customer's own last contact means the newest thing on the thread went out from us.
    const lastCustomerAt = activity?.lastInbound
        ?? (c.lastCustomerContactAt ? new Date(c.lastCustomerContactAt) : null);
    const lastMessageOutbound = activity
        ? !!activity.lastOutbound && (!activity.lastInbound || activity.lastOutbound > activity.lastInbound)
        : !!lastMsg && (!lastCustomerAt || lastMsg.getTime() > lastCustomerAt.getTime() + 1000);
    // callback_due is a Ben condition in its own right: the classifier heard a promised (or
    // interrupted) call, and the only person who can ring someone back is a person. The tag is
    // cleared by the outbound call itself (server/call-thread.ts) or by the sweep's fallback.
    const callbackDue = tags.includes('callback_due');
    const needsBen = tags.includes('needs_ben') || callbackDue || d.openQuestionCount > 0 || d.heldDraftCount > 0;
    const whoseMove: BoardCard['whoseMove'] = needsBen ? 'ben' : lastMessageOutbound ? 'customer' : 'agent';

    // The "is the agent actually running?" alarm: a fresh enquiry where the customer said
    // something over 15 minutes ago and nothing has gone back since. The agent replies in
    // minutes when healthy, so this firing means check the machine, not the customer.
    //
    // An open ask-Ben question is an agent ACTION, not agent silence — the first false alarm
    // (20 Aug, a furniture-assembly caller whose window was shut) accused the agent of being
    // down on a thread where it had correctly escalated within minutes and the move was Ben's.
    const agentDown = stage === 'enquiry'
        && !!lastCustomerAt
        && Date.now() - lastCustomerAt.getTime() > 15 * 60_000
        && !lastMessageOutbound
        && d.openQuestionCount === 0;

    // The clerk's verdict, stored on metadata by maybeAutoQuotePrep (server/agents/comms.ts).
    const rawReadiness = (c.metadata as Record<string, any> | null)?.quotePrepIntake?.readiness;
    const intakeReadiness: BoardCard['intakeReadiness'] =
        rawReadiness === 'quote_ready' || rawReadiness === 'needs_info' || rawReadiness === 'visit_first'
            ? rawReadiness : null;

    return {
        id: c.id,
        phoneNumber: c.phoneNumber,
        displayPhone: `+${c.phoneNumber.replace('@c.us', '')}`,
        contactName: c.contactName,
        lastMessagePreview: c.lastMessagePreview,
        lastMessageAt: lastMsg ? lastMsg.toISOString() : null,
        lastInboundAt: lastInbound ? lastInbound.toISOString() : null,
        unreadCount: c.unreadCount ?? 0,
        stage,
        priority: c.priority || 'normal',
        assignedTo: c.assignedTo,
        tags,
        leadId: c.leadId,
        windowOpen: msLeft > 0,
        windowExpiresAt: expiresAt ? expiresAt.toISOString() : null,
        windowHoursLeft: msLeft > 0 ? Math.floor(msLeft / 3600_000) : 0,
        hoursSinceLastMessage: lastMsg ? Math.floor((Date.now() - lastMsg.getTime()) / 3600_000) : null,
        channels: activity?.channels ?? [],
        lastInboundChannel: activity?.lastInboundChannel ?? null,
        lastCustomerMessageAt: (activity?.lastInbound ?? (c.lastCustomerContactAt ? new Date(c.lastCustomerContactAt) : null))?.toISOString() ?? null,
        // Falls back to the conversation's own timestamps when per-message activity wasn't loaded
        // (e.g. the single-card responses from PATCH), so the shape is always complete.
        wait: computeWaitState(
            activity?.lastInbound ?? (c.lastCustomerContactAt ? new Date(c.lastCustomerContactAt) : null),
            activity?.lastOutbound ?? null,
            DEFAULT_SLA_WORKING_HOURS
        ),
        whoseMove,
        // A closed thread never sits on Ben's desk, whatever signals it carries: the backlog of
        // dead threads with stale held drafts turned the desk into 39 cards of noise on day one.
        // The drafts panel is where leftover approvals get cleaned up; the desk is today's work.
        bensDesk: whoseMove === 'ben' && stage !== 'closed',
        lastMessageOutbound,
        intakeReadiness,
        openQuestionCount: d.openQuestionCount,
        openQuestionOptions: d.openQuestionOptions,
        heldDraftCount: d.heldDraftCount,
        recontactDate: d.recontactDate,
        quoteValueGBP: d.quoteValueGBP,
        quoteViewCount: d.quoteViewCount,
        agentDown,
        complaint: (c.priority || 'normal') === 'urgent' && whoseMove === 'ben',
        callbackDue,
    };
}

// GET /api/inbox/senders — which numbers Ben can send from.
//
// Twilio carries +447449501762. A coexistence number onboarded via Embedded Signup cannot go
// through Twilio at all, so it is listed as a separate sender with transport 'meta'. Without this
// the UI has no way to reach the new number even once it is onboarded.
inboxBoardRouter.get('/senders', async (_req, res) => {
    try {
        const { getWhatsAppSenderE164, isWhatsAppSenderConfigured } = await import('./whatsapp-sender');
        const { getCoexistenceSender } = await import('./whatsapp-onboarding');

        const senders: Array<{
            id: string; transport: 'twilio' | 'meta'; displayPhone: string;
            label: string; isDefault: boolean; available: boolean; note?: string;
        }> = [];

        const twilioE164 = getWhatsAppSenderE164();
        senders.push({
            id: 'twilio',
            transport: 'twilio',
            displayPhone: twilioE164 ?? '(not configured)',
            label: 'Platform number',
            isDefault: true,
            available: isWhatsAppSenderConfigured(),
            note: isWhatsAppSenderConfigured() ? undefined : 'TWILIO_WHATSAPP_NUMBER is not set',
        });

        const coexistence = await getCoexistenceSender();
        if (coexistence) {
            senders.push({
                id: 'meta',
                transport: 'meta',
                displayPhone: coexistence.displayPhoneNumber ?? '(unknown)',
                label: 'Handset number (coexistence)',
                isDefault: false,
                available: true,
                note: 'Also live in the WhatsApp Business app — replies sync both ways',
            });
        }

        res.json({ senders, coexistenceOnboarded: !!coexistence });
    } catch (error: any) {
        console.error('[InboxBoard] Failed to list senders:', error);
        res.status(500).json({ error: 'Failed to list senders' });
    }
});

// GET /api/inbox/board — every non-archived conversation, grouped into columns.
inboxBoardRouter.get('/board', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 300, 1000);

        // Projection, not select-*: full rows drag every thread's stored quote-prep intake blob
        // (metadata jsonb, multi-KB each) across the wire × 400 cards, which took the board from
        // instant to ~20s on a remote link (found 21 Aug: "comms won't load in dev"). The board
        // needs ONE scalar out of metadata — the clerk's readiness — so that is all it fetches,
        // reshaped so toCard reads it exactly as before.
        const rows = (await db.select({
            id: conversations.id,
            phoneNumber: conversations.phoneNumber,
            contactName: conversations.contactName,
            lastMessagePreview: conversations.lastMessagePreview,
            lastMessageAt: conversations.lastMessageAt,
            lastInboundAt: conversations.lastInboundAt,
            lastCustomerContactAt: conversations.lastCustomerContactAt,
            unreadCount: conversations.unreadCount,
            stage: conversations.stage,
            priority: conversations.priority,
            assignedTo: conversations.assignedTo,
            tags: conversations.tags,
            leadId: conversations.leadId,
            status: conversations.status,
            intakeReadiness: sql<string | null>`${conversations.metadata}->'quotePrepIntake'->>'readiness'`,
        }).from(conversations)
            .where(ne(conversations.status, 'archived'))
            .orderBy(desc(conversations.lastMessageAt))
            .limit(limit))
            .map((r) => ({
                ...r,
                metadata: r.intakeReadiness ? { quotePrepIntake: { readiness: r.intakeReadiness } } : null,
            })) as any[];

        const activity = await loadActivity(rows.map((r) => r.id));
        const derived = await loadCardDerived(rows);
        const cards = rows.map((r) => toCard(r, activity.get(r.id), derived.get(r.id)))
            // Won fade: a won card whose thread has been silent for a week has nothing left to
            // manage, so it leaves the board. Read-path filter ONLY — the rows are untouched and
            // still reachable via search/thread routes; nothing is archived or deleted.
            .filter((card) => !(
                card.stage === 'won'
                && card.lastMessageAt
                && Date.now() - new Date(card.lastMessageAt).getTime() > 7 * 86_400_000
            ));

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
                // The agent's queues: drafts awaiting approval, questions awaiting Ben.
                pendingDrafts: await db.select({ n: sql<number>`count(*)::int` })
                    .from(messageDrafts).where(eq(messageDrafts.status, 'pending'))
                    .then((r) => r[0]?.n ?? 0),
                openQuestions: await db.select({ n: sql<number>`count(*)::int` })
                    .from(agentQuestions).where(eq(agentQuestions.status, 'open'))
                    .then((r) => r[0]?.n ?? 0),
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

/** A phone call rendered as a read-only timeline event. */
export type CallEvent = {
    kind: 'call';
    id: string;
    direction: 'inbound' | 'outbound';
    createdAt: string;
    durationSeconds: number | null;
    outcome: string | null;
    summary: string | null;
    transcript: string | null;
    recordingUrl: string | null;
    status: string | null;
    /**
     * The AI verdict on an answered inbound call (calls.classification, written by
     * server/call-classifier.ts). `kind` lets the UI flag a complaint; `line` is the
     * ready-made human sentence. Null until that build lands or for unclassified calls.
     */
    classification: { kind: string; line: string } | null;
};

/**
 * Loads calls for a conversation, joined on phone number.
 *
 * Calls live in their own table with no foreign key to conversations, so the only join available is
 * the number itself. conversations.phoneNumber is stored WhatsApp-style (`447...@c.us`) while
 * calls.phoneNumber is E.164 (`+447...`), so both are reduced to bare digits to compare.
 *
 * Deliberately read-only. Calls are shown for context — they are not repliable, they do not open
 * the WhatsApp 24-hour window, and they do not feed the SLA clock (which reads only `messages`).
 * A customer phoning us is not the same as a message awaiting a reply.
 */
async function loadCallsForConversation(conversationPhoneKey: string, limit = 50): Promise<CallEvent[]> {
    const digits = conversationPhoneKey.replace('@c.us', '').replace(/\D/g, '');
    if (!digits) return [];

    // Full rows rather than a projection, so newly-added columns the mapping below cares about
    // (classification arrived this way) are picked up by the schema rather than by remembering
    // to extend a field list here.
    const rows = await db
        .select()
        .from(calls)
        // Compare on digits so '+447...' matches '447...@c.us'.
        .where(sql`regexp_replace(${calls.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`)
        .orderBy(desc(calls.startTime))
        .limit(limit);

    return rows.map((c) => {
        const cls = readCallClassification(c);
        return {
            kind: 'call' as const,
            id: c.id,
            // 'outbound-dial' and similar variants all mean outbound.
            direction: (c.direction ?? '').startsWith('out') ? 'outbound' : 'inbound',
            createdAt: (c.startTime ?? new Date()).toISOString(),
            durationSeconds: c.duration ?? null,
            outcome: c.outcome ?? null,
            summary: c.jobSummary ?? null,
            // Transcripts run to thousands of words; the thread shows an excerpt and links out.
            transcript: c.transcription ? c.transcription.slice(0, 1500) : null,
            recordingUrl: c.recordingUrl ?? null,
            status: c.status ?? null,
            classification: cls ? { kind: cls.kind, line: classificationLine(cls) } : null,
        };
    });
}

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
        const callEvents = await loadCallsForConversation(conv.phoneNumber);

        // The agent's pending work on this thread, shown above the composer: drafts awaiting
        // Ben's approval, and questions the agent is blocked on. Matched on digits because
        // drafts store E.164 while conversations store @c.us keys.
        const convDigits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
        const pendingDrafts = convDigits
            ? await db.select().from(messageDrafts)
                .where(and(
                    eq(messageDrafts.status, 'pending'),
                    sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${convDigits}`,
                ))
                .orderBy(desc(messageDrafts.createdAt))
            : [];
        const openQuestions = await db.select().from(agentQuestions)
            .where(and(
                eq(agentQuestions.conversationId, conv.id),
                inArray(agentQuestions.status, ['open', 'answered']),
            ))
            .orderBy(desc(agentQuestions.createdAt));

        // Quarantined rows are DELIBERATELY still here. They are what the machine did in Ben's
        // name, and hiding them would leave him staring at a thread that makes no sense. They just
        // arrive labelled `neverSent` so the UI can show them as what they were: an attempt that
        // reached nobody. Only the SLA clock in loadActivity ignores them.
        const messageEvents = recent.reverse().map((m) => ({
            kind: 'message' as const,
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
            createdAt: m.createdAt?.toISOString?.() ?? m.createdAt,
            ...neverSentMeta(m),
        }));

        // Every call is on this thread twice on purpose: once as a `messages` row with
        // channel='call' (written by server/call-thread.ts, which is what gives a call-only
        // conversation a preview, a channel icon and an SLA clock) and once as the full call
        // record above, which carries duration, outcome, transcript and recording.
        //
        // The timeline keeps the richer one. Matching is by the deterministic id the ingest
        // writes, so a call message whose `calls` row has since been deleted still renders rather
        // than vanishing.
        const renderedCallMessageIds = new Set(callEvents.map((c) => callMessageId(c.id)));
        const timelineMessages = messageEvents.filter((m) => !renderedCallMessageIds.has(m.id));

        // Merge into one chronological timeline. Calls sit inline with messages so a customer's
        // history reads as a single sequence — the whole point of pulling them in.
        const timeline = [...timelineMessages, ...callEvents].sort(
            (a, b) => new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime()
        );

        // Has this person told us to stop? Surfaced on the thread itself rather than only in a
        // table, because the moment that matters is the one where Ben is about to type a reply.
        const { getOptOut } = await import('./opt-out');
        const suppression = await getOptOut(conv.phoneNumber).catch((e) => {
            console.warn('[InboxBoard] Opt-out lookup failed for thread:', e?.message);
            return null;
        });

        res.json({
            card: toCard(conv, activity.get(conv.id)),
            optOut: suppression && {
                scope: suppression.scope,
                at: suppression.at.toISOString(),
                source: suppression.source,
                channel: suppression.channel,
                keyword: suppression.matchedKeyword,
                text: suppression.triggerText,
            },
            totalMessages: total,
            totalCalls: callEvents.length,
            truncated: total > recent.length,
            // `messages` retained under its original name and shape for existing callers;
            // `timeline` is the merged view the comms thread renders.
            messages: messageEvents,
            timeline,
            drafts: pendingDrafts,
            questions: openQuestions,
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
