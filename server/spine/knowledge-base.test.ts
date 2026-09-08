/**
 * Build plan v2, item 3.4 — the knowledge base's rails.
 *
 * The one property everything else rests on: NOTHING that could reach a customer can see an
 * unreviewed entry, a retired one, or an open question for Ben. This suite pins that at every
 * level it is enforced (the predicate, the accessors' SQL, the code re-filter, the review action,
 * the seed's shape) and proves the migration is additive.
 *
 * `db` is a stub that records the query it was handed, so the accessors' WHERE clauses can be
 * inspected without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A drizzle-shaped stub. `select().from().where().orderBy()` and `.limit()` both resolve to
 * `rows`, and the SQL the accessor built is captured for inspection.
 */
const state: { rows: any[]; whereSql: string; updated: any } = { rows: [], whereSql: '', updated: null };

/**
 * Drizzle's condition objects are cyclic (a column points at its table, which points back), so the
 * stub collects the string literals out of the tree instead of stringifying it. That is enough to
 * assert "this query filtered on 'reviewed' and 'answer'".
 */
function literals(node: unknown, seen = new Set<unknown>(), out: string[] = []): string {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object' && !seen.has(node)) {
        seen.add(node);
        for (const v of Object.values(node as Record<string, unknown>)) literals(v, seen, out);
    }
    return out.join(' ');
}

function chain(): any {
    const self: any = {
        from: () => self,
        where: (w: any) => { state.whereSql = literals(w); return self; },
        orderBy: () => Promise.resolve(state.rows),
        limit: () => Promise.resolve(state.rows),
        set: (v: any) => { state.updated = v; return self; },
        values: () => self,
        onConflictDoNothing: () => self,
        returning: () => Promise.resolve(state.rows),
        then: (res: any) => Promise.resolve(state.rows).then(res),
    };
    return self;
}

vi.mock('../db', () => ({
    db: { select: () => chain(), update: () => chain(), insert: () => chain(), delete: () => chain() },
    pool: {},
}));

import {
    isSendable, sendableEntries, slugFor, validateDraft, editUnmakesReview, toEntry,
    listReviewedEntries, getReviewedEntry, getFixedLine, adminListEveryEntryIncludingUnreviewed,
    reviewEntry, updateEntry, setStatus, FIXED_LINE_IDS,
    type KbEntry,
} from './knowledge-base';
import { KB_SEED, SEED_QUESTIONS, SEED_ANSWERS, SEED_FIXED_LINES } from './knowledge-base-seed';

const row = (over: Partial<any> = {}) => ({
    id: 'areas-covered', kind: 'answer', topic: 'Which areas do you cover?',
    approvedWords: 'We are Nottingham based.', bannedWords: ['nationwide'],
    status: 'reviewed', reviewedBy: 'human:ben', reviewedAt: new Date('2026-09-08T09:00:00Z'),
    benNote: null, sourceNote: null,
    createdAt: new Date('2026-09-08T08:00:00Z'), updatedAt: new Date('2026-09-08T09:00:00Z'),
    ...over,
});

beforeEach(() => { state.rows = []; state.whereSql = ''; state.updated = null; });

describe('3.4: the sendable predicate — the rule everything customer-facing rests on', () => {
    const base = { kind: 'answer' as const, status: 'reviewed' as const, approvedWords: 'Yes, we cover Derby.' };
    it('a reviewed answer with words is sendable', () => {
        expect(isSendable(base)).toBe(true);
    });
    it('nothing else is: not unreviewed, not retired, not a question, not blank', () => {
        expect(isSendable({ ...base, status: 'unreviewed' })).toBe(false);
        expect(isSendable({ ...base, status: 'retired' })).toBe(false);
        expect(isSendable({ ...base, kind: 'question' })).toBe(false);
        expect(isSendable({ ...base, approvedWords: '   ' })).toBe(false);
        expect(isSendable({ ...base, approvedWords: '' })).toBe(false);
    });
    it('an unknown status or kind from the database fails CLOSED, never open', () => {
        expect(toEntry(row({ status: 'approved-ish' }) as any).status).toBe('unreviewed');
        expect(toEntry(row({ kind: 'fact' }) as any).kind).toBe('question');
        expect(isSendable(toEntry(row({ status: 'approved-ish' }) as any))).toBe(false);
        expect(isSendable(toEntry(row({ kind: 'fact' }) as any))).toBe(false);
    });
});

