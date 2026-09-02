import { describe, it, expect, vi } from 'vitest';
import { judgeSend, verdictFrom, renderJudgeUser, verifierAgent, MOVE_QUALITY_SYSTEM, RUBRIC_ID } from './verifier';

describe('verifier', () => {
    it('is a READ-tier agent that never proposes', async () => {
        expect(verifierAgent.tier).toBe('READ');
        expect(await verifierAgent.run({} as any)).toBeNull();
    });
    it('verdict mapping: fine only when all three pass; unsafe outranks the code', () => {
        expect(verdictFrom({ moveRight: true, voiceRight: true, unsafe: false, reason: 'ok' })).toEqual({ verdict: 'sample_fine', reason: 'fine' });
        expect(verdictFrom({ moveRight: true, voiceRight: true, unsafe: true, reason: 'figure', code: 'tone' })).toEqual({ verdict: 'sample_not_fine', reason: 'unsafe' });
        expect(verdictFrom({ moveRight: false, voiceRight: true, unsafe: false, reason: 'x' })).toEqual({ verdict: 'sample_not_fine', reason: 'wrong_move' });
        expect(verdictFrom({ moveRight: true, voiceRight: false, unsafe: false, reason: 'x' })).toEqual({ verdict: 'sample_not_fine', reason: 'tone' });
        expect(verdictFrom({ moveRight: false, voiceRight: true, unsafe: false, reason: 'x', code: 'missing_info' })).toEqual({ verdict: 'sample_not_fine', reason: 'missing_info' });
    });
    it('judgeSend calls the rubric on the configured model and validates the answer', async () => {
        const llm = vi.fn(async () => ({ data: { moveRight: true, voiceRight: false, unsafe: false, reason: 'Re-greeted mid conversation', code: 'tone' }, model: 'claude-opus-5' }));
        const r = await judgeSend({ body: 'Hiya again! Could you send a photo?', thread: 'CUSTOMER: hi\nUS: Hiya, photo?\nCUSTOMER: here', signals: ['no_reply_48h'] }, { llm, model: 'claude-opus-5' });
        expect(r.verdict).toBe('sample_not_fine');
        expect(r.reason).toBe('tone');
        expect(r.rubric).toBe(RUBRIC_ID);
        const args = llm.mock.calls[0][0] as any;
        expect(args.model).toBe('claude-opus-5');
        expect(args.system).toBe(MOVE_QUALITY_SYSTEM);
        expect(args.user).toMatch(/SIGNALS AFTER THE SEND: no_reply_48h/);
    });
    it('rejects a malformed judge answer instead of guessing', async () => {
        const llm = vi.fn(async () => ({ data: { moveRight: 'yes' }, model: 'x' }));
        await expect(judgeSend({ body: 'b', thread: 't', signals: [] }, { llm })).rejects.toThrow();
    });
    it('renders the user turn with the send last and the signals named', () => {
        const u = renderJudgeUser({ body: 'BODY', thread: 'T', signals: [], intent: 'ask_gap', approver: 'agent.scoper' });
        expect(u).toMatch(/declared intent ask_gap/);
        expect(u).toMatch(/SIGNALS AFTER THE SEND: none/);
    });
});
