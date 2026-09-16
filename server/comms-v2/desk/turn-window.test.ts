/**
 * The quiet window (turn-window.ts): a quick run of messages from one party goes to the desk as one
 * turn, every message still lands on the file as it arrives, a message after the window is a new
 * turn, a turn that does not wait goes after what that party had waiting, and the desk runs on one
 * file one pass at a time.
 */
import { describe, expect, it } from 'vitest';
import { Gateway } from './gateway';
import type { DeskLike, DeskResult } from './desk-types';
import type { CaseFile, Turn } from './case-file';
import { appendTurn, isTurnOf, messagesOf } from './case-file';
import { MemoryCaseFileStore } from './store';
import { customerTurnOf, waitsForQuiet } from './turn-window';
import type { InboundTurn } from './whatsapp-adapter';
import { clockDue } from '../channels/live-clock';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function result(file: CaseFile, turn: Turn | null): DeskResult {
    return { runId: `run_${turn?.id ?? 'clock'}`, decision: 'send', partyId: file.parties[0].personId, channel: 'whatsapp', windowState: 'open', templateId: null, bubbles: [{ text: 'ok', gapMs: 0 }], factIds: [], kbIds: [], guards: { figure: { result: 'pass', note: null } } as any, approver: 'agent.comms_v2', hold: null, delivered: true, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 1 };
}

// A reply is never dated before the turn it answers (sender.ts `land`), and records the messages it
// answered, as a real desk's does: recovery reads that record to skip what a reply already answered.
function recordingDesk(delayMs = 0) {
    const seen: Array<{ body: string; burst: string[] | undefined; turnsOnFile: number }> = [];
    const log: string[] = [];
    const desk: DeskLike = {
        async handleTurn(file, turn) {
            log.push(`start ${turn.body}`); seen.push({ body: turn.body, burst: turn.burst, turnsOnFile: file.turns.length }); await sleep(delayMs); log.push(`end ${turn.body}`);
            const last = file.turns[file.turns.length - 1];
            const at = new Date(Math.max(Date.parse(turn.at), last ? Date.parse(last.at) + 1 : 0)).toISOString();
            appendTurn(file, { at, channel: turn.channel, direction: 'outbound', partyId: turn.partyId, kind: 'text', body: 'ok', media: [], runId: `run_${turn.id}`, approver: 'agent.comms_v2', answers: messagesOf(turn) });
            return result(file, turn);
        },
        async clockPass(file) { log.push('clock'); return result(file, null); },
    };
    return { desk, seen, log };
}

let minute = 0;
function msg(text: string, media: InboundTurn['media'] = []): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media, at: new Date(Date.parse('2026-09-15T10:00:00.000Z') + (minute++) * 1000).toISOString(), providerMessageId: null, via: 'door', mediaFailures: [] };
}

describe('customerTurnOf', () => {
    it('reads a burst as the newest message carrying every message\'s words and photos; a burst of one is that turn', () => {
        const base = { channel: 'whatsapp' as const, direction: 'inbound' as const, partyId: 'p1', runId: null, approver: null };
        const photo = { id: 'm1', kind: 'image' as const, mime: 'image/jpeg', path: '/tmp/x', url: null, description: null };
        const a: Turn = { ...base, id: 't1', at: '2026-09-15T10:00:00.000Z', kind: 'text', body: 'hi', media: [] };
        const b: Turn = { ...base, id: 't2', at: '2026-09-15T10:00:02.000Z', kind: 'media', body: '', media: [photo] };
        const c: Turn = { ...base, id: 't3', at: '2026-09-15T10:00:04.000Z', kind: 'text', body: ' it is the tap ', media: [] };
        expect(customerTurnOf([a])).toBe(a);
        const one = customerTurnOf([a, b, c]);
        expect(one).toMatchObject({ id: 't3', at: c.at, kind: 'media', body: 'hi\nit is the tap', burst: ['t1', 't2', 't3'] });
        expect(one.media[0]).toBe(photo);
        expect([a, b, c].every((t) => isTurnOf(t, one))).toBe(true);
        expect(isTurnOf(a, c)).toBe(false);
    });
    it('waits only for customer texts and photos on WhatsApp and SMS', () => {
        const t = (over: Partial<Turn>): Turn => ({ id: 't', at: '', channel: 'whatsapp', direction: 'inbound', partyId: 'p', kind: 'text', body: '', media: [], runId: null, approver: null, ...over });
        expect(waitsForQuiet(t({}))).toBe(true);
        expect(waitsForQuiet(t({ channel: 'sms', kind: 'media' }))).toBe(true);
        expect(waitsForQuiet(t({ channel: 'email' }))).toBe(false);
        expect(waitsForQuiet(t({ kind: 'call_transcript' }))).toBe(false);
        expect(waitsForQuiet(t({ kind: 'portal_action' }))).toBe(false);
        expect(waitsForQuiet(t({ direction: 'outbound' }))).toBe(false);
    });
});

