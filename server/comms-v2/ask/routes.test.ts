/**
 * The ask agent over HTTP, mounted where the page will call it (/api/comms-v2/ask, inside the board
 * router), and the path its draft takes to a customer: only a person pressing send on the board
 * (POST /case-files/:id/send-held-draft), which refuses an ask-held draft for exactly the reasons it
 * refuses any held draft: the file's owner, the window, the opt-out ledger, and a draft the guards
 * never let be held.
 */
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseFile } from '../desk/case-file';
import { hold as setHold } from '../desk/case-file';
import { noFixedLineSource } from '../desk/fixed-lines';
import { BEN } from '../desk/guards';
import { FakeModelClient } from '../desk/models';
import { createSandboxDoor } from '../desk/sandbox-door';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import type { MemoryCaseFileStore } from '../desk/store';
import type { BoardSource } from '../api/store';
import { createCommsV2ApiRouter } from '../api/routes';
import type { CommsEvent } from '../../comms-events';
import { MemoryAskSessionStore } from './sessions';
import { MemoryAskActionStore } from './actions';
import { memorySource, scriptedLoop, whatsappFile, type ScriptStep } from './ask-fixtures';

const BEN_EMAIL = 'ben.real@handyservices.app';
const OTHER_EMAIL = 'someone.else@handyservices.app';
const assignments: Record<string, string[]> = { ben: [`user_${BEN_EMAIL}`] };
let skew = 0;

let server: import('node:http').Server;
let base: string;
let store: MemoryCaseFileStore;
let mode: BoardSource['mode'] = 'dry_run';
let script: ScriptStep[] = [];
let composed = 'Thanks Sam, could you send us a photo of the tap?';
const events: CommsEvent[] = [];
const sessions = new MemoryAskSessionStore(() => new Date('2026-09-17T09:10:00.000Z'));
const actions = new MemoryAskActionStore();
/** The board's send path reads the wall clock, so files are dated from it: a window opened ten minutes ago, or two days ago. */
const openAt = () => new Date(Date.now() - 10 * 60_000).toISOString();
const shutAt = () => new Date(Date.now() - 48 * 3_600_000).toISOString();

