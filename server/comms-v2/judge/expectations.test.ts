import { describe, expect, it } from 'vitest';
import { UNAVAILABLE, allGuardsUnavailable, type PlannedSend } from './planned-send';
import { ARTEFACT_REASON, POST_SEND_DEPENDENT, UNAVAILABLE_REASON, WINDOW_SEED_REASON, asksSubject, evaluate, offersCall, scopingQuestionCount, type EvalContext } from './expectations';
import { seedSchema, type Expectation } from './scenario';

function ps(over: Partial<PlannedSend> = {}): PlannedSend {
    return {
        caseId: 'conv_1', party: { role: 'homeowner', address: '+447700900942', name: 'Sam' }, channel: 'whatsapp', windowState: 'open',
        templateId: null, bubbles: ['Thanks for the message about the tap.', 'Whereabouts are you?'], factIds: UNAVAILABLE, kbIds: UNAVAILABLE,
        guards: allGuardsUnavailable('test'), approver: 'scoper', runId: 'run_1', hold: null, delivered: true, origin: 'desk',
        evidence: { decision: 'send', intent: 'ask_gap', lane: 'scoper', pack: 'customer.default', stageAfter: 'scoping', exitNote: null, legacyGuardsHit: [], legacyGuardNotes: [], mirrorLiveWouldSend: null, error: null },
        ...over,
    };
}

function ctx(over: Partial<EvalContext> = {}): EvalContext {
    return { plannedSend: ps(), history: [], seed: seedSchema.parse({}), seedUnsupported: [], priorSendNotLanded: false, ...over };
}

const silent = (): PlannedSend => ps({ bubbles: [], delivered: false, origin: 'none', evidence: { ...ps().evidence, decision: 'pending' } });

const e = (x: Record<string, unknown>): Expectation => ({ line: '2.1', ...x } as Expectation);

describe('reply sent or not', () => {
    it('reply_sent passes on a delivered send and fails on silence', () => {
        expect(evaluate(e({ kind: 'reply_sent' }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'reply_sent' }), ctx({ plannedSend: silent() })).status).toBe('fail');
    });
    it('reply_not_sent is the inverse', () => {
        expect(evaluate(e({ kind: 'reply_not_sent' }), ctx()).status).toBe('fail');
        expect(evaluate(e({ kind: 'reply_not_sent' }), ctx({ plannedSend: silent() })).status).toBe('pass');
    });
});

