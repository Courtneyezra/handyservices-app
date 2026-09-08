/**
 * 0.2 part E — the regulated net reads the last three customer texts and the photo descriptions.
 *
 * The hole (s30 finding F5): every deterministic rule read the NEWEST inbound alone
 * (triage.ts lastInbound → RE_REGULATED.test(text)). That is right for a callback request or a
 * money question, which are things the customer is asking now. It is wrong for gas, which is a
 * property of the job: a thread whose first message says "boiler" and whose third says "so can you
 * come Tuesday?" reached no exception at all, and gas is the ONE thing T18 leaves as Ben's.
 *
 * Nothing else widened. The money, callback, refund, complaint and date lexicons still read the
 * newest message only, and the cases below say so explicitly, because widening the money lexicon
 * over three turns would hold a thread for Ben long after his answer.
 */
import { describe, it, expect } from 'vitest';
import { triageRules, recentCustomerTexts, mediaDescriptions, regulatedHit, REGULATED_LOOKBACK } from './triage';
import type { CaseFile, MediaItem, TimelineItem } from './types';

function cf(over: Partial<CaseFile> = {}, timeline: TimelineItem[] = []): CaseFile {
    return {
        conversationId: 'c1', phone: '+447700123456', audience: 'customer', stage: 'enquiry', contactName: 'Sam',
        timeline, media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: new Date().toISOString(), channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: new Date().toISOString(),
        ...over,
    };
}
let clock = Date.parse('2026-09-08T09:00:00Z');
const tick = () => new Date((clock += 60_000)).toISOString();
const inbound = (body: string, extra: Partial<TimelineItem> = {}): TimelineItem => ({ at: tick(), kind: 'message_in', channel: 'whatsapp', body, by: 'customer', ...extra });
const outbound = (body: string): TimelineItem => ({ at: tick(), kind: 'message_out', channel: 'whatsapp', body });
const photo = (description: string): MediaItem => ({ id: 'm1', kind: 'image', description });

describe('recentCustomerTexts', () => {
    it('is the last three customer messages, newest first; ours and empty ones do not count', () => {
        const file = cf({}, [
            inbound('first'), outbound('ours'), inbound('second'), inbound('  '), outbound('ours again'), inbound('third'), inbound('fourth'),
        ]);
        expect(recentCustomerTexts(file)).toEqual(['fourth', 'third', 'second']);
        expect(REGULATED_LOOKBACK).toBe(3);
    });

    it('a call transcript is not a customer text', () => {
        const file = cf({}, [{ at: tick(), kind: 'call_in', channel: 'call', transcript: 'the boiler is leaking' }, inbound('hello')]);
        expect(recentCustomerTexts(file)).toEqual(['hello']);
    });
});

describe('mediaDescriptions', () => {
    it('is every described item, and nothing when the describer produced none', () => {
        expect(mediaDescriptions(cf({ media: [photo('a wall-mounted combi boiler'), { id: 'm2', kind: 'image' }] }))).toEqual(['a wall-mounted combi boiler']);
        expect(mediaDescriptions(cf())).toEqual([]);
    });
});

describe('the gas lexicon over the last three texts', () => {
    it('THE DEFECT: "boiler" three messages back, "can you come Tuesday?" now — still Ben', () => {
        const file = cf({}, [
            inbound('hi, the boiler in the kitchen is dripping'),
            outbound('Thanks, we have got that.'),
            inbound('it is the one under the stairs'),
            inbound('so can you come Tuesday?'),
        ]);
        const r = triageRules(file);
        expect(r.lane).toBe('ben');
        expect(r.exceptions).toContain('regulated_trade');
        expect(r.reasons.join(' ')).toMatch(/gas lexicon .* on a customer message 2 turns back/);
    });

    it('the newest message still fires, and says so', () => {
        const r = triageRules(cf({}, [outbound('hi'), inbound('my boiler is leaking, can you fix it')]));
        expect(r.exceptions).toContain('regulated_trade');
        expect(r.reasons.join(' ')).toMatch(/on the newest customer message/);
    });

    it('a fourth message back is out of reach — three is the lookback, not "the whole thread"', () => {
        const r = triageRules(cf({}, [
            inbound('the boiler flue needs looking at'),
            outbound('ok'),
            inbound('actually forget that'),
            inbound('can you hang two doors instead'),
            inbound('and a shelf in the hall'),
            inbound('when are you free?'),
        ]));
        expect(r.exceptions).not.toContain('regulated_trade');
    });

    it('a photo description alone is enough, with no words at all', () => {
        const r = triageRules(cf({ media: [photo('a close-up of a gas meter and its pipework')] }, [
            outbound('Send us a photo when you can.'), inbound(''),
        ]));
        expect(r.lane).toBe('ben');
        expect(r.exceptions).toContain('regulated_trade');
        expect(r.reasons.join(' ')).toMatch(/on a photo or video description/);
    });

    it('no gas anywhere: the thread goes to an agent, as it did before', () => {
        const r = triageRules(cf({ media: [photo('a wooden door off its hinges')] }, [
            inbound('two doors need rehanging'), outbound('ok'), inbound('when are you free?'),
        ]));
        expect(r.exceptions).toEqual([]);
        expect(r.lane).not.toBe('ben');
    });
});

