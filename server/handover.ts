/**
 * THE HANDOVER, AND THE WAY BACK (T17, 7 Sep 2026, docs/comms-build/BRIEF-T17-after-the-handover.md).
 *
 * A thread goes to Ben through one door — the exit tags it `needs_ben`, writes the flag row, pings
 * once (server/spine/exit.ts) — and until this file it had no door back. The only thing that
 * removed the tag on a reply was the desk page's own client-side PATCH, fired from its two send
 * buttons, so a reply from the template route, a draft Ben approved, a quick reply, the composer's
 * Meta path or anything outside the page left the tag standing; every later agent reply on the
 * thread was then held for him (decide.ts step 6) and no new flag could ping (the exit deduped
 * on the tag). The S15 review's §7.3: "a thread handed to Ben never comes back".
 *
 * `releaseFromBen` is that door. It removes the tag, marks every unanswered `flagged` / `open`
 * agent_questions row on the thread `dismissed` — the schema's own meaning for the status, "Ben
 * decided no answer is needed (e.g. he'll reply himself)" — writes the ledger `flag_closed` row,
 * and tells the board. It is called from:
 *
 *   · sendCustomerMessage (server/outbound.ts) after any successful send whose approver is a
 *     person (`human:<id>`): the composer, the template route, a draft Ben approved, a quick reply
 *     a person sent. Never for `contractor:*` (his words to the customer are not Ben acting) and
 *     never for an automated approver.
 *   · the composer's Meta coexistence path (server/whatsapp-api.ts), which bypasses the gate.
 *   · releaseAnsweredFlags (server/agents/silence-breaker.ts), a 24/7 once-a-minute belt: an
 *     unanswered flag on a needs_ben thread with a human outbound since it — an outbound whose
 *     text none of our sent drafts carried, the definition the sweeps already use — is released
 *     whatever surface wrote the outbound. The one thing that can catch a handset reply if one is
 *     ever recorded (nothing in this repository ingests one today).
 *
 * What it does NOT change: decide.ts's rule that an open flag or the tag holds later replies.
 * That rule is deliberate. This file changes WHEN the flag clears, not whether it holds.
 * Nothing here reaches a customer.
 */
import type { Approver } from './approver';

export const NEEDS_BEN_TAG = 'needs_ben';

/** A person licensed this send. Contractors are people too, but not Ben; automated approvers are code. */
export function isHumanApprover(approver: unknown): approver is `human:${string}` {
    return typeof approver === 'string' && approver.startsWith('human:') && approver.length > 'human:'.length;
}

export interface ReleaseTarget {
    conversationId?: string | null;
    /** Any spelling — digits are extracted. Used when the caller only knows the number. */
    phone?: string | null;
}

export interface ReleaseContext {
    /** Who or what released it, for the ledger actor: 'human:ben@…', 'system:handset_reply', … */
    by: string;
    reason: string;
    runId?: string | null;
    now?: Date;
}

export interface ReleaseOutcome {
    conversationId: string | null;
    /** True when the tag was on the thread and came off. */
    tagCleared: boolean;
    /** How many unanswered flag rows were marked dismissed. */
    flagsDismissed: number;
    /** tagCleared || flagsDismissed > 0 */
    released: boolean;
}

export interface ReleaseDeps {
    loadConversation: (target: ReleaseTarget) => Promise<{ id: string; phoneNumber: string; tags: string[] } | null>;
    clearTag: (conversationId: string, tagsWithout: string[], at: Date) => Promise<void>;
    /** Mark every unanswered flagged/open row dismissed; return the ids that changed. */
    dismissFlags: (conversationId: string, by: string, at: Date) => Promise<string[]>;
    ledgerFlagClosed: (a: { questionId: string; phone: string; conversationId: string; closedBy: string; reason: string; runId?: string | null }) => Promise<unknown>;
    emitBoardDelta: (conversationId: string) => void;
    log: (summary: string, detail: Record<string, unknown>, phone: string, conversationId: string) => void;
}

function digitsOf(phone: string | null | undefined): string {
    return (phone ?? '').replace('@c.us', '').replace(/\D/g, '');
}

