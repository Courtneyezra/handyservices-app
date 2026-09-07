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
                // T17: detectSlaLane reads Route A drafts through a raw from-clause (`personalized_quotes q`,
                // so WAITING_DRAFT_WHERE's `q.` columns resolve); name it from the SQL chunks.
                let name = '';
                if (table && typeof table === 'object' && 'queryChunks' in table) {
                    const text = JSON.stringify((table as any).queryChunks);
                    name = /personalized_quotes/.test(text) ? 'personalized_quotes_raw' : '';
                } else if (table) {
                    name = getTableName(table);
                }
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

import {
    detectSlaLane, flagOwnedByExpiryPath, DEFAULT_SLA_SWEEP_CONFIG, laneDueAt, nextReminderAt, chaseRung, chaseIsBacklog,
    isChaseLane, CHASE_LANES, AGENT_DRAFT_SOURCES, type SlaSweepConfig,
} from './sla-sweep';

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

    // T17: a flag WITH due_at is no longer the sweep's blind spot. It is the ben_flag chase lane,
    // whose clock zero is the due time itself, so the first sweep ping lands
    // lanes.ben_flag.workingHours AFTER the expiry re-ping — never on top of it (the 3 Sep guard's
    // point, kept), and never "nothing" (the S15 review's finding, fixed).
    it('flag WITH due_at → the ben_flag chase lane, clock zero = the due time (not the raise time)', async () => {
        stage({
            agent_questions: [flagged({ dueAt: new Date('2026-09-02T13:00:00Z') })],
            messages: [], message_drafts: [], personalized_quotes: [],
        });
        const det = await detectSlaLane(conv());
        expect(det?.lane).toBe('ben_flag');
        expect(det!.enteredAt.toISOString()).toBe('2026-09-02T13:00:00.000Z');
        expect(det!.detail).toBe('Can we do Saturday?');
    });

    it('flag WITH due_at outranks the verdict lanes (one lane per thread, the flag first)', async () => {
        stage({
            agent_questions: [flagged({ dueAt: new Date('2026-09-02T13:00:00Z') })],
            messages: [], message_drafts: [], personalized_quotes: [],
        });
        const det = await detectSlaLane(conv({
            metadata: { quotePrepIntake: { readiness: 'quote_ready' }, quotePrepAuto: { lastRunAt: '2026-09-02T08:00:00Z' } },
        }));
        expect(det?.lane).toBe('ben_flag');
    });

    it('an ANSWERED flag (dismissed by a human reply, T17) is not a lane at all', async () => {
        stage({
            agent_questions: [flagged({ dueAt: new Date('2026-09-02T13:00:00Z'), answeredAt: new Date('2026-09-02T10:00:00Z') } as any)],
            messages: [], message_drafts: [], personalized_quotes: [],
        });
        expect(await detectSlaLane(conv())).toBeNull();
    });

    it('a human outbound since the flag → no lane, and the humanReplied hook fires (the belt on the way back)', async () => {
        stage({
            agent_questions: [flagged({ dueAt: new Date('2026-09-02T13:00:00Z') })],
            messages: [{ content: 'Hi Sam, Ben here, Saturday is fine', channel: 'whatsapp', quarantinedAt: null, createdAt: new Date('2026-09-02T09:30:00Z') }],
            message_drafts: [], personalized_quotes: [],
        });
        const seen: any[] = [];
        expect(await detectSlaLane(conv(), { humanReplied: (i) => { seen.push(i); } })).toBeNull();
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ conversationId: 'conv_1', phone: '+447700900111' });
        expect(seen[0].flagRaisedAt.toISOString()).toBe('2026-09-02T09:00:00.000Z');
    });

    it('an outbound that is one of OUR sent drafts is not a human reply: the lane stands, the hook stays quiet', async () => {
        stage({
            agent_questions: [flagged({ dueAt: new Date('2026-09-02T13:00:00Z') })],
            messages: [{ content: 'Thanks for your message, we\'ve got it.', channel: 'whatsapp', quarantinedAt: null, createdAt: new Date('2026-09-02T09:12:00Z') }],
            message_drafts: [{ body: 'Thanks for your message, we\'ve got it.\n---\nJust looking at it now, we\'ll come back to you shortly.' }],
            personalized_quotes: [],
        });
        const seen: any[] = [];
        const det = await detectSlaLane(conv(), { humanReplied: (i) => { seen.push(i); } });
        expect(det?.lane).toBe('ben_flag');
        expect(seen).toHaveLength(0);
    });

    it('a thread without the needs_ben tag never reads the flag at all', async () => {
        stage({ agent_questions: [flagged()], messages: [], message_drafts: [], personalized_quotes: [] });
        expect(await detectSlaLane(conv({ tags: [] }))).toBeNull();
    });
});