describe('the gateway\'s quiet window', () => {
    it('three messages inside the window reach the desk once, as one turn; each landed on the file at once', async () => {
        const { desk, seen } = recordingDesk();
        const g = new Gateway({ desk, quietMs: 60 });
        const first = g.inbound(msg('hi'));
        await sleep(20);
        const landedSoFar = g.store.all()[0].turns.length;
        const second = g.inbound(msg('my tap drips'));
        await sleep(20);
        const third = g.inbound(msg('kitchen one'));
        const out = await Promise.all([first, second, third]);
        expect(landedSoFar).toBe(1);
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ body: 'hi\nmy tap drips\nkitchen one', turnsOnFile: 3 });
        const handled = out.map((o) => { if (o.kind !== 'handled') throw new Error(o.kind); return o; });
        const ids = handled.map((h) => h.turn.id);
        expect(seen[0].burst).toEqual(ids);
        expect(handled.every((h) => JSON.stringify(h.burst) === JSON.stringify(ids))).toBe(true);
        expect(handled.map((h) => h.result.decision)).toEqual(['none', 'none', 'send']);
        expect(new Set(handled.map((h) => h.result.runId)).size).toBe(1);
        expect(handled[0].result).toMatchObject({ delivered: false, bubbles: [], approver: null, composerCalls: 0 });
        expect(handled[0].result.note).toMatch(/one customer turn: 3 messages .* answered them once/);
    });

    it('a message after the party has gone quiet is its own turn; the window restarts on each message', async () => {
        const { desk, seen } = recordingDesk();
        const g = new Gateway({ desk, quietMs: 50 });
        await g.inbound(msg('hi'));
        await g.inbound(msg('still there?'));
        expect(seen.map((s) => s.body)).toEqual(['hi', 'still there?']);
        expect(seen.every((s) => s.burst === undefined)).toBe(true);
    });

    it('a turn that does not wait goes to the desk after the messages its party still had waiting', async () => {
        const { desk, log } = recordingDesk();
        const g = new Gateway({ desk, quietMs: 5_000 });
        const waiting = g.inbound(msg('hi'));
        await sleep(10);
        const file = g.store.all()[0];
        // A clock pass is not a customer turn: it runs, and the burst still waits for quiet.
        expect(await g.clock(file.id)).not.toBeNull();
        expect(log).toEqual(['clock']);
        const started = Date.now();
        const email: Turn = { ...file.turns[0], id: 'email_1', channel: 'email', body: 'and by email' };
        const handTurn = (g as unknown as { handTurn(f: CaseFile, t: Turn): Promise<unknown> }).handTurn.bind(g);
        const [hi] = await Promise.all([waiting, handTurn(file, email)]);
        expect(Date.now() - started).toBeLessThan(2_000);
        expect(log).toEqual(['clock', 'start hi', 'end hi', 'start and by email', 'end and by email']);
        expect(hi.kind === 'handled' && hi.result.decision).toBe('send');
    });

    it('passes on one file run one at a time, in the order they were handed over', async () => {
        const { desk, log } = recordingDesk(30);
        const g = new Gateway({ desk });
        const a = await g.inbound(msg('hi'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        log.length = 0;
        await Promise.all([g.inbound(msg('one')), g.inbound(msg('two')), g.clock(a.file.id)]);
        expect(log).toEqual(['start one', 'end one', 'start two', 'end two', 'clock']);
    });

    // A reply is never dated before the turn it answers (sender.ts `land`): the fake desk below
    // mirrors that so recovering more than one stale group in the same pass never trips the case
    // file's out-of-order refusal, exactly as the real sender would not.
    function answeringDesk(calls: Turn[]): DeskLike {
        return {
            async handleTurn(file, turn) {
                calls.push(turn);
                const last = file.turns[file.turns.length - 1];
                const at = new Date(Math.max(Date.parse(turn.at), last ? Date.parse(last.at) + 1 : 0)).toISOString();
                appendTurn(file, { at, channel: turn.channel, direction: 'outbound', partyId: turn.partyId, kind: 'text', body: 'ok', media: [], runId: `run_${calls.length}`, approver: 'agent.comms_v2', answers: messagesOf(turn) });
                return result(file, turn);
            },
            async clockPass(file) { return result(file, null); },
        };
    }

    // The process dies: nothing is left to fire the gateway's real timers, exactly as a restart leaves them.
    function die(g: Gateway): void {
        const waiting = (g as unknown as { waiting: Map<string, { timer: ReturnType<typeof setTimeout> | null }> }).waiting;
        for (const b of waiting.values()) if (b.timer) clearTimeout(b.timer);
    }
    const latestDue = (file: CaseFile) => Math.max(...(file.waits ?? []).map((w) => Date.parse(w.dueAt)));

    it('the burst\'s wait is on the file from its first message until its reply has landed, and a clock pass meanwhile recovers nothing', async () => {
        const { desk, seen, log } = recordingDesk(80);
        const lines: string[] = [];
        const g = new Gateway({ desk, quietMs: 30, log: (l) => lines.push(l) });
        const text = g.inbound(msg('I can send a picture of the tap. NG3 3EG'));
        const file = g.store.all()[0];
        expect(file.waits).toMatchObject([{ turnIds: [file.turns[0].id], handedAt: null }]);
        await sleep(50);
        // Flushed and being answered: the wait is still on the file, handed, and a tick leaves it be.
        expect(file.waits).toHaveLength(1);
        expect(file.waits![0].handedAt).not.toBeNull();
        expect(clockDue(file)).toBe(true);
        const tick = g.clock(file.id);
        await sleep(10);
        const media = g.inbound(msg('', [{ id: 'video_1', kind: 'video', mime: 'video/mp4', path: null, url: null }]));
        await Promise.all([text, tick, media]);
        expect(lines.some((l) => /lost to a restart/.test(l))).toBe(false);
        expect(seen.map((x) => x.body)).toEqual(['I can send a picture of the tap. NG3 3EG', '']);
        expect(log.filter((l) => l.startsWith('start'))).toHaveLength(2);
        expect(log).toContain('clock');
        expect(file.turns.map((t) => t.direction)).toEqual(['inbound', 'inbound', 'outbound', 'outbound']);
        expect(file.waits).toBeUndefined();
        expect(clockDue(file)).toBe(false);
    });

    it('a burst this process lost to a restart still gets exactly one reply on the clock pass once due, and a second pass sends nothing more', async () => {
        const calls: Turn[] = [];
        const desk = answeringDesk(calls);
        const store = new MemoryCaseFileStore();
        const g1 = new Gateway({ desk, quietMs: 8_000, store });
        // Both messages land on the file at once (synchronous up to the quiet-window timer), with their wait.
        void g1.inbound(msg('hi'));
        void g1.inbound(msg('my tap drips'));
        const file = store.all()[0];
        expect(file.turns).toHaveLength(2);
        expect(file.waits).toMatchObject([{ turnIds: [file.turns[0].id, file.turns[1].id], handedAt: null }]);
        die(g1);
        // The restart: a fresh gateway over the same durable store. Before the wait falls due the party may still be typing.
        const early = new Gateway({ desk, quietMs: 8_000, store, now: () => new Date(latestDue(file) - 1) });
        expect((await early.clock(file.id))?.runId).toBe('run_clock');
        expect(calls).toHaveLength(0);
        const g2 = new Gateway({ desk, quietMs: 8_000, store, now: () => new Date(latestDue(file) + 1) });
        const first = await g2.clock(file.id);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ body: 'hi\nmy tap drips', burst: [file.turns[0].id, file.turns[1].id] });
        expect(first?.decision).toBe('send');
        expect(file.waits).toBeUndefined();
        const second = await g2.clock(file.id);
        expect(calls).toHaveLength(1);
        expect(second?.runId).toBe('run_clock');
    });

    it('a restart mid-pass leaves the handed wait for the next process, which answers it once; one whose reply had already landed is dropped', async () => {
        const calls: Turn[] = [];
        const store = new MemoryCaseFileStore();
        // A desk that never finishes: the process dies while the desk is still writing the reply.
        const hung: DeskLike = { handleTurn: () => new Promise<DeskResult>(() => undefined), async clockPass(file) { return result(file, null); } };
        const g1 = new Gateway({ desk: hung, quietMs: 10, store });
        void g1.inbound(msg('hi'));
        await sleep(30);
        const file = store.all()[0];
        expect(file.waits![0].handedAt).not.toBeNull();
        const g2 = new Gateway({ desk: answeringDesk(calls), quietMs: 10, store });
        expect((await g2.clock(file.id))?.decision).toBe('send');
        expect(calls.map((t) => t.body)).toEqual(['hi']);
        // The reply landed but the put that took its wait off did not: nothing goes again.
        file.waits = [{ partyId: file.parties[0].personId, channel: 'whatsapp', turnIds: [file.turns[0].id], dueAt: file.turns[0].at, holder: 'gateway_before', handedAt: file.turns[0].at }];
        const g3 = new Gateway({ desk: answeringDesk(calls), quietMs: 10, store });
        expect((await g3.clock(file.id))?.runId).toBe('run_clock');
        expect(calls).toHaveLength(1);
        expect(file.waits).toBeUndefined();
    });

    it('a party who lost a burst on two channels to the same restart gets each answered once; the newer channel\'s reply does not bury the older one', async () => {
        const calls: Turn[] = [];
        const desk = answeringDesk(calls);
        const store = new MemoryCaseFileStore();
        const g1 = new Gateway({ desk, quietMs: 8_000, store });
        void g1.inbound(msg('hi on whatsapp'));
        const file = store.all()[0];
        const partyId = file.parties[0].personId;
        // A second, independent burst for the same party on SMS: a burst is keyed per party and channel.
        const smsAt = new Date(Date.parse(file.turns[0].at) + 2_000).toISOString();
        const smsLanded = appendTurn(file, { at: smsAt, channel: 'sms', kind: 'text', body: 'and a text too', media: [], partyId, direction: 'inbound', runId: null, approver: null });
        if (!smsLanded.ok) throw new Error(smsLanded.reason);
        void (g1 as unknown as { handTurn(f: CaseFile, t: Turn): Promise<unknown> }).handTurn(file, smsLanded.value);
        expect(file.waits!.map((w) => w.channel)).toEqual(['whatsapp', 'sms']);
        expect(calls).toHaveLength(0);
        die(g1);
        const g2 = new Gateway({ desk, quietMs: 8_000, store, now: () => new Date(latestDue(file) + 1) });
        const result1 = await g2.clock(file.id);
        expect(result1?.decision).toBe('send');
        expect(calls).toHaveLength(2);
        expect(calls.map((t) => t.channel)).toEqual(['whatsapp', 'sms']);
        expect(calls.find((t) => t.channel === 'whatsapp')).toMatchObject({ body: 'hi on whatsapp' });
        expect(calls.find((t) => t.channel === 'sms')).toMatchObject({ body: 'and a text too' });
        const result2 = await g2.clock(file.id);
        expect(calls).toHaveLength(2);
        expect(result2?.runId).toBe('run_clock');
    });

    it('an email after a restart goes to the desk after the WhatsApp burst the restart stranded, and each is answered once', async () => {
        const calls: Turn[] = [];
        const desk = answeringDesk(calls);
        const store = new MemoryCaseFileStore();
        const g1 = new Gateway({ desk, quietMs: 8_000, store });
        void g1.inbound(msg('hi on whatsapp'));
        const file = store.all()[0];
        const partyId = file.parties[0].personId;
        const waTurn = file.turns[0];
        die(g1);
        const g2 = new Gateway({ desk, quietMs: 8_000, store });
        // Before any clock pass reaches the file the same party emails in; email never waits for quiet.
        const landedEmail = appendTurn(file, { at: new Date(Date.parse(waTurn.at) + 1_000).toISOString(), channel: 'email', kind: 'text', body: 'and by email', media: [], partyId, direction: 'inbound', runId: null, approver: null });
        if (!landedEmail.ok) throw new Error(landedEmail.reason);
        const handTurn = (g2 as unknown as { handTurn(f: CaseFile, t: Turn): Promise<unknown> }).handTurn.bind(g2);
        await handTurn(file, landedEmail.value);
        expect(calls.map((t) => `${t.channel}:${t.body}`)).toEqual(['whatsapp:hi on whatsapp', 'email:and by email']);
        expect(file.waits).toBeUndefined();
        expect(clockDue(file)).toBe(false);
        const again = await g2.clock(file.id);
        expect(calls).toHaveLength(2);
        expect(again?.runId).toBe('run_clock');
    });

    it('a restart strands a WhatsApp message; a live follow-up on the same channel before recovery still draws exactly one reply covering both, and a later clock pass sends nothing more', async () => {
        const calls: Turn[] = [];
        const desk = answeringDesk(calls);
        const store = new MemoryCaseFileStore();
        const g1 = new Gateway({ desk, quietMs: 30, store });
        void g1.inbound(msg('hi'));
        const file = store.all()[0];
        const hiId = file.turns[0].id;
        expect(file.turns).toHaveLength(1);
        expect(calls).toHaveLength(0);
        die(g1);
        // The restart: a fresh gateway over the same durable store and identity directory (both
        // survive a restart; only the gateway's in-memory burst timers do not) has no memory of the
        // stranded burst.
        const g2 = new Gateway({ desk, quietMs: 30, store, identity: g1.identity });
        const again = await g2.inbound(msg('still there?'));
        if (again.kind !== 'handled') throw new Error(again.kind);
        expect(again.file.id).toBe(file.id);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ body: 'hi\nstill there?', burst: [hiId, again.turn.id] });
        expect(again.result.decision).toBe('send');
        const later = await g2.clock(file.id);
        expect(calls).toHaveLength(1);
        expect(later?.runId).toBe('run_clock');
    });

    it('a desk that throws rejects every message of its burst, and the next pass on the file still runs', async () => {
        let fail = true;
        const desk: DeskLike = {
            async handleTurn(file, turn) { if (fail) throw new Error('desk down'); return result(file, turn); },
            async clockPass(file) { return result(file, null); },
        };
        const g = new Gateway({ desk, quietMs: 30 });
        const out = await Promise.allSettled([g.inbound(msg('hi')), g.inbound(msg('there'))]);
        expect(out.map((o) => o.status)).toEqual(['rejected', 'rejected']);
        fail = false;
        const next = await g.inbound(msg('hello?'));
        expect(next.kind === 'handled' && next.result.decision).toBe('send');
        expect(g.store.all()[0].turns).toHaveLength(3);
    });
});