describe('no other lexicon widened', () => {
    it('a money question three messages back does NOT hold the thread', () => {
        const r = triageRules(cf({}, [
            inbound('how much would two doors be?'),
            outbound('Ben will come back to you on the price.'),
            inbound('no rush'),
            inbound('the hall one is the wide one'),
        ]));
        expect(r.exceptions).not.toContain('money_question');
    });

    it('a callback asked for three messages back does NOT re-raise itself', () => {
        const r = triageRules(cf({}, [
            inbound('can you call me about this'),
            outbound('Ben will ring you.'),
            inbound('thanks'),
            inbound('the address is 4 Mill Lane'),
        ]));
        expect(r.exceptions).not.toContain('callback_requested');
    });
});

describe('T21 still holds: a message Ben answered on the phone is not re-read', () => {
    it('an outbound call with a transcript AFTER the customer\'s last turn stops the lexicon re-firing', () => {
        // Ben rang them; nothing has come in since. The pass after his call must not lane the
        // thread straight back to him, or the follow-up he asked for never gets composed.
        const at = (mins: number) => new Date(Date.parse('2026-09-08T09:00:00Z') + mins * 60_000).toISOString();
        const r = triageRules(cf({}, [
            { at: at(0), kind: 'message_in', channel: 'whatsapp', body: 'the boiler is making a noise', by: 'customer' },
            { at: at(5), kind: 'message_in', channel: 'whatsapp', body: 'any time this week suits', by: 'customer' },
            { at: at(10), kind: 'call_out', channel: 'call', transcript: 'Ben: we do not touch gas, I will find you a Gas Safe engineer for that one.' },
        ]));
        expect(r.exceptions).not.toContain('regulated_trade');
        expect(r.reasons.join(' ')).toMatch(/answered by our call/);
    });

    it('but a NEW message after the call is a new turn, and gas in the last three texts fires again', () => {
        const at = (mins: number) => new Date(Date.parse('2026-09-08T09:00:00Z') + mins * 60_000).toISOString();
        const r = triageRules(cf({}, [
            { at: at(0), kind: 'message_in', channel: 'whatsapp', body: 'the boiler is making a noise', by: 'customer' },
            { at: at(10), kind: 'call_out', channel: 'call', transcript: 'Ben: we do not touch gas, I will find you a Gas Safe engineer for that one.' },
            { at: at(20), kind: 'message_in', channel: 'whatsapp', body: 'thanks for ringing — Tuesday then?', by: 'customer' },
        ]));
        expect(r.exceptions).toContain('regulated_trade');
    });
});

describe('regulatedHit is pure and says where it fired', () => {
    it('reports the position, so the run reads honestly', () => {
        expect(regulatedHit(cf({}, [inbound('gas safe certificate?')]))).toEqual({ hit: true, where: 'the newest customer message' });
        expect(regulatedHit(cf({}, [inbound('asbestos in the garage roof'), inbound('anyway')]))).toEqual({ hit: true, where: 'a customer message 1 turn back' });
        expect(regulatedHit(cf({}, [inbound('two doors please')]))).toEqual({ hit: false, where: null });
    });
});