// ---------------------------------------------------------------- T17: the chase ladder

const CFG: SlaSweepConfig = DEFAULT_SLA_SWEEP_CONFIG;
const at = (iso: string) => new Date(iso);

describe('T17 · the pending_draft and price_draft lanes', () => {
    it('a pending agent draft past its due time → pending_draft, clock zero = the due time', async () => {
        stage({
            agent_questions: [], messages: [], personalized_quotes: [],
            message_drafts: [{ id: 'd1', body: 'Hi Sam, which room is the tap in?', dueAt: new Date('2026-09-02T14:00:00Z'), source: 'spine' }],
        });
        const det = await detectSlaLane(conv({ tags: [] }));
        expect(det?.lane).toBe('pending_draft');
        expect(det!.enteredAt.toISOString()).toBe('2026-09-02T14:00:00.000Z');
        expect(det!.detail).toMatch(/^spine draft: Hi Sam, which room/);
    });

    it('the pending_draft lane is due AT its clock zero (there is no ping for a pending draft today)', () => {
        expect(CFG.lanes.pending_draft.workingHours).toBe(0);
        const due = laneDueAt({ lane: 'pending_draft', enteredAt: at('2026-09-02T14:00:00Z') }, CFG);
        expect(due.toISOString()).toBe('2026-09-02T14:00:00.000Z');
    });

    it('a Route A draft waiting to be priced → price_draft, clock zero = its creation, link to the price screen', async () => {
        stage({
            agent_questions: [], messages: [], message_drafts: [],
            personalized_quotes_raw: [{ slug: 'ab12cd', createdAt: '2026-09-02T11:00:00.000Z', customerName: 'Sam Jones' }],
        });
        const det = await detectSlaLane(conv({ tags: [] }));
        expect(det?.lane).toBe('price_draft');
        expect(det!.enteredAt.toISOString()).toBe('2026-09-02T11:00:00.000Z');
        expect(det!.href).toBe('/admin/price/ab12cd');
    });

    it('precedence: the flag outranks the draft outranks the price draft', async () => {
        stage({
            agent_questions: [flagged({ dueAt: new Date('2026-09-02T13:00:00Z') })],
            messages: [],
            message_drafts: [{ id: 'd1', body: 'x', dueAt: new Date('2026-09-02T14:00:00Z'), source: 'spine' }],
            personalized_quotes_raw: [{ slug: 'ab12cd', createdAt: '2026-09-02T11:00:00.000Z', customerName: 'Sam' }],
        });
        expect((await detectSlaLane(conv()))?.lane).toBe('ben_flag');
        stage({
            agent_questions: [], messages: [],
            message_drafts: [{ id: 'd1', body: 'x', dueAt: new Date('2026-09-02T14:00:00Z'), source: 'comms_agent' }],
            personalized_quotes_raw: [{ slug: 'ab12cd', createdAt: '2026-09-02T11:00:00.000Z', customerName: 'Sam' }],
        });
        expect((await detectSlaLane(conv({ tags: [] })))?.lane).toBe('pending_draft');
    });

    it('only agent drafts count: the rules layer\'s own lines and acks are never a chase', () => {
        expect(AGENT_DRAFT_SOURCES).toEqual(['spine', 'comms_agent']);
        expect(AGENT_DRAFT_SOURCES).not.toContain('rules_layer');
        expect(AGENT_DRAFT_SOURCES).not.toContain('first_contact_ack');
    });
});

