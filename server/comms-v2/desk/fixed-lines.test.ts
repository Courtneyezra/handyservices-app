/**
 * The fixed lines are Ben speaking (brand-voice/whatsapp-comms.md, "Who you are"): the desk IS Ben,
 * so no line mentions Ben, the office or the team in the third person. His name may close a line as
 * his "Thanks / Ben" sign-off, and `first_contact_ack` may introduce him in the first person.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_FIXED_LINES, FORMER_HELD_ACK, KB_BACKED, fixedLine, isHeldAckText, lateMediaAckLine, mediaNoun, type FixedLineKind } from './fixed-lines';
import type { TurnMedia } from './case-file';
import { RE_COMES_BACK, RE_DATE_TIME_DURATION, RE_THANKS_MEDIA } from './lexicon';
import { hasDashPunctuation } from './dashes';

const SIGN_OFF = /\n\nThanks\nBen$/;
const entries = Object.entries(DEFAULT_FIXED_LINES) as Array<[FixedLineKind, string]>;

describe('the default fixed lines', () => {
    it('no line names Ben except as the sign-off, and none talks about him, the office or the team', () => {
        for (const [kind, text] of entries) {
            const body = text.replace(SIGN_OFF, '').replace(/\bBen here\b/, '');
            expect(body, kind).not.toMatch(/\bBen\b|\b(?:he|he'll|him|his|himself)\b|\bthe (?:office|team)\b|\bmy colleague\b/i);
        }
    });

    it('the four knowledge-base defaults close with the sign-off; the short lines carry none', () => {
        for (const [kind, text] of entries) expect(SIGN_OFF.test(text), kind).toBe(KB_BACKED.has(kind));
    });

    it('keeps the house voice: no em dashes, and no hyphen used as a dash', () => {
        for (const [kind, text] of entries) {
            expect(text, kind).not.toMatch(/[—–]/);
            expect(hasDashPunctuation(text), kind).toBe(false);
        }
    });

    it('no line the desk writes itself promises to come back (the captain\'s ruling, 18 Sep 2026); only Ben\'s four reviewed defaults are his own words', () => {
        for (const kind of ['money_to_ben', 'date_change_to_ben', 'held_ack', 'no_source', 'not_converging']) expect(Object.keys(DEFAULT_FIXED_LINES), kind).not.toContain(kind);
        for (const [kind, text] of entries) if (!KB_BACKED.has(kind)) expect(RE_COMES_BACK.test(text), kind).toBe(false);
    });

    it('sends a reviewed row\'s words with its dashes made commas, and the row still cited', async () => {
        const line = await fixedLine('complaint', { async reviewed() { return { id: 'kb-complaint', words: "Sorry to hear that - leave it with me.\n\nThanks\nBen" }; } });
        expect(line).toEqual({ kind: 'complaint', text: "Sorry to hear that, leave it with me.\n\nThanks\nBen", kbId: 'kb-complaint' });
    });
});

const photo = (id: string): TurnMedia => ({ id, kind: 'image', mime: 'image/jpeg', path: null, url: null, description: null });
const video = (id: string): TurnMedia => ({ id, kind: 'video', mime: 'video/mp4', path: null, url: null, description: null });

describe('the former held acknowledgement is known by its wording', () => {
    it('recognises every line the desk used to send, naming what arrived, and nothing else', () => {
        expect(mediaNoun([])).toBeNull();
        const mixes = [[], [photo('p')], [video('v')], [photo('p1'), photo('p2')], [video('v1'), video('v2')], [photo('p'), video('v')], [photo('p1'), photo('p2'), video('v1'), video('v2')]];
        for (const media of mixes) {
            const noun = mediaNoun(media);
            const text = noun ? FORMER_HELD_ACK.replace(/^Thanks,/, `Thanks for the ${noun},`) : FORMER_HELD_ACK;
            expect(isHeldAckText(text), text).toBe(true);
        }
        expect(isHeldAckText("Thanks for the video, leave it with me and I'll come back to you.")).toBe(true);
        expect(isHeldAckText(`${FORMER_HELD_ACK}\n`)).toBe(true);
        for (const other of ['Let me check on that one and come straight back to you.', "Thanks for the quote, leave it with me and I'll come back to you.", `${FORMER_HELD_ACK} A new tap is about £120.`, `A new tap is about £120.\n${FORMER_HELD_ACK}`]) {
            expect(isHeldAckText(other)).toBe(false);
        }
    });
});

describe('the late thanks for media', () => {
    // 20:07 BST on 15 Sep, answered at 06:38 BST the next morning.
    const sent = new Date('2026-09-15T19:06:09.000Z');
    it('says the media came in yesterday, earlier or the other day, and that the reply is late, in words the date guard allows', () => {
        const yesterday = lateMediaAckLine([video('v')], sent, new Date('2026-09-16T04:38:49.000Z'));
        expect(yesterday).toEqual({ kind: 'late_media_ack', text: "Thanks for the video you sent yesterday, sorry I'm only getting back to you on it now.", kbId: null });
        expect(lateMediaAckLine([photo('p')], sent, new Date('2026-09-15T22:00:00.000Z')).text).toBe("Thanks for the photo you sent earlier, sorry I'm only getting back to you on it now.");
        expect(lateMediaAckLine([photo('p'), photo('q')], sent, new Date('2026-09-19T09:00:00.000Z')).text).toBe("Thanks for the photos you sent the other day, sorry I'm only getting back to you on it now.");
        // London days, not UTC: 23:30 UTC on the 15th is already the 16th in London.
        expect(lateMediaAckLine([video('v')], new Date('2026-09-15T23:30:00.000Z'), new Date('2026-09-16T09:00:00.000Z')).text).toContain('sent earlier');
        for (const text of [yesterday.text, DEFAULT_FIXED_LINES.late_media_ack]) {
            expect(RE_DATE_TIME_DURATION.test(text), text).toBe(false);
            expect(hasDashPunctuation(text), text).toBe(false);
        }
        expect(RE_THANKS_MEDIA.test(yesterday.text)).toBe(true);
    });
});
