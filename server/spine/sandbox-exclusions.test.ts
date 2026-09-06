/**
 * T5 vitest: the sandbox thread stays out of every surface that could ping Ben or count as
 * evidence. Pinned at the source, architecture-test style, because each of these paths opens a
 * database at import and the exclusion is a one-line predicate whose presence is the whole point.
 *
 *   sweeps    the cadence sweep and requestRun already skip test numbers; the SLA sweep and the
 *             desk's SLA candidates now do the same, BEFORE the lane detector runs
 *   board     loadBoardCards excludes the sandbox number (the desk's reply items derive from it)
 *   evidence  the sampler skips sandbox rows; every one of gatherEvidence's agent_runs queries
 *             carries the sandbox exclusion
 *   scheduler runDue and the legacy ticker read only metadata.nextTriageAt, which the sandbox
 *             route never writes
 *   feed      the legacy agent now imports the lean event shape from the spine, so Phase 5 takes
 *             nothing the panel needs; the canned replay is gone
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('sweeps and the desk skip the drama range before doing anything', () => {
    it('sla-sweep: isTestNumber guard sits inside the candidates loop, before detectSlaLane', () => {
        const src = read('agents/sla-sweep.ts');
        expect(src).toMatch(/import \{ isTestNumber \} from '\.\.\/phone-utils'/);
        const loop = src.slice(src.indexOf('for (const conv of candidates) {'));
        expect(loop.indexOf('isTestNumber(conv.phoneNumber)')).toBeGreaterThan(-1);
        expect(loop.indexOf('isTestNumber(conv.phoneNumber)')).toBeLessThan(loop.indexOf('detectSlaLane(conv)'));
    });
    it('desk-routes: the SLA candidates loop skips test numbers before detectSlaLane', () => {
        const src = read('desk-routes.ts');
        expect(src).toMatch(/import \{ isTestNumber \} from '\.\/phone-utils'/);
        const loop = src.slice(src.indexOf('for (const conv of candidates) {'));
        expect(loop.indexOf('isTestNumber(conv.phoneNumber)')).toBeLessThan(loop.indexOf('detectSlaLane(conv)'));
    });
    it('comms-sweep and requestRun already skip test numbers (the precedent this follows)', () => {
        expect(read('agents/comms-sweep.ts')).toMatch(/if \(isTestNumber\(c\.phoneNumber \?\? ''\)\) continue;/);
        expect(read('spine/request-run.ts')).toMatch(/if \(isTestNumber\(conv\.phoneNumber\)\) return \{ queued: false, reason: 'test number' \};/);
    });
});

describe('the board never shows the sandbox thread', () => {
    it('loadBoardCards carries notSandboxPhoneSql in its where clause', () => {
        const src = read('inbox-board.ts');
        expect(src).toMatch(/import \{ notSandboxPhoneSql \} from '\.\/spine\/sandbox'/);
        const fn = src.slice(src.indexOf('export async function loadBoardCards'));
        expect(fn).toContain('notSandboxPhoneSql(conversations.phoneNumber)');
    });
});

describe('evidence never includes a sandbox pass', () => {
    it('the sampler skips sandbox rows before it looks for a sent draft', () => {
        const src = read('spine/sampler.ts');
        const fn = src.slice(src.indexOf('async function yesterdaysAutomaticSends'));
        expect(fn.indexOf('isSandboxRunProposal(p)')).toBeGreaterThan(-1);
        expect(fn.indexOf('isSandboxRunProposal(p)')).toBeLessThan(fn.indexOf('approver.startsWith'));
    });
    it('every agent_runs query in gatherEvidence carries the exclusion', () => {
        const src = read('spine/autonomy.ts');
        const fn = src.slice(src.indexOf('export async function gatherEvidence'), src.indexOf('// ---------------------------------------------------------------- applying a decision'));
        const queriesOnRuns = (fn.match(/FROM agent_runs|JOIN agent_runs/g) ?? []).length;
        const exclusions = (fn.match(/AND \$\{NOT_SANDBOX(_AR)?\}/g) ?? []).length;
        expect(queriesOnRuns).toBe(4);
        expect(exclusions).toBe(4);
    });
});

describe('no scheduler can pick the sandbox thread up', () => {
    it('the sandbox route never writes nextTriageAt; the tickers read nothing else', () => {
        const route = read('spine/sandbox-routes.ts');
        // Comments may name the key; the CODE may read it (to show "hasTrigger: false" on the
        // page) but must never write it: no `nextTriageAt:` object key, no quoted key for jsonb.
        const code = route.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        expect(code).not.toMatch(/nextTriageAt\s*:/);
        expect(code).not.toMatch(/['"]nextTriageAt['"]/);
        expect(code).not.toMatch(/requestRun\(/);
        expect(read('spine/request-run.ts')).toMatch(/WHERE archived_at IS NULL AND metadata->>'nextTriageAt' <= /);
        expect(read('agents/comms-sweep.ts')).toMatch(/WHERE archived_at IS NULL AND metadata->>'nextTriageAt' <= /);
    });
    it('the route only ever looks the thread up by the sandbox number', () => {
        const route = read('spine/sandbox-routes.ts');
        expect(route).not.toMatch(/req\.(params|query|body)\.(conversation|conversationId|id)\b/);
        expect(route).toContain('eq(conversations.phoneNumber, SANDBOX_PHONE_WA)');
    });
});

describe('the live feed survives Phase 5', () => {
    it('the legacy agent imports the lean shape from the spine; its own copy is gone', () => {
        const src = read('agents/comms.ts');
        expect(src).toMatch(/import \{ leanTranscriptEvent \} from '\.\.\/spine\/run-events'/);
        expect(src).not.toMatch(/^function leanTranscriptEvent/m);
    });
    it('the canned run replay is gone; the board demo stays dev-only', () => {
        const src = read('comms-events-route.ts');
        expect(src).not.toContain('dev-replay-run');
        expect(src).not.toContain('DELETE BEFORE COMMIT');
        expect(src).toContain("if (process.env.NODE_ENV !== 'production') {");
        expect(src).toContain('dev-board-demo');
    });
    it('runOnce opens and closes the feed around every pass', () => {
        const src = read('spine/index.ts');
        expect(src).toMatch(/const ev = runEmitter\(runId, conversationId\);\s+ev\.started\(\);/);
        expect(src).toMatch(/finally \{\s+ev\.finished\(ok\);/);
    });
});
