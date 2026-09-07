/**
 * T21 vitest: a message Ben has since answered on the phone is not re-read by triage's text
 * lexicons. The helper is pure; triageRules is pure (no db call on this path). The db module is
 * mocked at import because triage.ts imports it.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, pool: {} }));

import { answeredByOurCall, ANSWERING_CALL_MIN_TRANSCRIPT_CHARS } from './answered-by-call';
import { triageRules } from './triage';
import { MIN_TRANSCRIPT_CHARS } from '../post-call-ladder';
import type { CaseFile, TimelineItem } from './types';

const T0 = Date.parse('2026-09-08T10:00:00Z');
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();
const TRANSCRIPT = 'Agent: Hi, it is Ben, you messaged about the fan. Customer: Yes. Agent: Send me a couple of photos of it on this WhatsApp and I will price it up. Customer: Will do.';

function cf(timeline: TimelineItem[], over: Partial<CaseFile> = {}): CaseFile {
    return {
        conversationId: 'c1', phone: '+447700900942', audience: 'customer', stage: 'scoping', contactName: 'Sam',
        timeline, media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: iso(-10), channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: iso(30),
        ...over,
    };
}
const msgIn = (min: number, body: string): TimelineItem => ({ at: iso(min), kind: 'message_in', channel: 'whatsapp', body, by: 'customer' });
const msgOut = (min: number, body: string, by = 'rules.first_contact'): TimelineItem => ({ at: iso(min), kind: 'message_out', channel: 'whatsapp', body, by });
const callOut = (min: number, transcript: string | undefined = TRANSCRIPT): TimelineItem => ({ at: iso(min), kind: 'call_out', channel: 'call', body: 'Rang them back about the fan; asked for photos.', transcript });
const callIn = (min: number, transcript: string | undefined = TRANSCRIPT): TimelineItem => ({ at: iso(min), kind: 'call_in', channel: 'call', by: 'customer', transcript });

describe('answeredByOurCall', () => {
    it('the ladder\'s bar is the one it mirrors', () => {
        expect(ANSWERING_CALL_MIN_TRANSCRIPT_CHARS).toBe(MIN_TRANSCRIPT_CHARS);
    });
    it('an outbound call with a transcript after the customer\'s last message answers it', () => {
        const r = answeredByOurCall(cf([msgIn(-20, 'Hi, my fan is broken'), msgOut(-19, 'Is it OK if we give you a quick call?'), msgIn(-10, 'Yes please call me'), callOut(-5)]));
        expect(r).not.toBeNull();
        expect(r!.lastInbound?.body).toBe('Yes please call me');
        expect(r!.call.kind).toBe('call_out');
    });
    it('a call BEFORE the customer\'s last message answers nothing; nor does one without a transcript; nor an inbound call', () => {
        expect(answeredByOurCall(cf([callOut(-15), msgIn(-10, 'Yes please call me')]))).toBeNull();
        expect(answeredByOurCall(cf([msgIn(-10, 'Yes please call me'), { ...callOut(-5), transcript: undefined }]))).toBeNull();
        expect(answeredByOurCall(cf([msgIn(-10, 'Yes please call me'), callOut(-5, 'too short')]))).toBeNull();
        expect(answeredByOurCall(cf([msgIn(-10, 'Yes please call me'), callIn(-5)]))).toBeNull();
    });
    it('reads timestamps, not array order (the case file is assembled from two tables)', () => {
        expect(answeredByOurCall(cf([callOut(-5), msgIn(-10, 'Yes please call me')]))).not.toBeNull();
    });
    it('a later text from us does not undo the answer; a later message from the customer does', () => {
        expect(answeredByOurCall(cf([msgIn(-10, 'Yes please call me'), callOut(-5), msgOut(-2, 'Send the photos when you can', 'human:ben')]))).not.toBeNull();
        expect(answeredByOurCall(cf([msgIn(-10, 'Yes please call me'), callOut(-5), msgIn(-1, 'How much roughly?')]))).toBeNull();
    });
    it('a call-first thread (no inbound at all) counts as answered by the call', () => {
        expect(answeredByOurCall(cf([callOut(-5)]))?.lastInbound).toBeNull();
    });
});

describe('triageRules after Ben\'s call (the captain\'s flow)', () => {
    const flow = [msgIn(-30, 'Hi, my bathroom extractor fan has stopped working, can you replace it? NG7 2AB'), msgOut(-29, 'Hi Sam, thanks for getting in touch. Is it OK if we give you a quick call to run through it?'), msgIn(-20, 'Yes please give me a call'), callOut(-5)];
    it('"yes please call me" laned to Ben before the call; after the call it is the Scoper\'s turn', () => {
        const before = triageRules(cf(flow.slice(0, 3)));
        expect(before.lane).toBe('ben');
        expect(before.exceptions).toEqual(['callback_requested']);
        const after = triageRules(cf(flow));
        expect(after.lane).toBe('scoper');
        expect(after.exceptions).toEqual([]);
        expect(after.tags).not.toContain('callback_requested');
        expect(after.reasons.some((r) => /answered by our call/.test(r))).toBe(true);
    });
    it('money and date words in the answered message do not re-fire either; dateAsked is off', () => {
        const r = triageRules(cf([msgIn(-30, 'hi'), msgOut(-29, 'hi'), msgIn(-20, 'how much would it cost and can you come Tuesday?'), callOut(-5)]));
        expect(r.lane).toBe('scoper');
        expect(r.exceptions).toEqual([]);
        expect(r.dateAsked).toBe(false);
    });
    it('what still stands: a trust_concern tag, an opt-out, first contact, a first message asking for a call (Ben\'s, as before), and a customer message after the call', () => {
        expect(triageRules(cf(flow, { tags: ['trust_concern'] })).lane).toBe('ben');
        expect(triageRules(cf([msgIn(-30, 'hi'), msgOut(-29, 'hi'), msgIn(-20, 'STOP'), callOut(-5)])).lane).toBe('dropped');
        expect(triageRules(cf([msgIn(-20, 'Hi, my fan is broken, can you help?')])).lane).toBe('rules');
        expect(triageRules(cf([msgIn(-20, 'Yes please call me')])).lane).toBe('ben');
        const later = triageRules(cf([...flow, msgIn(-1, 'Actually how much will it be?')]));
        expect(later.lane).toBe('ben');
        expect(later.exceptions).toEqual(['money_question']);
    });
});
