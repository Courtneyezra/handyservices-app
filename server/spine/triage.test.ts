/**
 * Phase 2 vitest: triage rules-first, with a fake model. No database (writeConversation/persist off).
 */
import { describe, it, expect } from 'vitest';
import { triage, triageRules, mergeTriage, TriageModelSchema } from './triage';
import type { CaseFile, TimelineItem } from './types';

function cf(over: Partial<CaseFile> = {}, timeline: TimelineItem[] = []): CaseFile {
    return {
        conversationId: 'c1', phone: '+447700123456', audience: 'customer', stage: 'enquiry', contactName: 'Sam',
        timeline, media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: new Date().toISOString(), channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: new Date().toISOString(),
        ...over,
    };
}
const inbound = (body: string, extra: Partial<TimelineItem> = {}): TimelineItem => ({ at: new Date().toISOString(), kind: 'message_in', channel: 'whatsapp', body, by: 'customer', ...extra });
const outbound = (body: string): TimelineItem => ({ at: new Date(Date.now() - 60_000).toISOString(), kind: 'message_out', channel: 'whatsapp', body });

describe('triageRules', () => {
    it('drops an opt-out', () => {
        const r = triageRules(cf({}, [outbound('hi'), inbound('STOP')]));
        expect(r.lane).toBe('dropped'); expect(r.exceptions).toEqual(['opted_out']);
    });
    it('drops spam', () => {
        const r = triageRules(cf({}, [outbound('hi'), inbound('We can rank your website on page one of google')]));
        expect(r.lane).toBe('dropped'); expect(r.exceptions).toEqual(['spam']);
    });
    it('routes money to Ben as money_question', () => {
        const r = triageRules(cf({}, [outbound('hi'), inbound('how much would that cost?')]));
        expect(r.lane).toBe('ben'); expect(r.exceptions).toContain('money_question'); expect(r.source).toBe('rules');
    });
    it('routes dates to Ben as date_question', () => {
        const r = triageRules(cf({}, [outbound('hi'), inbound('what day could you come next week?')]));
        expect(r.lane).toBe('ben'); expect(r.exceptions).toContain('date_question');
    });
    it('routes a complaint and a refund to Ben, refund winning', () => {
        expect(triageRules(cf({}, [outbound('hi'), inbound("I'm really not happy with the finish")])).exceptions).toContain('complaint');
        const r = triageRules(cf({}, [outbound('hi'), inbound('I want a refund, this is terrible')]));
        expect(r.exceptions).toContain('refund'); expect(r.exceptions).not.toContain('complaint');
    });
    it('routes a callback request to Ben and tags it', () => {
        const r = triageRules(cf({}, [outbound('hi'), inbound('can you call me about this')]));
        expect(r.lane).toBe('ben'); expect(r.exceptions).toContain('callback_requested'); expect(r.tags).toContain('callback_requested');
    });
    it('routes regulated trades to Ben', () => {
        const r = triageRules(cf({}, [outbound('hi'), inbound('my boiler is leaking, can you fix it')]));
        expect(r.exceptions).toContain('regulated_trade');
    });
    it('treats a thread with no outbound as first contact → rules lane, ack_photos when media came with it', () => {
        expect(triageRules(cf({}, [inbound('hi, need some shelves put up')]))).toMatchObject({ lane: 'rules', intent: 'ack_enquiry' });
        expect(triageRules(cf({}, [inbound('here you go', { mediaIds: ['m1'] })]))).toMatchObject({ lane: 'rules', intent: 'ack_photos' });
    });
    it('does NOT drop a non-UK number (decided 2 Sep)', () => {
        const r = triageRules(cf({ phone: '+33612345678' }, [inbound('hello, do you do flat pack?')]));
        expect(r.lane).not.toBe('dropped'); expect(r.lane).toBe('rules');
    });
    it('routes an unpaid quote to post_quote and needs_quote to the clerk', () => {
        expect(triageRules(cf({ stage: 'quote_sent', quote: { slug: 'abc123', lines: 2, paid: false } }, [outbound('quote link'), inbound('thanks, will have a look')])).lane).toBe('post_quote');
        expect(triageRules(cf({ tags: ['needs_quote'] }, [outbound('hi'), inbound('that is everything')])).lane).toBe('quote_clerk');
    });
    it('sends a trust_concern thread to Ben and a contractor thread to the contractor lane', () => {
        expect(triageRules(cf({ tags: ['trust_concern'] }, [outbound('hi'), inbound('ok')])).lane).toBe('ben');
        expect(triageRules(cf({ audience: 'contractor' }, [outbound('job brief'), inbound('on my way')])).lane).toBe('contractor');
    });
    it('defaults to the scoper', () => {
        expect(triageRules(cf({}, [outbound('hi'), inbound('the tap is in the kitchen')])).lane).toBe('scoper');
    });
});

