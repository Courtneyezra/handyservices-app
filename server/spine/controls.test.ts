/**
 * P6 / A2 vitest: switch-control validation (confirm rule, unknown fields, rights), ownership,
 * and the "who changed what" fold. Pure; no database.
 */
import { describe, it, expect } from 'vitest';
import { validateSpineConfigPatch, validateCommsConfigPatch, isOwner, lastChangeByField, OWNER_EMAIL } from './controls';
import { DEFAULT_SPINE_CONFIG, VIDEO_MAX_PER_RUN } from './config';

describe('validateSpineConfigPatch', () => {
    it('accepts an admin-level toggle and needs no confirm', () => {
        const v = validateSpineConfigPatch({ asks: { enabled: true } });
        expect(v).toMatchObject({ ok: true, needs: 'admin', goesLive: false, patch: { asks: { enabled: true } }, changes: ['asks → on'] });
    });
    it('mode and autonomy are owner-only; shadow needs no confirm', () => {
        const v = validateSpineConfigPatch({ mode: 'shadow' });
        expect(v).toMatchObject({ ok: true, needs: 'owner', goesLive: false, patch: { mode: 'shadow', enabled: true, shadow: true } });
        expect(validateSpineConfigPatch({ autonomy: { enabled: true } })).toMatchObject({ ok: true, needs: 'owner' });
        expect(validateSpineConfigPatch({ mode: 'off' })).toMatchObject({ ok: true, patch: { mode: 'off', enabled: false, shadow: false } });
    });
    it("refuses mode 'live' without confirm: 'LIVE', accepts it with", () => {
        const no = validateSpineConfigPatch({ mode: 'live' });
        expect(no.ok).toBe(false);
        expect((no as any).errors.join(' ')).toMatch(/confirm: 'LIVE'/);
        expect(validateSpineConfigPatch({ mode: 'live', confirm: 'live' }).ok).toBe(false); // exact word
        const yes = validateSpineConfigPatch({ mode: 'live', confirm: 'LIVE' });
        expect(yes).toMatchObject({ ok: true, needs: 'owner', goesLive: true, confirmed: true, patch: { mode: 'live', enabled: true, shadow: false } });
    });
    it('refuses unknown fields, bad types, unknown agents and an empty patch', () => {
        expect((validateSpineConfigPatch({ sweepLimit: 9 }) as any).errors).toEqual(['unknown field sweepLimit']);
        expect((validateSpineConfigPatch({ asks: { enabled: 'yes' } }) as any).errors[0]).toMatch(/asks.enabled must be true or false/);
        expect((validateSpineConfigPatch({ mode: 'on' }) as any).errors[0]).toMatch(/mode must be/);
        expect((validateSpineConfigPatch({ agents: { comms: { enabled: false } } }) as any).errors[0]).toMatch(/unknown agent comms/);
        expect((validateSpineConfigPatch({}) as any).errors).toEqual(['nothing to change']);
        expect(validateSpineConfigPatch(null).ok).toBe(false);
        expect(validateSpineConfigPatch([1]).ok).toBe(false);
    });
    it('per-agent switches and video.images are admin-level', () => {
        const v = validateSpineConfigPatch({ agents: { scoper: { enabled: false } }, video: { enabled: true, images: true } });
        expect(v).toMatchObject({ ok: true, needs: 'admin', patch: { agents: { scoper: { enabled: false } }, video: { enabled: true, images: true } } });
        expect((v as any).changes).toEqual(['video → on', 'video.images → on', 'agents.scoper → off']);
    });
});

describe('validateCommsConfigPatch', () => {
    it('onInbound is admin-level; autosend is owner-only', () => {
        expect(validateCommsConfigPatch({ onInbound: false })).toMatchObject({ ok: true, needs: 'admin', patch: { onInbound: false } });
        expect(validateCommsConfigPatch({ autosend: { enabled: false } })).toMatchObject({ ok: true, needs: 'owner', turnsAutosendOn: false });
    });
    it('turning autosend ON needs the typed word', () => {
        expect((validateCommsConfigPatch({ autosend: { enabled: true } }) as any).errors.join(' ')).toMatch(/needs confirm: 'LIVE'/);
        expect(validateCommsConfigPatch({ autosend: { enabled: true }, confirm: 'LIVE' })).toMatchObject({ ok: true, turnsAutosendOn: true, confirmed: true });
    });
    it('refuses unknown fields and bad types', () => {
        expect((validateCommsConfigPatch({ enabled: false }) as any).errors[0]).toBe('unknown field enabled');
        expect((validateCommsConfigPatch({ onInbound: 'no' }) as any).errors[0]).toMatch(/onInbound must be/);
    });
});

