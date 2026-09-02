/**
 * P6 / A2 vitest: the go-live check's verdict arithmetic with injected loaders. No database.
 */
import { describe, it, expect } from 'vitest';
import { runGoLiveCheck, summariseChecks, REQUIRED_TABLES, REQUIRED_COLUMNS, type GoLiveDeps } from './golive-check';

const APPROVED = ['holding_line_v1', 'missed_call_ack', 'video_request', 'postcode_request', 'call_request'];

function green(over: Partial<GoLiveDeps> = {}): GoLiveDeps {
    return {
        heartbeat: async () => ({ ok: true, stale: false, ageSeconds: 30, host: 'railway' }),
        schema: async (tables, columns) => ({
            tables: Object.fromEntries(tables.map((t) => [t, true])),
            columns: Object.fromEntries(columns.map(([t, c]) => [`${t}.${c}`, true])),
        }),
        templates: async () => APPROVED.map((name) => ({ contentSid: `HX_${name}`, name, status: 'approved' })),
        evals: async () => ({ regressionRed: 0, runId: 'r1', at: '2026-09-03T00:00:00Z' }),
        legacyAutosend: async () => false,
        shadowRuns24h: async () => ({ runs: 40, errors: 0 }),
        openFlagsPastDue: async () => 0,
        spineMode: async () => 'shadow',
        now: () => new Date('2026-09-04T09:00:00Z'),
        ...over,
    };
}
const by = (r: Awaited<ReturnType<typeof runGoLiveCheck>>) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

describe('runGoLiveCheck', () => {
    it('all green → ok, evals GO when not skipped, mode is INFO', async () => {
        const r = await runGoLiveCheck({}, green());
        expect(r).toMatchObject({ ok: true, noGo: 0, warn: 0, at: '2026-09-04T09:00:00.000Z' });
        const c = by(r);
        expect(c.worker.status).toBe('GO'); expect(c.tables.status).toBe('GO'); expect(c.templates.status).toBe('GO');
        expect(c.evals.status).toBe('GO'); expect(c.legacy.status).toBe('GO'); expect(c.shadow.status).toBe('GO');
        expect(c.flags.status).toBe('GO'); expect(c.mode).toMatchObject({ status: 'INFO', detail: 'shadow' });
    });
    it('skipEvals → SKIP, still ok', async () => {
        const r = await runGoLiveCheck({ skipEvals: true }, green());
        expect(by(r).evals.status).toBe('SKIP'); expect(r.ok).toBe(true);
    });
    it('a stale or absent heartbeat is NO-GO', async () => {
        expect(by(await runGoLiveCheck({}, green({ heartbeat: async () => ({ ok: false, stale: true, ageSeconds: 900 }) }))).worker).toMatchObject({ status: 'NO-GO', detail: expect.stringMatching(/stale/) });
        expect(by(await runGoLiveCheck({}, green({ heartbeat: async () => ({ ok: false, ageSeconds: null }) }))).worker.detail).toMatch(/no heartbeat ever/);
    });
    it('a missing table or column is NO-GO and named', async () => {
        const r = await runGoLiveCheck({}, green({
            schema: async (tables, columns) => ({
                tables: Object.fromEntries(tables.map((t) => [t, t !== 'pack_tier_events'])),
                columns: Object.fromEntries(columns.map(([t, c]) => [`${t}.${c}`, c !== 'shadow_decision'])),
            }),
        }));
        expect(by(r).tables).toMatchObject({ status: 'NO-GO', detail: 'missing: pack_tier_events, agent_runs.shadow_decision' });
        expect(r.ok).toBe(false);
        expect(REQUIRED_TABLES).toContain('pack_intent_tiers'); expect(REQUIRED_COLUMNS).toContainEqual(['message_drafts', 'due_at']);
    });
    it('a required template pending or missing is NO-GO; the fallback name counts', async () => {
        const r = await runGoLiveCheck({}, green({ templates: async () => [
            { contentSid: '1', name: 'holding_line', status: 'approved' }, { contentSid: '2', name: 'missed_call_ack', status: 'pending' },
            { contentSid: '3', name: 'job_video_request', status: 'approved' }, { contentSid: '4', name: 'postcode_request', status: 'approved' },
        ] }));
        expect(by(r).templates).toMatchObject({ status: 'NO-GO', detail: 'missed_call_ack (pending), call_request missing' });
    });
    it('legacy autosend on is NO-GO; regression red is NO-GO; a missing scoreboard is NO-GO', async () => {
        expect(by(await runGoLiveCheck({}, green({ legacyAutosend: async () => true }))).legacy.status).toBe('NO-GO');
        expect(by(await runGoLiveCheck({}, green({ evals: async () => ({ regressionRed: 2, runId: null, at: null }) }))).evals).toMatchObject({ status: 'NO-GO', detail: '2 regression red' });
        expect(by(await runGoLiveCheck({}, green({ evals: async () => null }))).evals.status).toBe('NO-GO');
    });
    it('no shadow runs and past-due flags WARN but do not block; an error spike blocks', async () => {
        const r = await runGoLiveCheck({}, green({ shadowRuns24h: async () => ({ runs: 0, errors: 0 }), openFlagsPastDue: async () => 2 }));
        expect(r).toMatchObject({ ok: true, warn: 2 });
        expect(by(await runGoLiveCheck({}, green({ shadowRuns24h: async () => ({ runs: 10, errors: 5 }) }))).shadow.status).toBe('NO-GO');
        expect(by(await runGoLiveCheck({}, green({ shadowRuns24h: async () => ({ runs: 40, errors: 1 }) }))).shadow.status).toBe('WARN');
    });
    it('a loader that throws becomes a NO-GO (or WARN for the soft checks), never a crash', async () => {
        const r = await runGoLiveCheck({}, green({ heartbeat: async () => { throw new Error('db down'); }, openFlagsPastDue: async () => { throw new Error('x'); } }));
        expect(by(r).worker).toMatchObject({ status: 'NO-GO', detail: 'heartbeat: db down' });
        expect(by(r).flags.status).toBe('WARN');
        expect(r.ok).toBe(false);
    });
    it('summariseChecks counts', () => {
        const s = summariseChecks([{ id: 'mode', label: 'm', status: 'INFO', detail: '' }, { id: 'flags', label: 'f', status: 'WARN', detail: '' }], new Date('2026-09-04T00:00:00Z'));
        expect(s).toMatchObject({ ok: true, noGo: 0, warn: 1 });
    });
});