describe('triage (rules + model)', () => {
    const quiet = { writeConversation: false, persist: false } as const;
    it('does not call the model when the rules found an exception', async () => {
        let called = 0;
        const r = await triage(cf({}, [outbound('hi'), inbound('how much?')]), { ...quiet, llm: async () => { called++; return { data: {}, usage: null, model: 'x' }; } });
        expect(called).toBe(0); expect(r.source).toBe('rules'); expect(r.lane).toBe('ben');
    });
    it('uses the model when the rules found nothing, and lets it add an exception', async () => {
        const r = await triage(cf({}, [outbound('hi'), inbound('the tap is in the kitchen')]), {
            ...quiet, llm: async () => ({ data: { audience: 'customer', intent: 'clarify_scope', lane: 'scoper', exceptions: ['out_of_scope'], stage: 'scoping', tags: ['tap'], reasons: ['asked about a tap'] }, usage: null, model: 'claude-haiku-4-5' }),
        });
        expect(r.source).toBe('model'); expect(r.lane).toBe('ben'); expect(r.exceptions).toEqual(['out_of_scope']); expect(r.intent).toBe('clarify_scope'); expect(r.tags).toContain('tap');
    });
    it('falls back to the rules result when the model output fails the schema, and says so', async () => {
        const r = await triage(cf({}, [outbound('hi'), inbound('the tap is in the kitchen')]), { ...quiet, llm: async () => ({ data: { lane: 'made_up' }, usage: null, model: 'x' }) });
        expect(r.source).toBe('rules'); expect(r.lane).toBe('scoper'); expect(r.reasons.some((x) => /failed schema/.test(x))).toBe(true);
    });
    it('falls back when the model call throws', async () => {
        const r = await triage(cf({}, [outbound('hi'), inbound('the tap is in the kitchen')]), { ...quiet, llm: async () => { throw new Error('boom'); } });
        expect(r.source).toBe('rules'); expect(r.reasons.some((x) => /boom/.test(x))).toBe(true);
    });
    it('never lets the model set stage won or remove a rules exception', () => {
        const rules = triageRules(cf({}, [outbound('hi'), inbound('ok')]));
        const parsed = TriageModelSchema.parse({ audience: 'customer', intent: 'closing', lane: 'scoper', exceptions: [], stage: 'won', tags: [], reasons: [] });
        const merged = mergeTriage({ ...rules, exceptions: ['complaint'], lane: 'ben' }, parsed, 'm');
        expect(merged.stage).toBe(rules.stage); expect(merged.lane).toBe('ben'); expect(merged.exceptions).toEqual(['complaint']);
    });
});

// ---------------------------------------------------------------- P7: promised more, model clamp, the merge guard

import { customerPromisedMore, clampTriageModelOutput, RE_PROMISED_MORE } from './triage';

