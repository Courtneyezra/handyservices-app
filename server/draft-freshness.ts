/**
 * Draft freshness (P7, 4 Sep 2026): no reply may go out that was written before the customer's
 * latest message.
 *
 * Incident, 2 Sep, thread 46a13bdb… (Janet): 14:14 "back soon with measurement"; 14:15 the legacy
 * agent queued "just send the measurement over whenever you've got it"; 14:28 the measurement
 * photo arrived. The draft stayed pending (queueDraft's source dedupe refused a second one), the
 * 14:28 run produced nothing, and Ben was one tap from asking for something she had just sent.
 *
 * Three layers, all keyed on the thread's latest non-quarantined inbound:
 *   1. the hard guarantee at the exit — approveAndSendDraft (message-drafts.ts) calls `staleAgainst`
 *      and holds the draft (held_reason 'stale_by_inbound') for every approver, human or automated;
 *   2. supersede on inbound — supersedeStaleDrafts (message-drafts.ts) rejects older agent drafts the
 *      moment a new inbound lands, so the dedupe can never block the fresh run;
 *   3. the spine exit re-checks before it sends (server/spine/exit.ts).
 * The pure rule is here so all three agree and the tests need no database. The loaders are
 * SELECTs; `requestFreshRun` asks for the run that will replace the stale draft.
 */

export interface InboundRef {
    id: string;
    at: Date;
    hasMedia?: boolean;
}

export interface DraftFreshnessInput {
    createdAt: Date | string;
    /** message_drafts.based_on_inbound_id — the inbound the draft was written against, when stamped. */
    basedOnInboundId?: string | null;
}

export interface Staleness {
    stale: boolean;
    /** Why, for the held_reason note and the ledger event. */
    reason?: string;
    latest?: InboundRef | null;
}

/**
 * Pure. A draft is stale when the thread's latest inbound is newer than the draft, or (when the
 * draft says which inbound it answered) is a different message from that one — the second test
 * catches an inbound that landed between the agent reading the thread and queueing the draft.
 */
export function staleAgainst(draft: DraftFreshnessInput, latest: InboundRef | null | undefined): Staleness {
    if (!latest) return { stale: false, latest: null };
    // A draft that names the inbound it answered is judged by identity alone: the same message
    // still latest → fresh (whatever the clocks say); a different one → stale. Rows written
    // before the column exists fall back to the time test.
    if (draft.basedOnInboundId) {
        if (latest.id === draft.basedOnInboundId) return { stale: false, latest };
        return { stale: true, latest, reason: `the customer wrote again (${latest.id}${latest.hasMedia ? ', with media' : ''}) after the message this draft answered (${draft.basedOnInboundId})` };
    }
    const created = new Date(draft.createdAt).getTime();
    if (Number.isFinite(created) && latest.at.getTime() > created) {
        return { stale: true, latest, reason: `the customer wrote at ${latest.at.toISOString()}${latest.hasMedia ? ' (with media)' : ''}, after this draft was written at ${new Date(created).toISOString()}` };
    }
    return { stale: false, latest };
}

export const STALE_BY_INBOUND = 'stale_by_inbound';
export const STALE_SYSTEM_ACTOR = 'system:stale_by_inbound';

/** Sources whose pending drafts a newer customer message makes obsolete. The rules layer's content-free lines are not touched. */
export const AGENT_DRAFT_SOURCES: ReadonlySet<string> = new Set(['comms_agent', 'spine']);

export interface SupersedeCandidate { id: string; source: string; status: string; createdAt: Date | string; basedOnInboundId?: string | null }

/**
 * Pure. Which pending agent drafts a new inbound at `inboundAt` (id `latestInboundId`, when known)
 * supersedes. Rules-layer, manual and every other source pass through untouched; so does anything
 * not pending; so does a draft written after the inbound (or against that very inbound).
 */
export function selectSuperseded(candidates: SupersedeCandidate[], inboundAt: Date, latestInboundId?: string | null): SupersedeCandidate[] {
    return candidates.filter((d) => {
        if (d.status !== 'pending' || !AGENT_DRAFT_SOURCES.has(d.source)) return false;
        if (latestInboundId) return staleAgainst({ createdAt: d.createdAt, basedOnInboundId: d.basedOnInboundId }, { id: latestInboundId, at: inboundAt }).stale;
        return new Date(d.createdAt).getTime() < inboundAt.getTime();
    });
}

// ---------------------------------------------------------------- loaders (db, read-only)

