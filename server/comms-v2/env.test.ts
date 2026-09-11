/**
 * The machine-local env loader: fills only what is unset, never takes DATABASE_URL, never prints
 * a value; and the desk's database resolution, which accepts both names for one release and
 * refuses production.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTION_DB_HOST_MARKER } from '../worker-gate';
import { COMMS_V2_DATABASE_ENV, COMMS_V2_DATABASE_ENV_LEGACY, commsV2EnvPath, loadCommsV2Env, resolveCommsV2Database } from './env';

const homes: string[] = [];
function homeWith(contents: string | null): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-env-home-'));
    homes.push(home);
    if (contents !== null) {
        const file = commsV2EnvPath(home);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents, { mode: 0o600 });
    }
    return home;
}
afterEach(() => { for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('loadCommsV2Env', () => {
    it('looks under $HOME/.config/handyservices/comms-v2.env', () => {
        expect(commsV2EnvPath('/h')).toBe(path.join('/h', '.config', 'handyservices', 'comms-v2.env'));
    });
    it('a missing file loads nothing and is not an error', () => {
        const env: NodeJS.ProcessEnv = {};
        const r = loadCommsV2Env({ home: homeWith(null), env });
        expect(r.found).toBe(false);
        expect(r.loaded).toEqual([]);
        expect(env).toEqual({});
    });
    it('fills only the variables the process does not already have', () => {
        const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'from-the-shell', EMPTY: '' };
        const r = loadCommsV2Env({ home: homeWith('ANTHROPIC_API_KEY=from-the-file\nGEMINI_API_KEY=g-file\nEMPTY=filled\nCOMMS_V2_DATABASE_URL=postgres://u:p@branch.example/db\n'), env });
        expect(r.found).toBe(true);
        expect(env.ANTHROPIC_API_KEY).toBe('from-the-shell');
        expect(env.GEMINI_API_KEY).toBe('g-file');
        expect(env.EMPTY).toBe('filled');
        expect(env.COMMS_V2_DATABASE_URL).toBe('postgres://u:p@branch.example/db');
        expect(r.kept).toEqual(['ANTHROPIC_API_KEY']);
        expect(r.loaded.sort()).toEqual(['COMMS_V2_DATABASE_URL', 'EMPTY', 'GEMINI_API_KEY']);
    });
    it('never takes DATABASE_URL, COMMS_WORKER or NODE_ENV from the file', () => {
        const env: NodeJS.ProcessEnv = {};
        const r = loadCommsV2Env({ home: homeWith('DATABASE_URL=postgres://u:p@anywhere/db\nCOMMS_WORKER=1\nNODE_ENV=production\nOPENAI_API_KEY=o\n'), env });
        expect(env.DATABASE_URL).toBeUndefined();
        expect(env.COMMS_WORKER).toBeUndefined();
        expect(env.NODE_ENV).toBeUndefined();
        expect(env.OPENAI_API_KEY).toBe('o');
        expect(r.refused.sort()).toEqual(['COMMS_WORKER', 'DATABASE_URL', 'NODE_ENV']);
    });
    it('is idempotent and reports names only, never a value', () => {
        const env: NodeJS.ProcessEnv = {};
        const home = homeWith('OPENAI_API_KEY=sk-secret-value\n');
        const first = loadCommsV2Env({ home, env });
        const second = loadCommsV2Env({ home, env });
        expect(first.loaded).toEqual(['OPENAI_API_KEY']);
        expect(second.loaded).toEqual([]);
        expect(second.kept).toEqual(['OPENAI_API_KEY']);
        expect(JSON.stringify([first, second])).not.toContain('sk-secret-value');
    });
    it('writes nothing to the console', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        loadCommsV2Env({ home: homeWith('OPENAI_API_KEY=sk-secret-value\n'), env: {} });
        expect(log).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });
});

describe('resolveCommsV2Database', () => {
    it('refuses when neither name is set, without reading DATABASE_URL', () => {
        const r = resolveCommsV2Database({ DATABASE_URL: 'postgres://u:p@branch.example/db' });
        expect(r.ok).toBe(false);
        if (!r.ok) { expect(r.reason).toBe('missing'); expect(r.message).toContain(COMMS_V2_DATABASE_ENV); expect(r.message).not.toContain('branch.example'); }
    });
    it('reads the renamed variable', () => {
        const r = resolveCommsV2Database({ [COMMS_V2_DATABASE_ENV]: 'postgres://u:p@branch.example/db' });
        expect(r).toEqual({ ok: true, url: 'postgres://u:p@branch.example/db', from: COMMS_V2_DATABASE_ENV });
    });
    it('accepts the legacy name for one release, and the renamed one wins when both are set', () => {
        expect(resolveCommsV2Database({ [COMMS_V2_DATABASE_ENV_LEGACY]: 'postgres://u:p@old.example/db' })).toEqual({ ok: true, url: 'postgres://u:p@old.example/db', from: COMMS_V2_DATABASE_ENV_LEGACY });
        expect(resolveCommsV2Database({ [COMMS_V2_DATABASE_ENV_LEGACY]: 'postgres://u:p@old.example/db', [COMMS_V2_DATABASE_ENV]: 'postgres://u:p@new.example/db' })).toMatchObject({ ok: true, from: COMMS_V2_DATABASE_ENV });
    });
    it('refuses a production value under either name and names no value', () => {
        const prod = `postgres://u:p@${PRODUCTION_DB_HOST_MARKER}.example/db`;
        for (const name of [COMMS_V2_DATABASE_ENV, COMMS_V2_DATABASE_ENV_LEGACY]) {
            const r = resolveCommsV2Database({ [name]: prod });
            expect(r.ok).toBe(false);
            if (!r.ok) { expect(r.reason).toBe('production'); expect(r.message).toContain(name); expect(r.message).not.toContain('u:p@'); }
        }
    });
});
