/**
 * T35 (8 Sep 2026) — "we need this comms to be autonomous and stop the templated messages and
 * reply quick" (the captain, after watching his own WhatsApp test go unanswered and then answered
 * by a canned line).
 *
 * Three coupled changes, and this file is the proof for all three:
 *
 *   1. the inbound debounce is SECONDS (server/spine/config.ts DEBOUNCE_SECONDS), and it is still
 *      a debounce — a burst two messages long still produces ONE run
 *   2. the ten-minute silence holding line no longer has a trigger (the assertion lives with the
 *      clock, in server/agents/silence-clock.test.ts; the tie is named here)
 *   3. the four PRD v3 §5.1 intents start at SEND on customer.default, and every rail the money
 *      guard, the exceptions and the send preconditions put in front of them still holds
 *
 * Pure: the config is process-local, the database is a stub that records the write.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** The one real db call requestRun makes is captured here; nothing connects. */
const written: Array<Record<string, unknown>> = [];
let conversationRow: Record<string, unknown> | null = { id: 'c1', phoneNumber: '+447700123456', archivedAt: null };

vi.mock('../db', () => ({
    db: {
        select: () => ({ from: () => ({ where: async () => (conversationRow ? [conversationRow] : []) }) }),
        update: () => ({ set: (patch: Record<string, unknown>) => { written.push(patch); return { where: () => ({ returning: async () => [{ id: 'c1' }] }) }; } }),
        execute: async () => ({ rows: [] }),
    },
}));

import { DEBOUNCE_SECONDS, clampDebounceSeconds, DEFAULT_SPINE_CONFIG, useProcessLocalSpineConfig, _resetSpineConfigForTests, getSpineConfig } from './config';
import { debounceDelayMs, DEBOUNCED_TRIGGERS, requestRun } from './request-run';
import { decide } from './decide';
import { getPack } from './packs';
import { PRECONDITIONED_INTENTS } from './send-preconditions';
import { SILENCE_LANES } from '../agents/silence-breaker';
import type { CaseFile, GuardVerdict, Proposal, TriageResult } from './types';

const NOW = new Date('2026-09-08T10:00:00Z'); // 11:00 UK — inside every window

beforeEach(() => {
    written.length = 0;
    conversationRow = { id: 'c1', phoneNumber: '+447700123456', archivedAt: null };
    useProcessLocalSpineConfig({ enabled: true, mode: 'live' });
});
afterEach(() => {
    _resetSpineConfigForTests();
    vi.useRealTimers();
});

// ---------------------------------------------------------------- 1. the reply delay

describe('the inbound debounce is a pause, not a wait', () => {
    it('the code default is seconds, and lands where a person typing back would', () => {
        expect(DEFAULT_SPINE_CONFIG.debounceSeconds).toBe(DEBOUNCE_SECONDS.dflt);
        expect(DEFAULT_SPINE_CONFIG.debounceSeconds).toBeGreaterThanOrEqual(3);
        expect(DEFAULT_SPINE_CONFIG.debounceSeconds).toBeLessThanOrEqual(15);
    });

    it('the floor is the config bound, not a stray max() — a tiny value is 3s, never 0', () => {
        expect(debounceDelayMs({ debounceSeconds: 0 }, 'inbound_message')).toBe(DEBOUNCE_SECONDS.min * 1_000);
        expect(debounceDelayMs({ debounceSeconds: 1 }, 'inbound_message')).toBe(DEBOUNCE_SECONDS.min * 1_000);
        expect(debounceDelayMs({ debounceSeconds: 8 }, 'inbound_message')).toBe(8_000);
        expect(debounceDelayMs({ debounceSeconds: 8 }, 'media_received')).toBe(8_000);
    });

    it('only the customer\'s own typing waits; every other trigger runs at once', () => {
        expect([...DEBOUNCED_TRIGGERS]).toEqual(['inbound_message', 'media_received']);
        for (const t of ['cadence', 'manual', 'call_ended', 'flag_expiry'] as const) {
            expect(debounceDelayMs({ debounceSeconds: 8 }, t), t).toBe(0);
        }
        // A caller's own override still wins (the sandbox, the sweeps).
        expect(debounceDelayMs({ debounceSeconds: 8 }, 'inbound_message', 0)).toBe(0);
    });

    it('a row cannot put minutes back in front of a customer: the value is bounded on READ', async () => {
        expect(clampDebounceSeconds(600)).toBe(DEBOUNCE_SECONDS.max);
        expect(clampDebounceSeconds(-5)).toBe(DEBOUNCE_SECONDS.min);
        expect(clampDebounceSeconds(undefined)).toBe(DEBOUNCE_SECONDS.dflt);
        expect(clampDebounceSeconds('10' as unknown)).toBe(DEBOUNCE_SECONDS.dflt);
        _resetSpineConfigForTests();
        // The shape of the LIVE row today: the retired key, at ten minutes. It reads as the new
        // default, which is what makes the deploy alone enough (see the report).
        useProcessLocalSpineConfig({ enabled: true, debounceMinutes: 10 } as never);
        const cfg = await getSpineConfig();
        expect(cfg.debounceSeconds).toBe(DEBOUNCE_SECONDS.dflt);
        expect((cfg as Record<string, unknown>).debounceMinutes).toBeUndefined();
    });
});