describe('P7 customer promised more', () => {
    it('detects the promise phrases on the customer side', () => {
        for (const t of ["That's the only cladding, back soon with measurement", 'will send the photos tonight', 'sending now', 'one sec', 'hang on', 'bear with me', 'give me a minute', 'let me get the tape', "I'll get you the size", 'in a minute', 'shortly']) {
            expect(customerPromisedMore(t), t).toBe(true);
        }
        for (const t of ['how much would it cost', 'can you come tuesday', 'thanks!', '', 'the tap is in the kitchen']) {
            expect(customerPromisedMore(t), t).toBe(false);
        }
        expect(RE_PROMISED_MORE.test('The soonest slot?')).toBe(false); // "soonest" is a date word, not a promise
    });
    it('triageRules flags customerPromisedMore and does NOT route the incident sentence to Ben', () => {
        const r = triageRules(cf({}, [outbound('Could you send the measurement?'), inbound("That's the only cladding, back soon with measurement")]));
        expect(r.customerPromisedMore).toBe(true);
        expect(r.lane).toBe('scoper');
        expect(r.exceptions).toEqual([]);
        expect(r.reasons).toContain('customer promised more is coming');
    });
    it('a call transcript or a contractor thread cannot promise more', () => {
        expect(triageRules(cf({}, [outbound('hi'), { at: new Date().toISOString(), kind: 'call_in', channel: 'call', by: 'customer', transcript: 'back soon with the measurement' }])).customerPromisedMore).toBe(false);
        expect(triageRules(cf({ audience: 'contractor' }, [outbound('hi'), inbound('back soon with the measurement')])).customerPromisedMore).toBe(false);
    });
    it('the merge drops a model-only date_question when the customer promised more and the rules found no date', () => {
        const rules = triageRules(cf({}, [outbound('hi'), inbound("That's the only cladding, back soon with measurement")]));
        const model = { audience: 'customer', intent: 'unknown', lane: 'ben', exceptions: ['date_question'], stage: 'scoping', tags: [], reasons: ['mentions soon'] } as any;
        const merged = mergeTriage(rules, model, 'haiku');
        expect(merged.exceptions).toEqual([]);
        expect(merged.lane).not.toBe('ben');
        expect(merged.customerPromisedMore).toBe(true);
        // A real date question keeps its exception even with a promise in the same message.
        const rules2 = triageRules(cf({}, [outbound('hi'), inbound('what day can you come? back soon with the measurement')]));
        expect(mergeTriage(rules2, model, 'haiku').exceptions).toContain('date_question');
        // And a model money_question is never dropped by the promise.
        expect(mergeTriage(rules, { ...model, exceptions: ['money_question'] }, 'haiku').exceptions).toEqual(['money_question']);
    });
    it('clampTriageModelOutput trims a long reason to 200 chars instead of failing the schema', () => {
        const long = 'x'.repeat(350);
        const raw = { audience: 'customer', intent: 'ask_gap', lane: 'scoper', exceptions: [], stage: 'scoping', tags: ['A'.repeat(40), 'ok'], reasons: [long, 'fine', 1, '', 'a', 'b', 'c', 'd', 'e'] };
        expect(TriageModelSchema.safeParse(raw).success).toBe(false);
        const parsed = TriageModelSchema.safeParse(clampTriageModelOutput(raw));
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.reasons[0]).toHaveLength(200);
            expect(parsed.data.reasons).toHaveLength(6);
            expect(parsed.data.tags[0]).toHaveLength(30);
            expect(parsed.data.tags[1]).toBe('ok');
        }
        expect(clampTriageModelOutput(null)).toBeNull();
    });
});

// ---------------------------------------------------------------- P9: a scope increase is not out_of_scope

import { looksLikeRescope, TRIAGE_SYSTEM } from './triage';