describe('3.4: the reviewed-only accessor never returns an unreviewed entry', () => {
    it('listReviewedEntries filters on status AND kind in the SQL', async () => {
        state.rows = [row()];
        await listReviewedEntries();
        expect(state.whereSql).toContain('reviewed');
        expect(state.whereSql).toContain('answer');
    });
    it('and re-filters in code, so a query that returned the wrong set still returns nothing', async () => {
        // The stub ignores the WHERE and hands back rows the SQL would never have matched.
        state.rows = [
            row({ id: 'draft', status: 'unreviewed' }),
            row({ id: 'retired', status: 'retired' }),
            row({ id: 'q', kind: 'question', approvedWords: '' }),
            row({ id: 'blank', approvedWords: '' }),
        ];
        expect(await listReviewedEntries()).toEqual([]);
    });
    it('the one good row survives, alongside four that must not', async () => {
        state.rows = [row({ id: 'draft', status: 'unreviewed' }), row({ id: 'live' }), row({ id: 'q', kind: 'question', approvedWords: '' })];
        const out = await listReviewedEntries();
        expect(out.map((e) => e.id)).toEqual(['live']);
    });
    it('getReviewedEntry returns null for an unreviewed row even when the query hands one back', async () => {
        state.rows = [row({ status: 'unreviewed' })];
        expect(await getReviewedEntry('areas-covered')).toBeNull();
        state.rows = [row()];
        expect((await getReviewedEntry('areas-covered'))?.id).toBe('areas-covered');
        expect(await getReviewedEntry('')).toBeNull();
    });
    it('getFixedLine is the same reviewed-only read: an unreviewed fixed line is no fixed line', async () => {
        state.rows = [row({ id: FIXED_LINE_IDS.gas, status: 'unreviewed' })];
        expect(await getFixedLine('gas')).toBeNull();
        state.rows = [row({ id: FIXED_LINE_IDS.gas })];
        expect((await getFixedLine('gas'))?.id).toBe(FIXED_LINE_IDS.gas);
    });
    it('the admin read is the ONLY one that sees a draft, and it is named so you cannot call it by accident', async () => {
        state.rows = [row({ status: 'unreviewed' }), row({ id: 'q', kind: 'question', approvedWords: '' })];
        const all = await adminListEveryEntryIncludingUnreviewed();
        expect(all.map((e) => e.status)).toEqual(['unreviewed', 'reviewed']);
        expect(all).toHaveLength(2);
    });
});

describe('3.4: reviewing records who and when', () => {
    it('a review writes status, the person and the time', async () => {
        state.rows = [row({ status: 'unreviewed', reviewedBy: null, reviewedAt: null })];
        const before = Date.now();
        const r = await reviewEntry('areas-covered', 'human:ben@handyservices.app');
        expect(r.ok).toBe(true);
        expect(state.updated.status).toBe('reviewed');
        expect(state.updated.reviewedBy).toBe('human:ben@handyservices.app');
        expect(state.updated.reviewedAt).toBeInstanceOf(Date);
        expect(state.updated.reviewedAt.getTime()).toBeGreaterThanOrEqual(before);
    });
    it('a machine can never sign a review', async () => {
        state.rows = [row({ status: 'unreviewed' })];
        for (const by of ['agent:scoper', 'system:seed', 'rules.ack', '', 'ben']) {
            const r = await reviewEntry('areas-covered', by);
            expect(r).toMatchObject({ ok: false, status: 403 });
        }
        expect(state.updated).toBeNull();
    });
    it('an open question cannot be reviewed into an answer, and a blank entry cannot be reviewed at all', async () => {
        state.rows = [row({ kind: 'question', approvedWords: '', status: 'unreviewed', benNote: 'the website says…' })];
        expect(await reviewEntry('q', 'human:ben')).toMatchObject({ ok: false, status: 409 });
        state.rows = [row({ approvedWords: '   ', status: 'unreviewed' })];
        expect(await reviewEntry('blank', 'human:ben')).toMatchObject({ ok: false, status: 409 });
        expect(state.updated).toBeNull();
    });
    it('retiring and un-reviewing both clear the reviewer, so nothing carries a stale approval', async () => {
        state.rows = [row()];
        await setStatus('areas-covered', 'retired');
        expect(state.updated).toMatchObject({ status: 'retired', reviewedBy: null, reviewedAt: null });
        await setStatus('areas-covered', 'unreviewed');
        expect(state.updated).toMatchObject({ status: 'unreviewed', reviewedBy: null, reviewedAt: null });
    });
});

