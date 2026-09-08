/**
 * Build plan v2, item 3.4: the knowledge base — the store.
 *
 * Ben writes what is true about the business here (his answer 11), and item 3.2 will make a
 * factual answer to a customer BE an entry's `approvedWords`, selected verbatim, because the s10
 * review established that nothing in this repository can check whether a claim about the business
 * is true. So an entry is not a hint to a model. It is the sentence that gets sent.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE. Anything that could reach a customer reads
 * `listReviewedEntries()` / `getReviewedEntry()` / `getFixedLine()`. Those three return REVIEWED
 * ANSWERS and nothing else. An unreviewed entry, a retired one and a question for Ben are all
 * invisible to them. Reaching an unreviewed row at all takes the deliberately named, admin-only
 * `adminListEveryEntryIncludingUnreviewed()`, and `knowledge-base-access.test.ts` fails if any
 * module outside the admin route calls it.
 *
 * The rule is belt and braces on purpose:
 *   the SQL filters on status and kind;
 *   `sendableEntries()` re-filters the rows in code, so a hand-written query cannot smuggle one
 *     past by returning the wrong set;
 *   the table's own CHECKs (migration 20260908_kb_entries.sql) make 'reviewed' impossible on a
 *     question, on a blank, or without a named reviewer — so the invariant survives code that has
 *     not been written yet.
 *
 * This item is the store, the page and the seed. NOTHING here is wired into a reply path, a
 * prompt, a guard or a policy pack: the search tool the Scoper will use is item 3.1.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { kbEntries, KB_KINDS, KB_STATUSES, type KbEntryRow, type KbKind, type KbStatus } from '@shared/schema';

export type { KbEntryRow, KbKind, KbStatus };
export { KB_KINDS, KB_STATUSES };

/**
 * What a reader gets. The same shape for the admin page and for a future citation, minus the rows
 * the customer-facing accessors never return.
 */
