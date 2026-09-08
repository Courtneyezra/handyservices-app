/**
 * 0.4 vitest: the run transcript is kept, and it is bounded.
 *
 * The claim the PR makes, pinned here so it cannot quietly stop being true:
 *   · a run's transcript is stored in the lean per-step shape and reads back step for step;
 *   · an oversized transcript is cut by the STATED rule — largest tool results first, in place —
 *     and what comes back still parses and still names every step and tool;
 *   · when dropping every result is not enough, the tail is cut and the cut is recorded;
 *   · the cap is a byte cap on the stored JSON, not a step count.
 *
 * Pure module: no database, no model, no clock beyond the truncation marker's own timestamp.
 */
import { describe, it, expect } from 'vitest';
import { boundRunTranscript, TRANSCRIPT_MAX_BYTES } from './transcript-store';
import type { AgentTranscriptEvent } from './runner';

const at = '2026-09-08T10:00:00.000Z';
const evt = (type: AgentTranscriptEvent['type'], detail: any): AgentTranscriptEvent => ({ at, type, detail });

/** A realistic short run: read the thread, read the quote, say something, finish. */
const SHORT: AgentTranscriptEvent[] = [
    evt('tool_call', { tool: 'get_thread', input: { conversationId: 'c1' } }),
    evt('tool_result', { tool: 'get_thread', result: { id: 'c1', items: [{ body: 'the tap drips' }] } }),
    evt('tool_call', { tool: 'get_quote', input: { slug: 'q-abc' } }),
    evt('tool_result', { tool: 'get_quote', result: { slug: 'q-abc', totalPence: 12000 } }),
    evt('assistant_text', { text: 'I will ask about the basin.' }),
    evt('done', { stop_reason: 'end_turn' }),
];

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');

describe('boundRunTranscript — the transcript that is kept', () => {
    it('stores every step, in order, in the lean shape', () => {
        const stored = boundRunTranscript(SHORT);
        expect(stored.map((s) => s.type)).toEqual(
            ['tool_call', 'tool_result', 'tool_call', 'tool_result', 'assistant_text', 'done'],
        );
        expect(stored[1]).toMatchObject({ tool: 'get_thread', result: { id: 'c1' } });
        expect(stored[3]).toMatchObject({ tool: 'get_quote', result: { slug: 'q-abc', totalPence: 12000 } });
        expect((stored[4] as any).detail.text).toBe('I will ask about the basin.');
    });

    it('reads back as JSON — the column is jsonb, so the stored value must round-trip', () => {
        const stored = boundRunTranscript(SHORT);
        expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
    });

    it('an empty run stores an empty transcript, not null', () => {
        expect(boundRunTranscript([])).toEqual([]);
    });

    it('leaves a transcript that already fits completely alone', () => {
        const stored = boundRunTranscript(SHORT);
        expect(bytes(stored)).toBeLessThan(TRANSCRIPT_MAX_BYTES);
        expect(stored.some((s) => (s as any).result?.dropped)).toBe(false);
    });
});

describe('the bound: largest tool results dropped first', () => {
    /** One small read, one enormous one — only the enormous one should go. */
    const oversized: AgentTranscriptEvent[] = [
        evt('tool_call', { tool: 'get_thread', input: { conversationId: 'c1' } }),
        evt('tool_result', { tool: 'get_thread', result: { id: 'c1', note: 'small' } }),
        evt('tool_call', { tool: 'search_kb', input: { q: 'sealant' } }),
        // The lean shaper caps strings at 500 chars and arrays at 20, so bulk has to come from a
        // wide OBJECT: 4,000 distinct keys, each with a 400-char value.
        evt('tool_result', { tool: 'search_kb', result: Object.fromEntries(
            Array.from({ length: 4000 }, (_, i) => [`k${i}`, 'x'.repeat(400)]),
        ) }),
        evt('assistant_text', { text: 'Done reading.' }),
    ];

    it('fits under the cap, and the JSON still parses', () => {
        const stored = boundRunTranscript(oversized);
        expect(bytes(stored)).toBeLessThanOrEqual(TRANSCRIPT_MAX_BYTES);
        expect(() => JSON.parse(JSON.stringify(stored))).not.toThrow();
    });

    it('drops the LARGEST result and keeps the smaller one', () => {
        const stored = boundRunTranscript(oversized);
        expect((stored[3] as any).result).toMatchObject({ dropped: true });
        expect((stored[3] as any).result.bytes).toBeGreaterThan(0);
        expect((stored[1] as any).result).toMatchObject({ id: 'c1', note: 'small' });
    });

    it('keeps every step and every tool name — nothing is reordered and nothing disappears', () => {
        const stored = boundRunTranscript(oversized);
        expect(stored).toHaveLength(oversized.length);
        expect(stored.map((s) => (s as any).tool)).toEqual(['get_thread', 'get_thread', 'search_kb', 'search_kb', undefined]);
        expect((stored.at(-1) as any).detail.text).toBe('Done reading.');
    });

    it('a run of nothing but assistant text is cut at the tail, and the cut is recorded', () => {
        // No tool results to drop: the only lever left is the tail.
        const wall = Array.from({ length: 600 }, () => evt('assistant_text', { text: 'y'.repeat(500) }));
        const stored = boundRunTranscript(wall);
        expect(bytes(stored)).toBeLessThanOrEqual(TRANSCRIPT_MAX_BYTES);
        const marker = stored.at(-1) as any;
        expect(marker.type).toBe('truncated');
        expect(marker.detail).toMatchObject({ reason: 'transcript_cap', maxBytes: TRANSCRIPT_MAX_BYTES });
        expect(marker.detail.droppedSteps).toBeGreaterThan(0);
        expect(marker.detail.droppedSteps + (stored.length - 1)).toBe(wall.length);
    });

    it('honours a caller-supplied cap, so the rule is a byte cap and not a step count', () => {
        const stored = boundRunTranscript(SHORT, 400);
        expect(bytes(stored)).toBeLessThanOrEqual(400);
    });
});
