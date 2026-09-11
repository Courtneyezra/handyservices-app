/**
 * Ben's own reply from the board, through the one sender (human-reply.ts): his words go out as
 * written with him as approver and a fresh run id, land on the file as his turn, clear the hold
 * with his words recorded as the release, and leave the thread to automation (checklist 7.4). The
 * guards never run over them (behaviour.md answer 43): a figure, a date or a commitment Ben types
 * goes as he wrote it, under his own human approver, with no guard verdict recorded anywhere. What still refuses him is what the sender owns: a shut window, a wall of bubbles, a
 * hold that is someone else's.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, open, hold as setHold, type ApproverSlot, type CaseFile, type Party } from './case-file';
import { BEN } from './guards';
import { humanReply } from './human-reply';
import { DESK_APPROVER } from './sender';

const AT = '2026-09-11T10:00:00.000Z';
const now = (iso = '2026-09-11T10:05:00.000Z') => () => new Date(iso);

function fixture(): { file: CaseFile; party: Party } {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: AT, channel: 'whatsapp', kind: 'text', body: 'How much would a new tap be?', media: [] },
    }, { now: now(AT) });
    if (!r.ok) throw new Error(r.reason);
    return { file: r.value, party: r.value.parties[0] };
}

/** The desk's own reply to that turn: the money line that promises Ben will come back, and the hold behind it. */
function deskRepliedAndHeld(file: CaseFile): void {
    setHold(file, { approver: BEN, reason: 'money: How much', exception: 'money' }, { now: now('2026-09-11T10:00:01.000Z') });
    const t = appendTurn(file, { at: '2026-09-11T10:00:02.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'Ben will come back to you on the price.', media: [], runId: 'run_desk', approver: DESK_APPROVER }, { now: now('2026-09-11T10:00:02.000Z') });
    if (!t.ok) throw new Error(t.reason);
}

describe('a person answers from the board', () => {
    it('sends Ben\'s words as written through the one sender, records his turn, clears the hold with his words and hands the thread back', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);

        const out = await humanReply({ file, approver: BEN, words: 'Morning Sam, spoke to my fitter.\n\nI will pop round and look at it properly.' }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        // The sender rendered it: a blank line is a bubble break, and nothing was rewritten.
        expect(out.result.bubbles.map((b) => b.text)).toEqual([
            'Morning Sam, spoke to my fitter.',
            'I will pop round and look at it properly.',
        ]);
        expect(out.result.approver).toBe('human:ben');
        expect(out.result.runId).toMatch(/^run_/);
        expect(out.result.delivered).toBe(true);

        // Ben's turn is on the file, carrying him as approver.
        const last = file.turns[file.turns.length - 1];
        expect(last.direction).toBe('outbound');
        expect(last.approver).toBe('human:ben');
        expect(last.body).toContain('spoke to my fitter');
        expect(file.sends[file.sends.length - 1]).toMatchObject({ approver: 'human:ben', channel: 'whatsapp', mode: 'dry_run' });

        // The hold is cleared, with his words as the release, and the file still holds.
        expect(file.hold).toBeNull();
        expect(out.release).toMatchObject({ approver: { kind: 'human', id: 'ben' }, reason: 'money: How much' });
        expect(out.release?.words).toContain('spoke to my fitter');
        expect(file.releases).toHaveLength(1);
    });

    it('the thread is automation\'s again: the hold is gone and the next customer turn is the desk\'s', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        await humanReply({ file, approver: BEN, words: 'Morning Sam, I will take a look.' }, { now: now() });
        expect(file.hold).toBeNull();

        const next = appendTurn(file, { at: '2026-09-11T10:10:00.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'Great, thanks', media: [], runId: null, approver: null }, { now: now('2026-09-11T10:10:00.000Z') });
        expect(next.ok).toBe(true);
        const again = await humanReply({ file, approver: BEN, words: 'No problem.' }, { now: now('2026-09-11T10:11:00.000Z') });
        expect(again.ok).toBe(true);
    });

    it('sends a figure Ben types as he wrote it, with every guard recorded as not applied', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);

        const out = await humanReply({ file, approver: BEN, words: 'A new tap is about £120 fitted.' }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles.map((b) => b.text)).toEqual(['A new tap is about £120 fitted.']);
        expect(Object.values(out.result.guards).map((g) => g.result)).toEqual(Array(8).fill('not_applied'));
        expect(out.result.factIds).toEqual([]);
        expect(file.sends).toHaveLength(1);
    });

    it('sends a date Ben types with no diary fact behind it: the guards are the composer\'s, not his', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const out = await humanReply({ file, approver: BEN, words: 'I can pop round Friday to look at it properly.' }, { now: now() });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.guards.date_time_duration.result).toBe('not_applied');
        expect(file.turns[file.turns.length - 1].body).toContain('Friday');
    });

    it('sends a second reply from the same person: the one-reply guard paces the desk, not Ben', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const first = await humanReply({ file, approver: BEN, words: 'I will take a look today.' }, { now: now() });
        expect(first.ok).toBe(true);

        const second = await humanReply({ file, approver: BEN, words: 'One more thing.' }, { now: now('2026-09-11T10:06:00.000Z') });
        expect(second.ok).toBe(true);
        expect(file.sends).toHaveLength(2);
    });

    it('refuses no words, a rule-based approver, and a hold named for someone else', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const rules: ApproverSlot = { kind: 'rules', id: 'landlord_1', then: { kind: 'human', id: 'landlord_1' } };
        const other: ApproverSlot = { kind: 'human', id: 'someone_else' };

        expect(await humanReply({ file, approver: BEN, words: '   ' }, { now: now() })).toMatchObject({ ok: false, reason: 'a reply needs words' });
        expect(await humanReply({ file, approver: rules, words: 'hello' }, { now: now() })).toMatchObject({ ok: false });
        const wrong = await humanReply({ file, approver: other, words: 'hello' }, { now: now() });
        expect(wrong.ok).toBe(false);
        if (wrong.ok) return;
        expect(wrong.reason).toMatch(/only ben may answer/);
        expect(file.turns).toHaveLength(2);
    });

    it('refuses a shut window: a shut window never carries freeform words', async () => {
        const { file, party } = fixture();
        deskRepliedAndHeld(file);
        const ch = party.channels.find((c) => c.kind === 'whatsapp')!;
        ch.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await humanReply({ file, approver: BEN, words: 'Morning Sam.' }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/window is shut/);
        expect(file.sends).toHaveLength(0);
    });

    it('refuses a reply over the bubble ceiling rather than sending a wall', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const words = ['one', 'two', 'three', 'four', 'five'].join('\n\n');
        const out = await humanReply({ file, approver: BEN, words }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/over the ceiling/);
    });

    it('answers a file with no hold, and the file stays unheld', async () => {
        const { file } = fixture();
        const out = await humanReply({ file, approver: BEN, words: 'Hi Sam, let me take a look and come back to you.' }, { now: now() });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.release).toBeNull();
        expect(file.hold).toBeNull();
        expect(file.turns[file.turns.length - 1].approver).toBe('human:ben');
    });
});
