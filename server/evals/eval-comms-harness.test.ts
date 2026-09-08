/**
 * 0.7 part A: a local eval run with NO database must still work exactly as it did before —
 * the file is written, the table is skipped out loud, and the run keeps its own exit code.
 *
 * This drives the real script in a child process (replay adapter, one family, one trial: no model,
 * no network, ~2s) because the thing under test is the script's own wiring, not a pure function.
 * eval-results/latest.json and latest.md are saved and restored so a developer's own scoreboard
 * survives the test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RESULTS = path.join(ROOT, 'eval-results');
const KEEP = ['latest.json', 'latest.md'];
const saved = new Map<string, Buffer>();
const written: string[] = [];

function run(env: NodeJS.ProcessEnv): string {
    return execFileSync('npx', ['tsx', 'scripts/eval-comms.ts', '--family', 'closing', '--adapter', 'replay', '--trials', '1'], {
        cwd: ROOT,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
}

beforeAll(() => {
    for (const f of KEEP) {
        const p = path.join(RESULTS, f);
        if (fs.existsSync(p)) saved.set(f, fs.readFileSync(p));
    }
});

afterAll(() => {
    for (const p of written) { try { fs.unlinkSync(p); } catch { /* already gone */ } }
    for (const f of KEEP) {
        const p = path.join(RESULTS, f);
        const was = saved.get(f);
        if (was) fs.writeFileSync(p, was);
        else { try { fs.unlinkSync(p); } catch { /* was not there before either */ } }
    }
});

describe('eval-comms with no database', () => {
    it('writes the scoreboard file and says the table was skipped', () => {
        const out = run({ DATABASE_URL: '' });
        const m = out.match(/Results: eval-results\/([^\s]+\.json)/);
        expect(m, out).toBeTruthy();
        const runFile = path.join(RESULTS, m![1]);
        written.push(runFile);
        expect(fs.existsSync(runFile)).toBe(true);
        expect(fs.existsSync(path.join(RESULTS, 'latest.json'))).toBe(true);
        expect(fs.existsSync(path.join(RESULTS, 'latest.md'))).toBe(true);
        expect(out).toContain('table: skipped (no DATABASE_URL');

        // 0.7 part C: the run records the prompt it graded, file and table alike.
        const written1 = JSON.parse(fs.readFileSync(runFile, 'utf8'));
        expect(written1.promptHash).toMatch(/^[0-9a-f]{24}$/);
        expect(Object.keys(written1.promptHashes ?? {})).toContain('customer.default');
        expect(out).toContain(`Prompt digest graded: ${written1.promptHash}`);
    }, 180_000);

    it('still writes the file when a database is configured but unreachable, and says why', () => {
        // A refused connection must never cost the run its results or its exit code.
        const out = run({ DATABASE_URL: 'postgres://eval:none@127.0.0.1:1/no-db' });
        const m = out.match(/Results: eval-results\/([^\s]+\.json)/);
        expect(m, out).toBeTruthy();
        written.push(path.join(RESULTS, m![1]));
        expect(fs.existsSync(path.join(RESULTS, m![1]))).toBe(true);
        expect(out).toMatch(/table: NOT written — /);
    }, 180_000);
});
