import { describe, it, expect } from 'vitest';
import { aggregateVerdicts, bucketForSources, intentFromReason, isVerdictReason, isDraftVerdict, topReason, type VerdictRow } from './verdict-stats';

const since = new Date('2026-08-03T00:00:00Z');
const t = '2026-08-20T10:00:00Z';
const row = (p: Partial<VerdictRow>): VerdictRow => ({ verdict: 'approve', reason: 'fine', source: 'comms_agent', intent: 'ask_gap', by: 'human:ben', createdAt: t, ...p });

const FAKE: VerdictRow[] = [
    row({}),                                                                  // approve ask_gap
    row({}),                                                                  // approve ask_gap
    row({ verdict: 'edit', reason: 'tone' }),                                 // edit ask_gap
    row({ verdict: 'reject', reason: 'wrong_move', intent: 'holding' }),      // reject holding
    row({ verdict: 'reject', reason: 'unsafe', intent: 'holding', by: 'human:courtnee' }),
    row({ verdict: 'approve', source: 'recovery', intent: null }),            // approve recovery, untagged
    row({ verdict: 'edit', reason: 'missing_info', source: 'recovery', intent: null }),
    row({ verdict: 'sample_fine', reason: null, intent: 'confirm_received' }),
    row({ verdict: 'sample_not_fine', reason: 'unsafe', intent: 'confirm_received' }),
];

describe('aggregateVerdicts', () => {
    const stats = aggregateVerdicts(FAKE, { days: 30, since });

    it('counts human verdicts and samples separately', () => {
        expect(stats.total).toBe(9);
        expect(stats.human).toBe(7);
        expect(stats.approve).toBe(3);
        expect(stats.edit).toBe(2);
        expect(stats.reject).toBe(2);
        expect(stats.sampleFine).toBe(1);
        expect(stats.sampleNotFine).toBe(1);
    });

    it('unedited approval = approve / human, one decimal', () => {
        expect(stats.uneditedApprovalRate).toBe(42.9); // 3/7
    });

    it('unsafe counts rejects, edits and not-fine samples tagged unsafe', () => {
        expect(stats.unsafe).toBe(2);
    });

    it('reason counters split reject from edit', () => {
        expect(stats.rejectReasons).toEqual({ wrong_move: 1, unsafe: 1 });
        expect(stats.editReasons).toEqual({ tone: 1, missing_info: 1 });
    });

    it('per-source buckets, biggest first', () => {
        expect(stats.bySource.map((b) => b.source)).toEqual(['comms_agent', 'recovery']);
        const comms = stats.bySource[0];
        expect(comms.human).toBe(5);
        expect(comms.uneditedApprovalRate).toBe(40);
        const recovery = stats.bySource[1];
        expect(recovery).toMatchObject({ approve: 1, edit: 1, reject: 0, human: 2, uneditedApprovalRate: 50 });
    });

    it('per-intent buckets, untagged drafts grouped as "untagged"', () => {
        const byIntent = Object.fromEntries(stats.byIntent.map((b) => [b.intent, b]));
        expect(byIntent.ask_gap).toMatchObject({ approve: 2, edit: 1, human: 3, uneditedApprovalRate: 66.7 });
        expect(byIntent.holding).toMatchObject({ reject: 2, human: 2, uneditedApprovalRate: 0, unsafe: 1 });
        expect(byIntent.untagged).toMatchObject({ human: 2 });
        expect(byIntent.confirm_received).toMatchObject({ human: 0, sampleFine: 1, sampleNotFine: 1, uneditedApprovalRate: null });
    });

    it('per-approver counts only human verdicts', () => {
        expect(stats.byApprover).toEqual([{ by: 'human:ben', human: 6 }, { by: 'human:courtnee', human: 1 }]);
    });

    it('window metadata is echoed', () => {
        expect(stats.days).toBe(30);
        expect(stats.since).toBe(since.toISOString());
    });

    it('empty input gives zeros and null rates, not NaN', () => {
        const empty = aggregateVerdicts([], { days: 7, since });
        expect(empty.total).toBe(0);
        expect(empty.uneditedApprovalRate).toBeNull();
        expect(empty.bySource).toEqual([]);
        expect(empty.byIntent).toEqual([]);
    });
});

describe('bucketForSources', () => {
    const stats = aggregateVerdicts(FAKE, { days: 30, since });
    it('sums the chosen sources', () => {
        const both = bucketForSources(stats, ['comms_agent', 'recovery']);
        expect(both.human).toBe(7);
        expect(both.uneditedApprovalRate).toBe(42.9);
        expect(both.rejectReasons).toEqual({ wrong_move: 1, unsafe: 1 });
    });
    it('unknown source is an empty bucket', () => {
        expect(bucketForSources(stats, ['ops_manager'])).toMatchObject({ human: 0, uneditedApprovalRate: null });
    });
});

describe('helpers', () => {
    it('intentFromReason reads the [intent] tag only', () => {
        expect(intentFromReason('[ask_gap] customer has not said which room')).toBe('ask_gap');
        expect(intentFromReason('  [Holding] wait for Ben')).toBe('holding');
        expect(intentFromReason('no tag here')).toBeNull();
        expect(intentFromReason(null)).toBeNull();
    });
    it('reason and verdict guards', () => {
        expect(isVerdictReason('unsafe')).toBe(true);
        expect(isVerdictReason('meh')).toBe(false);
        expect(isDraftVerdict('sample_fine')).toBe(true);
        expect(isDraftVerdict('approved')).toBe(false);
    });
    it('topReason picks the max', () => {
        expect(topReason({ tone: 2, unsafe: 5 })).toEqual({ reason: 'unsafe', n: 5 });
        expect(topReason({})).toBeNull();
    });
});
