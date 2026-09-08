/**
 * 0.7 part B: the prompt gate. A prompt change must arrive with an eval change.
 */
import { describe, it, expect } from 'vitest';
import { promptGateVerdict, promptChanges, evalCaseChanges } from './prompt-gate';

describe('prompt gate', () => {
    it('fails a prompt change with no eval change, and names the prompt', () => {
        const v = promptGateVerdict(['server/spine/prompts/scoper.core.md', 'server/spine/agents/scoper.ts']);
        expect(v.pass).toBe(false);
        expect(v.prompts).toEqual(['server/spine/prompts/scoper.core.md']);
        expect(v.message).toContain('PROMPT GATE FAILED');
        expect(v.message).toContain('server/spine/prompts/scoper.core.md');
        expect(v.message).toContain('eval family is missing');
    });

    it('passes when both move', () => {
        const v = promptGateVerdict(['server/spine/prompts/scoper.core.md', 'eval-cases/ask_gap/new.json']);
        expect(v.pass).toBe(true);
        expect(v.evalCases).toEqual(['eval-cases/ask_gap/new.json']);
    });

    it('passes an eval-only change and a change that touches neither', () => {
        expect(promptGateVerdict(['eval-cases/closing/more.json']).pass).toBe(true);
        expect(promptGateVerdict(['server/spine/decide.ts', 'client/src/App.tsx']).pass).toBe(true);
        expect(promptGateVerdict([]).pass).toBe(true);
    });

    it('fails on any prompt file, not only the Scoper core, and lists every one', () => {
        const v = promptGateVerdict(['server/spine/prompts/scoper.post_quote.md', 'server/spine/prompts/clerk.core.md']);
        expect(v.pass).toBe(false);
        expect(v.prompts).toEqual(['server/spine/prompts/scoper.post_quote.md', 'server/spine/prompts/clerk.core.md']);
        expect(v.message).toContain('scoper.post_quote.md');
        expect(v.message).toContain('clerk.core.md');
    });

    it('is not fooled by ./ or a leading slash, and does not match the directory name alone', () => {
        expect(promptChanges(['./server/spine/prompts/a.md', '/server/spine/prompts/b.md'])).toHaveLength(2);
        expect(promptChanges(['server/spine/prompts/'])).toEqual([]);
        expect(evalCaseChanges(['./eval-cases/x/y.json'])).toEqual(['eval-cases/x/y.json']);
        expect(evalCaseChanges(['eval-cases/'])).toEqual([]);
    });

    it('does not match a path that merely contains the prefix further in', () => {
        expect(promptChanges(['docs/server/spine/prompts/notes.md'])).toEqual([]);
        expect(evalCaseChanges(['docs/eval-cases/README.md'])).toEqual([]);
    });

    it('tells the author how to run the affected families against the model, either way', () => {
        for (const v of [promptGateVerdict(['server/spine/prompts/scoper.core.md']), promptGateVerdict(['server/spine/prompts/scoper.core.md', 'eval-cases/a/b.json'])]) {
            expect(v.message).toContain('--adapter spine --family');
        }
    });
});
