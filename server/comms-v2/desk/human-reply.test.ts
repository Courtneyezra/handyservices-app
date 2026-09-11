/**
 * Ben's own reply from the board, through the one sender (human-reply.ts): his words go out as
 * written with him as approver and a fresh run id, land on the file as his turn, clear the hold
 * with his words recorded as the release, and leave the thread to automation (checklist 7.4). The
 * guards never run over them (behaviour.md answer 43): a figure, a date or a commitment Ben types
 * goes as he wrote it, under his own human approver. What his words are still recorded in is the
 * bookkeeping of what the business has said: the ask ledger and the call offer. What still refuses
 * him is what the sender owns: a shut window, a wall of bubbles, a hold that is someone else's.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, everAsked, open, hold as setHold, type ApproverSlot, type CaseFile, type Party } from './case-file';
import { BEN } from './guards';
import { humanReply } from './human-reply';
import { DESK_APPROVER } from './sender';

const AT = '2026-09-11T10:00:00.000Z';
/** Who the signed-in session is, which is what the send records: the person, not the slot they hold. */
const BEN_PERSON = 'ben.real@handyservices.app';
const BEN_APPROVER = `human:${BEN_PERSON}`;
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

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Morning Sam, spoke to my fitter.\n\nI will pop round and look at it properly.' }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        // The sender rendered it: a blank line is a bubble break, and nothing was rewritten.
        expect(out.result.bubbles.map((b) => b.text)).toEqual([
            'Morning Sam, spoke to my fitter.',
            'I will pop round and look at it properly.',
        ]);
        expect(out.result.approver).toBe(BEN_APPROVER);
        expect(out.result.runId).toMatch(/^run_/);
        expect(out.result.turnId).toBe(file.turns[file.turns.length - 1].id);

        // Ben's turn is on the file, carrying him as approver.
        const last = file.turns[file.turns.length - 1];
        expect(last.direction).toBe('outbound');
        expect(last.approver).toBe(BEN_APPROVER);
        expect(last.body).toContain('spoke to my fitter');
        expect(file.sends[file.sends.length - 1]).toMatchObject({ approver: BEN_APPROVER, channel: 'whatsapp', mode: 'dry_run' });

        // The hold is cleared, with his words as the release, and the file still holds.
        expect(file.hold).toBeNull();
        expect(out.release).toMatchObject({ approver: { kind: 'human', id: 'ben' }, reason: 'money: How much' });
        expect(out.release?.words).toContain('spoke to my fitter');
        expect(file.releases).toHaveLength(1);
    });

    it('answers again after the customer writes back, the hold still cleared', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Morning Sam, I will take a look.' }, { now: now() });
        expect(file.hold).toBeNull();

        const next = appendTurn(file, { at: '2026-09-11T10:10:00.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'Great, thanks', media: [], runId: null, approver: null }, { now: now('2026-09-11T10:10:00.000Z') });
        expect(next.ok).toBe(true);
        const again = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'No problem.' }, { now: now('2026-09-11T10:11:00.000Z') });
        expect(again.ok).toBe(true);
    });

    it('sends a figure Ben types as he wrote it: the guards gate the composer, not him', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'A new tap is about £120 fitted.' }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles.map((b) => b.text)).toEqual(['A new tap is about £120 fitted.']);
        expect(file.turns[file.turns.length - 1].body).toContain('£120');
        expect(file.facts).toHaveLength(0);
        expect(file.sends).toHaveLength(1);
    });

    it('sends a date Ben types with no diary fact behind it: the guards are the composer\'s, not his', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'I can pop round Friday to look at it properly.' }, { now: now() });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(file.turns[file.turns.length - 1].body).toContain('Friday');
        expect(file.sends).toHaveLength(1);
    });

    it('sends a second reply from the same person: the one-reply guard paces the desk, not Ben', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const first = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'I will take a look today.' }, { now: now() });
        expect(first.ok).toBe(true);

        const second = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'One more thing.' }, { now: now('2026-09-11T10:06:00.000Z') });
        expect(second.ok).toBe(true);
        expect(file.sends).toHaveLength(2);
    });

    it('refuses no words, a rule-based approver, and a hold named for someone else', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const rules: ApproverSlot = { kind: 'rules', id: 'landlord_1', then: { kind: 'human', id: 'landlord_1' } };
        const other: ApproverSlot = { kind: 'human', id: 'someone_else' };

        expect(await humanReply({ file, approver: BEN, person: BEN_PERSON, words: '   ' }, { now: now() })).toMatchObject({ ok: false, reason: 'a reply needs words' });
        expect(await humanReply({ file, approver: rules, person: BEN_PERSON, words: 'hello' }, { now: now() })).toMatchObject({ ok: false });
        const wrong = await humanReply({ file, approver: other, person: BEN_PERSON, words: 'hello' }, { now: now() });
        expect(wrong.ok).toBe(false);
        if (wrong.ok) return;
        expect(wrong.reason).toMatch(/only ben may answer/);
        expect(file.turns).toHaveLength(2);
    });

    it('keeps the line breaks Ben types inside a bubble; a blank line still starts a new one', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const words = 'Morning Sam, two things I would do:\n- replace the washer\n- check the isolator valve\n\nI will bring both.';

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles.map((b) => b.text)).toEqual([
            'Morning Sam, two things I would do:\n- replace the washer\n- check the isolator valve',
            'I will bring both.',
        ]);
        expect(file.turns[file.turns.length - 1].body).toContain('\n- replace the washer');
    });

    it('refuses a slot that is not the one this file answers to, with no hold standing either', async () => {
        const { file } = fixture();
        const landlord: ApproverSlot = { kind: 'human', id: 'landlord_1' };

        const out = await humanReply({ file, approver: landlord, person: BEN_PERSON, words: 'Morning Sam, I can look at that.' }, { now: now() });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/only ben may answer/);
        expect(file.sends).toHaveLength(0);
        expect(file.turns).toHaveLength(1);
    });

    it('refuses a shut window: a shut window never carries freeform words', async () => {
        const { file, party } = fixture();
        deskRepliedAndHeld(file);
        const ch = party.channels.find((c) => c.kind === 'whatsapp')!;
        ch.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Morning Sam.' }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/window is shut/);
        expect(file.sends).toHaveLength(0);
    });

    it('refuses a reply over the bubble ceiling rather than sending a wall', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const words = ['one', 'two', 'three', 'four', 'five'].join('\n\n');
        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/over the ceiling/);
    });

    it('records what Ben asked for and promised, so the desk does not ask the customer twice', async () => {
        const { file, party } = fixture();
        deskRepliedAndHeld(file);

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Morning Sam, can you send me a photo of the tap?\n\nI will give you a quick call this afternoon.' }, { now: now() });

        expect(out.ok).toBe(true);
        expect(everAsked(file, 'media')).toBe(true);
        expect(party.callOffered).toBe(true);
        expect(everAsked(file, 'postcode')).toBe(false);
    });

    it('records nothing from prose that only reads like an ask, so the desk still asks', async () => {
        for (const words of ['I will be in touch later today, what is the best number for you?', 'I have seen the picture, what time works?']) {
            const { file, party } = fixture();
            deskRepliedAndHeld(file);
            const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words }, { now: now() });
            expect(out.ok).toBe(true);
            expect(everAsked(file, 'access')).toBe(false);
            expect(everAsked(file, 'media')).toBe(false);
            expect(everAsked(file, 'postcode')).toBe(false);
            expect(party.callOffered).toBe(false);
        }
    });

    it('records the person who typed the words, not the slot two of them share', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);

        const first = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Morning Sam, I will take a look.' }, { now: now() });
        const second = await humanReply({ file, approver: BEN, person: 'jo.office@handyservices.app', words: 'Ben is on his way.' }, { now: now('2026-09-11T10:06:00.000Z') });

        expect(first.ok && second.ok).toBe(true);
        expect(file.sends.map((s) => s.approver)).toEqual([BEN_APPROVER, 'human:jo.office@handyservices.app']);
        expect(file.turns.slice(-2).map((t) => t.approver)).toEqual([BEN_APPROVER, 'human:jo.office@handyservices.app']);
    });

    it('answers a file with no hold, and the file stays unheld', async () => {
        const { file } = fixture();
        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Hi Sam, let me take a look and come back to you.' }, { now: now() });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.release).toBeNull();
        expect(file.hold).toBeNull();
        expect(file.turns[file.turns.length - 1].approver).toBe(BEN_APPROVER);
    });
});
