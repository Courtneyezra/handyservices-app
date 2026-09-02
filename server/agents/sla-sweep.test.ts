/**
 * Close-out (3 Sep 2026): the needs_ben double-ping guard, with fakes. No database, no Pushover.
 *
 * P1-silence left one known double: a flagged agent_questions row that carries a `due_at` is
 * chased by silence-breaker's expireFlags (holding line + ONE re-ping at due time), and the same
 * stale flag also breached this sweep's needs_ben lane, so Ben got two pings for one flag. The
 * guard: a flag with a due time is not a needs_ben lane for this sweep.
 */
import { describe, it, expect, vi } from 'vitest';

const fake = vi.hoisted(() => ({ rows: new Map<string, any[]>() }));

vi.mock('../db', async () => {
    const { getTableName } = await import('drizzle-orm');
    // Chainable thenable: select().from(t).where().orderBy().limit() resolves to the rows staged
    // for that table. Every read the lane detector makes goes through this one shape.
    const select = () => {
        let table: any = null;
        const b: any = {
            from(t: any) { table = t; return b; },
            where() { return b; },
            orderBy() { return b; },
            limit() { return b; },
            then(res: any, rej: any) {
                const name = table ? getTableName(table) : '';
                return Promise.resolve(fake.rows.get(name) ?? []).then(res, rej);
            },
        };
        return b;
    };
    return { db: { select } };
});
vi.mock('./promise-tracker', () => ({ addWorkingHours: (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000) }));
vi.mock('../comms-events', () => ({ emitCommsEvent: () => undefined }));
vi.mock('../approver', () => ({ newRunId: (p: string) => `${p}_test` }));

import { detectSlaLane, flagOwnedByExpiryPath } from './sla-sweep';

const conv = (over: Partial<{ tags: string[]; metadata: unknown }> = {}) => ({
    id: 'conv_1', phoneNumber: '447700900111@c.us', contactName: 'Test', tags: ['needs_ben'], metadata: {}, ...over,
});
const flagged = (over: Partial<{ dueAt: Date | null; createdAt: Date; question: string }> = {}) => ({
    createdAt: new Date('2026-09-02T09:00:00Z'), question: 'Can we do Saturday?', dueAt: null, ...over,
});
function stage(rows: Record<string, any[]>) {
    fake.rows.clear();
    for (const [k, v] of Object.entries(rows)) fake.rows.set(k, v);
}

describe('flagOwnedByExpiryPath (pure)', () => {
    it('a flag with a due time belongs to the expiry path', () => {
        expect(flagOwnedByExpiryPath({ dueAt: new Date('2026-09-02T13:00:00Z') })).toBe(true);
        expect(flagOwnedByExpiryPath({ dueAt: '2026-09-02T13:00:00Z' })).toBe(true);
    });
    it('a legacy flag without one is the sweep\'s', () => {
        expect(flagOwnedByExpiryPath({ dueAt: null })).toBe(false);
        expect(flagOwnedByExpiryPath({ dueAt: undefined })).toBe(false);
    });
});

describe('detectSlaLane · needs_ben double-ping guard', () => {
    it('legacy flag (no due_at), no movement → needs_ben lane, clock = flag time', async () => {
        stage({ agent_questions: [flagged()], messages: [], message_drafts: [], personalized_quotes: [] });
        const det = await detectSlaLane(conv());
        expect(det).not.toBeNull();
        expect(det!.lane).toBe('needs_ben');
        expect(det!.enteredAt.toISOString()).toBe('2026-09-02T09:00:00.000Z');
        expect(det!.detail).toBe('Can we do Saturday?');
    });

    it('flag WITH due_at → no needs_ben lane (the expiry path already pings once)', async () => {
        stage({
            agent_questions: [flagged({ dueAt: new Date('2026-09-02T13:00:00Z') })],
            messages: [], message_drafts: [], personalized_quotes: [],
        });
        expect(await detectSlaLane(conv())).toBeNull();
    });

    it('flag WITH due_at falls through to the verdict lanes instead of short-circuiting', async () => {
        stage({
            agent_questions: [flagged({ dueAt: new Date('2026-09-02T13:00:00Z') })],
            messages: [], message_drafts: [], personalized_quotes: [],
        });
        const det = await detectSlaLane(conv({
            metadata: { quotePrepIntake: { readiness: 'quote_ready' }, quotePrepAuto: { lastRunAt: '2026-09-02T08:00:00Z' } },
        }));
        expect(det?.lane).toBe('quote_ready');
    });

    it('a thread without the needs_ben tag never reads the flag at all', async () => {
        stage({ agent_questions: [flagged()], messages: [], message_drafts: [], personalized_quotes: [] });
        expect(await detectSlaLane(conv({ tags: [] }))).toBeNull();
    });
});
