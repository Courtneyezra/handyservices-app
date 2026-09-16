/**
 * The desk's own model provider: a turn that cannot get an answer from it raises the alarm, whatever
 * the provider said, with the provider's words in the page; the health read goes unhealthy and
 * recovers on the next good turn; one outage pages once, then hourly, then says it is back.
 */
import { APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { Desk } from './desk';
import { noFixedLineSource } from './fixed-lines';
import { Gateway } from './gateway';
import { AnthropicModelClient, FakeModelClient, type ModelClient } from './models';
import {
    MODEL_ALERT_EVERY_MS, TurnModelWatch, assessModelHealth, deskModelHealth, nextModelHealth, recordTurnModelHealth,
    type ModelHealthRecord, type ModelHealthStore, type TurnReport,
} from './model-health';
import { emptyKb } from './scoping-tools';
import { noTemplateApproved } from './sender';
import type { InboundTurn } from './whatsapp-adapter';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';
import { withDeskHealth, type HeartbeatHealth } from '../../comms-worker-heartbeat';

const CREDIT = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';

/** What the SDK throws, built the way the SDK builds it, so the text is the one production logs. */
const failures: Record<string, () => Error> = {
    billing: () => APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: CREDIT }, request_id: 'req_1' }, undefined, new Headers()),
    'revoked key': () => APIError.generate(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, undefined, new Headers()),
    'provider outage': () => APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, undefined, new Headers()),
    'server error': () => APIError.generate(500, { type: 'error', error: { type: 'api_error', message: 'Internal server error' } }, undefined, new Headers()),
    'spend cap': () => APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified workspace API usage limits.' } }, undefined, new Headers()),
    timeout: () => new APIConnectionTimeoutError(),
};

/** The project's real client, its SDK swapped for one whose every request throws. */
function throwingClient(make: () => Error): ModelClient {
    const client = new AnthropicModelClient();
    (client as any).client = { messages: { parse: async () => { throw make(); } } };
    return client;
}

/** A row whose reads and writes each take a tick, so updates that are not kept apart interleave. */
function memoryStore(): ModelHealthStore & { row: ModelHealthRecord | null; writes: number } {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
    const s = {
        row: null as ModelHealthRecord | null,
        writes: 0,
        read: async () => s.row,
        update: async (next: (prev: ModelHealthRecord | null) => ModelHealthRecord | null) => {
            await tick();
            const record = next(s.row);
            await tick();
            if (record) { s.row = record; s.writes++; }
        },
    };
    return s;
}

function turn(text: string, at: string): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media: [], at, providerMessageId: null, via: 'door', mediaFailures: [] };
}

const routeScoping = { subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry' };
const working = new FakeModelClient({
    router: () => routeScoping,
    specialist: () => ({ facts: [{ key: 'job_type', value: 'leaking kitchen tap' }], jobUnknowns: [], answeredSubjects: [] }),
    composer: () => ({ reply: 'Hi Sam, a leaking kitchen tap, no problem.\n\nWhereabouts are you?', factIds: [], kbIds: [] }),
});

/** A desk whose client can be swapped between turns, reporting into a memory row and a page log. */
function rig() {
    const clock = { t: Date.parse('2026-09-16T05:41:00.000Z') };
    const now = () => new Date(clock.t += 1000);
    const store = memoryStore();
    const pages: Array<{ title: string; message: string }> = [];
    let current: ModelClient = working;
    const client: ModelClient = { structured: (call) => current.structured(call) };
    const quotes = new MemoryQuoteStore();
    const desk = new Desk({
        client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, now,
        scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) },
        quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier },
        modelHealth: (report) => recordTurnModelHealth(report, { store, pageable: true, notify: async (title, message) => { pages.push({ title, message }); } }),
    });
    const gateway = new Gateway({ desk, now });
    let n = 0;
    const send = async (text: string) => {
        const out = await gateway.inbound(turn(text, new Date(clock.t).toISOString()));
        if (out.kind !== 'handled') throw new Error(out.kind);
        n++;
        return out.result;
    };
    return { clock, store, pages, send, use: (c: ModelClient) => { current = c; }, turns: () => n };
}