describe('a burst still gets ONE reply', () => {
    /**
     * The due time requestRun wrote, read back out of the recorded drizzle fragment. The fragment
     * is a tree of query chunks whose bound parameters carry the values, and it holds a reference
     * back to the table, so it is walked rather than stringified.
     */
    function isoTimestampsIn(node: unknown, found: string[] = [], seen = new Set<unknown>()): string[] {
        if (node == null || typeof node !== 'object') {
            if (typeof node === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(node)) found.push(node);
            return found;
        }
        if (seen.has(node)) return found;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const item of node) isoTimestampsIn(item, found, seen);
            return found;
        }
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (key === 'table') continue;               // the fragment points back at the schema
            isoTimestampsIn(value, found, seen);
        }
        return found;
    }

    function lastDueAt(): number {
        const stamps = isoTimestampsIn(written.at(-1));
        expect(stamps, 'no due time in the recorded write').toHaveLength(1);
        return new Date(stamps[0]).getTime();
    }

    it('two messages three seconds apart leave one due time, and it is the SECOND one', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        expect(await requestRun('c1', 'inbound_message')).toEqual({ queued: true });
        const firstDue = lastDueAt();
        expect(firstDue).toBe(NOW.getTime() + DEBOUNCE_SECONDS.dflt * 1_000);

        // "hi" … three seconds … "it's the tap in the kitchen"
        vi.setSystemTime(new Date(NOW.getTime() + 3_000));
        expect(await requestRun('c1', 'inbound_message')).toEqual({ queued: true });
        const secondDue = lastDueAt();

        // Latest writer wins: the row now holds ONE due time, pushed out by the second message.
        expect(written).toHaveLength(2);
        expect(secondDue).toBe(NOW.getTime() + 3_000 + DEBOUNCE_SECONDS.dflt * 1_000);
        expect(secondDue).toBeGreaterThan(firstDue);

        // So a worker tick at the FIRST message's due time finds nothing due, and the single run
        // happens at the second's — one reply, to both messages, exactly as the ten-minute
        // version behaved.
        expect(secondDue > firstDue).toBe(true);
        const tickAtFirstDue = firstDue;
        expect(tickAtFirstDue >= secondDue).toBe(false); // `nextTriageAt <= now` is the tick's rule
    });

    it('a message on a thread that has gone (or a test number) queues nothing at all', async () => {
        conversationRow = null;
        expect(await requestRun('c1', 'inbound_message')).toMatchObject({ queued: false });
        conversationRow = { id: 'c1', phoneNumber: '+447700900123', archivedAt: null }; // Ofcom test range
        expect(await requestRun('c1', 'inbound_message')).toMatchObject({ queued: false, reason: 'test number' });
        expect(written).toHaveLength(0);
    });
});

// ---------------------------------------------------------------- 2. the templated line

describe('the ten-minute holding line is not a routine reply any more', () => {
    it('no lane on the one clock fires it (the rest of the claim is in silence-clock.test.ts)', () => {
        expect(SILENCE_LANES.map((l) => l.reason)).not.toContain('silence');
        expect(SILENCE_LANES.map((l) => l.reason)).toEqual(['flag_expiry', 'draft_expiry']);
    });

    it('the pack still names the holding template and still forbids sending it as a reply', () => {
        const pack = getPack('customer.default');
        expect(pack.templates.holding).toBe('holding_line');
        expect(pack.neverSend).toContain('holding');
    });
});

// ---------------------------------------------------------------- 3. the Scoper's reply sends

const cf = (over: Partial<CaseFile> = {}): CaseFile => ({
    conversationId: 'c1', phone: '+447700123456', audience: 'customer', stage: 'scoping', contactName: 'Sam',
    timeline: [{ kind: 'message_in', at: new Date(NOW.getTime() - 60_000).toISOString(), body: 'my kitchen tap drips' }],
    media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: new Date(NOW.getTime() - 60_000).toISOString(), channelLastUsed: 'whatsapp' },
    client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: NOW.toISOString(),
    ...over,
});
const tri = (over: Partial<TriageResult> = {}): TriageResult => ({ audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [], reasons: ['r'], source: 'rules', ...over });
const prop = (over: Partial<Proposal> = {}): Proposal => ({ intent: 'ask_gap', body: ['Which room is the tap in.'], reasons: ['gap'], ...over });
const guardsOk: GuardVerdict = { ok: true, guardsHit: [], escalate: false, notes: [] };

