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
import { appendTurn, isTurnOf } from './case-file';
import { MemoryCaseFileStore } from './store';
import { customerTurnOf, waitsForQuiet } from './turn-window';
import type { InboundTurn } from './whatsapp-adapter';
import { clockDue } from '../channels/live-clock';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function result(file: CaseFile, turn: Turn | null): DeskResult {
    return { runId: `run_${turn?.id ?? 'clock'}`, decision: 'send', partyId: file.parties[0].personId, channel: 'whatsapp', windowState: 'open', templateId: null, bubbles: [{ text: 'ok', gapMs: 0 }], factIds: [], kbIds: [], guards: { figure: { result: 'pass', note: null } } as any, approver: 'agent.comms_v2', hold: null, delivered: true, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 1 };
}

function recordingDesk(delayMs = 0) {
    const seen: Array<{ body: string; burst: string[] | undefined; turnsOnFile: number }> = [];
    const log: string[] = [];
    const desk: DeskLike = {
        async handleTurn(file, turn) { log.push(`start ${turn.body}`); seen.push({ body: turn.body, burst: turn.burst, turnsOnFile: file.turns.length }); await sleep(delayMs); log.push(`end ${turn.body}`); return result(file, turn); },
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
                appendTurn(file, { at, channel: turn.channel, direction: 'outbound', partyId: turn.partyId, kind: 'text', body: 'ok', media: [], runId: `run_${calls.length}`, approver: 'agent.comms_v2' });
                return result(file, turn);
            },
            async clockPass(file) { return result(file, null); },
        };
    }

    it('a burst this process lost to a restart still gets exactly one reply on the next clock pass, and a second pass sends nothing more', async () => {
        const calls: Turn[] = [];
        const desk = answeringDesk(calls);
        const store = new MemoryCaseFileStore();
        const g1 = new Gateway({ desk, quietMs: 8_000, store });
        // Both messages land on the file at once (synchronous up to the quiet-window timer); g1's
        // in-memory burst is left to time out for real, exactly as it would if the process died here.
        void g1.inbound(msg('hi'));
        void g1.inbound(msg('my tap drips'));
        const file = store.all()[0];
        expect(file.turns).toHaveLength(2);
        expect(calls).toHaveLength(0);
        // The process dies here: nothing left to fire g1's real timer, exactly as a restart leaves it.
        const waiting = (g1 as unknown as { waiting: Map<string, { timer: ReturnType<typeof setTimeout> | null }> }).waiting;
        for (const b of waiting.values()) if (b.timer) clearTimeout(b.timer);
        // The restart: a fresh gateway over the same durable store, past the window, has no timer for it.
        const dueAt = Date.parse(file.turns[1].at) + 8_000;
        const g2 = new Gateway({ desk, quietMs: 8_000, store, now: () => new Date(dueAt + 1) });
        const first = await g2.clock(file.id);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ body: 'hi\nmy tap drips', burst: [file.turns[0].id, file.turns[1].id] });
        expect(first?.decision).toBe('send');
        const second = await g2.clock(file.id);
        expect(calls).toHaveLength(1);
        expect(second?.runId).toBe('run_clock');
    });

    it('a party who lost a burst on two channels to the same restart gets each answered once; the newer channel\'s reply does not bury the older one', async () => {
        const calls: Turn[] = [];
        const desk = answeringDesk(calls);
        const store = new MemoryCaseFileStore();
        const g1 = new Gateway({ desk, quietMs: 8_000, store });
        void g1.inbound(msg('hi on whatsapp'));
        const file = store.all()[0];
        const partyId = file.parties[0].personId;
        // A second, independent burst for the same party on SMS, also never flushed before the restart:
        // `joinBurst` keys a burst per party and channel, so the two time out (and get lost) on their own.
        const smsAt = new Date(Date.parse(file.turns[0].at) + 2_000).toISOString();
        const smsLanded = appendTurn(file, { at: smsAt, channel: 'sms', kind: 'text', body: 'and a text too', media: [], partyId, direction: 'inbound', runId: null, approver: null });
        if (!smsLanded.ok) throw new Error(smsLanded.reason);
        store.put(file);
        expect(file.turns.map((t) => t.channel)).toEqual(['whatsapp', 'sms']);
        expect(calls).toHaveLength(0);
        const waiting = (g1 as unknown as { waiting: Map<string, { timer: ReturnType<typeof setTimeout> | null }> }).waiting;
        for (const b of waiting.values()) if (b.timer) clearTimeout(b.timer);
        const dueAt = Date.parse(smsAt) + 8_000;
        const g2 = new Gateway({ desk, quietMs: 8_000, store, now: () => new Date(dueAt + 1) });
        const result1 = await g2.clock(file.id);
        expect(result1?.decision).toBe('send');
        expect(calls).toHaveLength(2);
        expect(calls.map((t) => t.channel).sort()).toEqual(['sms', 'whatsapp']);
        expect(calls.find((t) => t.channel === 'whatsapp')).toMatchObject({ body: 'hi on whatsapp' });
        expect(calls.find((t) => t.channel === 'sms')).toMatchObject({ body: 'and a text too' });
        const result2 = await g2.clock(file.id);
        expect(calls).toHaveLength(2);
        expect(result2?.runId).toBe('run_clock');
    });

    it('an email dispatched at once before the clock pass runs does not hide a WhatsApp burst the same restart stranded', async () => {
        const calls: Turn[] = [];
        const desk = answeringDesk(calls);
        const store = new MemoryCaseFileStore();
        const g1 = new Gateway({ desk, quietMs: 8_000, store });
        void g1.inbound(msg('hi on whatsapp'));
        const file = store.all()[0];
        const partyId = file.parties[0].personId;
        const waTurn = file.turns[0];
        expect(calls).toHaveLength(0);
        // The process dies here: nothing left to fire g1's real timer, exactly as a restart leaves it.
        const waiting = (g1 as unknown as { waiting: Map<string, { timer: ReturnType<typeof setTimeout> | null }> }).waiting;
        for (const b of waiting.values()) if (b.timer) clearTimeout(b.timer);
        const dueAt = Date.parse(waTurn.at) + 8_000;
        const g2 = new Gateway({ desk, quietMs: 8_000, store, now: () => new Date(dueAt + 1) });
        // Before any clock pass reaches the file, the same party emails in: email never waits for
        // quiet, so the gateway lands it and dispatches it to the desk at once (mirroring `inbound`).
        const landedEmail = appendTurn(file, { at: new Date(Date.parse(waTurn.at) + 1_000).toISOString(), channel: 'email', kind: 'text', body: 'and by email', media: [], partyId, direction: 'inbound', runId: null, approver: null });
        if (!landedEmail.ok) throw new Error(landedEmail.reason);
        store.put(file);
        const handTurn = (g2 as unknown as { handTurn(f: CaseFile, t: Turn): Promise<unknown> }).handTurn.bind(g2);
        await handTurn(file, landedEmail.value);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ channel: 'email', body: 'and by email' });
        expect(file.turns.map((t) => `${t.channel}:${t.direction}`)).toEqual(['whatsapp:inbound', 'email:inbound', 'email:outbound']);
        // The email's own reply is now the party's newest turn; the WhatsApp message must still be found due.
        expect(clockDue(file)).toBe(true);
        const recovered = await g2.clock(file.id);
        expect(recovered?.decision).toBe('send');
        expect(calls).toHaveLength(2);
        expect(calls[1]).toMatchObject({ channel: 'whatsapp', body: 'hi on whatsapp' });
        const again = await g2.clock(file.id);
        expect(calls).toHaveLength(2);
        expect(again?.runId).toBe('run_clock');
        expect(clockDue(file)).toBe(false);
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
