/**
 * Phase 2 vitest: decide() truth table — tier × exception × hours × window. Pure.
 */
import { describe, it, expect } from 'vitest';
import { decide, hoursAllow, approverFor } from './decide';
import { getPack } from './packs';
import type { CaseFile, PolicyPack, Proposal, TriageResult, GuardVerdict } from './types';

const REACTIVE_NOW = new Date('2026-09-02T22:30:00Z'); // 23:30 UK: outside proactive hours
const DAY_NOW = new Date('2026-09-02T10:00:00Z');      // 11:00 UK

function cf(over: Partial<CaseFile> = {}): CaseFile {
    return {
        conversationId: 'c1', phone: '+447700123456', audience: 'customer', stage: 'scoping', contactName: 'Sam',
        timeline: [], media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: DAY_NOW.toISOString(),
        ...over,
    };
}
const tri = (over: Partial<TriageResult> = {}): TriageResult => ({ audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [], reasons: ['r'], source: 'rules', ...over });
const prop = (over: Partial<Proposal> = {}): Proposal => ({ intent: 'ask_gap', body: ['Which room is the tap in?'], reasons: ['gap'], ...over });
const ok: GuardVerdict = { ok: true, guardsHit: [], escalate: false, notes: [] };
const sendPack = (base: PolicyPack, intent: string): PolicyPack => ({ ...base, tierByIntent: { ...base.tierByIntent, [intent]: 'SEND' } });