async function defaultDeps(): Promise<ReleaseDeps> {
    const { db } = await import('./db');
    const { conversations, agentQuestions } = await import('@shared/schema');
    const { and, eq, inArray, isNull, sql, desc } = await import('drizzle-orm');
    return {
        loadConversation: async (target) => {
            if (target.conversationId) {
                const [c] = await db.select({ id: conversations.id, phoneNumber: conversations.phoneNumber, tags: conversations.tags })
                    .from(conversations).where(eq(conversations.id, target.conversationId)).limit(1);
                return c ? { id: c.id, phoneNumber: c.phoneNumber, tags: (c.tags as string[] | null) ?? [] } : null;
            }
            const digits = digitsOf(target.phone);
            if (!digits) return null;
            const [c] = await db.select({ id: conversations.id, phoneNumber: conversations.phoneNumber, tags: conversations.tags })
                .from(conversations)
                .where(sql`regexp_replace(${conversations.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`)
                .orderBy(desc(conversations.updatedAt)).limit(1);
            return c ? { id: c.id, phoneNumber: c.phoneNumber, tags: (c.tags as string[] | null) ?? [] } : null;
        },
        clearTag: async (conversationId, tagsWithout, at) => {
            await db.update(conversations).set({ tags: tagsWithout, updatedAt: at }).where(eq(conversations.id, conversationId));
        },
        dismissFlags: async (conversationId, by, at) => {
            const rows = await db.update(agentQuestions)
                .set({ status: 'dismissed', answeredBy: by, answeredAt: at })
                .where(and(
                    eq(agentQuestions.conversationId, conversationId),
                    inArray(agentQuestions.status, ['flagged', 'open']),
                    isNull(agentQuestions.answeredAt),
                ))
                .returning({ id: agentQuestions.id });
            return rows.map((r) => r.id);
        },
        ledgerFlagClosed: async (a) => (await import('./ledger')).ledgerFlagClosed(a),
        emitBoardDelta: (conversationId) => {
            import('./comms-events')
                .then((m) => m.emitCommsEvent({ type: 'board_delta', conversationId, reason: 'tags', at: new Date().toISOString() }))
                .catch(() => undefined);
        },
        log: (summary, detail, phone, conversationId) => {
            import('./system-events')
                .then((m) => m.logSystemEvent({ kind: 'other', phone, conversationId, source: 'handover', summary, detail }))
                .catch(() => undefined);
        },
    };
}

/**
 * The way back. Idempotent: a thread that is not Ben's is left exactly as it was and reports
 * `released: false`. Never throws — a failure here must never turn a successful send into an
 * error, so callers get the outcome or a logged no-op.
 */
export async function releaseFromBen(target: ReleaseTarget, ctx: ReleaseContext, overrides: Partial<ReleaseDeps> = {}): Promise<ReleaseOutcome> {
    const none: ReleaseOutcome = { conversationId: null, tagCleared: false, flagsDismissed: 0, released: false };
    try {
        const deps: ReleaseDeps = { ...(await defaultDeps()), ...overrides };
        const conv = await deps.loadConversation(target);
        if (!conv) return none;
        const now = ctx.now ?? new Date();
        const phone = digitsOf(conv.phoneNumber) ? `+${digitsOf(conv.phoneNumber)}` : '';

        // Ledger first, while the rows still read 'flagged' (ledgerFlagClosedForConversation looks
        // them up by status), then the rows, then the tag.
        const dismissed = await deps.dismissFlags(conv.id, ctx.by, now);
        for (const questionId of dismissed) {
            await deps.ledgerFlagClosed({ questionId, phone, conversationId: conv.id, closedBy: ctx.by, reason: ctx.reason, runId: ctx.runId ?? null })
                .catch(() => undefined);
        }

        let tagCleared = false;
        if (conv.tags.includes(NEEDS_BEN_TAG)) {
            await deps.clearTag(conv.id, conv.tags.filter((t) => t !== NEEDS_BEN_TAG), now);
            tagCleared = true;
        }

        const released = tagCleared || dismissed.length > 0;
        if (released) {
            deps.emitBoardDelta(conv.id);
            deps.log(
                `handover: thread released from Ben by ${ctx.by} — ${ctx.reason}${tagCleared ? '; needs_ben cleared' : ''}${dismissed.length ? `; ${dismissed.length} flag(s) dismissed` : ''}`,
                { event: 'released_from_ben', by: ctx.by, reason: ctx.reason, tagCleared, flagsDismissed: dismissed.length, runId: ctx.runId ?? null },
                phone, conv.id,
            );
        }
        return { conversationId: conv.id, tagCleared, flagsDismissed: dismissed.length, released };
    } catch (error: any) {
        console.warn('[Handover] release failed (the send stands):', error?.message ?? error);
        return none;
    }
}

/**
 * The hook on the send gate: a person's successful send to a number is that person answering
 * the thread, whatever surface they used. Automated and contractor approvers do nothing here.
 */
export async function noteHumanSend(input: { to: string; approver: Approver | string; runId?: string | null; context?: string | null }): Promise<ReleaseOutcome | null> {
    if (!isHumanApprover(input.approver)) return null;
    return releaseFromBen(
        { phone: input.to },
        { by: input.approver, reason: `human reply sent${input.context ? ` (${input.context})` : ''}`, runId: input.runId ?? null },
    );
}
