/**
 * Contract 6: describe_media once per media and refused when not fetched; confirm_location;
 * readiness is job type and location, photos never required; next_question in the fixed order
 * with its refusals; offer_call's three refusals; regulated is gas and asbestos only.
 */
import { describe, expect, it } from 'vitest';
import { answered, ask, open, recordFact, type CaseFile, type Turn } from './case-file';
import { confirmLocation, describeMedia, nextQuestion, offerCall, readiness, regulated, workBesideRegulated } from './scoping-tools';
import { freezes, REGULATED_WITH_REST, regulatedWithRestReason } from '../service/hold-reasons';
import { moneyQuestionMatch, offersCall, regulatedMatch, regulatedNotGasMatch, scopingQuestionCount, textAsks } from './lexicon';

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
    it('tells asbestos and an artex ceiling apart from gas, so the gas line never answers them (service/hold-reasons.ts)', () => {
        for (const body of ['there is asbestos in the garage roof', 'Can you skim over my artex ceiling?', 'do I need an artex test first']) {
            expect(regulatedMatch(body), body).not.toBeNull();
            expect(regulatedNotGasMatch(body), body).not.toBeNull();
        }
        for (const body of ['my gas hob has stopped', 'the boiler is making a noise', 'My combi keeps losing pressure', 'The pilot light keeps going out', 'a socket has stopped working']) {
            expect(regulatedNotGasMatch(body), body).toBeNull();
        }
    });
    it('reads a combi, a pilot light and a flue beside a gas word as gas, but not a combi oven, microwave or drill, or a wood burner\'s flue', () => {
        const t = (body: string): Turn => ({ ...fixture(body).turns[0] });
        for (const body of ['My combi keeps losing pressure', 'My combi boiler is not firing up and there is no hot water', 'I need a new cupboard built in the hall and my boiler serviced', 'Fitted a new box shelf last week, now my boiler is leaking water', 'The kitchen cupboard hinge is loose, and my combi keeps losing pressure', 'can you box in the pipes under my boiler', "the combi's lost pressure again", 'my combi flue is leaking', 'the boiler flue is dripping', 'the flue on my gas fire is loose', 'The pilot light keeps going out', 'both pilot lights are out']) {
            expect(regulated(t(body)).regulated, body).toBe(true);
        }
        for (const body of ['can you fit a combi oven', 'my combi microwave bracket fell off', 'can I borrow your combi drill', 'the flue pipe on my wood burner', 'the chimney flue needs sweeping', 'Need the stove flue looked at', 'the boiler cupboard needs a new door', 'The door on my combi boiler cupboard has come off its hinges', 'Can you build a casing for my combi', 'my combination lock is stuck', 'it has a big influence on the price']) {
            expect(regulated(t(body)).regulated, body).toBe(false);
        }
    });
});