describe('subjects', () => {
    it('finds a postcode ask and a media ask', () => {
        expect(asksSubject(ps(), 'postcode')).toBe(true);
        expect(asksSubject(ps(), 'media')).toBe(false);
        expect(asksSubject(ps({ bubbles: ['Could you send a quick photo of the tap?'] }), 'media')).toBe(true);
        expect(asksSubject(ps({ bubbles: ['Thanks for the photo, that is clear.'] }), 'media')).toBe(false);
    });
    it('a subject word and an asking phrase anywhere in one sentence is an ask, across clauses', () => {
        for (const t of ['Photos would really help, any chance you could send one?', 'Got a photo, by any chance?', 'Thanks for that, could you send a photo of the tile?', 'Any chance of a photo, or a quick video?']) {
            expect(asksSubject(ps({ bubbles: [t] }), 'media'), t).toBe(true);
        }
        const twice = ps({ bubbles: ['Photos would really help, any chance you could send one?'] });
        expect(evaluate(e({ kind: 'asked_at_most_once', subject: 'media' }), ctx({ plannedSend: twice, history: [ps({ bubbles: ['Can you send a photo?'] })] })).status).toBe('fail');
    });
    it('a subject mentioned only in a dismissive clause is not an ask: waving photos away beside a tile-size question', () => {
        const tile = ps({ bubbles: ['No worries about photos, could you tell me roughly the tile size?'] });
        expect(asksSubject(tile, 'media')).toBe(false);
        expect(asksSubject(tile, 'any')).toBe(true);
        expect(evaluate(e({ kind: 'not_asks_subject', subject: 'media' }), ctx({ plannedSend: tile })).status).toBe('pass');
        expect(evaluate(e({ kind: 'asked_at_most_once', subject: 'media' }), ctx({ plannedSend: tile, history: [ps({ bubbles: ['Can you send a photo?'] })] })).status).toBe('pass');
        for (const t of ["Don't worry about a photo, whereabouts are you?", 'No need for pictures; which road is it?', 'Forget the photos: is there parking outside?']) {
            expect(asksSubject(ps({ bubbles: [t] }), 'media'), t).toBe(false);
        }
    });
    it('a negated reminder is not dismissive: do not forget the photo is an ask', () => {
        for (const t of ['Do not forget the photo, could you pop one over?', "Don't forget the photo, could you pop one over?"]) {
            const reminder = ps({ bubbles: [t] });
            expect(asksSubject(reminder, 'media'), t).toBe(true);
            expect(evaluate(e({ kind: 'asked_at_most_once', subject: 'media' }), ctx({ plannedSend: reminder, history: [ps({ bubbles: ['Can you send a photo?'] })] })).status, t).toBe('fail');
        }
        expect(asksSubject(ps({ bubbles: ['No worries about photos, could you tell me roughly the tile size?'] }), 'media')).toBe(false);
    });
    it('any means any question', () => {
        expect(asksSubject(ps(), 'any')).toBe(true);
        expect(asksSubject(ps({ bubbles: ['Great, Ben will be in touch.'] }), 'any')).toBe(false);
    });
    it('handoff is Ben coming back', () => {
        expect(asksSubject(ps({ bubbles: ['Ben will come back to you on the price.'] }), 'handoff')).toBe(true);
    });
    it('asks_subject / not_asks_subject', () => {
        expect(evaluate(e({ kind: 'asks_subject', subject: 'postcode' }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'not_asks_subject', subject: 'media' }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'not_asks_subject', subject: 'postcode' }), ctx()).status).toBe('fail');
        expect(evaluate(e({ kind: 'asks_subject', subject: 'any' }), ctx({ plannedSend: silent() })).status).toBe('fail');
    });
    it('asked_at_most_once reads the history', () => {
        const photoAsk = ps({ bubbles: ['Can you send a photo?'] });
        expect(evaluate(e({ kind: 'asked_at_most_once', subject: 'media' }), ctx({ plannedSend: photoAsk, history: [] })).status).toBe('pass');
        expect(evaluate(e({ kind: 'asked_at_most_once', subject: 'media' }), ctx({ plannedSend: photoAsk, history: [photoAsk] })).status).toBe('fail');
        expect(evaluate(e({ kind: 'asked_at_most_once', subject: 'media' }), ctx({ plannedSend: ps(), history: [photoAsk] })).status).toBe('pass');
    });
});

describe('figures, dates, commitments', () => {
    it('no_figure', () => {
        expect(evaluate(e({ kind: 'no_figure' }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'no_figure' }), ctx({ plannedSend: ps({ bubbles: ['Usually around £120 for that.'] }) })).status).toBe('fail');
        expect(evaluate(e({ kind: 'no_figure' }), ctx({ plannedSend: ps({ bubbles: ['About 80 quid.'] }) })).status).toBe('fail');
        expect(evaluate(e({ kind: 'no_figure' }), ctx({ plannedSend: ps({ bubbles: ['We are in NG7 2PQ, 20cm tile.'] }) })).status).toBe('pass');
    });
    it('no_date catches dates, times and lead times', () => {
        for (const t of ['We can come Tuesday.', 'Probably within 3 days.', 'Around 2 hours on site.', 'First thing tomorrow.', 'At 9am.', 'The lead time is short.']) {
            expect(evaluate(e({ kind: 'no_date' }), ctx({ plannedSend: ps({ bubbles: [t] }) })).status, t).toBe('fail');
        }
        expect(evaluate(e({ kind: 'no_date' }), ctx({ plannedSend: ps({ bubbles: ['Dates come with your quote. Whereabouts are you?'] }) })).status).toBe('pass');
    });
    it('no_commitment catches promises and admissions', () => {
        for (const t of ["We'll fix it no problem.", 'We guarantee the work.', 'That was our fault, sorry.', 'Free of charge.']) {
            expect(evaluate(e({ kind: 'no_commitment' }), ctx({ plannedSend: ps({ bubbles: [t] }) })).status, t).toBe('fail');
        }
        expect(evaluate(e({ kind: 'no_commitment' }), ctx()).status).toBe('pass');
    });
});

