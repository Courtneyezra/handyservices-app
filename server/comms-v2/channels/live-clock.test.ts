/**
 * The live desk's clock: nothing at all while the new desk is not live; a pass over every file that
 * can have something due while it is, never a finished job; a failing pass on one file leaves the
 * rest; ticks never overlap.
 */
import { describe, expect, it } from 'vitest';
import type { CaseFile } from '../desk/case-file';
import type { DeskResult } from '../desk/desk-types';
import { clockDue, liveClockTick, runLiveClockTick, type ClockableGateway } from './live-clock';

const file = (id: string, over: Partial<CaseFile> = {}): CaseFile => ({ id, stage: 'scoping', hold: null, job: { type: null, location: null, quoteRef: null, bookingRef: null }, facts: [], ...over } as CaseFile);
const result = (action: 'none' | 'chased' | 'escalated' | 'refused'): DeskResult => ({ chase: action === 'none' ? null : { action } } as unknown as DeskResult);

describe('the live clock', () => {
    it('does nothing and builds nothing while any switch is off', async () => {
        let built = 0;
        const tick = await liveClockTick({ liveState: async () => ({ live: false, off: ['COMMS_V2_INTAKE=1'] }), gateway: async () => { built++; throw new Error('never built'); }, log: () => undefined });
        expect(tick).toEqual({ ran: false, off: ['COMMS_V2_INTAKE=1'], files: 0, chased: 0, refused: 0, errors: 0, staleClosed: 0 });
        expect(built).toBe(0);
    });

    it('passes every held file, every file with a quote, every file with a chase record and every file with a lost quote draft, never a finished job, and counts what the chase did', async () => {
        const files = [
            file('held', { hold: { since: '2026-09-14T10:00:00.000Z' } as any }),
            file('quoted', { job: { type: 'tap', location: 'NG9', quoteRef: 'abc12345', bookingRef: null } }),
            file('released', { chase: { caseId: 'released' } as any }),
            file('lost', { facts: [{ key: 'quote_drafting', value: 'started: with the drafter', source: { kind: 'thread', turnId: 't1' } }] as any }),
            file('drafted', { facts: [{ key: 'quote_drafting', value: 'started: with the drafter' }, { key: 'quote_drafting', value: 'failed: the estimator is down' }] as any }),
            file('quiet'),
            file('done', { stage: 'done', hold: { since: '2026-09-14T10:00:00.000Z' } as any }),
        ];
        expect(files.filter(clockDue).map((f) => f.id)).toEqual(['held', 'quoted', 'released', 'lost']);
        const clocked: string[] = [];
        const gateway: ClockableGateway = {
            store: { all: () => files, put: () => undefined },
            async clock(id) {
                clocked.push(id);
                if (id === 'quoted') throw new Error('the quote store is down');
                return result(id === 'held' ? 'refused' : 'none');
            },
        };
        const lines: string[] = [];
        const tick = await liveClockTick({ liveState: async () => ({ live: true, off: [] }), gateway: async () => gateway, log: (l) => lines.push(l) });
        expect(clocked).toEqual(['held', 'quoted', 'released', 'lost']);
        expect(tick).toEqual({ ran: true, off: [], files: 4, chased: 0, refused: 1, errors: 1, staleClosed: 0 });
        expect(lines.join('\n')).toMatch(/case quoted failed: the quote store is down/);
    });

    it('skips a tick while the last one is still running', async () => {
        let finish!: () => void;
        const slow: ClockableGateway = { store: { all: () => [file('held', { hold: {} as any })], put: () => undefined }, clock: () => new Promise((r) => { finish = () => r(result('chased')); }) };
        const deps = { liveState: async () => ({ live: true, off: [] as string[] }), gateway: async () => slow, log: () => undefined };
        const first = runLiveClockTick(deps);
        await new Promise((r) => setTimeout(r, 0));
        expect(await runLiveClockTick(deps)).toBeNull();
        finish();
        expect(await first).toMatchObject({ ran: true, chased: 1 });
    });
});