describe('lexicon', () => {
    it('reads a money question but not an enquiry for a quote', () => {
        expect(moneyQuestionMatch('How much roughly?')).toBeTruthy();
        expect(moneyQuestionMatch('Can you do it any cheaper?')).toBeTruthy();
        expect(moneyQuestionMatch('Hi, can I get a quote for a leaking tap?')).toBeNull();
    });
    it('reads haggling in everyday words as money, but not job talk that looks like it', () => {
        for (const body of [
            'Is that the best you can do?', 'Any wiggle room on that?', "That's a bit steep isn't it", 'Can you do it for less than that?', 'Would you do it for less than 150?', "That's a bit dear", "That's over my budget", 'My budget is 200', "I'm on a tight budget", 'Can you do it for £100?', 'You quoted me £150, any cheaper?',
            'Someone else quoted me 80 for it', 'Can you match 90?', 'Could you do mates rates?', 'Can I pay cash for less?', 'Can you do any better on that?',
            'Can you go any lower?', 'Can you go any lower on the price?', 'Could you go any lower on the price?', 'Can you go lower than 150?', 'Is there any room to move on that?', 'That seems a lot for a tap', 'Any chance of a deal if I book two jobs?',
            'Do you do a pensioner rate?', 'Can you do it for 100?', 'Would you take 120?', 'Can you accept 90?', 'Would u take 80 cash?', 'Can you knock a tenner off?', 'Would you do 150 cash?',
            'Too pricey for me', 'Can you meet me halfway?', 'That is a bit steep for a tap', 'Too dear for me', 'Can you do it for less money?', 'Is that negotiable?', 'Can I pay in instalments?', 'Could you knock some off?',
        ]) {
            expect(moneyQuestionMatch(body), body).toBeTruthy();
        }
        for (const body of [
            'Any news on the quote?', 'Can you match the paint colour?', 'Could you lower the shelf a bit?', "I'll take it", 'The drip is a lot worse today',
            'Can you do any better than a patch repair?', "That's a lot better, thanks", "That's a lot of water", "It'll take 20 minutes",
            'Can you do it for 2 hours on Friday?', 'Can you take 3 of the old doors away?', 'Dear Ben, my tap drips', 'Is there any room to move the wardrobe?',
            'Could you knock the old tiles off?', 'I can take 2 photos when I get home', 'It will take 2 people to lift', 'Could you do it for 3 doors?', 'Will it take 45?', 'The job should take 30.', 'the old shed can take 30.',
            'I can take 20 photos if you like', 'what budget hinges do you use', 'you quoted me last week for the shelves, can you also do the gate', 'Can you do it for 10am?', "We'll go lower on the shelf height", 'Sounds a lot like a washer',
            'The roof is quite steep, can you still do the gutters?', 'the stairs are very steep', 'The mirror is too high, could it go lower?',
            'Can you do the shelf for less than an hour?', 'We paid for less work last time',
            'The roof is a bit steep, will you need scaffolding?', 'Could you go lower with the TV bracket?',
            'Can the TV go any lower on the wall?', 'Could the shelf go any lower?', 'Can you go any lower with the TV bracket?',
        ]) {
            expect(moneyQuestionMatch(body), body).toBeNull();
        }
    });
    it('reads a call offer and its negation, and an ask of a subject outside a dismissive clause', () => {
        expect(offersCall('Happy to give you a quick call if easier.')).toBeTruthy();
        expect(offersCall("No problem, we won't call you, text is fine.")).toBeNull();
        expect(offersCall('Or I can ring you if that is easier?')).toBeTruthy();
        expect(offersCall('We can chat over the phone if you prefer.')).toBeTruthy();
        // A call that already happened, or was tried, is not an offer, and a question beside it is still about the job.
        expect(offersCall('As we discussed on the phone, could you send a photo?')).toBeNull();
        expect(offersCall('Great speaking to you on the phone.')).toBeNull();
        expect(offersCall('We tried to call you back but no luck.')).toBeNull();
        expect(scopingQuestionCount('As we discussed on the phone, could you send a photo?')).toBe(1);
        expect(offersCall('Happy to give you a quick call this morning if easier?')).toBeTruthy();
        expect(offersCall("We're trying to fit you in Thursday so Ben will call you tomorrow to confirm.")).toBeTruthy();
        expect(offersCall('I tried to find a slot and can give you a ring later if easier?')).toBeTruthy();
        expect(scopingQuestionCount('I tried to find a slot and can give you a ring later if easier?')).toBe(0);
        expect(offersCall('As I said I can give you a ring tomorrow.')).toBeTruthy();
        expect(offersCall('I spoke to Ben and he will call you tomorrow.')).toBeTruthy();
        for (const offer of [
            'Ben tried to call you earlier and will ring you again', 'Happy chatting on the phone if easier?',
            'Happy speaking to you on the phone if easier?', 'As I mentioned earlier a quick call might help.',
        ]) expect(offersCall(offer), offer).toBeTruthy();
        for (const past of [
            'Is that the door we talked about on the phone?', 'Did you get the quote after we spoke on the phone?',
            'Did the photos I mentioned on the phone come through?', 'As we discussed on the phone could you send a photo?',
            'Was it you I spoke to on the phone yesterday?',
        ]) {
            expect(offersCall(past), past).toBeNull();
            expect(scopingQuestionCount(past), past).toBe(1);
        }
        expect(offersCall('As we discussed yesterday on the phone, could you send a photo?')).toBeNull();
        expect(offersCall("We've spoken before on the phone.")).toBeNull();
        expect(scopingQuestionCount('Happy to give you a quick call this morning if easier?')).toBe(0);
        for (const past of [
            'As we spoke about on the phone, could you send a photo?', 'As we talked about on the phone, could you send a photo?',
            'We spoke earlier on the phone.', 'Thanks for chatting with me on the phone.',
        ]) expect(offersCall(past), past).toBeNull();
        expect(scopingQuestionCount('As we spoke about on the phone, could you send a photo?')).toBe(1);
        expect(scopingQuestionCount('As we talked about on the phone, could you send a photo?')).toBe(1);
        expect(scopingQuestionCount('Would a quick call help?')).toBe(0);
        expect(textAsks('If it is easy, could you send a photo?', 'media')).toBe(true);
        expect(textAsks('No worries about photos, what size is the tile?', 'media')).toBe(false);
        // Thanks for media in one clause and a job question in another is no ask for media.
        expect(textAsks('Thanks for sending the video, what size is the gap?', 'media')).toBe(false);
        expect(textAsks('Cheers for the photos, which wall is it going on?', 'media')).toBe(false);
        expect(textAsks('Thanks for the photo, could you send one of the whole door too?', 'media')).toBe(true);
        expect(textAsks('Thanks for the pics, could you pop another over of the hinge?', 'media')).toBe(true);
        expect(textAsks('Thanks for the photo. Could you send a video of it running?', 'media')).toBe(true);
        expect(textAsks('Whereabouts are you?', 'postcode')).toBe(true);
        expect(textAsks('Whereabouts does it catch when it sticks?', 'postcode')).toBe(false);
        expect(textAsks('Where is it sticking, top or side?', 'postcode')).toBe(false);
        expect(textAsks("What's your postcode?", 'postcode')).toBe(true);
        expect(scopingQuestionCount('Got it. Where does it catch? Top or side? Happy to give you a quick call if easier?')).toBe(2);
    });
});