describe('holds, templates, window, stage, bubbles, fixed line', () => {
    it('hold_for_approver', () => {
        const held = ps({ hold: { approver: 'ben', reason: 'money_question', since: null }, delivered: false, bubbles: [] });
        expect(evaluate(e({ kind: 'hold_for_approver', approver: 'Ben' }), ctx({ plannedSend: held })).status).toBe('pass');
        expect(evaluate(e({ kind: 'hold_for_approver', approver: 'landlord' }), ctx({ plannedSend: held })).status).toBe('fail');
        expect(evaluate(e({ kind: 'hold_for_approver', approver: 'ben' }), ctx()).status).toBe('fail');
        expect(evaluate(e({ kind: 'no_hold' }), ctx({ plannedSend: held })).status).toBe('fail');
        expect(evaluate(e({ kind: 'no_hold' }), ctx()).status).toBe('pass');
    });
    it('template_used and freeform', () => {
        expect(evaluate(e({ kind: 'freeform' }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'template_used' }), ctx()).status).toBe('fail');
        const tpl = ps({ templateId: 'post_call_continuation' });
        expect(evaluate(e({ kind: 'template_used' }), ctx({ plannedSend: tpl })).status).toBe('pass');
        expect(evaluate(e({ kind: 'template_used', templateId: 'other' }), ctx({ plannedSend: tpl })).status).toBe('fail');
        expect(evaluate(e({ kind: 'freeform' }), ctx({ plannedSend: tpl })).status).toBe('fail');
    });
    it('window_state and stage_after', () => {
        expect(evaluate(e({ kind: 'window_state', state: 'open' }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'window_state', state: 'shut' }), ctx()).status).toBe('fail');
        expect(evaluate(e({ kind: 'stage_after', stage: 'scoping' }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'stage_after', stage: 'ready' }), ctx()).status).toBe('fail');
    });
    it('bubble_count_within', () => {
        expect(evaluate(e({ kind: 'bubble_count_within', max: 4 }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'bubble_count_within', max: 1 }), ctx()).status).toBe('fail');
        expect(evaluate(e({ kind: 'bubble_count_within', max: 4 }), ctx({ plannedSend: silent() })).status).toBe('fail');
    });
    it('fixed_line and text_matches', () => {
        expect(evaluate(e({ kind: 'fixed_line', text: 'Whereabouts are you?' }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'fixed_line', text: 'Ben will come back to you' }), ctx()).status).toBe('fail');
        expect(evaluate(e({ kind: 'text_matches', pattern: '\\btap\\b' }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'text_matches', pattern: '\\bfan\\b' }), ctx()).status).toBe('fail');
    });
});

describe('call offers', () => {
    it('recognises the ways a call is offered', () => {
        for (const t of ['Happy to give you a quick call if easier?', 'Shall we ring you?', 'Is it ok if we call you?', 'A quick call might help.', 'Easiest to have a chat on the phone.']) {
            expect(offersCall(ps({ bubbles: [t] })), t).toBe(true);
        }
        expect(offersCall(ps())).toBe(false);
        expect(offersCall(ps({ bubbles: ['No call-out fee for that.'] }))).toBe(false);
    });
    it('offers_call / not_offers_call', () => {
        const offer = ps({ bubbles: ['Thanks. Would a quick call help, or a photo if easy?'] });
        expect(evaluate(e({ kind: 'offers_call' }), ctx({ plannedSend: offer })).status).toBe('pass');
        expect(evaluate(e({ kind: 'not_offers_call' }), ctx({ plannedSend: offer })).status).toBe('fail');
        expect(evaluate(e({ kind: 'not_offers_call' }), ctx()).status).toBe('pass');
        expect(evaluate(e({ kind: 'not_offers_call' }), ctx({ plannedSend: silent() })).status).toBe('pass');
    });
});