describe('3.4: editing the words of a reviewed entry unmakes the review', () => {
    it('the pure rule: different words, or a different kind, unmakes it', () => {
        const before = { kind: 'answer' as const, approvedWords: 'We cover Derby.' };
        expect(editUnmakesReview(before, { kind: 'answer', approvedWords: 'We cover Derby and Leicester.' })).toBe(true);
        expect(editUnmakesReview(before, { kind: 'question', approvedWords: 'We cover Derby.' })).toBe(true);
        expect(editUnmakesReview(before, { kind: 'answer', approvedWords: '  We cover Derby.  ' })).toBe(false);
    });
    it('through updateEntry: changing the words drops the row back to unreviewed', async () => {
        state.rows = [row()];
        await updateEntry('areas-covered', { topic: 'Which areas do you cover?', approvedWords: 'We cover Derby too now.' });
        expect(state.updated).toMatchObject({ status: 'unreviewed', reviewedBy: null, reviewedAt: null });
    });
    it('but fixing a typo in the topic alone leaves the review standing', async () => {
        state.rows = [row()];
        await updateEntry('areas-covered', { topic: 'What areas do you cover?', approvedWords: 'We are Nottingham based.' });
        expect(state.updated.status).toBeUndefined();
        expect(state.updated.topic).toBe('What areas do you cover?');
    });
});

describe('3.4: what the write path accepts', () => {
    it('a topic is required; a question needs its question and may carry no words', () => {
        expect(validateDraft({ topic: '  ' })).toMatchObject({ ok: false });
        expect(validateDraft({ kind: 'question', topic: 'Is the quote free?' })).toMatchObject({ ok: false });
        expect(validateDraft({ kind: 'question', topic: 'Is the quote free?', benNote: 'the website says X, the rules say Y' })).toMatchObject({ ok: true });
        const withWords = validateDraft({ kind: 'question', topic: 'Is the quote free?', benNote: 'X vs Y', approvedWords: 'Yes, free!' });
        expect(withWords.ok).toBe(false);
        expect((withWords as { ok: false; errors: string[] }).errors.join(' ')).toMatch(/question, not an answer/);
    });
    it('an answer may be saved blank: it just cannot be reviewed until it has words', () => {
        expect(validateDraft({ topic: 'How soon can you come?' })).toMatchObject({ ok: true });
    });
    it('slugFor makes a readable citation id and never collides', () => {
        expect(slugFor('Which areas do you cover?')).toBe('which-areas-do-you-cover');
        expect(slugFor('Is the quote free?', ['is-the-quote-free'])).toBe('is-the-quote-free-2');
        expect(slugFor('!!!')).toMatch(/^entry-\d+$/);
    });
});