describe('P9 rescope pre-check', () => {
    const quote = { slug: 'q1', total: 569, lines: 3, viewedAt: '2026-09-01T10:00:00Z', expiresAt: null, paid: false };
    const sarah = (text: string, over: Partial<CaseFile> = {}) => cf({ quote, stage: 'quote_sent', ...over }, [outbound('Your quote for the 3 doors is ready: https://handyservices.app/quote/q1'), inbound(text, { mediaIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] })]);

    it('looksLikeRescope needs a scope word AND a job noun', () => {
        for (const t of ['Actually can you do all 9 doors instead of 3, photos attached', 'Could you add another two lights while you are here', 'Instead of the shelf can you fit the wardrobe', 'We want the rest of the windows done as well', 'Can you do the whole kitchen, not just the sink']) {
            expect(looksLikeRescope(t), t).toBe(true);
        }
        for (const t of ['all good thanks', 'is another day better?', 'how much extra would that be', 'yes please go ahead', '', 'more info: the postcode is NG3 7EG']) {
            expect(looksLikeRescope(t), t).toBe(false);
        }
    });
    it("Sarah's case: a quote out, 'all 9 doors' with six photos → tag rescope, lane scoper, no exception", () => {
        const r = triageRules(sarah('Actually could you quote for all 9 doors instead of just the 3? Photos attached'));
        expect(r.lane).toBe('scoper');
        expect(r.exceptions).toEqual([]);
        expect(r.tags).toContain('rescope');
        expect(r.reasons.join(' ')).toMatch(/scope change on quote q1/);
    });
    it('without a quote on the thread the same words are ordinary scoping, no rescope tag', () => {
        const r = triageRules(cf({}, [outbound('hi'), inbound('can you do all 9 doors instead of 3')]));
        expect(r.tags).not.toContain('rescope');
        expect(r.lane).toBe('scoper');
    });
    it('a real exception still wins: a price question or regulated work on a rescope goes to Ben', () => {
        expect(triageRules(sarah('all 9 doors instead, how much extra would that cost?')).exceptions).toContain('money_question');
        expect(triageRules(sarah('and can you swap the boiler as well as the doors')).exceptions).toContain('regulated_trade');
        expect(triageRules(sarah('the asbestos garage roof needs removing as well as the doors')).exceptions).toContain('regulated_trade');
    });
    it('needs_quote already on the thread still lanes the clerk (the redone quote is in progress)', () => {
        const r = triageRules(sarah('all 9 doors instead of 3 please', { tags: ['needs_quote'] }));
        expect(r.lane).toBe('quote_clerk');
    });
    it("the merge drops a model-only out_of_scope on a rescope and keeps the rules' lane; a rules exception is untouched", () => {
        const rules = triageRules(sarah('Actually could you quote for all 9 doors instead of just the 3? Photos attached'));
        const model = { audience: 'customer', intent: 'unknown', lane: 'ben', exceptions: ['out_of_scope'], stage: 'quote_sent', tags: ['photos_received'], reasons: ['customer wants 9 doors instead of 3, outside the original quote'] } as any;
        const merged = mergeTriage(rules, model, 'haiku');
        expect(merged.exceptions).toEqual([]);
        expect(merged.lane).toBe('scoper');
        expect(merged.tags).toEqual(expect.arrayContaining(['rescope', 'photos_received']));
        const money = { ...model, exceptions: ['out_of_scope', 'money_question'] };
        expect(mergeTriage(rules, money, 'haiku').exceptions).toEqual(['money_question']);
        // Not a rescope (no quote): the model's out_of_scope stands.
        const plain = triageRules(cf({}, [outbound('hi'), inbound('can you remove the asbestos garage')]));
        expect(mergeTriage({ ...plain, exceptions: [], lane: 'scoper' }, model, 'haiku').exceptions).toContain('out_of_scope');
    });
    it('the prompt defines out_of_scope precisely and names the rescope rule', () => {
        expect(TRIAGE_SYSTEM).toMatch(/out_of_scope means, precisely/);
        expect(TRIAGE_SYSTEM).toMatch(/NEVER means "more work than the quote covered"/);
        expect(TRIAGE_SYSTEM).toMatch(/tags "rescope" and "needs_quote", no exception/);
    });
});

describe('P15 part 2: the contractor relay lane', () => {
    it('a customer reply on a thread a contractor is mid-relay on goes to him, not to an agent', () => {
        const r = triageRules(cf({ tags: ['contractor_relay_open'] }, [outbound('Craig here, I\'m outside. Which door?'), inbound('Side door, the blue one')]));
        expect(r.lane).toBe('contractor_relay');
        expect(r.exceptions).toEqual([]);
        expect(r.reasons.join(' ')).toMatch(/mid-relay/);
    });
    it('an exception still wins: a reply that also asks about money goes to Ben (he gets the notice anyway)', () => {
        const r = triageRules(cf({ tags: ['contractor_relay_open'] }, [outbound('Craig here, i\'m outside.'), inbound('side door, and how much for the extra socket?')]));
        expect(r.lane).toBe('ben');
        expect(r.exceptions).toContain('money_question');
    });
    it('without the tag nothing changes, and the lane never fires on our own outbound', () => {
        expect(triageRules(cf({}, [outbound('hi'), inbound('side door, the blue one')])).lane).not.toBe('contractor_relay');
        expect(triageRules(cf({ tags: ['contractor_relay_open'] }, [outbound('hi')])).lane).not.toBe('contractor_relay');
    });
    it('no agent runs the relay lane, so nothing is auto-answered', async () => {
        const { agentForLane } = await import('./index');
        expect(agentForLane('contractor_relay')).toBeNull();
    });
});
