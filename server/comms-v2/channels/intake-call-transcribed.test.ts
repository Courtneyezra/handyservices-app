/**
 * The two call forwards through the intake, over a scripted calls row: `call_finished` at hang-up,
 * before the batch pass has written anything, then `call_transcribed` once the transcript and job
 * summary are on the row. The number is in the Ofcom drama range; the database is a stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseFile, Turn } from '../desk/case-file';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import { ChannelGateway } from './channel-gateway';
import { forwardNow, resetLiveChannelGateway } from './intake';

const row = vi.hoisted(() => ({ current: null as Record<string, unknown> | null, reads: 0, gate: null as Promise<void> | null }));

vi.mock('../../db', () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => {
                        const snapshot = row.current ? { ...row.current } : null;
                        row.reads++;
                        if (row.reads === 1 && row.gate) await row.gate;
                        return snapshot ? [snapshot] : [];
                    },
                }),
            }),
        }),
    },
}));

const TRANSCRIPT = '[Caller]: Hi, the bathroom extractor fan has stopped working.\n[Agent]: Thanks, we can take a look this week.';

const ran: Turn[] = [];
const desk: DeskLike = {
    async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> { ran.push(turn); return { runId: 'r', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 }; },
    async clockPass(file: CaseFile): Promise<DeskResult> { return this.handleTurn(file, file.turns[0]); },
};

const bareRow = () => ({
    id: 'call_7', phoneNumber: '+447700900942', customerName: 'Priya', direction: 'inbound', status: 'completed', outcome: null, handledBy: null,
    duration: 95, ringSeconds: 4, jobSummary: null, transcription: null, classification: null,
    startTime: new Date('2026-09-16T09:00:00.000Z'), endTime: new Date('2026-09-16T09:01:35.000Z'),
});

describe('a call forwarded at hang-up and again once transcribed', () => {
    let gateway: ChannelGateway;
    beforeEach(() => {
        ran.length = 0;
        row.current = bareRow(); row.reads = 0; row.gate = null;
        gateway = new ChannelGateway({ desk });
        resetLiveChannelGateway(gateway);
    });
    afterEach(() => resetLiveChannelGateway());

    it('fills in the one call bubble with the transcript and summary, and runs the desk once', async () => {
        expect(await forwardNow({ kind: 'call_finished', callRecordId: 'call_7' })).toMatchObject({ forwarded: 1, attached: 0 });
        const [file] = gateway.store.all();
        expect(file.turns[0].body).toContain('(no transcript)');

        row.current = { ...bareRow(), transcription: TRANSCRIPT, jobSummary: 'Bathroom extractor fan not working' };
        expect(await forwardNow({ kind: 'call_transcribed', callRecordId: 'call_7' })).toMatchObject({ forwarded: 0, attached: 1 });

        expect(file.turns).toHaveLength(1);
        expect(file.turns[0].body).toContain('extractor fan has stopped');
        expect(file.facts.filter((f) => f.key === 'call_summary').map((f) => f.value)).toEqual(['Bathroom extractor fan not working']);
        expect(ran).toHaveLength(1);
        expect(file.sends).toEqual([]);
    });

    it('a filler summary is not shown as the call summary', async () => {
        row.current = { ...bareRow(), transcription: TRANSCRIPT, jobSummary: 'No job description provided.' };
        await forwardNow({ kind: 'call_finished', callRecordId: 'call_7' });
        expect(gateway.store.all()[0].facts.filter((f) => f.key === 'call_summary')).toEqual([]);
    });

    it('waits for the hang-up forward still reading its row, so the transcript is never refused for arriving first', async () => {
        let open!: () => void;
        row.gate = new Promise<void>((r) => { open = r; });
        const finished = forwardNow({ kind: 'call_finished', callRecordId: 'call_7' });
        row.current = { ...bareRow(), transcription: TRANSCRIPT, jobSummary: 'Bathroom extractor fan not working' };
        const transcribed = forwardNow({ kind: 'call_transcribed', callRecordId: 'call_7' });
        open();
        await Promise.all([finished, transcribed]);
        const [file] = gateway.store.all();
        expect(file.turns).toHaveLength(1);
        expect(file.turns[0].body).toContain('extractor fan has stopped');
        expect(ran).toHaveLength(1);
    });

    it('a transcribed forward for a call the desk never had opens nothing and runs nothing', async () => {
        row.current = { ...bareRow(), transcription: TRANSCRIPT };
        const report = await forwardNow({ kind: 'call_transcribed', callRecordId: 'call_7' });
        expect(report).toMatchObject({ forwarded: 0, attached: 0 });
        expect(report.skipped).toEqual(['no call turn on any file to attach this call to']);
        expect(gateway.store.all()).toEqual([]);
        expect(ran).toEqual([]);
    });
});
