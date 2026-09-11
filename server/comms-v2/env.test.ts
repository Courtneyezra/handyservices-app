/**
 * The machine-local env loader: takes only the three allowed names, fills only what is unset,
 * ignores everything else by name and never prints a value; and the desk's database resolution,
 * which reads one name and refuses production.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTION_DB_HOST_MARKER } from '../worker-gate';
import { ALLOWED_FROM_FILE, COMMS_V2_DATABASE_ENV, commsV2EnvPath, loadCommsV2Env, resolveCommsV2Database } from './env';

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
    it('allows exactly the database string and the two model keys', () => {
        expect([...ALLOWED_FROM_FILE].sort()).toEqual(['ANTHROPIC_API_KEY', 'COMMS_V2_DATABASE_URL', 'GEMINI_API_KEY']);
    });
    it('a missing file loads nothing and is not an error', () => {
        const env: NodeJS.ProcessEnv = {};
        const r = loadCommsV2Env({ home: homeWith(null), env });
        expect(r.found).toBe(false);
        expect(r.loaded).toEqual([]);
        expect(r.ignored).toEqual([]);
        expect(env).toEqual({});
    });
    it('fills only the allowed variables the process does not already have', () => {
        const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'from-the-shell', GEMINI_API_KEY: '' };
        const r = loadCommsV2Env({ home: homeWith('ANTHROPIC_API_KEY=from-the-file\nGEMINI_API_KEY=g-file\nCOMMS_V2_DATABASE_URL=postgres://u:p@branch.example/db\n'), env });
        expect(r.found).toBe(true);
        expect(env.ANTHROPIC_API_KEY).toBe('from-the-shell');
        expect(env.GEMINI_API_KEY).toBe('g-file');
        expect(env.COMMS_V2_DATABASE_URL).toBe('postgres://u:p@branch.example/db');
        expect(r.kept).toEqual(['ANTHROPIC_API_KEY']);
        expect(r.loaded.sort()).toEqual(['COMMS_V2_DATABASE_URL', 'GEMINI_API_KEY']);
        expect(r.ignored).toEqual([]);
    });
    it('ignores every other name in the file and reports it by name only', () => {
        const env: NodeJS.ProcessEnv = {};
        const file = [
            'DATABASE_URL=postgres://u:p@anywhere/db',
            'COMMS_WORKER=1',
            'NODE_ENV=production',
            'OPENAI_API_KEY=sk-openai-secret',
            'STRIPE_SECRET_KEY=sk-stripe-secret',
            'TWILIO_AUTH_TOKEN=twilio-secret',
            'GEMINI_API_KEY=g-file',
            '',
        ].join('\n');
        const r = loadCommsV2Env({ home: homeWith(file), env });
        expect(env).toEqual({ GEMINI_API_KEY: 'g-file' });
        expect(r.loaded).toEqual(['GEMINI_API_KEY']);
        expect(r.ignored.sort()).toEqual(['COMMS_WORKER', 'DATABASE_URL', 'NODE_ENV', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'TWILIO_AUTH_TOKEN']);
        expect(JSON.stringify(r)).not.toMatch(/secret|anywhere|production/);
    });
    it('is idempotent and reports names only, never a value', () => {
        const env: NodeJS.ProcessEnv = {};
        const home = homeWith('ANTHROPIC_API_KEY=sk-secret-value\n');
        const first = loadCommsV2Env({ home, env });
        const second = loadCommsV2Env({ home, env });
        expect(first.loaded).toEqual(['ANTHROPIC_API_KEY']);
        expect(second.loaded).toEqual([]);
        expect(second.kept).toEqual(['ANTHROPIC_API_KEY']);
        expect(JSON.stringify([first, second])).not.toContain('sk-secret-value');
    });
    it('writes nothing to the console', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        loadCommsV2Env({ home: homeWith('ANTHROPIC_API_KEY=sk-secret-value\nSTRIPE_SECRET_KEY=sk-stripe-secret\n'), env: {} });
        expect(log).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });
});

describe('resolveCommsV2Database', () => {
    it('refuses when the desk variable is unset, without reading DATABASE_URL', () => {
        const r = resolveCommsV2Database({ DATABASE_URL: 'postgres://u:p@branch.example/db' });
        expect(r.ok).toBe(false);
        if (!r.ok) { expect(r.reason).toBe('missing'); expect(r.message).toContain(COMMS_V2_DATABASE_ENV); expect(r.message).not.toContain('branch.example'); }
    });
    it('reads the desk variable', () => {
        const r = resolveCommsV2Database({ [COMMS_V2_DATABASE_ENV]: 'postgres://u:p@branch.example/db' });
        expect(r).toEqual({ ok: true, url: 'postgres://u:p@branch.example/db', from: COMMS_V2_DATABASE_ENV });
    });
    it('refuses a production value and names no value', () => {
        const prod = `postgres://u:p@${PRODUCTION_DB_HOST_MARKER}.example/db`;
        const r = resolveCommsV2Database({ [COMMS_V2_DATABASE_ENV]: prod });
        expect(r.ok).toBe(false);
        if (!r.ok) { expect(r.reason).toBe('production'); expect(r.message).toContain(COMMS_V2_DATABASE_ENV); expect(r.message).not.toContain('u:p@'); }
    });
});