describe('T17 · the ladder\'s arithmetic (pure)', () => {
    it('N and M come from the working-hours model: 4 (the desk\'s unit) and 12 (one BEN_HOURS working day)', () => {
        expect(CFG.chase.everyWorkingHours).toBe(4);
        expect(CFG.chase.escalateAfterWorkingHours).toBe(12);
        expect(CFG.lanes.ben_flag.workingHours).toBe(4);
        expect(CFG.lanes.price_draft.workingHours).toBe(4);
        expect(CHASE_LANES).toEqual(['ben_flag', 'pending_draft', 'price_draft']);
        expect(isChaseLane('quote_ready')).toBe(false);
    });

    it('the first chase on a flag lands N working hours AFTER the expiry re-ping, never on top of it', () => {
        // The test mocks addWorkingHours as plain hours; the point is the offset from the due time.
        const due = laneDueAt({ lane: 'ben_flag', enteredAt: at('2026-09-07T12:42:00Z') }, CFG);
        expect(due.toISOString()).toBe('2026-09-07T16:42:00.000Z');
    });

    it('chase lanes remind every N working hours; the verdict lanes keep the daily clock-hour cadence', () => {
        const last = at('2026-09-07T16:42:00Z');
        expect(nextReminderAt('ben_flag', last, CFG).toISOString()).toBe('2026-09-07T20:42:00.000Z');
        expect(nextReminderAt('quote_ready', last, CFG).toISOString()).toBe('2026-09-08T16:42:00.000Z');
    });

    it('rung titles are distinct and escalate at M: chase 1, chase 2, then the owner\'s title', () => {
        // Monday 7 Sep 2026, flag due 12:42 UK (11:42Z, BST). BEN_HOURS is 08–20 daily.
        const det = { lane: 'ben_flag' as const, enteredAt: at('2026-09-07T11:42:00Z') };
        const r1 = chaseRung(det, 1, at('2026-09-07T15:42:00Z'), CFG);   // +4 working hours
        const r2 = chaseRung(det, 2, at('2026-09-08T07:42:00Z'), CFG);   // next morning 08:42 UK = +8
        const r3 = chaseRung(det, 3, at('2026-09-08T11:42:00Z'), CFG);   // 12:42 UK Tue = +12 → owner
        expect(r1).toMatchObject({ rung: 1, escalated: false });
        expect(r1.title).toBe('⏳ Chase 1: flagged thread still with you, 4 working hours past due');
        expect(r2).toMatchObject({ rung: 2, escalated: false });
        expect(r2.title).toMatch(/^⏳ Chase 2: flagged thread still with you, 8 working hours past due$/);
        expect(r3).toMatchObject({ rung: 3, escalated: true });
        expect(r3.title).toBe('🚨 Escalated: flagged thread — 12 working hours with nobody moving (chase 3)');
        expect(new Set([r1.title, r2.title, r3.title]).size).toBe(3);
    });

    it('a chase older than chase.maxAgeDays is backlog for the digest, not a live chase; verdict lanes are untouched', () => {
        const now = at('2026-09-10T12:00:00Z');
        expect(chaseIsBacklog('ben_flag', at('2026-09-06T12:00:00Z'), now, CFG)).toBe(true);
        expect(chaseIsBacklog('ben_flag', at('2026-09-08T12:00:00Z'), now, CFG)).toBe(false);
        expect(chaseIsBacklog('quote_ready', at('2026-08-01T12:00:00Z'), now, CFG)).toBe(false);
    });
});
