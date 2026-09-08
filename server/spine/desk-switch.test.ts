/**
 * Build plan v2, item 0.5 "The switch" — `spine.desk`, the one setting that says which desk
 * behaviour is live, and `isDeskV4()`, the only sanctioned way to ask.
 *
 * Nothing consults the switch yet; this suite pins the four things later PRs will lean on:
 *   the default is v3 (today's desk), in code and through every read path;
 *   an unknown value is refused — by the schema on read, and by the route's validator on write;
 *   the helper is false on the default and true only on 'v4';
 *   a round trip through the ACTUAL POST /config handler preserves the value and logs the change.
 *
 * Pure + process-local config: no database (mocked at import), no live row.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, pool: {} }));

import {
    DEFAULT_SPINE_CONFIG, DESK_BEHAVIOURS, isDeskBehaviour, isDeskV4,
    getSpineConfig, setSpineConfig, useProcessLocalSpineConfig, _resetSpineConfigForTests,
    type DeskBehaviour, type SpineConfig,
} from './config';
import { validateSpineConfigPatch, SPINE_CONTROLS, lastChangeByField } from './controls';
import { spineRouter } from './routes';

afterEach(() => { _resetSpineConfigForTests(); });

describe('0.5: the vocabulary', () => {
    it('is exactly v3 and v4 — there is no third desk', () => {
        expect(DESK_BEHAVIOURS).toEqual(['v3', 'v4']);
    });
    it('isDeskBehaviour narrows only those two', () => {
        expect(isDeskBehaviour('v3')).toBe(true);
        expect(isDeskBehaviour('v4')).toBe(true);
        for (const bad of ['v5', 'V4', 'v4 ', '', 'live', 4, true, null, undefined, {}, ['v4']]) {
            expect(isDeskBehaviour(bad)).toBe(false);
        }
    });
});

describe('0.5: the default is v3 (today\'s desk)', () => {
    it('in code', () => {
        expect(DEFAULT_SPINE_CONFIG.desk).toBe('v3');
    });
    it('through a process-local config seeded with nothing', async () => {
        useProcessLocalSpineConfig({});
        expect((await getSpineConfig()).desk).toBe('v3');
    });
    it('through the env override seam, and through a row that predates the key', async () => {
        // A stored row written before 0.5 carries no `desk` at all: it reads as today's desk.
        useProcessLocalSpineConfig({ enabled: true, mode: 'live' } as Partial<SpineConfig>);
        const cfg = await getSpineConfig();
        expect(cfg.mode).toBe('live');
        expect(cfg.desk).toBe('v3');
    });
});

describe('0.5: an unknown value is rejected by the schema', () => {
    it('a row carrying junk reads as v3, never as an unknown behaviour (fail closed)', async () => {
        for (const junk of ['v5', 'V4', 'true', 42, null, {}, []]) {
            useProcessLocalSpineConfig({ desk: junk as unknown as DeskBehaviour });
            expect((await getSpineConfig()).desk).toBe('v3');
            expect(isDeskV4(await getSpineConfig())).toBe(false);
            _resetSpineConfigForTests();
        }
    });
    it('a good value survives the same read path untouched', async () => {
        useProcessLocalSpineConfig({ desk: 'v4' });
        expect((await getSpineConfig()).desk).toBe('v4');
    });
    it('setSpineConfig cannot store an unknown value either', async () => {
        useProcessLocalSpineConfig({ desk: 'v4' });
        await setSpineConfig({ desk: 'v9' as unknown as DeskBehaviour }, 'test');
        expect((await getSpineConfig()).desk).toBe('v3');
    });
});

describe('0.5: isDeskV4 is the only sanctioned reader', () => {
    it('false on the code default, true only on v4', () => {
        expect(isDeskV4(DEFAULT_SPINE_CONFIG)).toBe(false);
        expect(isDeskV4({ desk: 'v3' })).toBe(false);
        expect(isDeskV4({ desk: 'v4' })).toBe(true);
    });
    it('fail closed on anything it cannot read', () => {
        expect(isDeskV4(null)).toBe(false);
        expect(isDeskV4(undefined)).toBe(false);
        expect(isDeskV4({} as SpineConfig)).toBe(false);
        expect(isDeskV4({ desk: 'V4' as unknown as DeskBehaviour })).toBe(false);
    });
    it('is a behaviour selector, not a permission: it says nothing about whether the spine runs', () => {
        // A v4 desk on a spine that is off is still off — the mode is the permission.
        expect(isDeskV4({ ...DEFAULT_SPINE_CONFIG, desk: 'v4' })).toBe(true);
        expect(DEFAULT_SPINE_CONFIG.enabled).toBe(false);
    });
    it('no behaviour module reads the raw key — everything asks isDeskV4()', async () => {
        const fs = await import('fs'); const path = await import('path');
        const roots = [path.join(__dirname, '..'), path.join(__dirname, '..', '..', 'client', 'src'), path.join(__dirname, '..', '..', 'scripts')];
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
                else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
            }
        };
        for (const r of roots) if (fs.existsSync(r)) walk(r);
        // Where the switch is DEFINED, PLUMBED (the config row → the route → the page) or PRINTED
        // it is naturally named; the ban is on a behaviour module deciding for itself what `desk`
        // means instead of calling isDeskV4(). Update this list only when adding plumbing.
        const plumbing = new Set(['server/spine/config.ts', 'server/spine/controls.ts', 'server/spine/routes.ts', 'server/agent-staff.ts', 'client/src/pages/admin/AgentStaffPage.tsx', 'scripts/_spine-mode.ts']);
        const repo = path.join(__dirname, '..', '..');
        const offenders = files.filter((f) => {
            const rel = path.relative(repo, f).split(path.sep).join('/');
            if (plumbing.has(rel)) return false;
            return /\.desk\b|\bdesk\s*[=!]==\s*['"]v[34]['"]/.test(fs.readFileSync(f, 'utf8'));
        }).map((f) => path.relative(repo, f));
        expect(offenders).toEqual([]);
    });
});

describe('0.5: the route refuses an unknown value and accepts the two', () => {
    it('accepts v3 and v4, owner-only, with an audit line', () => {
        for (const d of DESK_BEHAVIOURS) {
            expect(validateSpineConfigPatch({ desk: d })).toMatchObject({
                ok: true, needs: 'owner', goesLive: false, patch: { desk: d }, changes: [`desk → ${d}`],
            });
        }
    });
    it('refuses anything else, and says what it wanted', () => {
        for (const bad of ['v5', 'V4', 'v3 ', '', 'live', 4, true, null, {}, ['v4']]) {
            const v = validateSpineConfigPatch({ desk: bad });
            expect(v.ok).toBe(false);
            expect((v as any).errors.join(' ')).toMatch(/desk must be 'v3' or 'v4'/);
        }
    });
    it('does not touch the mode: flipping the desk leaves enabled/shadow/mode alone', () => {
        const v = validateSpineConfigPatch({ desk: 'v4' }) as any;
        expect(Object.keys(v.patch)).toEqual(['desk']);
        expect(v.patch.enabled).toBeUndefined();
        expect(v.patch.mode).toBeUndefined();
        expect(v.patch.shadow).toBeUndefined();
    });
    it('carries no confirm word of its own, and rides alongside a mode change', () => {
        const both = validateSpineConfigPatch({ mode: 'live', confirm: 'LIVE', desk: 'v4' }) as any;
        expect(both.ok).toBe(true);
        expect(both.patch).toMatchObject({ mode: 'live', enabled: true, shadow: false, desk: 'v4' });
        expect(both.changes).toContain('desk → v4');
    });
    it('is a control the strip knows about, read as a plain value', () => {
        expect(SPINE_CONTROLS).toContain('desk');
        const folded = lastChangeByField([{
            at: '2026-09-08T09:00:00Z', source: 'spine', summary: 'spine config changed by human:ben: {"desk":"v4"}',
            detail: { by: 'human:ben', before: { ...DEFAULT_SPINE_CONFIG }, after: { ...DEFAULT_SPINE_CONFIG, desk: 'v4' } },
        }]);
        expect(folded.desk).toMatchObject({ by: 'human:ben' });
        expect(folded.mode).toBeUndefined(); // the desk flip did not move the mode
    });
});

// ---------------------------------------------------------------- the round trip

/** The registered POST /config handler, invoked exactly as express would. */
function configHandler(): (req: any, res: any) => Promise<void> {
    const layer = (spineRouter as any).stack.find((l: any) => l.route?.path === '/config' && l.route?.methods?.post);
    expect(layer).toBeTruthy();
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function post(body: unknown, user: any = { id: 'u1', email: 'ezramarketingltd@gmail.com', role: 'admin' }) {
    let status = 200; let payload: any = null;
    const res = {
        status(code: number) { status = code; return res; },
        json(v: any) { payload = v; return res; },
    };
    await configHandler()({ body, user }, res);
    return { status, payload };
}

describe('0.5: a round trip through POST /api/spine/config preserves the value', () => {
    beforeEach(() => { useProcessLocalSpineConfig({ enabled: true, mode: 'live' } as Partial<SpineConfig>); });

    it('v3 → v4 → v3, read back from the config each time', async () => {
        expect((await getSpineConfig()).desk).toBe('v3');

        const up = await post({ desk: 'v4' });
        expect(up.status).toBe(200);
        expect(up.payload).toMatchObject({ ok: true, changes: ['desk → v4'], spine: { desk: 'v4' } });
        expect((await getSpineConfig()).desk).toBe('v4');
        expect(isDeskV4(await getSpineConfig())).toBe(true);

        const down = await post({ desk: 'v3' });
        expect(down.status).toBe(200);
        expect(down.payload).toMatchObject({ ok: true, changes: ['desk → v3'], spine: { desk: 'v3' } });
        expect(isDeskV4(await getSpineConfig())).toBe(false);
    });

    it('the flip leaves the pipeline mode exactly where it was (CUTOVER §4a)', async () => {
        const before = await getSpineConfig();
        await post({ desk: 'v4' });
        const after = await getSpineConfig();
        expect(after.mode).toBe(before.mode);
        expect(after.enabled).toBe(before.enabled);
        expect(after.shadow).toBe(before.shadow);
        expect(after.asks).toEqual(before.asks);
    });

    it('an unknown value is refused by the route with 400, and the stored value does not move', async () => {
        await post({ desk: 'v4' });
        const bad = await post({ desk: 'v5' });
        expect(bad.status).toBe(400);
        expect(bad.payload.ok).toBe(false);
        expect(bad.payload.errors.join(' ')).toMatch(/desk must be 'v3' or 'v4'/);
        expect((await getSpineConfig()).desk).toBe('v4');
    });

    it('a non-owner cannot flip it (403), and the stored value does not move', async () => {
        const va = await post({ desk: 'v4' }, { id: 'u2', email: 'va@handyservices.app', role: 'va' });
        expect(va.status).toBe(403);
        expect((await getSpineConfig()).desk).toBe('v3');
    });
});