describe('decide', () => {
    const pack = getPack('customer.default');
    it('drops opted-out and spam before anything else', () => {
        expect(decide({ proposal: prop(), guards: ok, pack, triage: tri({ lane: 'dropped', exceptions: ['opted_out'] }), caseFile: cf(), now: DAY_NOW }).kind).toBe('drop');
        expect(decide({ proposal: prop(), guards: ok, pack, triage: tri({ lane: 'dropped', exceptions: ['spam'] }), caseFile: cf(), now: DAY_NOW }).kind).toBe('drop');
    });
    it('flags any exception with a due time, urgent for a callback', () => {
        const d = decide({ proposal: null, guards: null, pack, triage: tri({ lane: 'ben', exceptions: ['money_question'] }), caseFile: cf(), now: DAY_NOW });
        expect(d).toMatchObject({ kind: 'flag', exception: 'money_question' });
        const cb = decide({ proposal: null, guards: null, pack, triage: tri({ lane: 'ben', exceptions: ['callback_requested'] }), caseFile: cf(), now: DAY_NOW });
        expect(cb.kind).toBe('flag');
        if (d.kind === 'flag' && cb.kind === 'flag') expect(new Date(cb.dueAt).getTime()).toBeLessThan(new Date(d.dueAt).getTime());
    });
    it('returns none with no proposal', () => {
        expect(decide({ proposal: null, guards: null, pack, triage: tri(), caseFile: cf(), now: DAY_NOW })).toMatchObject({ kind: 'none' });
    });
    it('flags a proposal that carries its own flag', () => {
        expect(decide({ proposal: prop({ flag: { exception: 'out_of_scope', note: 'asbestos' } }), guards: ok, pack, triage: tri(), caseFile: cf(), now: DAY_NOW })).toMatchObject({ kind: 'flag', exception: 'out_of_scope' });
    });
    it('DRAFT tier → pending with a due time (launch default for every scoper intent)', () => {
        const d = decide({ proposal: prop(), guards: ok, pack, triage: tri(), caseFile: cf({ window: { canFreeform: true, templateRequired: false, lastInboundAt: DAY_NOW.toISOString(), channelLastUsed: 'whatsapp' } }), now: DAY_NOW });
        expect(d.kind).toBe('pending'); if (d.kind === 'pending') { expect(d.reason).toMatch(/tier DRAFT/); expect(new Date(d.dueAt).getTime()).toBeGreaterThan(DAY_NOW.getTime()); }
    });
    it('SEND tier + reactive + window open → send with the pack approver', () => {
        const d = decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf({ window: { canFreeform: true, templateRequired: false, lastInboundAt: new Date(REACTIVE_NOW.getTime() - 5 * 60_000).toISOString(), channelLastUsed: 'whatsapp' } }), now: REACTIVE_NOW });
        expect(d).toEqual({ kind: 'send', approver: 'agent.scoper' });
    });
    it('SEND tier but an open exception on the thread → pending', () => {
        const d = decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf({ tags: ['needs_ben'], window: { canFreeform: true, templateRequired: false, lastInboundAt: DAY_NOW.toISOString(), channelLastUsed: 'whatsapp' } }), now: DAY_NOW });
        expect(d).toMatchObject({ kind: 'pending', reason: expect.stringMatching(/open exception/) });
    });
    it('SEND tier, proactive at 23:30 UK → pending until the next proactive slot', () => {
        const d = decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf({ window: { canFreeform: true, templateRequired: false, lastInboundAt: new Date(REACTIVE_NOW.getTime() - 3 * 3600_000).toISOString(), channelLastUsed: 'whatsapp' } }), now: REACTIVE_NOW });
        expect(d.kind).toBe('pending'); if (d.kind === 'pending') { expect(d.reason).toMatch(/outside proactive hours/); expect(new Date(d.dueAt).getTime()).toBeGreaterThan(REACTIVE_NOW.getTime()); }
        expect(hoursAllow(pack, cf({ window: { canFreeform: true, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' } }), DAY_NOW).ok).toBe(true);
    });
    it('SEND tier, window shut, no template → pending; with a template or on SMS → send', () => {
        const shut = { canFreeform: false, templateRequired: true, lastInboundAt: DAY_NOW.toISOString(), channelLastUsed: 'whatsapp' as const };
        expect(decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf({ window: shut }), now: DAY_NOW })).toMatchObject({ kind: 'pending', reason: expect.stringMatching(/window shut/) });
        const withTemplate = { ...sendPack(pack, 'ask_gap'), templates: { ask_gap: 'some_template' } };
        expect(decide({ proposal: prop(), guards: ok, pack: withTemplate, triage: tri(), caseFile: cf({ window: shut }), now: DAY_NOW }).kind).toBe('send');
        expect(decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf({ window: { ...shut, channelLastUsed: 'sms' } }), now: DAY_NOW }).kind).toBe('send');
    });
    it('a Ben-only guard hit → flag; any other guard hit → pending', () => {
        const money: GuardVerdict = { ok: false, guardsHit: ['money'], escalate: true, notes: ['money: £120'] };
        expect(decide({ proposal: prop({ body: ['That would be £120'] }), guards: money, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf(), now: DAY_NOW })).toMatchObject({ kind: 'flag', exception: 'money_question' });
        const voice: GuardVerdict = { ok: false, guardsHit: ['voice'], escalate: false, notes: ['voice: em dash'] };
        expect(decide({ proposal: prop(), guards: voice, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf(), now: DAY_NOW })).toMatchObject({ kind: 'pending', reason: expect.stringMatching(/guard hit/) });
    });
    it('an intent outside the pack → pending', () => {
        expect(decide({ proposal: prop({ intent: 'job_brief' }), guards: ok, pack, triage: tri(), caseFile: cf(), now: DAY_NOW })).toMatchObject({ kind: 'pending', reason: expect.stringMatching(/not in pack/) });
    });
    it('READ and PROPOSE tiers never reach the customer', () => {
        expect(decide({ proposal: prop(), guards: ok, pack: getPack('customer.exception'), triage: tri(), caseFile: cf(), now: DAY_NOW })).toMatchObject({ kind: 'pending' });
        expect(decide({ proposal: prop(), guards: ok, pack: { ...pack, tierByIntent: { ask_gap: 'PROPOSE' } }, triage: tri(), caseFile: cf(), now: DAY_NOW })).toMatchObject({ kind: 'none', reason: expect.stringMatching(/PROPOSE/) });
    });
    it('rules packs are SEND by default and carry rules.* approvers', () => {
        const rules = getPack('rules.first_contact');
        const d = decide({ proposal: prop({ intent: 'ask_media', body: ['Could you send a quick video?'] }), guards: ok, pack: rules, triage: tri({ lane: 'rules', intent: 'ask_media' }), caseFile: cf({ window: { canFreeform: true, templateRequired: false, lastInboundAt: DAY_NOW.toISOString(), channelLastUsed: 'whatsapp' } }), now: DAY_NOW });
        expect(d).toEqual({ kind: 'send', approver: 'rules.ask' });
        expect(approverFor(getPack('rules.followup'), 'sla_chase')).toBe('rules.followup');
        expect(approverFor(rules, 'ack_enquiry')).toBe('rules.first_contact');
    });
});