describe('the desk model alarm', () => {
    for (const [cause, make] of Object.entries(failures)) {
        it(`pages on a ${cause}, carrying the provider's own words, and the health read says the desk cannot answer`, async () => {
            const r = rig();
            r.use(throwingClient(make));
            const result = await r.send('My toilet won\'t flush');
            expect(result.decision).toBe('hold');
            const words = make().message;
            expect(r.pages).toHaveLength(1);
            expect(r.pages[0].title).toBe('comms desk cannot answer: model call failed');
            expect(r.pages[0].message).toContain(words);
            expect(r.pages[0].message).toContain('router call (claude-haiku-4-5)');
            const health = assessModelHealth(r.store.row);
            expect(health).toMatchObject({ status: 'failing', canAnswer: false, reason: words, failedTurns: 1, failedCall: { role: 'router', model: 'claude-haiku-4-5' } });
        });
    }

    it('keeps the verbatim billing body the SDK reports', async () => {
        const r = rig();
        r.use(throwingClient(failures.billing));
        await r.send('Hello');
        expect(r.pages[0].message).toContain(`400 {"type":"error","error":{"type":"invalid_request_error","message":"${CREDIT}"}`);
    });

    it('pages once for an ongoing outage, again after an hour, then once when a turn succeeds; the health read recovers', async () => {
        const r = rig();
        r.use(throwingClient(failures['revoked key']));
        await r.send('one');
        await r.send('two');
        await r.send('three');
        expect(r.pages).toHaveLength(1);
        expect(r.store.row).toMatchObject({ state: 'failing', failedTurns: 3, alerted: true });
        r.clock.t += MODEL_ALERT_EVERY_MS;
        await r.send('four');
        expect(r.pages).toHaveLength(2);
        expect(r.pages[1].message).toContain('4 customer turns in a row have failed');

        r.use(working);
        const ok = await r.send('five');
        expect(ok.decision).toBe('send');
        expect(r.pages).toHaveLength(3);
        expect(r.pages[2].title).toBe('comms desk is answering again');
        expect(r.pages[2].message).toContain('invalid x-api-key');
        expect(assessModelHealth(r.store.row)).toMatchObject({ status: 'ok', canAnswer: true, reason: null, failedTurns: 0 });

        await r.send('six');
        expect(r.pages).toHaveLength(3);
    });

    it('a composer that cannot reach the provider fails the turn too', async () => {
        const r = rig();
        r.use(new FakeModelClient({
            router: () => routeScoping,
            specialist: () => ({ facts: [], jobUnknowns: [], answeredSubjects: [] }),
            composer: () => ({ error: '503 upstream connect error' }),
        }));
        const result = await r.send('a wobbly bannister');
        expect(result.decision).toBe('hold');
        expect(r.pages[0].message).toContain('composer call (claude-fable-5-1)');
        expect(r.pages[0].message).toContain('503 upstream connect error');
    });

    it('a model that declines, or a specialist whose answer is unusable, is not an outage', async () => {
        const watch = new TurnModelWatch(new FakeModelClient({ router: () => ({ refused: true }), specialist: () => ({ not: 'the schema' }) }));
        const schema = z.object({ ok: z.boolean() });
        await watch.structured({ role: 'router', model: 'm', effort: 'low', system: '', user: '', schema });
        await watch.structured({ role: 'specialist', model: 'm', effort: 'low', system: '', user: '', schema });
        expect(watch.outcome()).toEqual({ verdict: 'ok', failure: null });
    });

    it('does not page outside production, but still records the verdict', async () => {
        const store = memoryStore();
        const pages: string[] = [];
        const report: TurnReport = { outcome: { verdict: 'failed', failure: { role: 'router', model: 'm', error: 'boom', kind: 'provider' } }, at: new Date(), runId: 'run_1', caseId: 'case_1', decision: 'hold' };
        expect(await recordTurnModelHealth(report, { store, pageable: false, notify: async (t) => { pages.push(t); } })).toBeNull();
        expect(pages).toEqual([]);
        expect(store.row?.state).toBe('failing');
    });

    it('a turn with no model call leaves the verdict where it was', () => {
        const prev = nextModelHealth(null, { outcome: { verdict: 'failed', failure: { role: 'router', model: 'm', error: 'x', kind: 'provider' } }, at: new Date(), runId: 'r', caseId: 'c', decision: 'hold' }, true).record;
        expect(nextModelHealth(prev, { outcome: { verdict: 'no_model_call', failure: null }, at: new Date(), runId: 'r', caseId: 'c', decision: 'hold' }, true)).toEqual({ record: prev, alert: null });
    });
});

