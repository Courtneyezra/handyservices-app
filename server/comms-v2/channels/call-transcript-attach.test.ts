/**
 * A call reaches the desk at hang-up, before the batch transcription has written anything
 * (twilio-realtime.ts finalizes first, then transcribes). The same call passed again once its
 * transcript and summary land fills in the bubble it already has: one call turn, no desk run, so
 * nothing can be sent to the customer by the update.
 */
import { describe, expect, it } from 'vitest';
import type { CaseFile, Turn } from '../desk/case-file';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import { fromFinishedCall, type FinishedCall } from './call-adapter';
import { ChannelGateway } from './channel-gateway';

const TRANSCRIPT = '[Caller]: Hi, my kitchen tap has been dripping all week.\n[Agent]: No problem, can you send a photo?';

function harness() {
    const ran: string[] = [];
    const desk: DeskLike = {
        async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> {
            ran.push(turn.id);
            return { runId: 'r', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 };
        },
        async clockPass(file: CaseFile): Promise<DeskResult> { ran.push(`clock:${file.id}`); return this.handleTurn(file, file.turns[0]); },
    };
    let n = 0;
    const gateway = new ChannelGateway({ desk, newId: (p) => `${p}_${++n}`, now: () => new Date('2026-09-16T10:00:00.000Z') });
    return { gateway, ran };
}

const call = (over: Partial<FinishedCall> = {}): FinishedCall => ({
    phone: '+447700900942', name: 'Sam', direction: 'inbound', missed: false, transcript: null, durationSeconds: 120,
    at: '2026-09-16T09:58:00.000Z', jobSummary: null, callId: 'call_1', ...over,
});
const env = (over: Partial<FinishedCall> = {}) => fromFinishedCall(call(over))!;
const callTurns = (file: CaseFile) => file.turns.filter((t) => t.kind === 'call_transcript');
const summaries = (file: CaseFile, turnId: string) => file.facts.filter((f) => f.key === 'call_summary' && f.source.kind === 'thread' && f.source.turnId === turnId).map((f) => f.value);

describe('a call whose record reaches the desk before its transcript', () => {
    it('lands bare at hang-up', async () => {
        const { gateway, ran } = harness();
        const out = await gateway.inbound(env());
        expect(out.kind).toBe('handled');
        if (out.kind !== 'handled') return;
        expect(out.turn.body).toContain('(no transcript)');
        expect(out.turn.callId).toBe('call_1');
        expect(ran).toEqual([out.turn.id]);
    });

    it('gets its transcript and summary on the same turn once transcription lands, with no second turn and no desk run', async () => {
        const { gateway, ran } = harness();
        const first = await gateway.inbound(env());
        if (first.kind !== 'handled') throw new Error(first.kind);
        const after = await gateway.inbound(env({ transcript: TRANSCRIPT, jobSummary: 'Dripping kitchen tap' }), {}, { attachOnly: true });
        expect(after.kind).toBe('attached');
        const file = gateway.store.get(first.file.id)!;
        expect(callTurns(file)).toHaveLength(1);
        expect(file.turns).toHaveLength(1);
        expect(file.turns[0].id).toBe(first.turn.id);
        expect(file.turns[0].body).toContain('kitchen tap has been dripping');
        expect(file.turns[0].body).not.toContain('(no transcript)');
        expect(summaries(file, first.turn.id)).toEqual(['Dripping kitchen tap']);
        expect(ran).toEqual([first.turn.id]);
        expect(file.sends).toEqual([]);
    });

    it('is idempotent: the same transcript passed again changes nothing and runs nothing', async () => {
        const { gateway, ran } = harness();
        const first = await gateway.inbound(env());
        if (first.kind !== 'handled') throw new Error(first.kind);
        const full = env({ transcript: TRANSCRIPT, jobSummary: 'Dripping kitchen tap' });
        const a = await gateway.inbound(full, {}, { attachOnly: true });
        const b = await gateway.inbound(full, {}, { attachOnly: true });
        expect(a).toMatchObject({ kind: 'attached', changed: true });
        expect(b).toMatchObject({ kind: 'attached', changed: false });
        const file = gateway.store.get(first.file.id)!;
        expect(file.turns).toHaveLength(1);
        expect(summaries(file, first.turn.id)).toEqual(['Dripping kitchen tap']);
        expect(ran).toEqual([first.turn.id]);
    });

    it('a second hang-up signal for the same call (status callback and stream close both finalize) opens no second bubble', async () => {
        const { gateway, ran } = harness();
        const first = await gateway.inbound(env());
        if (first.kind !== 'handled') throw new Error(first.kind);
        const again = await gateway.inbound(env());
        expect(again).toMatchObject({ kind: 'attached', changed: false });
        expect(gateway.store.get(first.file.id)!.turns).toHaveLength(1);
        expect(ran).toEqual([first.turn.id]);
    });

    it('a transcription that never lands, or comes back empty, leaves the bubble as it was', async () => {
        const { gateway, ran } = harness();
        const first = await gateway.inbound(env({ transcript: TRANSCRIPT }));
        if (first.kind !== 'handled') throw new Error(first.kind);
        const before = first.turn.body;
        const empty = await gateway.inbound(env({ transcript: '   ' }), {}, { attachOnly: true });
        expect(empty).toMatchObject({ kind: 'attached', changed: false });
        expect(gateway.store.get(first.file.id)!.turns[0].body).toBe(before);
        expect(ran).toEqual([first.turn.id]);
    });

    it('a missed call keeps its missed line whatever a later pass carries', async () => {
        const { gateway } = harness();
        const first = await gateway.inbound(env({ missed: true }));
        if (first.kind !== 'handled') throw new Error(first.kind);
        const before = first.turn.body;
        await gateway.inbound(env({ missed: false, transcript: TRANSCRIPT }), {}, { attachOnly: true });
        expect(gateway.store.get(first.file.id)!.turns[0].body).toBe(before);
    });

    it('an attach with no call turn on any file opens nothing and runs nothing', async () => {
        const { gateway, ran } = harness();
        const out = await gateway.inbound(env({ transcript: TRANSCRIPT }), {}, { attachOnly: true });
        expect(out.kind).toBe('refused');
        expect(gateway.store.all()).toEqual([]);
        expect(ran).toEqual([]);
    });

    it('finds the call on a file that is already done rather than opening a new one', async () => {
        const { gateway, ran } = harness();
        const first = await gateway.inbound(env());
        if (first.kind !== 'handled') throw new Error(first.kind);
        gateway.store.get(first.file.id)!.stage = 'done';
        const out = await gateway.inbound(env({ transcript: TRANSCRIPT }), {}, { attachOnly: true });
        expect(out.kind).toBe('attached');
        expect(gateway.store.all()).toHaveLength(1);
        expect(gateway.store.get(first.file.id)!.turns[0].body).toContain('kitchen tap');
        expect(ran).toEqual([first.turn.id]);
    });

    it('a door call carries no call id and is never treated as an attach', async () => {
        const { gateway, ran } = harness();
        const a = await gateway.inbound(env({ callId: null, transcript: TRANSCRIPT }));
        const b = await gateway.inbound(env({ callId: null, transcript: TRANSCRIPT, at: '2026-09-16T09:59:00.000Z' }));
        expect([a.kind, b.kind]).toEqual(['handled', 'handled']);
        expect(ran).toHaveLength(2);
    });
});