describe('gas beside work we do (the ruling of 18 Sep 2026)', () => {
    it('takes the job type Scoping read as work we do only when it names none of the gas work', () => {
        expect(workBesideRegulated('boiler', 'repair a crack in the lounge ceiling')).toBe('repair a crack in the lounge ceiling');
        expect(workBesideRegulated('gas', 'put up two shelves')).toBe('put up two shelves');
        // A belt under the model, failing closed to the freeze.
        expect(workBesideRegulated('boiler', 'boiler removal and ceiling repair')).toBeNull();
        expect(workBesideRegulated('gas hob', 'hob replacement')).toBeNull();
        expect(workBesideRegulated('combi', 'new combi')).toBeNull();
        expect(workBesideRegulated('boiler', null)).toBeNull();
        expect(workBesideRegulated('boiler', '  ')).toBeNull();
    });

    it('a gas hold beside work we do answers the rest; every other fixed-line-only hold still freezes', () => {
        const beside = regulatedWithRestReason('boiler', 'ceiling repair');
        expect(beside).toContain(REGULATED_WITH_REST);
        expect(freezes({ exception: 'regulated', reason: beside })).toBe(false);
        expect(freezes({ exception: 'regulated', reason: 'regulated: boiler' })).toBe(true);
        // The marker counts only on a regulated hold: a complaint that took the card over freezes whatever it carries.
        expect(freezes({ exception: 'complaint', reason: `complaint: a mess; ${beside}` })).toBe(true);
        for (const e of ['refund', 'trust_doubt'] as const) expect(freezes({ exception: e, reason: e })).toBe(true);
        for (const e of ['money', 'callback', 'not_converging'] as const) expect(freezes({ exception: e, reason: e })).toBe(false);
        expect(freezes({ exception: null, reason: 'router_failed' })).toBe(false);
        expect(freezes(null)).toBe(false);
    });
});