describe('the four promoted intents', () => {
    const pack = getPack('customer.default');

    it('are exactly PRD v3 §5.1, and nothing else moved', () => {
        expect(pack.tierByIntent).toEqual({
            ask_gap: 'SEND', confirm_received: 'SEND', point_to_quote_page: 'SEND', point_to_picker: 'SEND',
        });
        expect(Object.keys(pack.tierByIntent).sort()).toEqual([...PRECONDITIONED_INTENTS].sort());
        expect(pack.defaultTier).toBe('DRAFT');
    });

    it('the never-send list, the guard set and the exceptions to Ben are untouched', () => {
        expect(pack.neverSend).toEqual(['holding', 'clarify_scope', 'faq_from_kb', 'closing', 'offer_survey']);
        expect(pack.guardSet).toContain('money');
        expect(pack.guardSet).toEqual([
            'money', 'date_promise', 'discount', 'duration_claim', 'capability_claim', 'liability',
            'policy_commitment', 'capitulation', 'voice', 'unseen_implication', 'soft_commitment',
        ]);
        expect(pack.exceptionsToBen).toEqual([
            'complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade', 'money_question', 'callback_requested',
        ]);
    });

    it('a clean reactive gap ask now SENDS, from the Scoper, with a run approver', () => {
        expect(decide({ proposal: prop(), guards: guardsOk, pack, triage: tri(), caseFile: cf(), now: NOW }))
            .toEqual({ kind: 'send', approver: 'agent.scoper' });
    });

    it('an intent T35 did not name is still a draft for Ben', () => {
        const d = decide({ proposal: prop({ intent: 'clarify_scope' }), guards: guardsOk, pack, triage: tri(), caseFile: cf(), now: NOW });
        expect(d).toMatchObject({ kind: 'pending', reason: expect.stringMatching(/tier DRAFT/) });
    });
});

describe('every rail in front of those four still holds', () => {
    const pack = getPack('customer.default');

    it('the money guard: a price in the body is a FLAG for Ben, never a send', () => {
        const money: GuardVerdict = { ok: false, guardsHit: ['money'], escalate: true, notes: ['money: £120'] };
        expect(decide({ proposal: prop({ body: ['That would be £120.'] }), guards: money, pack, triage: tri(), caseFile: cf(), now: NOW }))
            .toMatchObject({ kind: 'flag', exception: 'money_question' });
    });

    it('an exception on the thread is Ben\'s, before any tier is read', () => {
        for (const e of ['complaint', 'refund', 'trust_concern', 'money_question', 'callback_requested'] as const) {
            expect(decide({ proposal: prop(), guards: guardsOk, pack, triage: tri({ lane: 'ben', exceptions: [e] }), caseFile: cf(), now: NOW }), e)
                .toMatchObject({ kind: 'flag', exception: e });
        }
    });

    it('an open flag on the thread holds the reply even at SEND', () => {
        expect(decide({ proposal: prop(), guards: guardsOk, pack, triage: tri(), caseFile: cf({ tags: ['needs_ben'] }), now: NOW }))
            .toMatchObject({ kind: 'pending', reason: expect.stringMatching(/open exception/) });
    });

    it('the send preconditions still gate the move: our own turn newest → pending, not send', () => {
        const ourTurnNewest = cf({ timeline: [
            { kind: 'message_in', at: new Date(NOW.getTime() - 120_000).toISOString(), body: 'my kitchen tap drips' },
            { kind: 'message_out', at: new Date(NOW.getTime() - 30_000).toISOString(), body: 'Got it.' },
        ] });
        expect(decide({ proposal: prop(), guards: guardsOk, pack, triage: tri(), caseFile: ourTurnNewest, now: NOW }))
            .toMatchObject({ kind: 'pending', reason: 'precondition: ours_is_newest' });
    });

    it('the send preconditions still gate the move: a quote on the case file stops a gap ask', () => {
        const withQuote = cf({ quote: { id: 'q1', slug: 'abc123', total: 12000, paid: false, status: 'sent' } as CaseFile['quote'] });
        expect(decide({ proposal: prop(), guards: guardsOk, pack, triage: tri(), caseFile: withQuote, now: NOW }))
            .toMatchObject({ kind: 'pending', reason: 'precondition: ask_gap:quote_on_case' });
    });

    it('an hour after the customer wrote, nothing sends by itself', () => {
        const stale = new Date(NOW.getTime() + 60 * 60_000);
        expect(decide({ proposal: prop(), guards: guardsOk, pack, triage: tri(), caseFile: cf(), now: stale }))
            .toMatchObject({ kind: 'pending', reason: 'precondition: not_reactive' });
    });
});
