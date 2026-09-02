import { describe, it, expect, vi } from 'vitest';
import type { AgentRunResult, AgentTool } from '../../agents/runner';
import { createContractorLiaisonAgent, checkLiaisonBody, renderLiaisonCaseFile, liaisonAccepts, LIAISON_NAME } from './contractor-liaison';
import { CONTRACTOR_DEFAULT } from '../packs/contractor-default';
import type { CaseFile, TriageResult } from '../types';

const cf = (over: Partial<CaseFile> = {}): CaseFile => ({
    conversationId: 'conv_craig', phone: '+447700900123', audience: 'contractor', stage: 'booked', contactName: 'Craig',
    timeline: [{ at: '2026-09-02T09:00:00.000Z', kind: 'message_in', channel: 'whatsapp', body: 'What have you got for me Thursday?' }],
    media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: '2026-09-02T09:00:00.000Z', channelLastUsed: 'whatsapp' },
    client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h'.repeat(64), builtAt: '2026-09-02T09:10:00.000Z', ...over,
});
const triage = (over: Partial<TriageResult> = {}): TriageResult => ({ audience: 'contractor', intent: 'unknown', lane: 'contractor', exceptions: [], stage: 'booked', tags: [], reasons: ['contractor audience'], source: 'rules', ...over });
const ctx = { contractor: { profileId: 'hp_1', userId: 'u_1', name: 'Craig Smith' }, jobs: [{ ref: 'bk_1', source: 'booking_request' as const, status: 'assigned', scheduledDate: '2026-09-04', slot: '09:00-11:00', postcode: 'NG12 5FD', customerFirstName: 'Sarah', work: 'Gutter leak at the downpipe join', payoutPence: 12000, materials: ['gutter sealant', 'downpipe clip'], quoteSlug: 'q1' }] };

type Script = (tools: Record<string, AgentTool>) => Promise<void>;
function stub(script: Script) {
    const calls: any[] = [];
    const runAgent = vi.fn(async (opts: any): Promise<AgentRunResult> => {
        calls.push(opts);
        await script(Object.fromEntries((opts.tools as AgentTool[]).map((t) => [t.name, t])));
        return { finalText: 'done', transcript: [], turns: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, runId: opts.runId, model: opts.model, costPence: 0, durationMs: 1 };
    });
    return { runAgent: runAgent as any, calls };
}
async function run(script: Script, over: { cf?: CaseFile; tri?: TriageResult } = {}) {
    const s = stub(script);
    const agent = createContractorLiaisonAgent({ runAgent: s.runAgent, persist: false, loadContext: async () => ctx, model: 'stub-model' });
    const proposal = await agent.run({ caseFile: over.cf ?? cf(), pack: CONTRACTOR_DEFAULT, triage: over.tri ?? triage(), runId: 'run_l1' });
    return { proposal, s };
}

describe('contractor liaison belt', () => {
    it('1. proposes a job brief with postcode + first name only; the brief carries the job context', async () => {
        const { proposal, s } = await run(async (t) => {
            await t.propose_reply.run({ intent: 'job_brief', body: ['Thursday 9 to 11 at NG12 5FD, gutter leak at the downpipe join. Sarah is in.', 'Bring gutter sealant and a downpipe clip.'], reasons: ['assigned job on Thursday'] });
        });
        expect(proposal).toMatchObject({ intent: 'job_brief' });
        expect(proposal?.body).toHaveLength(2);
        expect(s.calls[0].name).toBe(LIAISON_NAME);
        expect(s.calls[0].model).toBe('stub-model');
        expect(s.calls[0].persist).toBe(false);
        expect(s.calls[0].goal).toContain('postcode NG12 5FD');
        expect(s.calls[0].goal).toContain('materials: gutter sealant; downpipe clip');
        expect(s.calls[0].goal).not.toContain('Hughes');
        expect(s.calls[0].system).toContain('NEVER put a customer');
    });
    it('2. a brief carrying the customer phone is refused at the tool; a flag alone becomes a flag-only proposal', async () => {
        const { proposal } = await run(async (t) => {
            await expect(t.propose_reply.run({ intent: 'job_brief', body: ['Ring Sarah on 07950 552 830 when you are near NG12 5FD'], reasons: ['brief'] })).rejects.toThrow(/customer_pii/);
            await expect(t.propose_reply.run({ intent: 'availability_ask', body: ['Free Thursday? Or Friday?'], reasons: ['ask'] })).rejects.toThrow(/more than one question/);
            await t.flag.run({ exception: 'complaint', note: 'Craig says the customer was abusive on the last visit and he will not go back.' });
        });
        expect(proposal).toMatchObject({ intent: 'confirm_receipt', body: [], flag: { exception: 'complaint' } });
    });
    it('3. never runs for a customer thread, and only accepts contractor audience', async () => {
        const s = stub(async () => { throw new Error('should not run'); });
        const agent = createContractorLiaisonAgent({ runAgent: s.runAgent, persist: false, loadContext: async () => ctx });
        expect(await agent.run({ caseFile: cf({ audience: 'customer' }), pack: CONTRACTOR_DEFAULT, triage: triage({ audience: 'customer', lane: 'scoper' }), runId: 'r' })).toBeNull();
        expect(s.runAgent).not.toHaveBeenCalled();
        expect(liaisonAccepts({ caseFile: cf(), triage: triage(), trigger: 'inbound_message' })).toBe(true);
        expect(liaisonAccepts({ caseFile: cf(), triage: triage({ audience: 'customer' }), trigger: 'inbound_message' })).toBe(false);
    });
    it('checkLiaisonBody + case file render are pure', () => {
        expect(checkLiaisonBody(['NG12 5FD tomorrow 9am'])).toBeNull();
        expect(checkLiaisonBody(['Got it — cheers'])).toMatch(/chat voice/);
        expect(checkLiaisonBody([])).toMatch(/empty/);
        const text = renderLiaisonCaseFile(cf(), triage(), { contractor: null, jobs: [] });
        expect(text).toContain('NOT MATCHED');
        expect(text).toContain('What have you got for me Thursday?');
    });
});