describe('3.4: the seed', () => {
    it('every seed row is valid, and every id is unique', () => {
        for (const s of KB_SEED) expect(validateDraft(s), s.id).toMatchObject({ ok: true });
        expect(new Set(KB_SEED.map((s) => s.id)).size).toBe(KB_SEED.length);
    });
    it('nothing in the seed is born sendable: none of it declares a status at all', () => {
        for (const s of KB_SEED) expect(s, s.id).not.toHaveProperty('status');
        // …and as a row it would be unreviewed, so nothing in the seed passes the predicate.
        for (const s of KB_SEED) {
            expect(isSendable({ kind: s.kind ?? 'answer', status: 'unreviewed', approvedWords: s.approvedWords ?? '' }), s.id).toBe(false);
        }
    });
    it('the four website contradictions are stored as QUESTIONS and can never be an answer', () => {
        const ids = SEED_QUESTIONS.map((q) => q.id);
        expect(ids).toEqual([
            'question-is-the-quote-free',
            'question-call-out-charge',
            'question-gas-safe-engineers',
            'question-put-it-right-at-no-charge',
        ]);
        for (const q of SEED_QUESTIONS) {
            expect(q.kind, q.id).toBe('question');
            expect((q.approvedWords ?? '').trim(), q.id).toBe('');
            // it says what the website claims AND what the rules say, so he can settle it
            expect(q.benNote, q.id).toMatch(/THE WEBSITE SAYS|THE CALL SCRIPTS SAY/);
            expect(q.benNote, q.id).toMatch(/RULES SAY/);
            expect(isSendable({ kind: 'question', status: 'reviewed', approvedWords: q.approvedWords ?? '' }), q.id).toBe(false);
        }
    });
    it('no seeded ANSWER asserts one of the four forbidden claims', () => {
        const forbidden = [/free quote/i, /quotes are free/i, /no call.?out charge/i, /gas safe registered/i, /at no charge/i, /fix it free/i];
        for (const a of [...SEED_ANSWERS, ...SEED_FIXED_LINES]) {
            for (const re of forbidden) expect(a.approvedWords ?? '', `${a.id} / ${re}`).not.toMatch(re);
        }
    });
    it('covers the six topics the item names, plus the four fixed lines', () => {
        const ids = SEED_ANSWERS.map((a) => a.id);
        for (const needed of ['areas-covered', 'how-quoting-works', 'deposit-and-payment', 'guarantee', 'what-we-do-not-do', 'what-happens-on-the-day']) {
            expect(ids, needed).toContain(needed);
        }
        expect(SEED_FIXED_LINES.map((f) => f.id)).toEqual([FIXED_LINE_IDS.gas, FIXED_LINE_IDS.complaint, FIXED_LINE_IDS.refund, FIXED_LINE_IDS.trust]);
        for (const f of SEED_FIXED_LINES) expect((f.approvedWords ?? '').trim(), f.id).not.toBe('');
    });
    it('the drafts keep the house voice: no em dashes, no money figures, no dates', () => {
        for (const s of KB_SEED) {
            const words = s.approvedWords ?? '';
            expect(words, s.id).not.toMatch(/—/);
            expect(words, s.id).not.toMatch(/£\s?\d/);
            expect(words, s.id).not.toMatch(/\b\d+\s?(days?|weeks?|hours?|minutes?)\b/i);
        }
    });
});

describe('3.4: the migration is additive', () => {
    const sql = readFileSync(join(process.cwd(), 'migrations/20260908_kb_entries.sql'), 'utf8');
    it('creates one new table and nothing else, and drops nothing but its own constraints', () => {
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kb_entries/);
        expect(sql).not.toMatch(/DROP TABLE/i);
        expect(sql).not.toMatch(/DROP COLUMN/i);
        expect(sql).not.toMatch(/\bTRUNCATE\b/i);
        expect(sql).not.toMatch(/\bDELETE FROM\b/i);
        // every ALTER touches kb_entries only
        for (const m of sql.matchAll(/ALTER TABLE (\w+)/g)) expect(m[1]).toBe('kb_entries');
        // and every DROP is the idempotent "drop my own constraint before adding it" pair
        for (const m of sql.matchAll(/DROP CONSTRAINT IF EXISTS (\w+)/g)) expect(m[1]).toMatch(/^kb_entries_/);
    });
    it('is re-runnable: every create is guarded', () => {
        expect(sql.match(/CREATE TABLE/g)?.length).toBe(sql.match(/CREATE TABLE IF NOT EXISTS/g)?.length);
        expect(sql.match(/CREATE INDEX/g)?.length).toBe(sql.match(/CREATE INDEX IF NOT EXISTS/g)?.length);
    });
    it('carries the rails in the table, not only in the accessor', () => {
        // a reviewed row must be an answer, with words, reviewed by a named person at a known time
        expect(sql).toMatch(/status <> 'reviewed'[\s\S]*kind = 'answer'[\s\S]*btrim\(approved_words\) <> ''[\s\S]*reviewed_by IS NOT NULL[\s\S]*reviewed_at IS NOT NULL/);
        // a question can never carry words that could be sent
        expect(sql).toMatch(/kind <> 'question' OR \(btrim\(approved_words\) = ''/);
    });
});
