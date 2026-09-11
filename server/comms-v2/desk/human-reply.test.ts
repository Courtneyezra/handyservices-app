/**
 * Ben's own reply from the board, through the one sender (human-reply.ts): his words go out as
 * written with him as approver and a fresh run id, land on the file as his turn, clear the hold
 * with his words recorded as the release, and leave the thread to automation (checklist 7.4). The
 * guards are the same eight, with no bypass for a person: an unsourced figure is refused with the
 * reason named and nothing sent; the same figure cited from a quote line goes.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, open, recordFact, hold as setHold, type ApproverSlot, type CaseFile, type Party } from './case-file';
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

    it('the thread is automation\'s again: the next customer turn passes the one-reply guard for the desk', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        await humanReply({ file, approver: BEN, words: 'Morning Sam, I will take a look.' }, { now: now() });
        expect(file.hold).toBeNull();

        const next = appendTurn(file, { at: '2026-09-11T10:10:00.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'Great, thanks', media: [], runId: null, approver: null }, { now: now('2026-09-11T10:10:00.000Z') });
        expect(next.ok).toBe(true);
        const again = await humanReply({ file, approver: BEN, words: 'No problem.' }, { now: now('2026-09-11T10:11:00.000Z') });
        expect(again.ok).toBe(true);
    });

    it('refuses an unsourced figure with the guard\'s reason and sends nothing', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const before = file.turns.length;

        const out = await humanReply({ file, approver: BEN, words: 'A new tap is about £120 fitted.' }, { now: now() });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.failures.join(' ')).toMatch(/figure: .*£120/);
        expect(out.result.guards.figure.result).toBe('fail');
        expect(out.result.delivered).toBe(false);
        expect(file.turns).toHaveLength(before);
        expect(file.sends).toHaveLength(0);
        expect(file.hold).not.toBeNull();
    });

    it('the same figure goes once it cites the quote line it came from', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const fact = recordFact(file, { key: 'quote_line_tap', value: '£120', source: { kind: 'quote_line', quoteRef: 'Q-1', line: 'Supply and fit a mixer tap' }, by: 'ben' }, { now: now() });
        expect(fact.ok).toBe(true);
        if (!fact.ok) return;

        const out = await humanReply({ file, approver: BEN, words: 'A new tap is £120 fitted, as on your quote.', factIds: [fact.value.id] }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.factIds).toEqual([fact.value.id]);
        expect(file.sends[0].factIds).toEqual([fact.value.id]);
    });

    it('refuses a date Ben types with no diary fact behind it: the guards do not soften for a person', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const out = await humanReply({ file, approver: BEN, words: 'I can pop round Friday to look at it properly.' }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.result.guards.date_time_duration.result).toBe('fail');
        expect(file.sends).toHaveLength(0);
    });

    it('refuses a fact id that is not on the file', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const out = await humanReply({ file, approver: BEN, words: 'That is £120.', factIds: ['fact_nope'] }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/facts cited that are not on the file/);
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

    it('refuses a second reply from the same person with no customer turn in between', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const first = await humanReply({ file, approver: BEN, words: 'I will take a look today.' }, { now: now() });
        expect(first.ok).toBe(true);

        const second = await humanReply({ file, approver: BEN, words: 'One more thing.' }, { now: now('2026-09-11T10:06:00.000Z') });
        expect(second.ok).toBe(false);
        if (second.ok) return;
        expect(second.failures.join(' ')).toMatch(/already replied to this message/);
        expect(file.sends).toHaveLength(1);
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