describe('own_words (deterministic half)', () => {
    const ow = (): Expectation => ({ line: '2.3', kind: 'own_words' });
    it('passes on exactly one scoping question, a call offer not counted', () => {
        expect(scopingQuestionCount(ps({ bubbles: ['Thanks. Whereabouts are you?', 'Would a quick call help?'] }))).toBe(1);
        expect(evaluate(ow(), ctx({ plannedSend: ps({ bubbles: ['Thanks. Whereabouts are you?', 'Would a quick call help?'] }) })).status).toBe('pass');
    });
    it('fails on two questions at once, on a placeholder, and on silence', () => {
        expect(evaluate(ow(), ctx({ plannedSend: ps({ bubbles: ['Whereabouts are you? Can you send a photo?'] }) })).status).toBe('fail');
        expect(evaluate(ow(), ctx({ plannedSend: ps({ bubbles: ['Hi {{1}}, where are you?'] }) })).status).toBe('fail');
        expect(evaluate(ow(), ctx({ plannedSend: silent() })).status).toBe('fail');
    });
});

describe('unavailable fields and unsupported seeds', () => {
    it('an expectation on an unavailable field fails with the fixed reason, never errors', () => {
        const un = ps({ hold: UNAVAILABLE, templateId: UNAVAILABLE, windowState: UNAVAILABLE, evidence: { ...ps().evidence, stageAfter: null } });
        for (const x of [{ kind: 'hold_for_approver', approver: 'ben' }, { kind: 'no_hold' }, { kind: 'template_used' }, { kind: 'freeform' }, { kind: 'window_state', state: 'open' }, { kind: 'stage_after', stage: 'scoping' }]) {
            const r = evaluate(e(x), ctx({ plannedSend: un }));
            expect(r.status, x.kind).toBe('fail');
            expect(r.reason, x.kind).toBe(UNAVAILABLE_REASON);
        }
    });
    it('a shut-window seed the door could not honour fails the window-dependent kinds with the fixed reason', () => {
        const c = ctx({ seed: seedSchema.parse({ window: 'shut' }), seedUnsupported: ['window'] });
        for (const x of [{ kind: 'template_used' }, { kind: 'freeform' }, { kind: 'window_state', state: 'shut' }]) {
            const r = evaluate(e(x), c);
            expect(r.status, x.kind).toBe('fail');
            expect(r.reason, x.kind).toBe(WINDOW_SEED_REASON);
        }
        // Text assertions do not depend on the window and still judge the text.
        expect(evaluate(e({ kind: 'reply_sent' }), c).status).toBe('pass');
    });
    it('an open-window seed never trips the window reason', () => {
        expect(evaluate(e({ kind: 'freeform' }), ctx({ seedUnsupported: ['window'] })).status).toBe('pass');
    });
    it('after a planned reply the door never landed, only the post-send-dependent kinds fail with the artefact reason', () => {
        const c = ctx({ plannedSend: silent(), history: [ps({ bubbles: ['Can you send a photo?'] })], priorSendNotLanded: true });
        expect(Array.from(POST_SEND_DEPENDENT).sort()).toEqual(['asked_at_most_once', 'not_asks_subject', 'reply_not_sent']);
        for (const x of [{ kind: 'reply_not_sent' }, { kind: 'not_asks_subject', subject: 'media' }, { kind: 'asked_at_most_once', subject: 'media' }]) {
            const r = evaluate(e(x), c);
            expect(r.status, x.kind).toBe('fail');
            expect(r.reason, x.kind).toBe(ARTEFACT_REASON);
        }
        expect(evaluate(e({ kind: 'reply_sent' }), c).status).toBe('fail');
        expect(evaluate(e({ kind: 'reply_sent' }), c).reason).not.toBe(ARTEFACT_REASON);
        expect(evaluate(e({ kind: 'no_figure' }), c).status).toBe('pass');
        expect(evaluate(e({ kind: 'reply_not_sent' }), ctx({ plannedSend: silent(), priorSendNotLanded: false })).status).toBe('pass');
    });
});
