/**
 * The switch-over's desk switch and the one question every live re-point asks.
 *
 *   `spine.commsDesk` defaults to the old desk, in code and through every read, and an unknown value
 *   reads as the old desk; the route refuses one, is owner-only, and choosing the new desk needs the
 *   typed word while going back does not;
 *   `commsV2Live` is yes only with the intake, the desk switch and the new desk's sender switch all
 *   on, in the comms worker, and names every one that is off; an unreadable row is never live.
 *
 * Pure plus process-local config: no database, no live row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, pool: {} }));

import { COMMS_DESKS, DEFAULT_SPINE_CONFIG, isCommsDesk, isCommsV2Desk, getSpineConfig, setSpineConfig, useProcessLocalSpineConfig, _resetSpineConfigForTests, type CommsDesk, type SpineConfig } from '../spine/config';
import { SPINE_CONTROLS, lastChangeByField, validateSpineConfigPatch } from '../spine/controls';
import { commsV2LiveFrom, commsV2LiveState } from './switch';

afterEach(() => { _resetSpineConfigForTests(); });

const ALL_ON_ENV = { COMMS_V2_INTAKE: '1', COMMS_WORKER: '1' } as NodeJS.ProcessEnv;
const ALL_ON_CFG = { commsDesk: 'comms_v2' as CommsDesk, senders: { comms_v2: { enabled: true } } };

describe('the desk switch in the spine row', () => {
    it('is exactly the old desk and the new one', () => {
        expect(COMMS_DESKS).toEqual(['spine', 'comms_v2']);
        for (const bad of ['v2', 'COMMS_V2', 'comms_v2 ', '', 'live', true, null, undefined, {}]) expect(isCommsDesk(bad)).toBe(false);
    });

    it('defaults to the old desk in code, through an empty row and through a row that predates the key', async () => {
        expect(DEFAULT_SPINE_CONFIG.commsDesk).toBe('spine');
        useProcessLocalSpineConfig({});
        expect((await getSpineConfig()).commsDesk).toBe('spine');
        _resetSpineConfigForTests();
        useProcessLocalSpineConfig({ enabled: true, mode: 'live', desk: 'v4' } as Partial<SpineConfig>);
        expect(isCommsV2Desk(await getSpineConfig())).toBe(false);
    });

    it('reads anything unknown as the old desk, and setSpineConfig cannot store one', async () => {
        for (const junk of ['v2', 'COMMS_V2', 1, null, {}]) {
            useProcessLocalSpineConfig({ commsDesk: junk as unknown as CommsDesk });
            expect((await getSpineConfig()).commsDesk).toBe('spine');
            _resetSpineConfigForTests();
        }
        useProcessLocalSpineConfig({ commsDesk: 'comms_v2' });
        expect(isCommsV2Desk(await getSpineConfig())).toBe(true);
        await setSpineConfig({ commsDesk: 'nope' as unknown as CommsDesk }, 'test');
        expect((await getSpineConfig()).commsDesk).toBe('spine');
    });

    it('is read fail closed by its one helper', () => {
        expect(isCommsV2Desk(null)).toBe(false);
        expect(isCommsV2Desk(undefined)).toBe(false);
        expect(isCommsV2Desk({} as SpineConfig)).toBe(false);
        expect(isCommsV2Desk({ commsDesk: 'spine' })).toBe(false);
        expect(isCommsV2Desk({ commsDesk: 'comms_v2' })).toBe(true);
    });
});

describe('the route that flips it', () => {
    it('is owner-only, and choosing the new desk needs the typed word', () => {
        const unconfirmed = validateSpineConfigPatch({ commsDesk: 'comms_v2' });
        expect(unconfirmed.ok).toBe(false);
        expect((unconfirmed as any).errors.join(' ')).toMatch(/confirm: 'LIVE'/);
        expect(validateSpineConfigPatch({ commsDesk: 'comms_v2', confirm: 'LIVE' })).toMatchObject({ ok: true, needs: 'owner', goesLive: false, patch: { commsDesk: 'comms_v2' }, changes: ['commsDesk → comms_v2'] });
    });

    it('going back to the old desk is the roll-back and needs no word', () => {
        expect(validateSpineConfigPatch({ commsDesk: 'spine' })).toMatchObject({ ok: true, needs: 'owner', patch: { commsDesk: 'spine' } });
    });

    it('refuses an unknown value, and leaves the old spine alone', () => {
        const bad = validateSpineConfigPatch({ commsDesk: 'v2', confirm: 'LIVE' });
        expect(bad.ok).toBe(false);
        expect((bad as any).errors.join(' ')).toMatch(/commsDesk must be 'spine' or 'comms_v2'/);
        const v = validateSpineConfigPatch({ commsDesk: 'comms_v2', confirm: 'LIVE' }) as any;
        expect(Object.keys(v.patch)).toEqual(['commsDesk']);
    });

    it('is a control the audit strip folds', () => {
        expect(SPINE_CONTROLS).toContain('commsDesk');
        const folded = lastChangeByField([{
            at: '2026-09-14T09:00:00Z', source: 'spine', summary: 'spine config changed by human:owner: {"commsDesk":"comms_v2"}',
            detail: { by: 'human:owner', before: { ...DEFAULT_SPINE_CONFIG }, after: { ...DEFAULT_SPINE_CONFIG, commsDesk: 'comms_v2' } },
        }]);
        expect(folded.commsDesk).toMatchObject({ by: 'human:owner' });
    });
});

describe('commsV2Live', () => {
    it('is live only with every switch on in the comms worker', () => {
        expect(commsV2LiveFrom(ALL_ON_CFG, ALL_ON_ENV)).toEqual({ live: true, off: [] });
    });

    it('names each switch that is off, and any one off is not live', () => {
        const cases: Array<[string, Pick<SpineConfig, 'commsDesk' | 'senders'>, NodeJS.ProcessEnv, RegExp]> = [
            ['intake', ALL_ON_CFG, { ...ALL_ON_ENV, COMMS_V2_INTAKE: '0' }, /COMMS_V2_INTAKE=1/],
            ['desk', { ...ALL_ON_CFG, commsDesk: 'spine' }, ALL_ON_ENV, /spine\.commsDesk = 'comms_v2'/],
            ['delivery, absent', { ...ALL_ON_CFG, senders: {} }, ALL_ON_ENV, /spine\.senders\.comms_v2\.enabled = true/],
            ['delivery, off', { ...ALL_ON_CFG, senders: { comms_v2: { enabled: false } } }, ALL_ON_ENV, /senders\.comms_v2/],
            ['worker', ALL_ON_CFG, { COMMS_V2_INTAKE: '1' } as NodeJS.ProcessEnv, /COMMS_WORKER=1/],
        ];
        for (const [name, cfg, env, named] of cases) {
            const state = commsV2LiveFrom(cfg, env);
            expect({ name, live: state.live }).toEqual({ name, live: false });
            expect(state.off).toHaveLength(1);
            expect(state.off[0]).toMatch(named);
        }
    });

    it('is not live on today\'s defaults, and an absent config is not live', () => {
        expect(commsV2LiveFrom(DEFAULT_SPINE_CONFIG, ALL_ON_ENV).live).toBe(false);
        expect(commsV2LiveFrom(null, ALL_ON_ENV).off).toHaveLength(2);
    });

    it('reads the spine row as it stands, so flipping one switch back is felt on the next read', async () => {
        useProcessLocalSpineConfig(ALL_ON_CFG);
        expect(await commsV2LiveState(ALL_ON_ENV)).toEqual({ live: true, off: [] });
        await setSpineConfig({ commsDesk: 'spine' }, 'test');
        expect(await commsV2LiveState(ALL_ON_ENV)).toMatchObject({ live: false, off: ["spine.commsDesk = 'comms_v2'"] });
    });
});