// ---------------------------------------------------------------- P7: the customer promised more

describe('decide — waiting for a promised item (P7)', () => {
    const pack = getPack('customer.default');
    it('returns none / waiting_for_promised even with a good proposal at SEND tier', () => {
        const d = decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri({ customerPromisedMore: true }), caseFile: cf({ window: { canFreeform: true, templateRequired: false, lastInboundAt: DAY_NOW.toISOString(), channelLastUsed: 'whatsapp' } }), now: DAY_NOW });
        expect(d).toEqual({ kind: 'none', reason: 'waiting_for_promised' });
    });
    it('the case-file flag alone is enough; and it is never a flag, even without a proposal', () => {
        expect(decide({ proposal: null, guards: null, pack, triage: tri(), caseFile: cf({ lastInboundPromisedMore: true }), now: DAY_NOW })).toEqual({ kind: 'none', reason: 'waiting_for_promised' });
    });
    it('an exception still wins: a complaint that also says "back soon" goes to Ben', () => {
        const d = decide({ proposal: prop(), guards: ok, pack, triage: tri({ lane: 'ben', exceptions: ['complaint'], customerPromisedMore: true }), caseFile: cf(), now: DAY_NOW });
        expect(d.kind).toBe('flag');
    });
    it('opt-out still drops', () => {
        expect(decide({ proposal: prop(), guards: ok, pack, triage: tri({ lane: 'dropped', exceptions: ['opted_out'], customerPromisedMore: true }), caseFile: cf(), now: DAY_NOW }).kind).toBe('drop');
    });
});

// ------------------------------------------- P19: the clerk prepares while the thread stays Ben's

describe("decide — the Ben lane is unmoved by what the clerk prepared (P19)", () => {
    const pack = getPack('customer.exception');
    const benTriage = tri({ lane: 'ben', exceptions: ['callback_requested', 'date_question'], tags: ['needs_quote'], reasons: ['callback lexicon', 'date lexicon'] });
    const intake: Proposal = {
        intent: 'propose_intake', body: [], reasons: ['3 line(s), readiness quote_ready'],
        artifact: { kind: 'quote_intake', summary: '3 line(s), readiness quote_ready, 0 gap(s)', data: { readiness: 'quote_ready' } },
    };

    it('is byte-for-byte the same decision with the clerk artifact as without it', () => {
        const without = decide({ proposal: null, guards: null, pack, triage: benTriage, caseFile: cf({ tags: ['needs_quote'] }), now: DAY_NOW });
        const with_ = decide({ proposal: intake, guards: ok, pack, triage: benTriage, caseFile: cf({ tags: ['needs_quote'] }), now: DAY_NOW });
        expect(with_).toEqual(without);
        expect(with_).toMatchObject({ kind: 'flag', exception: 'callback_requested' });
    });

    it('a visit_first survey offer on the Ben lane still flags: the exceptions branch sits above every tier', () => {
        // The runner skips this branch on the Ben lane (server/spine/index.ts); this pins that even
        // if a customer-facing DRAFT proposal reached decide there, nothing would be drafted.
        const offer: Proposal = { intent: 'offer_survey', body: ['We do a paid survey visit at £49. Shall I send the booking link?'], reasons: ['visit_first'], citations: ['price_source=settings surveyFeePence=4900'] };
        const d = decide({ proposal: offer, guards: ok, pack: getPack('customer.default'), triage: benTriage, caseFile: cf({ tags: ['needs_quote'] }), now: DAY_NOW });
        expect(d).toEqual(decide({ proposal: null, guards: null, pack: getPack('customer.default'), triage: benTriage, caseFile: cf({ tags: ['needs_quote'] }), now: DAY_NOW }));
        expect(d.kind).toBe('flag');
    });

    it('a decline body the clerk proposed cannot send on the Ben lane either', () => {
        const decline: Proposal = { intent: 'closing', body: ['That one is gas work, so we have to pass.'], reasons: ['decline'], artifact: { kind: 'quote_intake', summary: 'decline', data: { readiness: 'decline' } } };
        expect(decide({ proposal: decline, guards: ok, pack, triage: benTriage, caseFile: cf({ tags: ['needs_quote'] }), now: DAY_NOW }).kind).toBe('flag');
    });
});