describe('concurrent turns', () => {
    const failed = (at: string, caseId: string): TurnReport => ({ outcome: { verdict: 'failed', failure: { role: 'router', model: 'm', error: `boom ${caseId}`, kind: 'provider' } }, at: new Date(at), runId: `run_${caseId}`, caseId, decision: 'hold' });
    const ok = (at: string, caseId: string): TurnReport => ({ outcome: { verdict: 'ok', failure: null }, at: new Date(at), runId: `run_${caseId}`, caseId, decision: 'send' });
    const deps = (store: ModelHealthStore, pages: string[]) => ({ store, pageable: true, notify: async (title: string) => { pages.push(title); } });

    it('an outage failing many customers at once pages once and counts every failed turn', async () => {
        const store = memoryStore();
        const pages: string[] = [];
        await Promise.all([1, 2, 3, 4, 5].map((i) => recordTurnModelHealth(failed(`2026-09-16T05:41:1${i}.000Z`, `c${i}`), deps(store, pages))));
        expect(pages).toEqual(['comms desk cannot answer: model call failed']);
        expect(store.row).toMatchObject({ state: 'failing', failedTurns: 5, alerted: true, failingSince: '2026-09-16T05:41:11.000Z' });
    });

    it('an older failed turn recorded after a newer good one does not overwrite it', async () => {
        const store = memoryStore();
        const pages: string[] = [];
        await recordTurnModelHealth(ok('2026-09-16T05:41:20.000Z', 'new'), deps(store, pages));
        expect(await recordTurnModelHealth(failed('2026-09-16T05:41:10.000Z', 'old'), deps(store, pages))).toBeNull();
        expect(pages).toEqual([]);
        expect(store.row).toMatchObject({ state: 'ok', lastTurnAt: '2026-09-16T05:41:20.000Z' });
        expect(store.writes).toBe(1);
        expect(assessModelHealth(store.row)).toMatchObject({ status: 'ok', canAnswer: true });
    });

    it('a failed turn and a newer good one racing end ok, and the page that went is followed by its "back"', async () => {
        const store = memoryStore();
        const pages: string[] = [];
        await Promise.all([
            recordTurnModelHealth(failed('2026-09-16T05:41:10.000Z', 'a'), deps(store, pages)),
            recordTurnModelHealth(ok('2026-09-16T05:41:20.000Z', 'b'), deps(store, pages)),
        ]);
        expect(pages).toEqual(['comms desk cannot answer: model call failed', 'comms desk is answering again']);
        expect(store.row).toMatchObject({ state: 'ok', alerted: false });
    });

    it('a row that cannot be updated still pages the failure and never throws', async () => {
        const pages: string[] = [];
        const broken: ModelHealthStore = { read: async () => null, update: async () => { throw new Error('db down'); } };
        await expect(recordTurnModelHealth(failed('2026-09-16T05:41:10.000Z', 'a'), deps(broken, pages))).resolves.toMatchObject({ kind: 'failing' });
        expect(pages).toEqual(['comms desk cannot answer: model call failed']);
    });
});

describe('the health read', () => {
    const hb = (stale: boolean): HeartbeatHealth => ({ ok: !stale, ageSeconds: 5, stale, at: 'x', pid: 1, host: 'h', version: null, status: stale ? 'stale' : 'ok', thisProcess: { role: 'worker', pid: 1, host: 'h', version: null }, staleAfterSeconds: 600 });

    it('a fresh heartbeat is not ok while the desk cannot answer, and is ok again once it can', async () => {
        const r = rig();
        r.use(throwingClient(failures['provider outage']));
        await r.send('hello');
        const failing = withDeskHealth(hb(false), await deskModelHealth(r.store.read));
        expect(failing).toMatchObject({ status: 'cannot_answer', ok: false, stale: false, desk: { status: 'failing', reason: expect.stringContaining('Overloaded') } });
        r.use(working);
        await r.send('hello again');
        expect(withDeskHealth(hb(false), await deskModelHealth(r.store.read))).toMatchObject({ status: 'ok', ok: true, desk: { status: 'ok', canAnswer: true } });
    });

    it('a stale heartbeat still reads stale; no turn yet reads idle; an unreadable row reads unknown, not failing', async () => {
        expect(withDeskHealth(hb(true), assessModelHealth(null))).toMatchObject({ status: 'stale', ok: false });
        expect(withDeskHealth(hb(false), assessModelHealth(null))).toMatchObject({ status: 'ok', desk: { status: 'idle', canAnswer: null } });
        const unknown = await deskModelHealth(async () => { throw new Error('db down'); });
        expect(unknown).toMatchObject({ status: 'unknown', error: expect.stringContaining('db down') });
        expect(withDeskHealth(hb(false), unknown).status).toBe('ok');
    });
});
