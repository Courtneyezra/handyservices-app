/**
 * The ask agent's proposals and their one executor: a change runs only on its confirm, once, as the
 * signed-in person, while it has not expired, and only if what it would do is still exactly what Ben
 * was shown. A held draft goes out through the board's human send path; a change that sends nothing
 * leaves a system line on the case file carrying the action id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_KINDS } from '@shared/ops-types';
import { appendTurn, recordSend, hold as setHold, type ApproverSlot } from '../desk/case-file';
import { BEN } from '../desk/guards';
import { PRODUCTION_DB_HOST_MARKER } from '../../worker-gate';
import {
    MemoryAskActionStore, PREVIEW_CHANGED, PROPOSAL_TTL_MS, cancelAction, confirmAction, expiryFor, nextLondonMidnight, proposalTtlMs, previewHash, proposeAction,
    type ActionDeps, type ProposeInput,
} from './actions';
import { ACTION_KINDS, type ActionKindDef, type ActionKinds } from './action-kinds';
import { threadSurface } from './surface';
import { BEN_PERSON, memorySource, whatsappFile } from './ask-fixtures';

const DRAFT = 'Thanks Sam, could you send us a photo of the tap?';
const SESSION = 'session-ben';
const OTHER_SLOT: ApproverSlot = { kind: 'human', id: 'office' };

/** The board's send path reads the wall clock, so files are dated from it and the action clock runs from it too. */
let skew = 0;
const clock = () => new Date(Date.now() + skew);
afterEach(() => { skew = 0; });

function heldFile(draft = DRAFT) {
    const file = whatsappFile({ at: new Date(Date.now() - 10 * 60_000).toISOString() });
    setHold(file, { approver: BEN, reason: 'guards', exception: null, draft });
    return file;
}

function setup(files = [heldFile()], kinds?: ActionKinds) {
    const { store: cases, source } = memorySource(files);
    const store = new MemoryAskActionStore();
    const deps: ActionDeps = { store, source, kinds, now: clock };
    const propose = (over: Partial<ProposeInput> = {}) => proposeAction({ kind: 'draft.release', args: { caseFileId: files[0].id }, sessionId: SESSION, askRunId: 'ask_1', person: BEN_PERSON, approver: BEN, ...over }, deps);
    const settleAs = (id: string, over: { person?: string; approver?: ApproverSlot | null; owns?: boolean } = {}) => ({
        id, person: over.person ?? BEN_PERSON, approver: over.approver === undefined ? BEN : over.approver, ownsSession: async (s: string) => (over.owns ?? true) && s === SESSION,
    });
    return { cases, store, deps, propose, settleAs, file: files[0] };
}