describe('isOwner', () => {
    it('the owner account or role admin; never va', () => {
        expect(isOwner({ email: OWNER_EMAIL, role: 'va' })).toBe(true);
        expect(isOwner({ email: ' EzraMarketingLtd@gmail.com ', role: 'va' })).toBe(true);
        expect(isOwner({ email: 'someone@handyservices.co.uk', role: 'admin' })).toBe(true);
        expect(isOwner({ email: 'ben@handyservices.co.uk', role: 'va' })).toBe(false);
        expect(isOwner(null)).toBe(false);
    });
});

describe('lastChangeByField', () => {
    const spine = (at: string, by: string, before: any, after: any) => ({ at, source: 'spine', summary: `spine config changed by ${by}`, detail: { before, after, by } });
    const comms = (at: string, by: string, patch: any) => ({ at, source: 'comms-config', summary: 'comms flags', detail: { patch, by } });
    it('finds the newest event that actually changed each control', () => {
        const events = [
            spine('2026-09-01T10:00:00Z', 'script:courtnee', { enabled: false, shadow: false, asks: { enabled: false } }, { enabled: true, shadow: true, asks: { enabled: false } }),
            spine('2026-09-02T10:00:00Z', 'human:ben', { enabled: true, shadow: true, asks: { enabled: false } }, { enabled: true, shadow: true, asks: { enabled: true } }),
            spine('2026-09-03T10:00:00Z', 'human:courtnee', { enabled: true, shadow: true, asks: { enabled: true } }, { enabled: true, shadow: true, asks: { enabled: true }, sampler: { enabled: true } }),
            comms('2026-09-02T12:00:00Z', 'human:courtnee', { autosend: { enabled: false } }),
            comms('2026-09-03T12:00:00Z', 'human:ben', { onInbound: false }),
        ];
        const last = lastChangeByField(events);
        expect(last.mode).toMatchObject({ at: '2026-09-01T10:00:00.000Z', by: 'script:courtnee' });
        expect(last.asks).toMatchObject({ at: '2026-09-02T10:00:00.000Z', by: 'human:ben' });
        expect(last.sampler).toMatchObject({ at: '2026-09-03T10:00:00.000Z', by: 'human:courtnee' });
        expect(last.autonomy).toBeUndefined();
        expect(last.autosend).toMatchObject({ by: 'human:courtnee' });
        expect(last.onInbound).toMatchObject({ by: 'human:ben' });
    });
    it('an event without a by reads as unknown; an explicit mode field is honoured', () => {
        const last = lastChangeByField([{ at: '2026-09-04T00:00:00Z', source: 'spine', summary: 's', detail: { before: { enabled: true, mode: 'shadow' }, after: { enabled: true, mode: 'live' } } }]);
        expect(last.mode).toMatchObject({ by: 'unknown' });
    });
});

