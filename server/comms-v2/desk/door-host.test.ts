/**
 * The door host's refusal rules: no branch string, no door; a production string, no door;
 * DATABASE_URL is never read and is overwritten with the branch string; no message carries a
 * value.
 */
import { describe, expect, it } from 'vitest';
import { PRODUCTION_DB_HOST_MARKER } from '../../worker-gate';
import { COMMS_V2_DATABASE_ENV, DOOR_MOUNT, DoorHostError, prepareDoorEnv, resolveCommsV2Database } from './door-host';

const BRANCH = 'postgres://user:secret@ep-branch-example.eu-west-2.aws.neon.tech/neondb';
const PROD = `postgres://user:secret@${PRODUCTION_DB_HOST_MARKER}-a1b2.eu-west-2.aws.neon.tech/neondb`;

describe('resolveCommsV2Database', () => {
    it('refuses when the desk variable is unset, without reading DATABASE_URL', () => {
        const r = resolveCommsV2Database({ DATABASE_URL: BRANCH });
        expect(r.ok).toBe(false);
        if (!r.ok) { expect(r.reason).toBe('missing'); expect(r.message).toContain(COMMS_V2_DATABASE_ENV); expect(r.message).not.toContain('secret'); }
    });
    it('reads the desk variable from the ordinary environment', () => {
        expect(resolveCommsV2Database({ [COMMS_V2_DATABASE_ENV]: BRANCH })).toEqual({ ok: true, url: BRANCH, from: COMMS_V2_DATABASE_ENV });
    });
    it('refuses a production value and names no value', () => {
        const r = resolveCommsV2Database({ [COMMS_V2_DATABASE_ENV]: PROD });
        expect(r.ok).toBe(false);
        if (!r.ok) { expect(r.reason).toBe('production'); expect(r.message).toContain(COMMS_V2_DATABASE_ENV); expect(r.message).not.toContain('secret'); }
    });
});

describe('prepareDoorEnv', () => {
    it('refuses without the branch string, even when DATABASE_URL is set', () => {
        const env: NodeJS.ProcessEnv = { DATABASE_URL: BRANCH };
        expect(() => prepareDoorEnv(env)).toThrow(DoorHostError);
        try { prepareDoorEnv(env); } catch (e: any) {
            expect(e.kind).toBe('refused');
            expect(e.message).toContain(COMMS_V2_DATABASE_ENV);
            expect(e.message).not.toContain('secret');
        }
    });
    it('refuses a production string and names no value', () => {
        const env: NodeJS.ProcessEnv = { [COMMS_V2_DATABASE_ENV]: PROD };
        try { prepareDoorEnv(env); expect.unreachable('should refuse'); } catch (e: any) {
            expect(e).toBeInstanceOf(DoorHostError);
            expect(e.kind).toBe('refused');
            expect(e.message).toContain(COMMS_V2_DATABASE_ENV);
            expect(e.message).not.toContain('secret');
        }
        expect(env.DATABASE_URL).toBeUndefined();
    });
    it('puts the branch string where the database module reads it, over whatever DATABASE_URL held', () => {
        const env: NodeJS.ProcessEnv = { DATABASE_URL: PROD, [COMMS_V2_DATABASE_ENV]: BRANCH };
        expect(prepareDoorEnv(env)).toEqual({ databaseFrom: COMMS_V2_DATABASE_ENV });
        expect(env.DATABASE_URL).toBe(BRANCH);
    });
    it('mounts where the desk\'s door test mounts', () => {
        expect(DOOR_MOUNT).toBe('/api/comms-v2-sandbox');
    });
});
