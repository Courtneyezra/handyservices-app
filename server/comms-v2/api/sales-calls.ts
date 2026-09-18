/**
 * Sales calls: the case files whose calls the call classifier marked as someone selling to us
 * (server/call-classifier.ts, `calls.classification.kind = 'sales_spam'`), listed on their own on
 * the Handy Desk with a one-tap close. The captain's ruling, 18 Sep 2026: "List them for one-tap
 * close." They collect on their own list, nothing is ever sent to a cold caller, and they leave the
 * Needs you column (queue.ts is read without them).
 *
 * The verdict only SUGGESTS. Nothing here or anywhere else closes, archives or hides a file because
 * of it: the list is a read, and the only close is a person's tap on POST
 * /case-files/:id/close-sales-call (routes.ts), which asks again whether the file is still a sales
 * call before it closes. So a verdict that is wrong costs an extra row on this list, never a real
 * customer closed unseen: the file stays open, on the board in its stage column, and on this list
 * until someone looks at it.
 *
 * Nothing is classified here. The verdict is the one the classifier already stored on the call row,
 * read by the call turns' `callId` (channel-gateway.ts puts it on the turn); a call with no stored
 * verdict is not a sales call.
 *
 * A file is a sales call only while every customer turn on it is a call the classifier marked as
 * sales. A text, an email, a web form, or a call with any other verdict or none (a missed call is
 * never transcribed, so never classified) keeps the file on the desk's ordinary path, so a real
 * customer who rings, is marked wrongly and then writes to us is back in front of the desk at once.
 * A file already booked or done is not listed.
 *
 * No send path. This module imports no sender and the list carries no draft, no reply channel and
 * no action but close; the close route releases a standing hold only with the person's own words
 * (file-close.ts `closeByHand`, the same rule as every release) and sends nothing.
 */
import { isClosed, type CaseFile } from '../desk/case-file';
import { CALL_SUMMARY_KEY, NO_TRANSCRIPT, transcriptOf } from '../channels/call-adapter';
import type { ApproverAssignments } from './approvers';
import { cardOf, type BoardCard, type BoardMode } from './board';

/** The classifier's verdict for a sales approach: someone selling to us, a robocall, marketing. */
export const SALES_CALL_KIND = 'sales_spam';

/** How much of a call's transcript a card carries when the call has no summary. */
export const SALES_CALL_EXCERPT = 280;

/** The stored verdict's `kind` for each call id asked about; a call with none is simply absent. */
export type ReadCallKinds = (callIds: string[]) => Promise<Map<string, string>>;

/** The classifier's stored verdicts, on the database this process uses. A read: it never classifies. */
export const readCallKinds: ReadCallKinds = async (callIds) => {
    const out = new Map<string, string>();
    if (!callIds.length) return out;
    const { db } = await import('../../db');
    const { calls } = await import('@shared/schema');
    const { inArray } = await import('drizzle-orm');
    const rows = await db.select({ id: calls.id, classification: calls.classification }).from(calls).where(inArray(calls.id, callIds));
    for (const row of rows) {
        const kind = (row.classification as { kind?: unknown } | null)?.kind;
        if (typeof kind === 'string') out.set(row.id, kind);
    }
    return out;
};

/**
 * The call ids to look up for a file that could be a sales call: an open file whose every customer
 * turn is a call carrying its call id. Null for any other file, which is then never looked up.
 */
export function salesCallCandidate(file: CaseFile): string[] | null {
    if (isClosed(file.stage)) return null;
    const inbound = file.turns.filter((t) => t.direction === 'inbound');
    if (!inbound.length) return null;
    const ids: string[] = [];
    for (const t of inbound) {
        if (t.kind !== 'call_transcript' || !t.callId) return null;
        ids.push(t.callId);
    }
    return ids;
}

/** Every customer turn on the file is a call the classifier marked as a sales call. */
export function isSalesCallFile(file: CaseFile, kinds: ReadonlyMap<string, string>): boolean {
    const ids = salesCallCandidate(file);
    return !!ids && ids.every((id) => kinds.get(id) === SALES_CALL_KIND);
}

/** The stored verdicts for every candidate among these files, in one read. */
export async function salesCallKinds(files: CaseFile[], read: ReadCallKinds): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const f of files) for (const id of salesCallCandidate(f) ?? []) ids.add(id);
    return ids.size ? read(Array.from(ids)) : new Map();
}

/** The ids of the files among these that are sales calls. */
export async function salesCallIds(files: CaseFile[], read: ReadCallKinds): Promise<Set<string>> {
    const kinds = await salesCallKinds(files, read);
    return new Set(files.filter((f) => isSalesCallFile(f, kinds)).map((f) => f.id));
}

/** One call on a sales-call card: when, and what was said, as the call's summary or the start of its transcript. */
export interface SalesCallLine {
    at: string;
    summary: string | null;
    excerpt: string | null;
}

export interface SalesCallItem extends BoardCard {
    /** The file's calls, newest first. */
    calls: SalesCallLine[];
    /** When the newest call came in. */
    lastCallAt: string;
}

export interface SalesCallList {
    items: SalesCallItem[];
}

function callLinesOf(file: CaseFile): SalesCallLine[] {
    const lines: SalesCallLine[] = [];
    for (const t of file.turns) {
        if (t.direction !== 'inbound' || t.kind !== 'call_transcript') continue;
        let summary: string | null = null;
        for (let i = file.facts.length - 1; i >= 0 && summary === null; i--) {
            const f = file.facts[i];
            if (f.key === CALL_SUMMARY_KEY && f.source.kind === 'thread' && f.source.turnId === t.id) summary = f.value;
        }
        const text = transcriptOf(t);
        const excerpt = text && text !== NO_TRANSCRIPT ? (text.length > SALES_CALL_EXCERPT ? `${text.slice(0, SALES_CALL_EXCERPT).trimEnd()}…` : text) : null;
        lines.push({ at: t.at, summary, excerpt });
    }
    return lines.reverse();
}

/** The sales-call list: every open file whose calls were all marked as sales, newest call first. */
export function salesCallsOf(files: CaseFile[], kinds: ReadonlyMap<string, string>, filter: { mode?: BoardMode } = {}, assignments: ApproverAssignments = {}): SalesCallList {
    const items: SalesCallItem[] = [];
    for (const file of files) {
        if (!isSalesCallFile(file, kinds)) continue;
        const card = cardOf(file, assignments);
        if (filter.mode && card.mode !== filter.mode) continue;
        const calls = callLinesOf(file);
        items.push({ ...card, calls, lastCallAt: calls[0]?.at ?? file.openedAt });
    }
    items.sort((a, b) => Date.parse(b.lastCallAt) - Date.parse(a.lastCallAt));
    return { items };
}
