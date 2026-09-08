/**
 * 0.4 vitest: the runner hands its transcript to the run record.
 *
 * Before this the trail existed only in memory and on the SSE feed; `agent_runs.transcript_ref`
 * was a string nobody set, so after a run nobody could see what the model read or was told. Pinned
 * at the persistence seam (no database, no model): what `finishAgentRun` receives IS the run's
 * steps, in order, and it survives a JSON round-trip because the column is jsonb.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const finishAgentRun = vi.fn(async () => ({ costPence: 3 }));
const startAgentRun = vi.fn(async (i: any) => i.id ?? 'run_x');

vi.mock('../agent-runs', () => ({
    startAgentRun: (...a: any[]) => startAgentRun(...(a as [any])),
    finishAgentRun: (...a: any[]) => finishAgentRun(...(a as [])),
}));

/** The model, replaced: one tool turn, then a plain answer. */
const create = vi.fn();
vi.mock('../anthropic', () => ({ getAnthropic: () => ({ messages: { create: (...a: any[]) => create(...a) } }) }));

import { runAgent } from './runner';

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

beforeEach(() => {
    vi.clearAllMocks();
    create
        .mockResolvedValueOnce({
            stop_reason: 'tool_use', usage,
            content: [
                { type: 'text', text: 'Let me read the thread.' },
                { type: 'tool_use', id: 'tu_1', name: 'get_thread', input: { conversationId: 'c1' } },
            ],
        })
        .mockResolvedValueOnce({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'The tap drips at the base.' }] });
});

const tools = [{
    name: 'get_thread',
    description: 'read the thread',
    input_schema: { type: 'object' as const, properties: {} },
    run: async () => ({ id: 'c1', items: [{ body: 'the tap drips' }] }),
}];

const storedTranscript = () => (finishAgentRun.mock.calls.at(-1) as any[])[2].transcript;

describe('the runner keeps the transcript (0.4)', () => {
    it('hands the run\'s steps to finishAgentRun, in order', async () => {
        await runAgent({ name: 'test-agent', system: 's', goal: 'g', tools, runId: 'run_t1', maxTurns: 3 });

        expect(finishAgentRun).toHaveBeenCalledTimes(1);
        const steps = storedTranscript();
        expect(Array.isArray(steps)).toBe(true);
        expect(steps.map((s: any) => s.type)).toEqual(['assistant_text', 'tool_call', 'tool_result', 'assistant_text', 'done']);
        expect(steps[1]).toMatchObject({ tool: 'get_thread', input: { conversationId: 'c1' } });
        expect(steps[2]).toMatchObject({ tool: 'get_thread', result: { id: 'c1' } });
    });

    it('what is stored reads back — the column is jsonb, so it must round-trip', async () => {
        await runAgent({ name: 'test-agent', system: 's', goal: 'g', tools, runId: 'run_t2', maxTurns: 3 });
        const steps = storedTranscript();
        expect(JSON.parse(JSON.stringify(steps))).toEqual(steps);
    });

    it('a run that fails still stores what it got as far as it got', async () => {
        create.mockReset();
        create.mockResolvedValueOnce({
            stop_reason: 'tool_use', usage,
            content: [{ type: 'tool_use', id: 'tu_1', name: 'missing_tool', input: {} }],
        }).mockRejectedValueOnce(new Error('model unreachable'));

        await expect(runAgent({ name: 'test-agent', system: 's', goal: 'g', tools, runId: 'run_t3', maxTurns: 3 }))
            .rejects.toThrow('model unreachable');

        const patch = (finishAgentRun.mock.calls.at(-1) as any[])[2];
        expect(patch.error).toMatch(/model unreachable/);
        expect(patch.transcript.map((s: any) => s.type)).toEqual(['tool_call', 'tool_error']);
        expect(patch.transcript[1]).toMatchObject({ tool: 'missing_tool', error: 'Unknown tool: missing_tool' });
    });

    it('persist:false writes nothing at all — a dry run leaves no row and no transcript', async () => {
        await runAgent({ name: 'test-agent', system: 's', goal: 'g', tools, runId: 'run_t4', maxTurns: 3, persist: false });
        expect(startAgentRun).not.toHaveBeenCalled();
        expect(finishAgentRun).not.toHaveBeenCalled();
    });
});
