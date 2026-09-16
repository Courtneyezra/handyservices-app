/**
 * The fixed lines are Ben speaking (brand-voice/whatsapp-comms.md, "Who you are"): the desk IS Ben,
 * so no line mentions Ben, the office or the team in the third person. His name may close a line as
 * his "Thanks / Ben" sign-off, and `first_contact_ack` may introduce him in the first person.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_FIXED_LINES, KB_BACKED, fixedLine, type FixedLineKind } from './fixed-lines';
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

    it('sends a reviewed row\'s words with its dashes made commas, and the row still cited', async () => {
        const line = await fixedLine('complaint', { async reviewed() { return { id: 'kb-complaint', words: "Sorry to hear that - leave it with me.\n\nThanks\nBen" }; } });
        expect(line).toEqual({ kind: 'complaint', text: "Sorry to hear that, leave it with me.\n\nThanks\nBen", kbId: 'kb-complaint' });
    });
});