export interface KbEntry {
    id: string;
    kind: KbKind;
    topic: string;
    approvedWords: string;
    bannedWords: string[];
    status: KbStatus;
    reviewedBy: string | null;
    reviewedAt: string | null;
    benNote: string | null;
    sourceNote: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

/**
 * The four threads the desk does not scope (the captain's answer 21): it sends one fixed line in
 * Ben's words and hands the thread to him. Item 1.4 reads them through `getFixedLine`; these ids
 * are the contract between that item and this store, which is why they are constants and not a
 * lookup by topic text.
 */
export const FIXED_LINE_IDS = {
    gas: 'fixed-line-gas',
    complaint: 'fixed-line-complaint',
    refund: 'fixed-line-refund',
    trust: 'fixed-line-trust',
} as const;
export type FixedLineKind = keyof typeof FIXED_LINE_IDS;

// ------------------------------------------------------------------ pure: the rules, no database

export function isKbKind(v: unknown): v is KbKind {
    return typeof v === 'string' && (KB_KINDS as readonly string[]).includes(v);
}
export function isKbStatus(v: unknown): v is KbStatus {
    return typeof v === 'string' && (KB_STATUSES as readonly string[]).includes(v);
}

/**
 * The predicate everything customer-facing rests on. A row is sendable only if a person reviewed
 * it, it is an answer rather than an open question, and it actually has words.
 */
export function isSendable(e: Pick<KbEntry, 'kind' | 'status' | 'approvedWords'>): boolean {
    return e.status === 'reviewed' && e.kind === 'answer' && e.approvedWords.trim() !== '';
}

/** Re-filters in code what the SQL already filtered. Cheap, and it is the belt to the SQL's braces. */
export function sendableEntries(rows: readonly KbEntry[]): KbEntry[] {
    return rows.filter(isSendable);
}

/** A readable, stable citation id from a topic. Falls back to a timestamp when nothing survives. */
export function slugFor(topic: string, taken: readonly string[] = []): string {
    const base = topic
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .split('-').slice(0, 6).join('-')
        .slice(0, 60) || `entry-${Date.now()}`;
    if (!taken.includes(base)) return base;
    for (let n = 2; n < 500; n++) {
        const candidate = `${base}-${n}`;
        if (!taken.includes(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
}

export interface KbDraft {
    id?: string;
    kind?: KbKind;
    topic?: string;
    approvedWords?: string;
    bannedWords?: string[];
    benNote?: string | null;
    sourceNote?: string | null;
}
export type KbValidation =
    | { ok: true; value: Required<Pick<KbDraft, 'kind' | 'topic' | 'approvedWords' | 'bannedWords'>> & { benNote: string | null; sourceNote: string | null } }
    | { ok: false; errors: string[] };

/**
 * What the admin write path accepts. The table's CHECKs say the same things; this says them in
 * English so the page can show Ben why, before the row is refused by Postgres.
 */
export function validateDraft(input: KbDraft): KbValidation {
    const errors: string[] = [];
    const kind: KbKind = input.kind === undefined ? 'answer' : (isKbKind(input.kind) ? input.kind : (errors.push(`kind must be one of ${KB_KINDS.join(', ')}`), 'answer'));
    const topic = (input.topic ?? '').trim();
    const approvedWords = (input.approvedWords ?? '').trim();
    const benNote = (input.benNote ?? '').trim();
    const sourceNote = (input.sourceNote ?? '').trim();
    const bannedWords = Array.isArray(input.bannedWords)
        ? input.bannedWords.map((w) => String(w).trim()).filter(Boolean)
        : (input.bannedWords === undefined ? [] : (errors.push('bannedWords must be a list of phrases'), []));

    if (!topic) errors.push('A question or topic is required.');
    if (topic.length > 300) errors.push('The question or topic is too long (300 characters).');
    if (approvedWords.length > 4000) errors.push('The approved words are too long (4000 characters).');
    if (kind === 'question') {
        if (approvedWords) errors.push('A question for Ben carries no approved words: it is a question, not an answer.');
        if (!benNote) errors.push('A question needs the question itself: what the website claims and what the desk\'s rules say.');
    }
    if (errors.length) return { ok: false, errors };
    return { ok: true, value: { kind, topic, approvedWords, bannedWords, benNote: benNote || null, sourceNote: sourceNote || null } };
}

/**
 * Editing the words of a reviewed entry drops it back to unreviewed. Ben reviewed the sentence, not
 * the row, so changing the sentence unmakes the review — otherwise an edit is a way to put unread
 * words in front of a customer under an old approval.
 */
export function editUnmakesReview(before: Pick<KbEntry, 'kind' | 'approvedWords'>, after: Pick<KbEntry, 'kind' | 'approvedWords'>): boolean {
    return before.approvedWords.trim() !== after.approvedWords.trim() || before.kind !== after.kind;
}

// ---------------------------------------------------------------------------- reads

function iso(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    const t = d instanceof Date ? d : new Date(d);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

export function toEntry(row: KbEntryRow): KbEntry {
    return {
        id: row.id,
        kind: isKbKind(row.kind) ? row.kind : 'question',      // fail closed: an unknown kind is not an answer
        topic: row.topic,
        approvedWords: row.approvedWords ?? '',
        bannedWords: (row.bannedWords ?? []) as string[],
        status: isKbStatus(row.status) ? row.status : 'unreviewed', // fail closed: unknown is not reviewed
        reviewedBy: row.reviewedBy ?? null,
        reviewedAt: iso(row.reviewedAt),
        benNote: row.benNote ?? null,
        sourceNote: row.sourceNote ?? null,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
    };
}

/**
 * THE customer-facing read. Reviewed answers, and nothing else, ever. Item 3.1's search tool reads
 * this and only this.
 */
export async function listReviewedEntries(): Promise<KbEntry[]> {
    const rows = await db.select().from(kbEntries)
        .where(and(eq(kbEntries.status, 'reviewed'), eq(kbEntries.kind, 'answer')))
        .orderBy(asc(kbEntries.topic));
    return sendableEntries(rows.map(toEntry));
}

/** One reviewed answer by its citation id. Anything else reads as null, including a real row. */
export async function getReviewedEntry(id: string): Promise<KbEntry | null> {
    if (!id) return null;
    const rows = await db.select().from(kbEntries)
        .where(and(eq(kbEntries.id, id), eq(kbEntries.status, 'reviewed'), eq(kbEntries.kind, 'answer')))
        .limit(1);
    const entry = rows[0] ? toEntry(rows[0]) : null;
    return entry && isSendable(entry) ? entry : null;
}

/**
 * The fixed line for one of the four threads the desk does not scope (answer 21). Reviewed only,
 * like every other customer-facing read: until Ben has reviewed it there is no fixed line, and the
 * caller must hand the thread to him with nothing said. Item 1.4's single entry point.
 */
export async function getFixedLine(kind: FixedLineKind): Promise<KbEntry | null> {
    return getReviewedEntry(FIXED_LINE_IDS[kind]);
}

/**
 * EVERYTHING, including the unreviewed rows, the retired ones and the open questions for Ben.
 *
 * Deliberately named and deliberately awkward: this is the admin review screen's read, and nothing
 * else may call it. Its rows are NOT sendable — several of them are
 * drafts a model wrote and questions nobody has answered. `knowledge-base-access.test.ts` walks the
 * repository and fails if a new caller appears.
 */
export async function adminListEveryEntryIncludingUnreviewed(): Promise<KbEntry[]> {
    const rows = await db.select().from(kbEntries)
        .orderBy(asc(kbEntries.status), asc(kbEntries.kind), desc(kbEntries.updatedAt));
    return rows.map(toEntry);
}

// ---------------------------------------------------------------------------- writes (admin only)

export interface KbWriteResult { ok: true; entry: KbEntry }
export interface KbWriteRefusal { ok: false; status: number; errors: string[] }

/** Create an entry. Always lands unreviewed: nothing is born sendable. */
export async function createEntry(draft: KbDraft): Promise<KbWriteResult | KbWriteRefusal> {
    const v = validateDraft(draft);
    if (!v.ok) return { ok: false, status: 400, errors: v.errors };
    const taken = (await db.select({ id: kbEntries.id }).from(kbEntries)).map((r) => r.id);
    const id = (draft.id ?? '').trim() || slugFor(v.value.topic, taken);
    if (taken.includes(id)) return { ok: false, status: 409, errors: [`An entry with the id "${id}" already exists.`] };
    const [row] = await db.insert(kbEntries).values({
        id,
        kind: v.value.kind,
        topic: v.value.topic,
        approvedWords: v.value.approvedWords,
        bannedWords: v.value.bannedWords,
        status: 'unreviewed',
        benNote: v.value.benNote,
        sourceNote: v.value.sourceNote,
    }).returning();
    return { ok: true, entry: toEntry(row) };
}

/**
 * Edit an entry. Changing the words (or the kind) of a reviewed entry drops it back to unreviewed,
 * so Ben reviews what is actually there. Retiring and restoring go through `setStatus`.
 */
export async function updateEntry(id: string, draft: KbDraft): Promise<KbWriteResult | KbWriteRefusal> {
    const v = validateDraft(draft);
    if (!v.ok) return { ok: false, status: 400, errors: v.errors };
    const [existing] = await db.select().from(kbEntries).where(eq(kbEntries.id, id)).limit(1);
    if (!existing) return { ok: false, status: 404, errors: ['No entry with that id.'] };
    const before = toEntry(existing);
    const unmade = before.status === 'reviewed' && editUnmakesReview(before, { kind: v.value.kind, approvedWords: v.value.approvedWords });
    const [row] = await db.update(kbEntries).set({
        kind: v.value.kind,
        topic: v.value.topic,
        approvedWords: v.value.approvedWords,
        bannedWords: v.value.bannedWords,
        benNote: v.value.benNote,
        sourceNote: v.value.sourceNote,
        ...(unmade ? { status: 'unreviewed' as KbStatus, reviewedBy: null, reviewedAt: null } : {}),
        updatedAt: new Date(),
    }).where(eq(kbEntries.id, id)).returning();
    return { ok: true, entry: toEntry(row) };
}

/**
 * Ben's review: one deliberate action, which records WHO and WHEN. `by` is always human:<id> —
 * the review is the only thing standing between a draft and a customer, so a machine can never
 * sign one.
 */
export async function reviewEntry(id: string, by: string): Promise<KbWriteResult | KbWriteRefusal> {
    if (!/^human:/.test(by)) return { ok: false, status: 403, errors: ['Only a person can review an entry.'] };
    const [existing] = await db.select().from(kbEntries).where(eq(kbEntries.id, id)).limit(1);
    if (!existing) return { ok: false, status: 404, errors: ['No entry with that id.'] };
    const entry = toEntry(existing);
    if (entry.kind !== 'answer') return { ok: false, status: 409, errors: ['This is an open question for you, not an answer. Answer it first: write the words you would send, change it to an answer, then review it.'] };
    if (!entry.approvedWords.trim()) return { ok: false, status: 409, errors: ['There are no words to approve yet. Write what you would send, then review it.'] };
    const [row] = await db.update(kbEntries)
        .set({ status: 'reviewed', reviewedBy: by, reviewedAt: new Date(), updatedAt: new Date() })
        .where(eq(kbEntries.id, id)).returning();
    return { ok: true, entry: toEntry(row) };
}

/**
 * Retire an entry (it stops being sendable immediately), or send a reviewed one back to unreviewed.
 * Retiring keeps the row: a reply that cited it a month ago should still resolve to something.
 */
export async function setStatus(id: string, status: Extract<KbStatus, 'unreviewed' | 'retired'>): Promise<KbWriteResult | KbWriteRefusal> {
    if (status !== 'unreviewed' && status !== 'retired') return { ok: false, status: 400, errors: ['Reviewing is its own action.'] };
    const [row] = await db.update(kbEntries)
        .set({ status, reviewedBy: null, reviewedAt: null, updatedAt: new Date() })
        .where(eq(kbEntries.id, id)).returning();
    if (!row) return { ok: false, status: 404, errors: ['No entry with that id.'] };
    return { ok: true, entry: toEntry(row) };
}

/**
 * The seed's write: insert what is missing and leave alone what is there. A row Ben has touched is
 * never overwritten by a re-run, reviewed or not — the seed is a first draft, not the truth.
 */
export async function insertSeedEntryIfMissing(seed: KbDraft & { id: string; topic: string }): Promise<'inserted' | 'kept'> {
    const v = validateDraft(seed);
    if (!v.ok) throw new Error(`Seed entry ${seed.id} is invalid: ${v.errors.join('; ')}`);
    const inserted = await db.insert(kbEntries).values({
        id: seed.id,
        kind: v.value.kind,
        topic: v.value.topic,
        approvedWords: v.value.approvedWords,
        bannedWords: v.value.bannedWords,
        status: 'unreviewed',
        benNote: v.value.benNote,
        sourceNote: v.value.sourceNote,
    }).onConflictDoNothing({ target: kbEntries.id }).returning({ id: kbEntries.id });
    return inserted.length ? 'inserted' : 'kept';
}

/** How many entries are still waiting for Ben — the sidebar badge and the page's own header. */
export async function countUnreviewed(): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(kbEntries).where(eq(kbEntries.status, 'unreviewed'));
    return Number(row?.n ?? 0);
}
