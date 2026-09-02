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