/** Latest non-quarantined inbound on a thread. Never throws: an unreadable thread reads as "no inbound". */
export async function latestInboundFor(conversationId: string | null | undefined): Promise<InboundRef | null> {
    if (!conversationId) return null;
    try {
        const { db } = await import('./db');
        const { messages } = await import('@shared/schema');
        const { and, desc, eq } = await import('drizzle-orm');
        const { notQuarantined } = await import('./message-quarantine');
        const [row] = await db.select({ id: messages.id, createdAt: messages.createdAt, mediaUrl: messages.mediaUrl })
            .from(messages)
            .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'inbound'), notQuarantined))
            .orderBy(desc(messages.createdAt)).limit(1);
        if (!row?.createdAt) return null;
        return { id: String(row.id), at: new Date(row.createdAt), hasMedia: !!row.mediaUrl };
    } catch (error: any) {
        console.warn(`[DraftFreshness] latest inbound unreadable for ${conversationId}:`, error?.message ?? error);
        return null;
    }
}

export interface InboundSince { count: number; media: number; latestAt: string | null; latestId: string | null }

/** Inbound messages on a thread newer than `since` — what Ben's banner counts. Never throws. */
export async function inboundSince(conversationId: string | null | undefined, since: Date | string): Promise<InboundSince> {
    const empty: InboundSince = { count: 0, media: 0, latestAt: null, latestId: null };
    if (!conversationId) return empty;
    try {
        const { db } = await import('./db');
        const { messages } = await import('@shared/schema');
        const { and, desc, eq, gt } = await import('drizzle-orm');
        const { notQuarantined } = await import('./message-quarantine');
        const rows = await db.select({ id: messages.id, createdAt: messages.createdAt, mediaUrl: messages.mediaUrl })
            .from(messages)
            .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'inbound'), notQuarantined, gt(messages.createdAt, new Date(since))))
            .orderBy(desc(messages.createdAt)).limit(50);
        return countInboundSince(rows.map((r) => ({ id: String(r.id), at: new Date(r.createdAt ?? 0), hasMedia: !!r.mediaUrl })));
    } catch (error: any) {
        console.warn(`[DraftFreshness] inbound-since unreadable for ${conversationId}:`, error?.message ?? error);
        return empty;
    }
}

/** Pure fold for inboundSince (rows newest first or not). */
export function countInboundSince(rows: InboundRef[]): InboundSince {
    if (!rows.length) return { count: 0, media: 0, latestAt: null, latestId: null };
    const newest = rows.reduce((a, b) => (b.at.getTime() > a.at.getTime() ? b : a));
    return { count: rows.length, media: rows.filter((r) => r.hasMedia).length, latestAt: newest.at.toISOString(), latestId: newest.id };
}

/** The thread for a draft: its conversation id, else the @c.us key its phone maps to. */
export async function conversationIdForDraft(draft: { conversationId?: string | null; phone: string }): Promise<string | null> {
    if (draft.conversationId) return draft.conversationId;
    try {
        const { db } = await import('./db');
        const { conversations } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const digits = draft.phone.replace(/\D/g, '');
        if (!digits) return null;
        const [conv] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.phoneNumber, `${digits}@c.us`)).limit(1);
        return conv?.id ?? null;
    } catch {
        return null;
    }
}

/**
 * Ask for the run that replaces a stale draft. Spine enabled (shadow or live) → requestRun at
 * once (it writes metadata.nextTriageAt, the key the legacy tick reads too); spine off → the
 * legacy debounce row set to now. Never throws; the answer is logged.
 */
export async function requestFreshRun(conversationId: string | null | undefined, why: string): Promise<{ queued: boolean; via: 'spine' | 'legacy' | 'none'; reason?: string }> {
    if (!conversationId) return { queued: false, via: 'none', reason: 'no conversation' };
    try {
        const { isSpineEnabled } = await import('./spine/config');
        if (await isSpineEnabled()) {
            const { requestRun } = await import('./spine/request-run');
            const r = await requestRun(conversationId, 'inbound_message', { delayMs: 0 });
            console.log(`[DraftFreshness] fresh spine run for ${conversationId} (${why}): ${r.queued ? 'queued' : `not queued (${r.reason})`}`);
            return { queued: r.queued, via: 'spine', reason: r.reason };
        }
        const { db } = await import('./db');
        const { conversations } = await import('@shared/schema');
        const { eq, sql } = await import('drizzle-orm');
        const now = new Date().toISOString();
        const rows = await db.update(conversations)
            .set({ metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('nextTriageAt', ${now}::text)` })
            .where(eq(conversations.id, conversationId)).returning({ id: conversations.id });
        console.log(`[DraftFreshness] fresh legacy run for ${conversationId} (${why}): ${rows.length ? 'armed now' : 'conversation not found'}`);
        return { queued: rows.length > 0, via: 'legacy', reason: rows.length ? undefined : 'conversation not found' };
    } catch (error: any) {
        console.warn(`[DraftFreshness] could not request a fresh run for ${conversationId}:`, error?.message ?? error);
        return { queued: false, via: 'none', reason: error?.message ?? String(error) };
    }
}
