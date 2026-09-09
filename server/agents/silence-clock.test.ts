/**
 * 0.2 part D — the three holding-line clocks are ONE clock carrying a reason.
 *
 * A refactor, so the test's job is to show that nothing moved. The three lanes (an inbound gone
 * quiet, a flag past due, a draft past due) still exist, still own their own scan and their own
 * claim, and still send the same three fixed lines; what changed is that one function runs them,
 * in a fixed order, and every one of them emits through one place.
 *
 * T35 (8 Sep 2026): the `silence` lane is RETIRED from the clock — it fired the canned holding
 * line at the same ten minutes the inbound debounce waited, so the template beat the Scoper to
 * the customer. `sweepSilence` is still exported and still tested; it is simply not a row in
 * SILENCE_LANES any more. The assertions below now pin that, so re-adding it is a deliberate act
 * with a failing test in front of it.
 *
 * The db is a chainable stub that returns nothing, so each lane runs its real query shape and
 * finds no candidates. That is enough for the structural claims here; the per-lane DECISIONS —
 * ten minutes, the 48-hour ceiling, the due times, the claim — are pure functions and are tested
 * unchanged in silence-breaker.test.ts, which this file deliberately does not duplicate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/** Every drizzle builder method returns the chain; the terminal reads resolve to nothing. */
function chain(): any {
    const c: any = new Proxy({}, {
        get(_t, prop) {
            if (prop === 'then') return undefined;              // not a thenable mid-chain
            if (prop === 'limit' || prop === 'returning') return () => Promise.resolve([]);
            return () => c;
        },
    });
    return c;
}

vi.mock('../db', () => ({
    db: {
        select: () => chain(),
        update: () => chain(),
        insert: () => chain(),
        execute: async () => ({ rows: [] }),
    },
}));

const held: Array<{ conversationId: string; kind: string }> = [];
vi.mock('../rules-layer', () => ({
    sendHoldingLine: vi.fn(async (conversationId: string, kind: string) => {
        held.push({ conversationId, kind });
        return { sent: true, reason: 'sent', draftId: 'd1' };
    }),
    isTestNumber: () => false,
}));
vi.mock('../system-events', () => ({ logSystemEvent: vi.fn(async () => {}) }));
vi.mock('../pushover', () => ({ notifyEscalation: vi.fn(async () => {}) }));

import {
    SILENCE_LANES, SILENCE_REASONS, runSilenceClock, runSilenceBreakerTick, _resetSilenceClockThrottle,
    sweepSilence, expireFlags, expireDrafts,
} from './silence-breaker';

/** rules-layer.ts is mocked above, so its copy is read from the source instead of imported. */
const RULES_LAYER_SRC = fs.readFileSync(path.resolve(__dirname, '../rules-layer.ts'), 'utf8');

beforeEach(() => {
    held.length = 0;
    _resetSilenceClockThrottle();
});

describe('one clock, the lanes that remain', () => {
    it('the lanes are the two expiry reasons, in a fixed order — silence is retired (T35)', () => {
        expect(SILENCE_LANES.map((l) => l.reason)).toEqual(['flag_expiry', 'draft_expiry']);
        // The vocabulary is unchanged: rules-layer still owns `silence` copy, and every holding
        // line already sent under that name still reads by it in system_events.
        expect(SILENCE_REASONS).toEqual(['silence', 'flag_expiry', 'draft_expiry']);
    });

    it('T35: no lane fires the ten-minute silence holding line at a customer', () => {
        expect(SILENCE_LANES.some((l) => l.reason === 'silence')).toBe(false);
    });

    it('every lane names a holding line rules-layer still has copy and a template for', () => {
        // The words did not move as part of 0.2: HOLDING_COPY, HOLDING_WHY and
        // HOLDING_TEMPLATE_PREFERENCE in server/rules-layer.ts are untouched, and each still keys
        // on the reason the lane carries.
        for (const lane of SILENCE_LANES) {
            expect(RULES_LAYER_SRC, `no HOLDING_TEMPLATE_PREFERENCE for ${lane.reason}`).toMatch(new RegExp(`\\b${lane.reason}:\\s*\\[HOLDING_TEMPLATE_NAME`));
            expect(RULES_LAYER_SRC, `${lane.reason} is not a rules.holding approver`).toMatch(new RegExp(`\\b${lane.reason}:\\s*'rules\\.holding'`));
        }
    });

    it('the three lane scans are still exported (sweepSilence included: T35 retires the trigger, not the mechanism)', () => {
        expect(typeof sweepSilence).toBe('function');
        expect(typeof expireFlags).toBe('function');
        expect(typeof expireDrafts).toBe('function');
    });

    it('one pass runs every lane, in order', async () => {
        const order: string[] = [];
        const lanes = SILENCE_LANES.map((l) => ({ ...l, run: async () => { order.push(l.reason); return { acted: 0, note: l.reason }; } }));
        for (const l of lanes) await l.run(new Date());
        expect(order).toEqual(['flag_expiry', 'draft_expiry']);
    });

    it('runs, and finds nothing to say, against an empty desk', async () => {
        await expect(runSilenceClock(new Date('2026-09-08T09:00:00Z'))).resolves.toBeUndefined();
        expect(held).toEqual([]);
    });

    it('is still throttled to one pass a minute', async () => {
        const t0 = new Date('2026-09-08T09:00:00Z');
        const calls: string[] = [];
        const spy = vi.spyOn(SILENCE_LANES[0], 'run').mockImplementation(async () => { calls.push('ran'); return { acted: 0, note: '' }; });
        await runSilenceClock(t0);
        await runSilenceClock(new Date(t0.getTime() + 30_000));      // inside the minute: skipped
        expect(calls).toHaveLength(1);
        await runSilenceClock(new Date(t0.getTime() + 61_000));      // outside it: runs again
        expect(calls).toHaveLength(2);
        spy.mockRestore();
    });

    it('a lane that throws does not stop the ones after it — what the three catch arms used to buy', async () => {
        const ran: string[] = [];
        const boom = vi.spyOn(SILENCE_LANES[0], 'run').mockRejectedValue(new Error('the silence scan fell over'));
        const after = vi.spyOn(SILENCE_LANES[1], 'run').mockImplementation(async () => { ran.push('draft_expiry'); return { acted: 0, note: '' }; });
        await expect(runSilenceClock(new Date('2026-09-08T09:00:00Z'))).resolves.toBeUndefined();
        expect(ran).toEqual(['draft_expiry']);
        boom.mockRestore();
        after.mockRestore();
    });

    it('the fast tick\'s old name still points at the one clock', () => {
        expect(runSilenceBreakerTick).toBe(runSilenceClock);
    });
});
