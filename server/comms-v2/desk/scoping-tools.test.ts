/**
 * Contract 6: describe_media once per media and refused when not fetched; confirm_location;
 * readiness is job type and location, photos never required; next_question in the fixed order
 * with its refusals; offer_call's three refusals; regulated is gas and asbestos only; kb_lookup
 * read-only and allowed to return nothing.
 */
import { describe, expect, it } from 'vitest';
import { answered, ask, open, recordFact, type CaseFile, type Turn } from './case-file';
import { confirmLocation, describeMedia, emptyKb, kbLookup, nextQuestion, offerCall, readiness, regulated } from './scoping-tools';
import { moneyQuestionMatch, offersCall, textAsks } from './lexicon';

function fixture(text = 'hi', media: Turn['media'] = []): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: media.length ? 'media' : 'text', body: text, media },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}
const thread = (file: CaseFile) => ({ kind: 'thread' as const, turnId: file.turns[0].id });

describe('describe_media', () => {
    it('describes each photo once, persists it on the turn, records the vision call, and refuses unfetched media', async () => {
        const file = fixture('the tap', [
            { id: 'm1', kind: 'image', mime: 'image/png', path: '/tmp/x.png', url: '/api/media/x.png', description: null },
            { id: 'm2', kind: 'image', mime: 'image/png', path: null, url: null, description: null },
        ]);
        let calls = 0;
        const describe = async () => { calls++; return { ok: true as const, description: 'kitchen mixer tap, dripping at the base', confidence: 'high' as const, model: 'gemini-3.6-flash', usage: { inputTokens: 500, outputTokens: 50 }, durationMs: 10 }; };
        const first = await describeMedia(file.turns[0], { describe, now: () => new Date('2026-09-11T10:00:01.000Z') });
        expect(first.described).toHaveLength(1);
        expect(first.failures).toEqual([{ mediaId: 'm2', reason: 'the media has not been fetched' }]);
        expect(first.calls[0]).toMatchObject({ role: 'vision', model: 'gemini-3.6-flash', inputTokens: 500, outputTokens: 50 });
        expect(file.turns[0].media[0].description?.description).toBe('kitchen mixer tap, dripping at the base');
        const again = await describeMedia(file.turns[0], { describe });
        expect(calls).toBe(1);
        expect(again.described).toHaveLength(1);
        expect(again.calls).toHaveLength(0);
    });
});

describe('confirm_location', () => {
    it('reads a full postcode with high confidence, an outward code medium, a named area low, nothing when ambiguous', () => {
        expect(confirmLocation("We're NG9 2AB.")).toMatchObject({ postcode: 'NG9 2AB', outward: 'NG9', confidence: 'high' });
        expect(confirmLocation('we are in the ng9 area')).toMatchObject({ postcode: null, outward: 'NG9', confidence: 'medium' });
        expect(confirmLocation('We live in Beeston')).toMatchObject({ postcode: null, outward: null, confidence: 'low', text: 'Beeston' });
        expect(confirmLocation('one 6ft panel')).toMatchObject({ postcode: null, outward: null, confidence: 'low', text: null });
    });
});

