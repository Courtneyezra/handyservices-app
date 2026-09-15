/**
 * The house rule on dashes (brand-voice/whatsapp-comms.md): no dash used as punctuation reaches a
 * customer, whether the composer wrote it, a fixed line carries it or the renderer folded a list
 * into one. A hyphenated word stays, a person's own words go as typed, and a reviewed row whose
 * dash went out as a comma still counts as carried word for word.
 */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile } from './case-file';
import { compose } from './composer';
import { hasDashPunctuation, withoutDashPunctuation } from './dashes';
import { runGuards } from './guards';
import { FakeModelClient } from './models';
import { render } from './sender';

function fixture(): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: 'Hi, my kitchen tap is leaking', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

describe('withoutDashPunctuation', () => {
    it('makes the dashes in the first live replies commas', () => {
        expect(withoutDashPunctuation('thanks for getting in touch - sorry to hear about the tap')).toBe('thanks for getting in touch, sorry to hear about the tap');
        expect(withoutDashPunctuation('NG3 3EG - got that')).toBe('NG3 3EG, got that');
        expect(withoutDashPunctuation("Whereabouts are you - what's your postcode?")).toBe("Whereabouts are you, what's your postcode?");
    });

    it('treats an em dash, an en dash and a double hyphen the same, spaced or not', () => {
        for (const text of ['a leaking tap — no problem', 'a leaking tap—no problem', 'a leaking tap – no problem', 'a leaking tap -- no problem']) {
            expect(withoutDashPunctuation(text), text).toBe('a leaking tap, no problem');
        }
    });

    it('drops a dash that follows punctuation already there or ends a line', () => {
        expect(withoutDashPunctuation('Thanks Sam. - Whereabouts are you?')).toBe('Thanks Sam. Whereabouts are you?');
        expect(withoutDashPunctuation('Got it -\n\nWhereabouts are you?')).toBe('Got it\n\nWhereabouts are you?');
    });

    it('leaves hyphenated words, a range and a hyphen opening a line alone', () => {
        const kept = 'A follow-up visit for the set-up, 2-3 panels.\n- the washer';
        expect(withoutDashPunctuation(kept)).toBe(kept);
        expect(hasDashPunctuation(kept)).toBe(false);
        expect(withoutDashPunctuation('panels 2–3')).toBe('panels 2-3');
        expect(hasDashPunctuation('NG3 3EG - got that')).toBe(true);
    });
});

describe('no dash reaches a customer', () => {
    it('the composer is told to use a comma or a full stop, and its reply leaves with commas whatever it wrote', async () => {
        const file = fixture();
        const client = new FakeModelClient({
            composer: () => ({ reply: 'Thanks for getting in touch - sorry to hear about the tap.\n\nNG3 3EG — got that. A follow-up visit is fine.', factIds: [], kbIds: [] }),
        });
        const res = await compose({ file, party: file.parties[0], turn: file.turns[0], route: { turnKind: 'enquiry', subjects: ['scoping'], exceptions: [] }, specialists: [], fixedLines: [] }, client);
        expect(res.output?.reply).toBe('Thanks for getting in touch, sorry to hear about the tap.\n\nNG3 3EG, got that. A follow-up visit is fine.');
        expect(client.calls[0].system).toMatch(/use a comma or a full stop/);
        expect(client.calls[0].system).not.toMatch(/Plain hyphens only/);
    });

    it('renders none on any channel, and sends a person\'s own words as typed', () => {
        for (const channel of ['whatsapp', 'sms', 'email'] as const) {
            const r = render(channel, 'NG3 3EG - got that.\n\nWhereabouts are you — roughly?', { name: 'Sam' });
            expect(r.ok, channel).toBe(true);
            for (const b of r.bubbles) expect(hasDashPunctuation(b.text), `${channel}: ${b.text}`).toBe(false);
        }
        expect(render('whatsapp', 'NG3 3EG - got that.', { asTyped: true }).bubbles[0].text).toBe('NG3 3EG - got that.');
    });

    it('a reviewed row whose dash went out as a comma still passes the verbatim rail and the claim check', () => {
        const file = fixture();
        const words = "We're fully insured - public liability cover.";
        const g = runGuards({
            file, party: file.parties[0], turn: file.turns[0], reply: withoutDashPunctuation(words), factIds: [], kbIds: ['kb-insured'],
            kbRows: [{ id: 'kb-insured', approvedWords: words, reviewed: true }], fixedLines: [], proposedSubject: null, liveQuoteRefs: new Set(),
        });
        expect(g.guards.business_claim).toEqual({ result: 'pass', note: null });
    });
});
