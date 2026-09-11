/**
 * One case file per job across channels (behaviour.md answer 25): a form, then a WhatsApp, then an
 * email from the same person land on one file; the form's phone and email are linked as one
 * person; the party's reach and the adapter's facts go on the file; the email thread is kept.
 */
import { describe, expect, it } from 'vitest';
import type { CaseFile, Turn } from '../desk/case-file';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import type { InboundTurn } from '../desk/whatsapp-adapter';
import { chooseChannel } from '../desk/sender';
import { ChannelGateway } from './channel-gateway';
import { fromDoorEmail } from './email-adapter';
import { fromWebForm } from './form-adapter';
import { fromDoorSms } from './sms-adapter';

const seen: string[] = [];
const fakeDesk: DeskLike = {
    async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> { seen.push(turn.id); return result(file); },
    async clockPass(file: CaseFile): Promise<DeskResult> { return result(file); },
};
function result(file: CaseFile): DeskResult {
    return { runId: 'run_x', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 };
}
const wa = (text: string, at: string): InboundTurn => ({ channel: 'whatsapp', address: '+447700900942', name: null, text, media: [], at, providerMessageId: null, via: 'meta', mediaFailures: [] });

describe('the channel gateway', () => {
    it('a form opens the file with the phone and email linked, the reach and the facts on it; WhatsApp and email turns then land on the same file', async () => {
        const g = new ChannelGateway({ desk: fakeDesk, now: () => new Date('2026-09-11T10:00:00.000Z') });
        const form = await fromWebForm({ customerName: 'Priya K', phone: '07700 900942', email: 'priya@example.com', jobDescription: 'fan dead', postcode: 'NG9 2AB', source: 'web_quote' }, { now: () => new Date('2026-09-11T09:59:00.000Z') });
        const a = await g.inbound(form, { whatsapp: false });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.turns[0]).toMatchObject({ channel: 'form', kind: 'form', body: 'fan dead' });
        expect(a.file.parties[0].channels.map((c) => [c.kind, c.address])).toEqual([['form', '+447700900942'], ['sms', '+447700900942'], ['email', 'priya@example.com']]);
        expect(a.file.facts.map((f) => [f.key, f.value, f.by])).toEqual([['customer_name', 'Priya K', 'form_adapter'], ['location', 'NG9 2AB', 'form_adapter'], ['form_source', 'web_quote', 'form_adapter']]);
        expect(a.file.facts.every((f) => f.source.kind === 'thread' && f.source.turnId === a.file.turns[0].id)).toBe(true);
        expect(a.file.job.location).toBe('NG9 2AB');
        expect(g.identity.directory.all()).toHaveLength(1);
        expect(g.identity.directory.all()[0].keys.sort()).toEqual(['email:priya@example.com', 'phone:07700900942']);
        const b = await g.inbound(wa('hi, about my form', '2026-09-11T10:01:00.000Z'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.file.id).toBe(a.file.id);
        expect(b.file.parties[0].channels.find((c) => c.kind === 'whatsapp')).toMatchObject({ address: '+447700900942', transport: 'meta', lastInboundAt: '2026-09-11T10:01:00.000Z' });
        const c = await g.inbound(fromDoorEmail({ address: 'Priya@Example.com', subject: 'Re: my fan', text: 'more detail', at: '2026-09-11T10:02:00.000Z', messageId: '<e1@x>' }));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.file.id).toBe(a.file.id);
        expect(c.file.turns.map((t) => t.channel)).toEqual(['form', 'whatsapp', 'email']);
        expect(c.file.parties[0].channels.find((ch) => ch.kind === 'email')?.thread).toEqual({ subject: 'Re: my fan', messageId: '<e1@x>', references: ['<e1@x>'] });
        expect(g.store.all()).toHaveLength(1);
        expect(seen).toHaveLength(3);
    });
    it('a form whose phone the business already knows joins that person, and its email is linked on the way past', async () => {
        const byWhatsApp = new ChannelGateway({ desk: fakeDesk });
        const c = await byWhatsApp.inbound(wa('my kitchen fan is dead', '2026-09-11T09:00:00.000Z'));
        if (c.kind !== 'handled') throw new Error(c.kind);
        const d = await byWhatsApp.inbound(await fromWebForm({ customerName: 'Priya K', phone: '+447700900942', email: 'priya@example.com', jobDescription: 'kitchen fan dead', at: '2026-09-11T09:05:00.000Z' }));
        if (d.kind !== 'handled') throw new Error(d.kind);
        expect(d.file.id).toBe(c.file.id);
        expect(byWhatsApp.store.all()).toHaveLength(1);
        expect(byWhatsApp.identity.directory.all()).toHaveLength(1);
        expect(byWhatsApp.identity.directory.all()[0].keys.slice().sort()).toEqual(['email:priya@example.com', 'phone:07700900942']);
    });
    it('a key the turn only asserts never binds to someone else: the form is held as candidates for Ben, and no file is touched', async () => {
        // A shared household address, or a typo. Without this the stranger's enquiry is appended to
        // Priya's file and the reply, written from her whole thread, can be addressed to his phone.
        const g = new ChannelGateway({ desk: fakeDesk });
        const hers = await g.inbound(fromDoorEmail({ address: 'priya@example.com', subject: 'My kitchen fan', text: 'the kitchen fan is dead', at: '2026-09-11T09:00:00.000Z', messageId: '<e1@x>' }));
        if (hers.kind !== 'handled') throw new Error(hers.kind);
        const turnsBefore = hers.file.turns.length;
        const stranger = await g.inbound(await fromWebForm({ customerName: 'Marc', phone: '+447700900123', email: 'priya@example.com', jobDescription: 'gate hinge', at: '2026-09-11T09:05:00.000Z' }));
        expect(stranger).toEqual({ kind: 'candidates', candidates: 1, address: '+447700900123' });
        expect(g.store.all()).toHaveLength(1);
        expect(g.store.all()[0].turns).toHaveLength(turnsBefore);
        expect(g.identity.directory.all()).toHaveLength(1);
        expect(g.identity.directory.all()[0].keys).toEqual(['email:priya@example.com']);
    });
    it('a WhatsApp channel goes on a form or call party when the seed or the presence source says the number is on it, never otherwise', async () => {
        const known = new ChannelGateway({ desk: fakeDesk, presence: { async knownOnWhatsApp() { return true; } } });
        const a = await known.inbound(await fromWebForm({ phone: '+447700900942', jobDescription: 'x' }));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.parties[0].channels.map((c) => c.kind)).toEqual(['form', 'sms', 'whatsapp']);
        expect(a.file.parties[0].channels.find((c) => c.kind === 'whatsapp')?.lastInboundAt).toBeNull();
        const seeded = new ChannelGateway({ desk: fakeDesk, presence: { async knownOnWhatsApp() { return true; } } });
        const b = await seeded.inbound(await fromWebForm({ phone: '+447700900942', jobDescription: 'x' }), { whatsapp: false });
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.file.parties[0].channels.map((c) => c.kind)).toEqual(['form', 'sms']);
        const unknown = new ChannelGateway({ desk: fakeDesk });
        const c = await unknown.inbound(fromDoorSms({ address: '+447700900942', text: 'hi' }));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.file.parties[0].channels.map((c) => c.kind)).toEqual(['sms']);
    });
    it('an email onto a file opened on another channel puts the email channel on the party, so the reply goes back by email on its thread', async () => {
        const g = new ChannelGateway({ desk: fakeDesk });
        const a = await g.inbound(fromDoorSms({ address: '+447700900942', name: 'Sam', text: 'my tap drips', at: '2026-09-11T10:00:00.000Z' }));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.parties[0].channels.map((c) => c.kind)).toEqual(['sms']);
        expect(g.identity.link(a.file.parties[0].canonical, 'email:sam@example.com', 'the same person, proved elsewhere').ok).toBe(true);
        const b = await g.inbound(fromDoorEmail({ address: 'sam@example.com', subject: 'My dripping tap', text: 'here is the detail', at: '2026-09-11T10:05:00.000Z', messageId: '<e9@x>' }));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.file.id).toBe(a.file.id);
        expect(b.file.parties[0].channels.map((c) => [c.kind, c.address])).toEqual([['sms', '+447700900942'], ['email', 'sam@example.com']]);
        expect(b.file.parties[0].channels.find((c) => c.kind === 'email')?.thread).toEqual({ subject: 'My dripping tap', messageId: '<e9@x>', references: ['<e9@x>'] });
        expect(chooseChannel(b.file.parties[0], 'email')).toEqual({ ok: true, channel: 'email', address: 'sam@example.com' });
    });
    it('an email-only person has an email channel and nothing else; an internal number is refused', async () => {
        const g = new ChannelGateway({ desk: fakeDesk });
        const a = await g.inbound(fromDoorEmail({ address: 'someone@example.com', text: 'hello', subject: 'Hi' }));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.parties[0].channels.map((c) => [c.kind, c.address])).toEqual([['email', 'someone@example.com']]);
        expect(a.file.parties[0].canonical).toBe('email:someone@example.com');
        g.identity.registerInternal('phone:07700900001', 'Ben');
        expect((await g.inbound(fromDoorSms({ address: '+447700900001', text: 'hi' }))).kind).toBe('refused');
    });
});