beforeAll(async () => {
    const mem = memorySource();
    store = mem.store;
    const client = new FakeModelClient({
        router: () => ({ intents: ['message'], domains: ['messages'], surface: 'thread', steps: ['Draft a reply'], moneyAction: false, wantsDraft: true }),
        composer: () => ({ words: composed }),
    });
    const door = createSandboxDoor({ quietMs: 0, client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const email = req.header('x-test-user');
        if (email) (req as any).user = { id: `user_${email}`, email, role: 'admin' };
        next();
    });
    app.use('/api/comms-v2', createCommsV2ApiRouter(
        door, async () => assignments, async () => ({ store, live: mode === 'live', mode }), async () => false, async () => ({}), () => false,
        {
            sessions,
            actions,
            turnDeps: { client, loop: (opts) => scriptedLoop(script)(opts) },
            emit: (evt) => events.push(evt),
            now: () => new Date('2026-09-17T09:10:00.000Z'),
            actionClock: () => new Date(Date.now() + skew),
        },
    ));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/comms-v2`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => { store.clear(); events.length = 0; mode = 'dry_run'; skew = 0; assignments.ben = [`user_${BEN_EMAIL}`]; composed = 'Thanks Sam, could you send us a photo of the tap?'; });

async function call(method: string, route: string, body?: unknown, as: string | null = BEN_EMAIL) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (as) headers['x-test-user'] = as;
    const res = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() as any };
}

async function finished(runId: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (events.some((e) => e.type === 'ops_run_finished' && e.runId === runId)) return;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`run ${runId} never finished`);
}

/** Ask the desk to draft on this file, through the routes, and wait for the answer. */
async function askForDraft(file: CaseFile, plan?: { label: string; done: boolean }[]): Promise<any> {
    script = [
        { tool: 'draft_reply', input: { caseFileId: file.id, brief: 'Ask for a photo of the tap' } },
        { tool: 'give_answer', input: { finalText: 'Drafted.', surface: 'thread', caseFileId: file.id, ...(plan ? { plan } : {}) } },
    ];
    const session = await call('POST', '/ask/sessions', {});
    const posted = await call('POST', `/ask/sessions/${session.json.id}/messages`, { text: 'Ask Sam for a photo', via: 'voice', context: { caseFileId: file.id } });
    expect(posted.status).toBe(202);
    await finished(posted.json.runId);
    return (await call('GET', `/ask/sessions/${session.json.id}`)).json;
}

describe('sessions', () => {
    it('refuses a request with no signed-in user', async () => {
        expect((await call('POST', '/ask/sessions/today', undefined, null)).status).toBe(401);
    });

    it('gives each person one session a day, and hides it from anyone else', async () => {
        const a = await call('POST', '/ask/sessions/today');
        const b = await call('POST', '/ask/sessions/today');
        expect(a.status).toBe(200);
        expect(b.json.id).toBe(a.json.id);
        expect(a.json).toMatchObject({ title: 'Handy Desk, Thu 17 Sept', createdBy: BEN_EMAIL, status: 'active' });
        const theirs = await call('POST', '/ask/sessions/today', undefined, OTHER_EMAIL);
        expect(theirs.json.id).not.toBe(a.json.id);
        expect((await call('GET', `/ask/sessions/${a.json.id}`, undefined, OTHER_EMAIL)).status).toBe(404);
        expect((await call('POST', `/ask/sessions/${a.json.id}/messages`, { text: 'hi' }, OTHER_EMAIL)).status).toBe(404);
        expect((await call('GET', '/ask/sessions')).json.map((s: any) => s.id)).toContain(a.json.id);
    });

    it('refuses an empty ask', async () => {
        const s = await call('POST', '/ask/sessions/today');
        expect((await call('POST', `/ask/sessions/${s.json.id}/messages`, { text: '  ' })).status).toBe(400);
    });

    it('takes the ask only as text', async () => {
        const s = await call('POST', '/ask/sessions/today');
        expect(await call('POST', `/ask/sessions/${s.json.id}/messages`, { content: 'what is waiting?' })).toEqual({ status: 400, json: { error: 'an ask needs text' } });
        expect((await call('GET', `/ask/sessions/${s.json.id}`)).json.messages).toEqual([]);
    });
});

describe('an ask, end to end', () => {
    it('streams the ops_* events in order and stores the answer on the assistant message', async () => {
        const file = whatsappFile({ at: openAt() });
        store.put(file);
        const detail = await askForDraft(file);

        const sessionEvents = events.filter((e) => 'sessionId' in e).map((e) => e.type);
        expect(sessionEvents[0]).toBe('ops_message');
        expect(sessionEvents[1]).toBe('ops_run_started');
        expect(sessionEvents.slice(2, -2).every((t) => t === 'ops_run_event')).toBe(true);
        expect(sessionEvents.slice(-2)).toEqual(['ops_message', 'ops_run_finished']);
        expect(events.at(-1)).toMatchObject({ type: 'ops_run_finished', ok: true });

        expect(detail.messages).toHaveLength(2);
        expect(detail.messages[0]).toMatchObject({ role: 'user', content: 'Ask Sam for a photo', via: 'voice', context: { caseFileId: file.id } });
        expect(detail.messages[1]).toMatchObject({
            role: 'assistant', content: 'Drafted.',
            answer: {
                finalText: 'Drafted.',
                surface: { type: 'thread', caseFileId: file.id },
                outgoing: [{ channel: 'wa', text: composed }],
                confirm: { label: 'Send as is', actionId: expect.any(String), kind: 'draft.release', action: { kind: 'draft.release', args: { caseFileId: file.id } } },
            },
        });
        expect(detail.messages[1].transcript.map((s: any) => s.tool ?? s.type)).toEqual(['route', 'get_case_file', 'get_case_file', 'draft_reply', 'draft_reply', 'give_answer', 'give_answer']);
    });

    it('a session that cannot be touched after the answer keeps the one answer and finishes ok', async () => {
        const file = whatsappFile({ at: openAt() });
        store.put(file);
        const touch = vi.spyOn(sessions, 'touch').mockRejectedValueOnce(new Error('connection reset'));
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const detail = await askForDraft(file);
            expect(touch).toHaveBeenCalledTimes(1);
            expect(events.at(-1)).toMatchObject({ type: 'ops_run_finished', ok: true });
            expect(detail.messages.map((m: any) => [m.role, m.content])).toEqual([['user', 'Ask Sam for a photo'], ['assistant', 'Drafted.']]);
            expect(events.filter((e) => e.type === 'ops_message')).toHaveLength(2);
            expect(quiet).toHaveBeenCalledWith(expect.stringMatching(/touch session/), expect.any(Error));
        } finally {
            touch.mockRestore();
            quiet.mockRestore();
        }
    });

    it('a failed run still finishes, with the failure on the thread', async () => {
        script = [{ tool: 'no_such_tool', input: {} }];
        const s = await call('POST', '/ask/sessions/today');
        const posted = await call('POST', `/ask/sessions/${s.json.id}/messages`, { text: 'anything' });
        await finished(posted.json.runId);
        expect(events.at(-1)).toMatchObject({ type: 'ops_run_finished', ok: false });
        const detail = (await call('GET', `/ask/sessions/${s.json.id}`)).json;
        expect(detail.messages.at(-1)).toMatchObject({ role: 'assistant', answer: { surface: { type: 'words' } } });
        expect(detail.messages.at(-1).content).toMatch(/That ask failed: no tool no_such_tool/);
    });
});

describe('the draft goes out only through the board\'s human send path', () => {
    it('is held, not sent; the board\'s one-tap send delivers it under the signed-in person', async () => {
        const file = whatsappFile({ at: openAt() });
        store.put(file);
        await askForDraft(file);
        expect(store.get(file.id)?.sends).toEqual([]);
        const card = (await call('GET', `/case-files/${file.id}`)).json;
        expect(card.hold).toMatchObject({ draft: composed, reason: expect.stringMatching(/^Asked on the Handy Desk/) });

        const sent = await call('POST', `/case-files/${file.id}/send-held-draft`);
        expect(sent.status).toBe(200);
        expect(sent.json.sent).toMatchObject({ approver: `human:${BEN_EMAIL}`, bubbles: [composed] });
        expect(store.get(file.id)?.hold).toBeNull();
        expect(store.get(file.id)?.sends).toHaveLength(1);
    });

    it('is refused to a session that holds no slot, exactly as any held draft is', async () => {
        const file = whatsappFile({ at: openAt() });
        store.put(file);
        await askForDraft(file);
        const refused = await call('POST', `/case-files/${file.id}/send-held-draft`, undefined, OTHER_EMAIL);
        expect(refused).toEqual({ status: 403, json: { error: 'no approver slot is assigned to this user' } });
        expect(store.get(file.id)?.sends).toEqual([]);
    });

    it('is refused on a shut window with the same words as the desk\'s own held draft', async () => {
        const at = shutAt();
        const mine = whatsappFile({ at });
        const desks = whatsappFile({ at });
        store.put(mine);
        store.put(desks);
        await askForDraft(mine);
        setHold(desks, { approver: BEN, reason: 'guards', exception: null, draft: composed });
        const a = await call('POST', `/case-files/${mine.id}/send-held-draft`);
        const b = await call('POST', `/case-files/${desks.id}/send-held-draft`);
        expect(a.status).toBe(409);
        expect(a.json.error).toMatch(/window is shut/);
        expect(a.json.error).toBe(b.json.error);
        expect(store.get(mine.id)?.hold?.draft).toBe(composed);
    });

    it('never exists when the guards refuse it, so there is nothing to send', async () => {
        const file = whatsappFile({ at: openAt() });
        store.put(file);
        composed = 'That will be £85 fitted.';
        const detail = await askForDraft(file);
        expect(detail.messages.at(-1).answer.confirm).toBeUndefined();
        expect(store.get(file.id)?.hold).toBeNull();
        const sent = await call('POST', `/case-files/${file.id}/send-held-draft`);
        expect(sent).toEqual({ status: 409, json: { error: 'there is no held draft to send' } });
    });

    describe('live, at the opt-out ledger', () => {
        afterEach(() => { vi.doUnmock('../../spine/config'); vi.doUnmock('../../outbound'); vi.resetModules(); });

        it('is refused with the ledger\'s own words, as the desk\'s held draft is, and nothing is recorded as sent', async () => {
            const outbox: string[] = [];
            vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
            vi.doMock('../../outbound', () => ({
                sendCustomerMessage: async (i: { body: string }) => { outbox.push(i.body); return { ok: false, attempts: [], fellBack: false, reason: 'OPTED_OUT', error: 'This customer opted out of all messages on 1 Sep 2026.' }; },
            }));
            const mine = whatsappFile({ at: openAt() });
            const desks = whatsappFile({ at: openAt() });
            store.put(mine);
            store.put(desks);
            await askForDraft(mine);
            setHold(desks, { approver: BEN, reason: 'guards', exception: null, draft: composed });
            mode = 'live';
            const a = await call('POST', `/case-files/${mine.id}/send-held-draft`);
            const b = await call('POST', `/case-files/${desks.id}/send-held-draft`);
            expect(a).toEqual({ status: 409, json: { error: 'send refused: This customer opted out of all messages on 1 Sep 2026.' } });
            expect(b).toEqual(a);
            expect(store.get(mine.id)?.sends).toEqual([]);
            expect(store.get(mine.id)?.hold?.draft).toBe(composed);
            // Each attempt reached the ledger once, and nothing got past it.
            expect(outbox).toEqual([composed, composed]);
        }, 20_000);
    });
});

describe('confirming a proposal from the answer', () => {
    async function proposed(plan?: { label: string; done: boolean }[]) {
        const file = whatsappFile({ at: openAt() });
        store.put(file);
        const detail = await askForDraft(file, plan);
        const answer = detail.messages.at(-1).answer;
        return { file, detail, answer, actionId: answer.confirm.actionId as string, sessionId: detail.session.id as string };
    }

    it('sends the held draft as the signed-in person, whatever the body says, and a second confirm sends nothing more', async () => {
        const { file, actionId } = await proposed();
        expect((await call('GET', `/ask/actions/${actionId}`)).json).toMatchObject({ id: actionId, kind: 'draft.release', status: 'proposed', previewText: composed, caseFileId: file.id });

        const first = await call('POST', `/ask/actions/${actionId}/confirm`, { person: 'intruder@example.com', approver: 'office', args: { caseFileId: 'other' } });
        expect(first.status).toBe(200);
        expect(first.json).toMatchObject({ ok: true, repeat: false, continuedRunId: null, action: { id: actionId, status: 'executed', confirmedBy: `human:${BEN_EMAIL}`, result: { approver: `human:${BEN_EMAIL}`, bubbles: [{ text: composed }] } } });
        expect(store.get(file.id)?.sends).toHaveLength(1);
        expect(store.get(file.id)?.sends[0]).toMatchObject({ approver: `human:${BEN_EMAIL}`, runId: first.json.action.runId });
        expect(store.get(file.id)?.hold).toBeNull();

        const second = await call('POST', `/ask/actions/${actionId}/confirm`);
        expect(second.status).toBe(200);
        expect(second.json).toMatchObject({ ok: true, repeat: true, action: { status: 'executed', runId: first.json.action.runId } });
        expect(store.get(file.id)?.sends).toHaveLength(1);
    });

    it('is not found for another person, forbidden to a session with no slot, and needs a signed-in user', async () => {
        const { file, actionId } = await proposed();
        expect(await call('POST', `/ask/actions/${actionId}/confirm`, undefined, OTHER_EMAIL)).toEqual({ status: 404, json: { error: 'no such proposal', action: null } });
        expect((await call('GET', `/ask/actions/${actionId}`, undefined, OTHER_EMAIL)).status).toBe(404);
        expect((await call('POST', `/ask/actions/${actionId}/cancel`, undefined, OTHER_EMAIL)).status).toBe(404);
        expect((await call('POST', `/ask/actions/${actionId}/confirm`, undefined, null)).status).toBe(401);
        assignments.ben = [];
        const noSlot = await call('POST', `/ask/actions/${actionId}/confirm`);
        expect(noSlot.status).toBe(403);
        expect(noSlot.json).toMatchObject({ error: 'no approver slot is assigned to this user', action: { status: 'proposed' } });
        expect(store.get(file.id)?.sends).toEqual([]);
    });

    it('is gone once expired', async () => {
        const { file, actionId } = await proposed();
        skew = 16 * 60_000;
        const out = await call('POST', `/ask/actions/${actionId}/confirm`);
        expect(out.status).toBe(410);
        expect(out.json).toMatchObject({ error: expect.stringMatching(/^this proposal was expired: it expired at /), action: { status: 'expired' } });
        expect(store.get(file.id)?.sends).toEqual([]);
    });

    it('is refused when the draft changed since the answer, and the new words are not sent', async () => {
        const { file, actionId } = await proposed();
        store.get(file.id)!.hold!.draft = 'Words nobody confirmed.';
        const out = await call('POST', `/ask/actions/${actionId}/confirm`);
        expect(out.status).toBe(409);
        expect(out.json).toMatchObject({ error: expect.stringMatching(/changed since you saw it/), action: { status: 'refused' } });
        expect(store.get(file.id)?.sends).toEqual([]);
    });

    it('cancels, and a confirm after is refused', async () => {
        const { file, actionId } = await proposed();
        const out = await call('POST', `/ask/actions/${actionId}/cancel`);
        expect(out).toMatchObject({ status: 200, json: { ok: true, repeat: false, action: { status: 'cancelled' } } });
        expect((await call('POST', `/ask/actions/${actionId}/confirm`)).status).toBe(409);
        expect(store.get(file.id)?.sends).toEqual([]);
        expect(store.get(file.id)?.hold?.draft).toBe(composed);
    });

    it('moves the plan strip on the answer and carries on with the next step as a tap', async () => {
        const { actionId, sessionId } = await proposed([{ label: 'Find Sam', done: true }, { label: 'Send the photo ask', done: false }, { label: 'Tell Ben it went', done: false }]);
        let detail = (await call('GET', `/ask/sessions/${sessionId}`)).json;
        expect(detail.messages.at(-1).answer.plan).toEqual([
            { label: 'Find Sam', state: 'done' },
            { label: 'Send the photo ask', state: 'current', actionId },
            { label: 'Tell Ben it went', state: 'waiting' },
        ]);

        script = [{ tool: 'give_answer', input: { finalText: 'Sent. Nothing else to do.', surface: 'words' } }];
        events.length = 0;
        const out = await call('POST', `/ask/actions/${actionId}/confirm`);
        expect(out.status).toBe(200);
        expect(out.json.continuedRunId).toMatch(/^ask_/);
        await finished(out.json.continuedRunId);

        // The answer that offered it was re-emitted with the step done.
        expect(events.find((e) => e.type === 'ops_message' && (e as any).message.role === 'assistant' && (e as any).message.answer?.plan)).toMatchObject({ message: { answer: { plan: [{ state: 'done' }, { state: 'done', actionId }, { state: 'waiting' }] } } });
        detail = (await call('GET', `/ask/sessions/${sessionId}`)).json;
        expect(detail.messages.map((m: any) => [m.role, m.via ?? null])).toEqual([['user', 'voice'], ['assistant', null], ['user', 'tap'], ['assistant', null]]);
        expect(detail.messages[1].answer.plan[1]).toEqual({ label: 'Send the photo ask', state: 'done', actionId });
        expect(detail.messages[2].content).toBe('Carry on with the plan: Tell Ben it went');
        expect(detail.messages[3].content).toBe('Sent. Nothing else to do.');

        // A repeat confirm neither moves the plan nor starts another run.
        const again = await call('POST', `/ask/actions/${actionId}/confirm`);
        expect(again.json).toMatchObject({ repeat: true, continuedRunId: null });
    });

    it('moves the plan on the newest answer that offered a reused proposal', async () => {
        const { file, actionId, sessionId } = await proposed([{ label: 'Send the photo ask', done: false }, { label: 'Tell Ben it went', done: false }]);
        script = [
            { tool: 'propose_send_held_draft', input: { caseFileId: file.id } },
            { tool: 'give_answer', input: { finalText: 'Still ready to send.', surface: 'thread', caseFileId: file.id, plan: [{ label: 'Send it now', done: false }, { label: 'Say it went', done: false }] } },
        ];
        const posted = await call('POST', `/ask/sessions/${sessionId}/messages`, { text: 'Send it', via: 'text', context: { caseFileId: file.id } });
        await finished(posted.json.runId);
        let detail = (await call('GET', `/ask/sessions/${sessionId}`)).json;
        expect(detail.messages[3].answer.confirm.actionId).toBe(actionId);

        script = [{ tool: 'give_answer', input: { finalText: 'Done.', surface: 'words' } }];
        const out = await call('POST', `/ask/actions/${actionId}/confirm`);
        expect(out.status).toBe(200);
        await finished(out.json.continuedRunId);
        detail = (await call('GET', `/ask/sessions/${sessionId}`)).json;
        expect(detail.messages[3].answer.plan[0]).toEqual({ label: 'Send it now', state: 'done', actionId });
        expect(detail.messages[4].content).toBe('Carry on with the plan: Say it went');
    });

    it('marks the step refused and drops the rest when the confirm is refused, and carries nothing on', async () => {
        const { file, actionId, sessionId } = await proposed([{ label: 'Send the photo ask', done: false }, { label: 'Tell Ben it went', done: false }]);
        store.get(file.id)!.hold!.draft = 'Words nobody confirmed.';
        const out = await call('POST', `/ask/actions/${actionId}/confirm`);
        expect(out.status).toBe(409);
        const detail = (await call('GET', `/ask/sessions/${sessionId}`)).json;
        expect(detail.messages).toHaveLength(2);
        expect(detail.messages[1].answer.plan).toEqual([
            { label: 'Send the photo ask', state: 'refused', actionId, reason: expect.stringMatching(/changed since you saw it/) },
            { label: 'Tell Ben it went', state: 'dropped' },
        ]);
    });
});