describe('proposing', () => {
    it('saves the exact arguments, preview and hash with a 15-minute expiry, and runs nothing', async () => {
        const { propose, cases, file } = setup();
        const out = await propose();
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.action).toMatchObject({ kind: 'draft.release', caseFileId: file.id, args: { caseFileId: file.id }, previewText: DRAFT, status: 'proposed', proposedBy: BEN_PERSON, confirmedBy: null, runId: null });
        expect(out.action.previewHash).toBe(previewHash('draft.release', { caseFileId: file.id }, { text: DRAFT, outgoing: out.outgoing }));
        expect(Date.parse(out.action.expiresAt) - Date.parse(out.action.proposedAt)).toBeLessThanOrEqual(PROPOSAL_TTL_MS);
        expect(out.label).toBe('Send as is');
        expect(out.outgoing).toEqual([{ to: file.parties[0].channels[0].address, channel: 'wa', text: DRAFT, actionId: out.action.id }]);
        expect(cases.get(file.id)?.sends).toEqual([]);
        expect(cases.get(file.id)?.hold?.draft).toBe(DRAFT);
    });

    it('refuses a session with no slot, a slot the file does not answer to, a file with no draft, and a kind not on the desk', async () => {
        const bare = whatsappFile();
        const { propose } = setup([heldFile(), bare]);
        expect(await propose({ approver: null })).toEqual({ ok: false, reason: expect.stringMatching(/no approver slot/) });
        expect(await propose({ approver: OTHER_SLOT })).toEqual({ ok: false, reason: 'only ben may act on this file' });
        expect(await propose({ args: { caseFileId: bare.id } })).toEqual({ ok: false, reason: 'there is no held draft to send' });
        expect(await propose({ args: { caseFileId: 'nope' } })).toEqual({ ok: false, reason: 'no such case file' });
        expect(await propose({ args: {} })).toEqual({ ok: false, reason: 'the arguments do not fit a draft.release' });
        expect(await propose({ kind: 'booking.create' })).toEqual({ ok: false, reason: 'creating a booking is not on the Handy Desk until design-map Q8 is answered' });
        expect(await propose({ kind: 'booking.move' })).toEqual({ ok: false, reason: 'the Handy Desk cannot propose booking.move yet' });
    });

    it('keeps one open proposal per kind per file: the same one again is reused, another session is refused, a stale one is superseded', async () => {
        const { propose, store, file } = setup();
        const first = await propose();
        const again = await propose();
        expect(again).toMatchObject({ ok: true, reused: true, action: { id: first.ok ? first.action.id : '' } });
        expect(store.rows.size).toBe(1);

        await store.attachMessage('ask_1', 'msg_1');
        const later = await propose({ askRunId: 'ask_2' });
        expect(later).toMatchObject({ ok: true, reused: true, action: { id: first.ok ? first.action.id : '', askRunId: 'ask_2', messageId: null } });
        await store.attachMessage('ask_2', 'msg_2');
        expect(first.ok && store.rows.get(first.action.id)).toMatchObject({ askRunId: 'ask_2', messageId: 'msg_2' });

        const elsewhere = await propose({ sessionId: 'session-2' });
        expect(elsewhere).toEqual({ ok: false, reason: expect.stringMatching(/already waiting for a confirm or a cancel/) });

        file.hold!.draft = 'A different draft.';
        const fresh = await propose({ sessionId: 'session-2' });
        expect(fresh).toMatchObject({ ok: true, reused: false, action: { previewText: 'A different draft.' } });
        expect(first.ok && store.rows.get(first.action.id)).toMatchObject({ status: 'expired', result: { reason: expect.stringMatching(/^superseded/) } });
    });

    it('expires an open proposal past its time rather than letting it block a new one', async () => {
        const { propose, store } = setup();
        const first = await propose();
        skew = PROPOSAL_TTL_MS + 1000;
        const second = await propose({ sessionId: 'session-2' });
        expect(second).toMatchObject({ ok: true, reused: false });
        expect(first.ok && store.rows.get(first.action.id)?.status).toBe('expired');
    });

    it('expires at London midnight when that comes before the 15 minutes', () => {
        // 23:55 BST on 17 Sep is 22:55Z; London midnight is 23:00Z.
        expect(expiryFor(new Date('2026-09-17T22:55:00Z')).toISOString()).toBe('2026-09-17T23:00:00.000Z');
        expect(expiryFor(new Date('2026-09-17T12:00:00Z')).toISOString()).toBe('2026-09-17T12:15:00.000Z');
        expect(expiryFor(new Date('2026-12-01T23:50:00Z')).toISOString()).toBe('2026-12-02T00:00:00.000Z');
        // Either side of the clocks going back on 25 Oct 2026.
        expect(nextLondonMidnight(new Date('2026-10-24T12:00:00Z')).toISOString()).toBe('2026-10-24T23:00:00.000Z');
        expect(nextLondonMidnight(new Date('2026-10-25T12:00:00Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
        // And forward on 29 Mar 2026.
        expect(nextLondonMidnight(new Date('2026-03-29T12:00:00Z')).toISOString()).toBe('2026-03-29T23:00:00.000Z');
    });
});

describe('the proposal window', () => {
    const prod = `postgres://u:p@${PRODUCTION_DB_HOST_MARKER}-pooler.example.neon.tech/db`;
    it('is 15 minutes unless a non-production process shortens it', () => {
        expect(proposalTtlMs({})).toBe(15 * 60_000);
        expect(proposalTtlMs({ COMMS_V2_ASK_PROPOSAL_TTL_SECONDS: '60', NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@branch-host/db' })).toBe(60_000);
        expect(proposalTtlMs({ COMMS_V2_ASK_PROPOSAL_TTL_SECONDS: '60' })).toBe(60_000);
        // Never longer, never nonsense.
        for (const v of ['3600', '900', '0', '-5', '1.5', 'soon', ' ']) expect(proposalTtlMs({ COMMS_V2_ASK_PROPOSAL_TTL_SECONDS: v })).toBe(15 * 60_000);
        expect(expiryFor(new Date('2026-09-17T12:00:00Z'), 60_000).toISOString()).toBe('2026-09-17T12:01:00.000Z');
    });

    it('ignores the override on a production process or a production database', () => {
        expect(proposalTtlMs({ COMMS_V2_ASK_PROPOSAL_TTL_SECONDS: '60', NODE_ENV: 'production' })).toBe(15 * 60_000);
        expect(proposalTtlMs({ COMMS_V2_ASK_PROPOSAL_TTL_SECONDS: '60', NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@branch-host/db' })).toBe(15 * 60_000);
        expect(proposalTtlMs({ COMMS_V2_ASK_PROPOSAL_TTL_SECONDS: '60', NODE_ENV: 'development', DATABASE_URL: prod })).toBe(15 * 60_000);
        expect(proposalTtlMs({ COMMS_V2_ASK_PROPOSAL_TTL_SECONDS: '60', DATABASE_URL: prod })).toBe(15 * 60_000);
    });
});

describe('confirming draft.release', () => {
    it('sends the held draft through the board\'s human send path as the person, under the confirm\'s run id, once', async () => {
        const { propose, deps, settleAs, cases, file } = setup();
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        const out = await confirmAction(settleAs(p.action.id), deps);
        expect(out).toMatchObject({ ok: true, repeat: false, action: { status: 'executed', confirmedBy: `human:${BEN_PERSON}` } });
        if (!out.ok) return;
        const sent = cases.get(file.id)!;
        expect(sent.sends).toHaveLength(1);
        expect(sent.sends[0]).toMatchObject({ approver: `human:${BEN_PERSON}`, runId: out.action.runId, mode: 'dry_run' });
        expect(sent.hold).toBeNull();
        expect(out.action.result).toMatchObject({ approver: `human:${BEN_PERSON}`, runId: out.action.runId, channel: 'whatsapp', bubbles: [{ text: DRAFT }], released: true });
        // A send is its own audit: no system line.
        expect(sent.systemTurns ?? []).toEqual([]);

        const again = await confirmAction(settleAs(p.action.id), deps);
        expect(again).toMatchObject({ ok: true, repeat: true, action: { id: p.action.id, status: 'executed' } });
        expect(cases.get(file.id)!.sends).toHaveLength(1);
    });

    it('runs once when two confirms race', async () => {
        const { propose, deps, settleAs, cases, file } = setup();
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        const [a, b] = await Promise.all([confirmAction(settleAs(p.action.id), deps), confirmAction(settleAs(p.action.id), deps)]);
        expect([a, b].filter((o) => o.ok && !o.repeat)).toHaveLength(1);
        expect([a, b].filter((o) => !o.ok || o.repeat).map((o) => (o.ok ? 'repeat' : o.code))).toEqual([expect.stringMatching(/^(repeat|in_progress)$/)]);
        expect(cases.get(file.id)!.sends).toHaveLength(1);
    });

    it('refuses once expired, and nothing is sent', async () => {
        const { propose, deps, settleAs, cases, file } = setup();
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        skew = PROPOSAL_TTL_MS + 1000;
        const out = await confirmAction(settleAs(p.action.id), deps);
        expect(out).toMatchObject({ ok: false, code: 'expired', action: { status: 'expired' } });
        expect(cases.get(file.id)!.sends).toEqual([]);
        expect(await confirmAction(settleAs(p.action.id), deps)).toMatchObject({ ok: false, code: 'expired' });
    });

    it('refuses when the held draft changed since Ben saw it, and does not send the new one', async () => {
        const { propose, deps, settleAs, cases, file } = setup();
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        cases.get(file.id)!.hold!.draft = 'Something Ben never read.';
        const out = await confirmAction(settleAs(p.action.id), deps);
        expect(out).toMatchObject({ ok: false, code: 'refused', reason: PREVIEW_CHANGED, action: { status: 'refused', result: { reason: PREVIEW_CHANGED } } });
        expect(cases.get(file.id)!.sends).toEqual([]);
        expect(cases.get(file.id)!.hold?.draft).toBe('Something Ben never read.');
        expect(await confirmAction(settleAs(p.action.id), deps)).toMatchObject({ ok: false, code: 'refused', reason: `this proposal was refused: ${PREVIEW_CHANGED}` });
    });

    it('refuses when the reply route changed since Ben saw it, and sends nothing on the new route', async () => {
        const { propose, deps, settleAs, cases, file } = setup();
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        expect(p.outgoing).toEqual([expect.objectContaining({ channel: 'wa' })]);
        const moved = cases.get(file.id)!;
        const at = new Date().toISOString();
        moved.parties[0].channels.push({ kind: 'email', address: 'sam@example.com', lastInboundAt: at });
        const turn = appendTurn(moved, { at, channel: 'email', direction: 'inbound', partyId: moved.parties[0].personId, kind: 'text', body: 'Replying by email instead.', media: [], runId: null, approver: null });
        if (!turn.ok) throw new Error(turn.reason);
        const out = await confirmAction(settleAs(p.action.id), deps);
        expect(out).toMatchObject({ ok: false, code: 'refused', reason: PREVIEW_CHANGED, action: { status: 'refused' } });
        expect(cases.get(file.id)!.sends).toEqual([]);
        expect(cases.get(file.id)!.hold?.draft).toBe(DRAFT);
    });

    it('previews and sends on the channel the customer last wrote on, not the last send\'s', async () => {
        const file = whatsappFile({ at: new Date(Date.now() - 10 * 60_000).toISOString() });
        const party = file.parties[0];
        party.channels.push({ kind: 'sms', address: '+447700900998', lastInboundAt: null });
        const sent = recordSend(file, {
            runId: 'run_earlier_sms', approver: 'human:office', partyId: party.personId, channel: 'sms', windowState: 'open', templateId: null,
            bubbles: [], factIds: [], kbIds: [], calls: [], at: new Date(Date.now() - 5 * 60_000).toISOString(), mode: 'dry_run', partial: false, turnId: null,
        });
        if (!sent.ok) throw new Error(sent.reason);
        setHold(file, { approver: BEN, reason: 'guards', exception: null, draft: DRAFT });
        const { propose, deps, settleAs, cases } = setup([file]);
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        const whatsapp = party.channels.find((c) => c.kind === 'whatsapp')!.address;
        expect(p.outgoing).toEqual([{ to: whatsapp, channel: 'wa', text: DRAFT, actionId: p.action.id }]);
        const out = await confirmAction(settleAs(p.action.id), deps);
        expect(out).toMatchObject({ ok: true, action: { status: 'executed', result: { channel: 'whatsapp' } } });
        expect(cases.get(file.id)!.sends.at(-1)).toMatchObject({ channel: 'whatsapp' });
    });

    it('refuses the draft swapped between the check and the send, in the executor\'s own tick', async () => {
        const file = heldFile();
        const kinds: ActionKinds = {
            'draft.release': {
                ...ACTION_KINDS['draft.release']!,
                // The preview still reads the old words, as if the swap landed after it.
                preview: async () => ({ ok: true, text: DRAFT }),
            },
        };
        const { propose, deps, settleAs, cases } = setup([file], kinds);
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        file.hold!.draft = 'Swapped.';
        const out = await confirmAction(settleAs(p.action.id), deps);
        expect(out).toMatchObject({ ok: false, code: 'refused', reason: PREVIEW_CHANGED });
        expect(cases.get(file.id)!.sends).toEqual([]);
    });

    it('refuses a session with no slot, or the wrong slot, and leaves the proposal for the right one', async () => {
        const { propose, deps, settleAs, cases, file, store } = setup();
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        expect(await confirmAction(settleAs(p.action.id, { approver: null }), deps)).toMatchObject({ ok: false, code: 'no_slot', reason: 'no approver slot is assigned to this user' });
        expect(await confirmAction(settleAs(p.action.id, { approver: OTHER_SLOT }), deps)).toMatchObject({ ok: false, code: 'wrong_slot', reason: 'only ben may act on this file' });
        expect(store.rows.get(p.action.id)?.status).toBe('proposed');
        expect(cases.get(file.id)!.sends).toEqual([]);
        expect(await confirmAction(settleAs(p.action.id), deps)).toMatchObject({ ok: true });
    });

    it('is not found for anyone whose session it is not', async () => {
        const { propose, deps, settleAs, cases, file } = setup();
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        expect(await confirmAction(settleAs(p.action.id, { person: 'someone.else@handyservices.app', owns: false }), deps)).toEqual({ ok: false, code: 'not_found', reason: 'no such proposal', action: null });
        expect(await confirmAction(settleAs('act_nope'), deps)).toMatchObject({ ok: false, code: 'not_found' });
        expect(cases.get(file.id)!.sends).toEqual([]);
    });

    it('offers no confirm for a draft on a shut window, refusing in the send path\'s own words', async () => {
        const file = whatsappFile({ at: new Date(Date.now() - 48 * 3_600_000).toISOString() });
        setHold(file, { approver: BEN, reason: 'guards', exception: null, draft: DRAFT });
        const { propose, store, cases } = setup([file]);
        const out = await propose();
        expect(out).toEqual({ ok: false, reason: expect.stringMatching(/^the whatsapp window is shut \(.*\); a shut window never carries freeform words/) });
        expect(store.rows.size).toBe(0);
        expect(cases.get(file.id)!.sends).toEqual([]);
        expect(cases.get(file.id)!.hold?.draft).toBe(DRAFT);
    });

    it('refuses at confirm a window that shut after the proposal, and sends nothing', async () => {
        const { propose, deps, settleAs, cases, file } = setup();
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        const party = cases.get(file.id)!.parties[0];
        party.channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
        const out = await confirmAction(settleAs(p.action.id), deps);
        expect(out).toMatchObject({ ok: false, code: 'refused', reason: expect.stringMatching(/^the whatsapp window is shut/), action: { status: 'refused', result: { reason: expect.stringMatching(/window is shut/) } } });
        expect(cases.get(file.id)!.sends).toEqual([]);
        expect(cases.get(file.id)!.hold?.draft).toBe(DRAFT);
    });

    describe('live, through a fake outbound sender', () => {
        afterEach(() => { vi.doUnmock('../../spine/config'); vi.doUnmock('../../outbound'); vi.resetModules(); });

        it('delivers the confirmed words once, and a second confirm delivers nothing', async () => {
            const outbox: string[] = [];
            vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
            vi.doMock('../../outbound', () => ({
                sendCustomerMessage: async (i: { body: string }) => { outbox.push(i.body); return { ok: true, attempts: [], fellBack: false, channel: 'whatsapp' }; },
            }));
            const file = heldFile();
            const { store: cases } = memorySource([file]);
            const store = new MemoryAskActionStore();
            const deps: ActionDeps = { store, source: async () => ({ store: cases, live: true, mode: 'live' }), now: clock };
            const p = await proposeAction({ kind: 'draft.release', args: { caseFileId: file.id }, sessionId: SESSION, askRunId: null, person: BEN_PERSON, approver: BEN }, deps);
            if (!p.ok) throw new Error(p.reason);
            const settle = { id: p.action.id, person: BEN_PERSON, approver: BEN, ownsSession: async () => true };
            const out = await confirmAction(settle, deps);
            expect(out).toMatchObject({ ok: true, action: { status: 'executed' } });
            expect(outbox).toEqual([DRAFT]);
            expect(cases.get(file.id)!.sends[0]).toMatchObject({ mode: 'live', approver: `human:${BEN_PERSON}` });
            await confirmAction(settle, deps);
            expect(outbox).toEqual([DRAFT]);
        }, 20_000);
    });
});

describe('cancelling', () => {
    it('stops it for good; a second cancel changes nothing, and a confirm after is refused', async () => {
        const { propose, deps, settleAs, cases, file } = setup();
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        const out = await cancelAction(settleAs(p.action.id), deps);
        expect(out).toMatchObject({ ok: true, repeat: false, action: { status: 'cancelled', confirmedBy: `human:${BEN_PERSON}`, result: { reason: `cancelled by human:${BEN_PERSON}` } } });
        expect(await cancelAction(settleAs(p.action.id), deps)).toMatchObject({ ok: true, repeat: true });
        expect(await confirmAction(settleAs(p.action.id), deps)).toMatchObject({ ok: false, code: 'closed', reason: `this proposal was cancelled: cancelled by human:${BEN_PERSON}` });
        expect(cases.get(file.id)!.sends).toEqual([]);
        expect(cases.get(file.id)!.hold?.draft).toBe(DRAFT);
    });

    it('cannot cancel what already ran', async () => {
        const { propose, deps, settleAs } = setup();
        const p = await propose();
        if (!p.ok) throw new Error(p.reason);
        await confirmAction(settleAs(p.action.id), deps);
        expect(await cancelAction(settleAs(p.action.id), deps)).toMatchObject({ ok: true, repeat: true, action: { status: 'executed' } });
    });
});

describe('a change that sends nothing', () => {
    /** A stand-in kind that changes nothing but says what it did, as booking.move and call.start will. */
    const noted: ActionKindDef<{ caseFileId: string; what: string }> = {
        kind: 'call.start',
        label: 'Call',
        sends: false,
        parseArgs: (raw: any) => (typeof raw?.caseFileId === 'string' && typeof raw?.what === 'string' ? { caseFileId: raw.caseFileId, what: raw.what } : null),
        caseFileOf: (a) => a.caseFileId,
        preconditions: async () => null,
        preview: async (_ctx, a) => ({ ok: true, text: `Call Sam about ${a.what}` }),
        execute: async (ctx, a) => ({ ok: true, result: { tel: 'tel:+447700900000', runId: ctx.runId, by: ctx.approverName }, audit: `Call started about ${a.what}` }),
    };

    it('leaves a system line on the file carrying the action id, shown on the thread in time order', async () => {
        const file = whatsappFile();
        const { propose, deps, settleAs, cases } = setup([file], { 'call.start': noted });
        const p = await propose({ kind: 'call.start', args: { caseFileId: file.id, what: 'the tap' } });
        if (!p.ok) throw new Error(p.reason);
        const out = await confirmAction(settleAs(p.action.id), deps);
        expect(out).toMatchObject({ ok: true, action: { status: 'executed', result: { tel: 'tel:+447700900000', by: `human:${BEN_PERSON}` } } });
        if (!out.ok) return;
        const stored = cases.get(file.id)!;
        expect(stored.systemTurns).toEqual([expect.objectContaining({
            kind: 'system', actionId: p.action.id, runId: out.action.runId, approver: `human:${BEN_PERSON}`,
            body: `Call started about the tap by human:${BEN_PERSON} (ask action ${p.action.id})`,
        })]);
        expect(out.action.result?.audit).toBe(stored.systemTurns![0].body);
        // Nothing on the thread's own turns: no reply-order rule reads a system line.
        expect(stored.turns).toHaveLength(1);
        expect(stored.sends).toEqual([]);
        const thread = threadSurface(stored);
        expect(thread.turns.map((t) => t.who)).toEqual(['customer', 'system']);
        expect(thread.turns[1]).toMatchObject({ body: stored.systemTurns![0].body, approver: `human:${BEN_PERSON}` });
    });

    it('comes back refused, with the reason, when its executor throws', async () => {
        const file = whatsappFile();
        const broken = { ...noted, execute: async () => { throw new Error('dialler down'); } };
        const { propose, deps, settleAs, cases } = setup([file], { 'call.start': broken });
        const p = await propose({ kind: 'call.start', args: { caseFileId: file.id, what: 'x' } });
        if (!p.ok) throw new Error(p.reason);
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            expect(await confirmAction(settleAs(p.action.id), deps)).toMatchObject({ ok: false, code: 'refused', reason: 'it failed while running: dialler down', action: { status: 'refused' } });
        } finally { quiet.mockRestore(); }
        expect(cases.get(file.id)!.systemTurns ?? []).toEqual([]);
    });

    it('re-checks its preconditions at confirm', async () => {
        const file = whatsappFile();
        let blocked: string | null = null;
        const gated = { ...noted, preconditions: async () => blocked };
        const { propose, deps, settleAs } = setup([file], { 'call.start': gated });
        const p = await propose({ kind: 'call.start', args: { caseFileId: file.id, what: 'x' } });
        if (!p.ok) throw new Error(p.reason);
        blocked = 'the customer has said text only';
        expect(await confirmAction(settleAs(p.action.id), deps)).toMatchObject({ ok: false, code: 'refused', reason: 'the customer has said text only' });
    });
});

describe('the registry', () => {
    it('holds draft.release and nothing that hands a thread back to the desk; booking.create stays out', () => {
        expect(Object.keys(ACTION_KINDS)).toEqual(['draft.release']);
        expect(Object.keys(ACTION_KINDS)).not.toContain('booking.create');
        expect(CONFIRM_KINDS).toEqual(['draft.release', 'message.send', 'quote.resend_link', 'booking.move', 'booking.create', 'call.start']);
        for (const kind of Object.keys(ACTION_KINDS)) expect(CONFIRM_KINDS).toContain(kind);
    });
});
