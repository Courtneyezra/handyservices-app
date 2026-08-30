/**
 * B-WP1 vitest: the ops manager's queue_draft guard ordering.
 *
 * Proves, with injected spies rather than prose:
 *   1. checkDraft runs BEFORE queueDraft — the guard chain gates every write.
 *   2. A guard violation → QueueDraftToolResult status 'refused', draftId null,
 *      and queueDraft is NEVER called.
 *   3. A clean body → checkDraft then queueDraft (source 'ops_manager') → status 'pending'.
 *   4. queueDraft returning null (suppression rails) → status 'suppressed'.
 *   5. The REAL checkDraft refuses a "£120 off" body (the deterministic money/discount rail).
 */
import { describe, it, expect, vi } from 'vitest';
import { opsQueueDraft } from './ops-manager';
import { checkDraft, type DraftViolation } from './draft-guards';

const INPUT = { phone: '+447700900123', body: 'Just checking in — did the plan for the shelving work for you?', reason: 'test' };

describe('opsQueueDraft guard ordering', () => {
    it('calls checkDraft before queueDraft on a clean body, and queues with source ops_manager', async () => {
        const calls: string[] = [];
        const check = vi.fn((input: Parameters<typeof checkDraft>[0]) => {
            calls.push('check');
            expect(input.body).toBe(INPUT.body);
            return null;
        });
        const queue = vi.fn(async (opts: any) => {
            calls.push('queue');
            expect(opts.source).toBe('ops_manager');
            expect(opts.phone).toBe(INPUT.phone);
            return 'draft-123';
        });

        const result = await opsQueueDraft(INPUT, { check: check as any, queue: queue as any });

        expect(calls).toEqual(['check', 'queue']);
        expect(result.status).toBe('pending');
        expect(result.draftId).toBe('draft-123');
    });

    it('returns status refused and never calls queueDraft when the guard chain fires', async () => {
        const violation: DraftViolation = { code: 'discount_offer', message: 'This draft offers a reduction.' };
        const check = vi.fn(() => violation);
        const queue = vi.fn(async () => 'should-never-happen');

        const result = await opsQueueDraft(
            { ...INPUT, body: 'I can do £120 off if you book this week.' },
            { check: check as any, queue: queue as any },
        );

        expect(check).toHaveBeenCalledTimes(1);
        expect(queue).not.toHaveBeenCalled();
        expect(result.status).toBe('refused');
        expect(result.draftId).toBeNull();
        expect(result.refusal).toContain(violation.message);
        expect(result.refusal).toContain('flag_for_ben');
    });

    it('maps a null queueDraft return (suppression rails) to status suppressed', async () => {
        const check = vi.fn(() => null);
        const queue = vi.fn(async () => null);

        const result = await opsQueueDraft(INPUT, { check: check as any, queue: queue as any });

        expect(queue).toHaveBeenCalledTimes(1);
        expect(result.status).toBe('suppressed');
        expect(result.draftId).toBeNull();
    });

    it('the REAL checkDraft refuses a £120-off body (no injection, no DB write path reached)', async () => {
        const queue = vi.fn(async () => 'should-never-happen');

        const result = await opsQueueDraft(
            { ...INPUT, body: 'Good news — we can offer you £120 off if you confirm today.' },
            { check: checkDraft, queue: queue as any },
        );

        expect(queue).not.toHaveBeenCalled();
        expect(result.status).toBe('refused');
        expect(result.draftId).toBeNull();
    });
});
