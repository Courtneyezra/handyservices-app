/**
 * The comms event ledger — sync layer.
 *
 * Derives comms_events rows from the three source tables (messages, calls, message_drafts)
 * instead of hooking the nine call sites that insert messages: one attribution brain here,
 * zero drift there. The sync is idempotent — (ref_table, ref_id, event_type) is unique and
 * every insert is ON CONFLICT DO NOTHING — so it can run from a cron, after a backfill wipe,
 * or twice in a row, and the ledger converges to the same state.
 *
 * Attribution model (the reason this table exists):
 *   - drafted_by / edited_by / sent_by are three different hands on one outbound message.
 *     An agent-drafted, Ben-edited, Ben-approved message must not count as "agent performance"
 *     unedited — the eval calibration and parity metrics both hang off this distinction.
 *   - An outbound message row whose content matches a sent/approved draft body part was drafted
 *     by whoever the draft's source says; everything else outbound was typed by a human.
 *     (Same content-matching rule the comms agent itself uses in get_thread — one convention.)
 *   - Drafts are PATCHed in place when Ben edits before approving, so for historical rows we can
 *     only see the final body. edited_by is therefore only stamped going forward, by the draft
 *     PATCH route, once that hook lands. Absence of edited_by on old rows means "unknown", not
 *     "unedited".
 *
 * Role profiles: one person, two roles, one number — threading is (phone, role_profile).
 * Contractor numbers come from users.role='contractor'; the business's own numbers are
 * 'internal'. Everything else defaults to 'customer' until supplier onboarding exists.
 */