describe('readiness and next_question', () => {
    it('ready is job type and location both present; photos never required', () => {
        const file = fixture();
        expect(readiness(file)).toEqual({ ready: false, missing: ['job type', 'location'] });
        recordFact(file, { key: 'job_type', value: 'leaking tap', source: thread(file), by: 'scoping' });
        expect(readiness(file).ready).toBe(false);
        recordFact(file, { key: 'location', value: 'NG9 2AB', source: thread(file), by: 'scoping' });
        expect(readiness(file).ready).toBe(true);
    });
    it('asks in the fixed order job, location, access, photos, and never a subject asked and unanswered or photos twice', () => {
        const file = fixture();
        expect(nextQuestion(file)?.subject).toBe('job');
        recordFact(file, { key: 'job_type', value: 'leaking tap', source: thread(file), by: 'scoping' });
        expect(nextQuestion(file, ['which tap'])).toEqual({ subject: 'job', unknowns: ['which tap'] });
        ask(file, 'job');
        expect(nextQuestion(file, ['which tap'])?.subject).toBe('postcode');
        // Answered, and still unknowns: the job again, one detail at a time, up to the cap.
        answered(file, 'job');
        expect(nextQuestion(file, ['tap brand'])?.subject).toBe('job');
        ask(file, 'job'); answered(file, 'job'); ask(file, 'job'); answered(file, 'job');
        expect(nextQuestion(file, ['still more'])?.subject).toBe('postcode');
        expect(nextQuestion(file, [])?.subject).toBe('postcode');
        recordFact(file, { key: 'location', value: 'NG9 2AB', source: thread(file), by: 'scoping' });
        expect(nextQuestion(file)?.subject).toBe('access');
        ask(file, 'access');
        expect(nextQuestion(file)?.subject).toBe('media');
        ask(file, 'media');
        expect(nextQuestion(file)).toBeNull();
        recordFact(file, { key: 'access', value: 'parking outside', source: thread(file), by: 'scoping' });
        expect(nextQuestion(file)).toBeNull();
    });
    it('skips photos once received or declined', () => {
        const declined = fixture();
        recordFact(declined, { key: 'job_type', value: 'tile', source: thread(declined), by: 'scoping' });
        recordFact(declined, { key: 'location', value: 'NG7 2PQ', source: thread(declined), by: 'scoping' });
        recordFact(declined, { key: 'access', value: 'fine', source: thread(declined), by: 'scoping' });
        recordFact(declined, { key: 'media_declined', value: 'true', source: thread(declined), by: 'scoping' });
        expect(nextQuestion(declined)).toBeNull();
        const received = fixture('the tap', [{ id: 'm1', kind: 'image', mime: 'image/png', path: '/tmp/x', url: null, description: null }]);
        recordFact(received, { key: 'job_type', value: 'tile', source: thread(received), by: 'scoping' });
        recordFact(received, { key: 'location', value: 'NG7 2PQ', source: thread(received), by: 'scoping' });
        recordFact(received, { key: 'access', value: 'fine', source: thread(received), by: 'scoping' });
        expect(nextQuestion(received)).toBeNull();
    });
});

describe('offer_call and regulated', () => {
    it('refuses a call for a party who prefers text, has already rung, or has been offered one', () => {
        const p = fixture().parties[0];
        expect(offerCall(p)).toBe(true);
        expect(offerCall({ ...p, prefersText: true })).toBe(false);
        expect(offerCall({ ...p, alreadyRung: true })).toBe(false);
        expect(offerCall({ ...p, callOffered: true })).toBe(false);
    });
    it('is gas and asbestos only; plumbing, roofing, structural and electrical are ours', () => {
        const t = (body: string): Turn => ({ ...fixture(body).turns[0] });
        expect(regulated(t('my gas hob has stopped')).regulated).toBe(true);
        expect(regulated(t('there is asbestos in the garage roof')).regulated).toBe(true);
        expect(regulated(t('the boiler is making a noise')).regulated).toBe(true);
        expect(regulated(t('leaking pipe under the sink')).regulated).toBe(false);
        expect(regulated(t('a few roof tiles have slipped')).regulated).toBe(false);
        expect(regulated(t('a socket has stopped working and a wall needs a lintel')).regulated).toBe(false);
        expect(regulated(t('the boiler cupboard door is hanging off')).regulated).toBe(false);
    });
});

describe('kb_lookup', () => {
    it('is read-only and may return nothing', async () => {
        expect(await kbLookup('do you do weekends?', emptyKb)).toEqual([]);
        const rows = await kbLookup('are you insured?', { async list() { return [{ id: 'kb-insured', topic: 'insurance cover', approvedWords: 'We are fully insured.' }, { id: 'kb-hours', topic: 'opening hours', approvedWords: 'Weekdays.' }]; } });
        expect(rows.map((r) => r.id)).toEqual(['kb-insured']);
    });
});

describe('lexicon', () => {
    it('reads a money question but not an enquiry for a quote', () => {
        expect(moneyQuestionMatch('How much roughly?')).toBeTruthy();
        expect(moneyQuestionMatch('Can you do it any cheaper?')).toBeTruthy();
        expect(moneyQuestionMatch('Hi, can I get a quote for a leaking tap?')).toBeNull();
    });
    it('reads a call offer and its negation, and an ask of a subject outside a dismissive clause', () => {
        expect(offersCall('Happy to give you a quick call if easier.')).toBeTruthy();
        expect(offersCall("No problem, we won't call you, text is fine.")).toBeNull();
        expect(textAsks('If it is easy, could you send a photo?', 'media')).toBe(true);
        expect(textAsks('No worries about photos, what size is the tile?', 'media')).toBe(false);
        expect(textAsks('Whereabouts are you?', 'postcode')).toBe(true);
    });
});