describe('T7: video.maxPerRun and the photos switch', () => {
    it('accepts a whole number inside the bound, admin-level, and names the change', () => {
        const v = validateSpineConfigPatch({ video: { maxPerRun: 6 } });
        expect(v).toMatchObject({ ok: true, needs: 'admin', goesLive: false, patch: { video: { maxPerRun: 6 } }, changes: ['video.maxPerRun → 6'] });
        expect(validateSpineConfigPatch({ video: { maxPerRun: VIDEO_MAX_PER_RUN.min } }).ok).toBe(true);
        expect(validateSpineConfigPatch({ video: { maxPerRun: VIDEO_MAX_PER_RUN.max } }).ok).toBe(true);
    });
    it('refuses anything outside the bound, a float, a string, NaN — nothing bad can reach the row', () => {
        const bad = [0, -1, VIDEO_MAX_PER_RUN.max + 1, 99, 2.5, '6', NaN, null, true];
        for (const maxPerRun of bad) {
            const v = validateSpineConfigPatch({ video: { maxPerRun } });
            expect(v.ok, `maxPerRun=${String(maxPerRun)}`).toBe(false);
            expect((v as any).errors[0]).toMatch(new RegExp(`video.maxPerRun must be a whole number from ${VIDEO_MAX_PER_RUN.min} to ${VIDEO_MAX_PER_RUN.max}`));
        }
        // A bad count poisons the whole body: the switch next to it is not applied either.
        expect(validateSpineConfigPatch({ video: { enabled: true, maxPerRun: 0 } }).ok).toBe(false);
    });
    it('the three video fields travel together as one partial sub-object', () => {
        const v = validateSpineConfigPatch({ video: { enabled: true, images: true, maxPerRun: 4 } });
        expect(v).toMatchObject({ ok: true, patch: { video: { enabled: true, images: true, maxPerRun: 4 } } });
        expect((v as any).changes).toEqual(['video → on', 'video.images → on', 'video.maxPerRun → 4']);
        // Only the switch: no maxPerRun key sneaks in as undefined.
        const only = validateSpineConfigPatch({ video: { images: false } });
        expect(only.ok && Object.keys((only as any).patch.video)).toEqual(['images']);
    });
    it('the bound is what config.ts says it is', () => {
        expect(VIDEO_MAX_PER_RUN).toEqual({ min: 1, max: 12 });
        expect(DEFAULT_SPINE_CONFIG.video.maxPerRun).toBeGreaterThanOrEqual(VIDEO_MAX_PER_RUN.min);
        expect(DEFAULT_SPINE_CONFIG.video.maxPerRun).toBeLessThanOrEqual(VIDEO_MAX_PER_RUN.max);
    });
    it('lastChangeByField sees the photos switch and the count as their own controls', () => {
        const spine = (at: string, by: string, before: any, after: any) => ({ at, source: 'spine', summary: `spine config changed by ${by}`, detail: { before, after, by } });
        const last = lastChangeByField([
            spine('2026-09-07T10:00:00Z', 'human:ben', { enabled: true, video: { enabled: false, images: false, maxPerRun: 3 } }, { enabled: true, video: { enabled: true, images: false, maxPerRun: 3 } }),
            spine('2026-09-07T11:00:00Z', 'human:courtnee', { enabled: true, video: { enabled: true, images: false, maxPerRun: 3 } }, { enabled: true, video: { enabled: true, images: true, maxPerRun: 3 } }),
            spine('2026-09-07T12:00:00Z', 'human:ben', { enabled: true, video: { enabled: true, images: true, maxPerRun: 3 } }, { enabled: true, video: { enabled: true, images: true, maxPerRun: 6 } }),
        ]);
        expect(last.video).toMatchObject({ at: '2026-09-07T10:00:00.000Z', by: 'human:ben' });
        expect(last['video.images']).toMatchObject({ at: '2026-09-07T11:00:00.000Z', by: 'human:courtnee' });
        expect(last['video.maxPerRun']).toMatchObject({ at: '2026-09-07T12:00:00.000Z', by: 'human:ben' });
    });
});

// ---------------------------------------------------------------- 0.2: the sender switches

describe('the sender switches (0.2)', () => {
    it('accepts a key the registry actually issued', () => {
        const v = validateSpineConfigPatch({ senders: { lead_automations: { enabled: false } } });
        expect(v.ok).toBe(true);
        expect(v.ok && v.patch.senders).toEqual({ lead_automations: { enabled: false } });
        expect(v.ok && v.changes).toContain('senders.lead_automations → off');
    });

    it('refuses a key nothing issued — a switch that turns nothing off is the bug this item ends', () => {
        const v = validateSpineConfigPatch({ senders: { made_up: { enabled: false } } });
        expect(v.ok).toBe(false);
        expect(!v.ok && v.errors.join(' ')).toMatch(/unknown sender switch made_up/);
    });

    it('a transactional sender cannot be named here, because it was never given a key', () => {
        // system.notification — the booking confirmation, the job notifications, the recovery SMS.
        for (const guess of ['system.notification', 'notification', 'booking_confirmation']) {
            const v = validateSpineConfigPatch({ senders: { [guess]: { enabled: false } } });
            expect(v.ok, guess).toBe(false);
        }
    });

    it('refuses a non-boolean, like every other switch', () => {
        const v = validateSpineConfigPatch({ senders: { lead_automations: { enabled: 'no' } } });
        expect(v.ok).toBe(false);
    });
});