import { db } from './db';
import { commsEvents, conversations, messages, messageDrafts, calls, users } from '@shared/schema';
import { sql, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
// Phase 1 (2 Sep 2026): the attribution vocabulary lives with the write-at-source ledger and is
// shared here so the backfill and the live path can never disagree about who an actor is.
import { INTERNAL_DIGITS, digitsOf, e164Of as e164, actorFromDraftSource, actorFromApprovedBy as senderFromApprovedBy } from './ledger';
export { ledgerDriftCheck } from './ledger';

async function contractorDigits(): Promise<Set<string>> {
    const rows = await db.select({ phone: users.phone }).from(users).where(eq(users.role, 'contractor'));
    return new Set(rows.map((r) => digitsOf(r.phone)).filter(Boolean));
}

function roleFor(digits: string, contractors: Set<string>): string {
    if (INTERNAL_DIGITS.has(digits)) return 'internal';
    if (contractors.has(digits)) return 'contractor';
    return 'customer';
}

/** Draft bodies split into their '---' burst parts, the shape they land in as message rows. */
function draftParts(body: string): string[] {
    return body.split(/\n?---\n?/).map((p) => p.trim()).filter(Boolean);
}

export interface LedgerSyncResult {
    messagesScanned: number;
    callsScanned: number;
    draftsScanned: number;
    inserted: number;
}

/**
 * Sync the ledger from the source tables. Full-scan and idempotent — at current volumes
 * (thousands of rows) this is seconds, and correctness beats cleverness until it isn't.
 */
export async function syncCommsLedger(): Promise<LedgerSyncResult> {
    const contractors = await contractorDigits();
    let inserted = 0;

    const insertBatch = async (rows: (typeof commsEvents.$inferInsert)[]) => {
        for (let i = 0; i < rows.length; i += 500) {
            const chunk = rows.slice(i, i + 500);
            if (!chunk.length) continue;
            const res = await db.insert(commsEvents).values(chunk).onConflictDoNothing().returning({ id: commsEvents.id });
            inserted += res.length;
        }
    };

    // ---- drafts first: outbound message attribution matches against them ----
    const draftRows = await db.select().from(messageDrafts);
    const draftEvents: (typeof commsEvents.$inferInsert)[] = [];
    // (phone digits, part content) -> attribution, for outbound message matching below
    const partIndex = new Map<string, { draftedBy: string; sentBy: string | null }>();
    for (const d of draftRows) {
        const dg = digitsOf(d.phone);
        const role = roleFor(dg, contractors);
        const draftedBy = actorFromDraftSource(d.source);
        const sentBy = senderFromApprovedBy(d.approvedBy);
        if (['sent', 'approved'].includes(d.status)) {
            for (const part of draftParts(d.body)) {
                partIndex.set(`${dg}|${part}`, { draftedBy, sentBy });
            }
        }
        draftEvents.push({
            id: randomUUID(), occurredAt: d.createdAt, eventType: 'draft_created',
            channel: d.channel ?? 'whatsapp', phone: e164(d.phone), roleProfile: role,
            actor: draftedBy, draftedBy, body: d.body,
            refTable: 'message_drafts', refId: d.id, runId: d.runId ?? null,
            meta: { source: d.source, reason: d.reason ?? undefined },
        });
        if (d.status === 'sent' && d.sentAt) {
            draftEvents.push({
                id: randomUUID(), occurredAt: d.sentAt, eventType: 'draft_sent',
                channel: d.channel ?? 'whatsapp', phone: e164(d.phone), roleProfile: role,
                actor: sentBy ?? draftedBy, draftedBy, sentBy, body: d.body,
                refTable: 'message_drafts', refId: d.id, runId: d.runId ?? null,
                meta: { source: d.source, sentMessageId: d.sentMessageId ?? undefined },
            });
        } else if (d.status === 'rejected' && d.approvedAt) {
            draftEvents.push({
                id: randomUUID(), occurredAt: d.approvedAt, eventType: 'draft_rejected',
                channel: d.channel ?? 'whatsapp', phone: e164(d.phone), roleProfile: role,
                actor: senderFromApprovedBy(d.approvedBy) ?? 'system:unknown', draftedBy, body: d.body,
                refTable: 'message_drafts', refId: d.id, runId: d.runId ?? null,
                meta: { source: d.source },
            });
        } else if (d.status === 'failed') {
            draftEvents.push({
                id: randomUUID(), occurredAt: d.sentAt ?? d.createdAt, eventType: 'draft_failed',
                channel: d.channel ?? 'whatsapp', phone: e164(d.phone), roleProfile: role,
                actor: draftedBy, draftedBy, body: d.body,
                refTable: 'message_drafts', refId: d.id, runId: d.runId ?? null,
                meta: { source: d.source, error: d.error ?? undefined },
            });
        }
    }
    await insertBatch(draftEvents);

    // ---- messages: the conversation joins carry the phone ----
    const msgRows = await db.select({
        id: messages.id, conversationId: messages.conversationId, direction: messages.direction,
        content: messages.content, channel: messages.channel, createdAt: messages.createdAt,
        type: messages.type, status: messages.status, phone: conversations.phoneNumber,
    }).from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id));

    const msgEvents: (typeof commsEvents.$inferInsert)[] = [];
    for (const m of msgRows) {
        const dg = digitsOf(m.phone);
        if (!dg) continue;
        const role = roleFor(dg, contractors);
        const inbound = m.direction === 'inbound';
        let actor = 'counterparty';
        let draftedBy: string | null = null;
        let sentBy: string | null = null;
        if (!inbound) {
            const match = partIndex.get(`${dg}|${(m.content ?? '').trim()}`);
            if (match) {
                draftedBy = match.draftedBy;
                sentBy = match.sentBy;
                actor = match.sentBy ?? match.draftedBy;
            } else {
                // No matching draft: typed directly by a human at the console (or legacy automation
                // predating drafts). 'human:direct' is honest — we know a person-side hand sent it,
                // not whose; the admin send routes can stamp better attribution going forward.
                actor = 'human:direct';
                sentBy = 'human:direct';
            }
        }
        msgEvents.push({
            id: randomUUID(), occurredAt: m.createdAt, eventType: inbound ? 'message_in' : 'message_out',
            channel: m.channel ?? 'whatsapp', phone: e164(m.phone), roleProfile: role,
            conversationId: m.conversationId, actor, draftedBy, sentBy, body: m.content,
            refTable: 'messages', refId: m.id,
            meta: { type: m.type ?? undefined, status: m.status ?? undefined },
        });
    }
    await insertBatch(msgEvents);

    // ---- calls ----
    const callRows = await db.select({
        id: calls.id, phoneNumber: calls.phoneNumber, direction: calls.direction,
        startTime: calls.startTime, duration: calls.duration,
        recordingUrl: calls.recordingUrl, localRecordingPath: calls.localRecordingPath,
        transcription: calls.transcription, jobSummary: calls.jobSummary, outcome: calls.outcome,
    }).from(calls);

    const callEvents: (typeof commsEvents.$inferInsert)[] = [];
    for (const c of callRows) {
        const dg = digitsOf(c.phoneNumber);
        if (!dg) continue;
        const outbound = (c.direction ?? '').toLowerCase().includes('out');
        callEvents.push({
            id: randomUUID(), occurredAt: c.startTime, eventType: outbound ? 'call_out' : 'call_in',
            channel: 'call', phone: e164(c.phoneNumber), roleProfile: roleFor(dg, contractors),
            actor: outbound ? 'human:ben' : 'counterparty',
            body: c.jobSummary,
            refTable: 'calls', refId: c.id,
            meta: {
                durationSeconds: c.duration ?? undefined,
                recorded: Boolean(c.recordingUrl || c.localRecordingPath),
                transcribed: Boolean(c.transcription && c.transcription.length > 20),
                outcome: c.outcome ?? undefined,
            },
        });
    }
    await insertBatch(callEvents);

    return {
        messagesScanned: msgRows.length,
        callsScanned: callRows.length,
        draftsScanned: draftRows.length,
        inserted,
    };
}

/** Ledger totals per event type — the one-line health check. */
export async function ledgerCounts(): Promise<Record<string, number>> {
    const rows: any = await db.execute(sql`select event_type, count(*)::int n from comms_events group by 1 order by 2 desc`);
    return Object.fromEntries((rows.rows ?? rows).map((r: any) => [r.event_type, r.n]));
}
