/**
 * Funnel-stage transitions for conversations.
 *
 * The /admin/comms board columns are a SALES FUNNEL, not conversation mechanics:
 *
 *   enquiry    — new and unanswered. The SLA clock is running; still worth winning.
 *   scoping    — we're in conversation, gathering what a quote needs.
 *   quote_sent — a live quote is out (Recovery watches these).
 *   won        — deposit paid. Visible 7 days, then auto-archived (still searchable).
 *   closed     — dead, spam, or done.
 *
 * Movement is EVENT-DRIVEN: inbound/outbound messages, quote sends and deposit payments
 * move cards through the funnel; manual drag on the board always wins over automation
 * (nothing here demotes a manually-set stage — transitions only promote forward or
 * reopen closed threads).
 */
import { db } from './db';
import { conversations } from '@shared/schema';
import { eq, and, ne, sql } from 'drizzle-orm';

export const CONVERSATION_STAGES = ['enquiry', 'scoping', 'quote_sent', 'won', 'closed'] as const;
export type ConversationStage = (typeof CONVERSATION_STAGES)[number];

/**
 * Stage after a CUSTOMER message lands. An enquiry stays an enquiry until WE reply;
 * a closed thread that speaks again is a fresh enquiry. Everything else keeps its
 * place in the funnel (a customer replying to a live quote doesn't demote it).
 * Legacy 'new' rows (pre-funnel vocabulary) normalize to 'enquiry'.
 */
export function stageAfterInbound(current: string | null | undefined): string {
    if (!current || current === 'closed' || current === 'new') return 'enquiry';
    return current;
}

/**
 * Stage after WE send something. The first outbound reply moves an enquiry into
 * scoping; later funnel stages are never demoted by merely talking. Legacy
 * 'new'/'active' rows normalize to their funnel equivalents.
 */
export function stageAfterOutbound(current: string | null | undefined): string {
    if (!current || current === 'enquiry' || current === 'new' || current === 'active') return 'scoping';
    return current;
}

/**
 * Deposit paid → the thread is WON. Matched on bare digits because quotes store E.164
 * (+447...) while conversations store WhatsApp keys (447...@c.us). Best-effort by
 * design: payment bookkeeping must never fail because board bookkeeping did.
 */
export async function markConversationWonByPhone(phone: string | null | undefined): Promise<void> {
    try {
        const digits = (phone ?? '').replace(/\D/g, '');
        if (!digits) return;
        const updated = await db.update(conversations)
            .set({ stage: 'won', updatedAt: new Date() })
            .where(and(
                sql`regexp_replace(${conversations.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`,
                ne(conversations.stage, 'won'),
            ))
            .returning({ id: conversations.id });
        if (updated.length > 0) {
            console.log(`[Funnel] Deposit paid — conversation ${updated[0].id} moved to won`);
        }
    } catch (error: any) {
        console.warn('[Funnel] Could not mark conversation won:', error?.message);
    }
}

/**
 * Won cards stay visible for 7 days (the glow, and any post-payment coordination),
 * then auto-archive off the board. The thread itself stays searchable — archiving is
 * a board filter (status='archived'), not a deletion. updatedAt is the entry-to-won
 * marker: any fresh activity on the thread renews its 7 days on the board.
 */
export async function archiveStaleWonConversations(days = 7): Promise<number> {
    const archived = await db.update(conversations)
        .set({ status: 'archived', archivedAt: new Date() })
        .where(and(
            eq(conversations.stage, 'won'),
            ne(conversations.status, 'archived'),
            sql`${conversations.updatedAt} < now() - make_interval(days => ${days})`,
        ))
        .returning({ id: conversations.id });
    if (archived.length > 0) {
        console.log(`[Funnel] Auto-archived ${archived.length} won conversation(s) older than ${days} days`);
    }
    return archived.length;
}
