/**
 * The ask agent's one customer-message write: a draft on the case file's hold, checked the way the
 * desk checks its own composed replies, and never sent. A clean draft is held for the file's
 * approver; a draft the guards or the channel refuse leaves the file exactly as it was; a standing
 * draft is never overwritten.
 */
import { describe, expect, it } from 'vitest';
import { hold as setHold, snapshot } from '../desk/case-file';
import { BEN } from '../desk/guards';
import { ASK_HOLD_MARK, holdDraft } from './hold-draft';
import { BEN_PERSON, now, whatsappFile } from './ask-fixtures';

describe('holding a draft the ask agent wrote', () => {
    it('holds a clean draft for Ben on a file nobody held, with who asked on the reason, and sends nothing', () => {
        const file = whatsappFile();
        const out = holdDraft({ file, words: 'Thanks Sam, sorry to hear about the tap.\n\nCould you send us a photo of it?', requestedBy: BEN_PERSON, why: 'ask for a photo' }, { now: now() });
        expect(out).toMatchObject({ ok: true, channel: 'whatsapp', warnings: [] });
        expect(file.hold).toMatchObject({ approver: BEN, draft: 'Thanks Sam, sorry to hear about the tap.\n\nCould you send us a photo of it?' });
        expect(file.hold?.reason).toBe(`${ASK_HOLD_MARK}: ${BEN_PERSON} asked for a reply to be drafted (ask for a photo)`);
        expect(file.sends).toEqual([]);
        expect(file.turns.filter((t) => t.direction === 'outbound')).toEqual([]);
    });

    it.each([
        ['a figure', 'It would be about £85 fitted.', /figure/],
        ['a date', 'We can come on Friday 19 September.', /date/],
        ['a disclosure', 'I am an AI assistant, happy to help.', /disclosure/],
    ])('refuses %s through the desk\'s guards and leaves the file as it was', (_label, words, failure) => {
        const file = whatsappFile();
        const before = snapshot(file);
        const out = holdDraft({ file, words, requestedBy: BEN_PERSON, why: 'test' }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/guards/);
        expect(out.failures.join(' ')).toMatch(failure);
        expect(file).toEqual(before);
    });

    it('refuses a draft that would not render within the WhatsApp bubble ceiling', () => {
        const file = whatsappFile();
        const out = holdDraft({ file, words: 'One.\n\nTwo.\n\nThree.\n\nFour.', requestedBy: BEN_PERSON, why: 'test' }, { now: now() });
        expect(out).toMatchObject({ ok: false });
        if (!out.ok) expect(out.reason).toMatch(/bubbles, over the ceiling/);
        expect(file.hold).toBeNull();
    });

    it('drops dash punctuation, as every composed reply does', () => {
        const file = whatsappFile();
        const out = holdDraft({ file, words: 'Thanks Sam - could you send a photo?', requestedBy: BEN_PERSON, why: 'photo' }, { now: now() });
        expect(out.ok).toBe(true);
        expect(file.hold?.draft).toBe('Thanks Sam, could you send a photo?');
    });

    it('adds the draft to a standing hold that has none, keeping the reason it was raised for', () => {
        const file = whatsappFile();
        setHold(file, { approver: BEN, reason: 'complaint: the last visit', exception: null }, { now: now() });
        const out = holdDraft({ file, words: 'Sorry Sam, we will look into it.', requestedBy: BEN_PERSON, why: 'apologise' }, { now: now() });
        expect(out.ok).toBe(true);
        expect(file.hold?.draft).toBe('Sorry Sam, we will look into it.');
        expect(file.hold?.reason).toMatch(/^complaint: the last visit; Asked on the Handy Desk/);
        expect(file.hold?.notedOn).toBe(true);
    });

    it('never overwrites a draft that already stands', () => {
        const file = whatsappFile();
        setHold(file, { approver: BEN, reason: 'guards', exception: null, draft: 'The desk\'s own draft.' }, { now: now() });
        const out = holdDraft({ file, words: 'Another draft.', requestedBy: BEN_PERSON, why: 'x' }, { now: now() });
        expect(out).toMatchObject({ ok: false });
        if (!out.ok) expect(out.reason).toMatch(/already holds a draft/);
        expect(file.hold?.draft).toBe('The desk\'s own draft.');
    });

    it('holds a draft on a shut window with a warning, because the customer may write again first', () => {
        const file = whatsappFile({ at: '2026-09-15T09:00:00.000Z' });
        const out = holdDraft({ file, words: 'Thanks Sam, could you send a photo?', requestedBy: BEN_PERSON, why: 'photo' }, { now: now() });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.warnings.join(' ')).toMatch(/window is shut/);
    });
});
