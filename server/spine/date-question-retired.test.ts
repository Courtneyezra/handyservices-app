/**
 * B3 / PRD v3 §7 — `date_question` retired as a Ben trigger. Pure: no DB, no model.
 *
 *   | Situation                        | Behaviour                                              |
 *   |----------------------------------|--------------------------------------------------------|
 *   | Before a quote exists            | "Dates come with your quote", carry on scoping; no flag |
 *   | A live (unpaid) quote exists     | point at the picker                                    |
 *   | After booking, wanting to change | OPEN (§13) — interim: still Ben, exactly as before     |
 *
 * What is pinned: the lane, the exception list, the pack the run resolves, the agent that runs,
 * the decision, the guard verdict on the exact line, and that the model cannot force Ben for a
 * date on its own. Nothing here touches money (`RE_MONEY`, `money_question`, the money guards).
 */
import { describe, it, expect } from 'vitest';
import { triageRules, mergeTriage, afterBooking, TRIAGE_SYSTEM, lastInbound } from './triage';
import { resolveStaticPack, getPack } from './packs';
import { decide } from './decide';
import { checkProposal } from './guards';
import { agentForLane } from './index';
import { buildScoperSystem, loadScoperCore, loadScoperPostQuote, dateQuestionNeedsBen, renderCaseFile, checkProposedBody } from './agents/scoper';
import { checkDraft, detectDatePromise, detectSoftCommitment, detectDurationClaim } from '../agents/draft-guards';
import type { CaseFile, TimelineItem, TriageResult } from './types';

const DAY_NOW = new Date('2026-09-07T10:00:00Z'); // Monday 11:00 UK

function cf(over: Partial<CaseFile> = {}, timeline: TimelineItem[] = []): CaseFile {
    return {
        conversationId: 'c1', phone: '+447700123456', audience: 'customer', stage: 'scoping', contactName: 'Sam',
        timeline, media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: DAY_NOW.toISOString(), channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: DAY_NOW.toISOString(),
        ...over,
    };
}
const inbound = (body: string): TimelineItem => ({ at: DAY_NOW.toISOString(), kind: 'message_in', channel: 'whatsapp', body, by: 'customer' });
const outbound = (body: string): TimelineItem => ({ at: new Date(DAY_NOW.getTime() - 60_000).toISOString(), kind: 'message_out', channel: 'whatsapp', body, by: 'agent.scoper' });

const LIVE_QUOTE = { slug: 'q1', total: 32000, lines: 2, viewedAt: DAY_NOW.toISOString(), expiresAt: null, paid: false };
const PAID_QUOTE = { ...LIVE_QUOTE, slug: 'q2', paid: true };

/** The exact §7 line, and the 1–3 bubble shape the prompt asks for (the line, then the next scoping ask). */
export const DATES_LINE = 'Dates come with your quote.';
const DATES_BUBBLES = [DATES_LINE, 'Could you send a quick photo of the tap and where it drips from?'];

// ------------------------------------------------------------------ row 1: before a quote exists

describe('§7 row 1 — before a quote exists, a date question is not Ben\'s', () => {
    const asks = ['what day could you come next week?', 'Can you come Tuesday morning?', 'When can you fit me in?', 'What time works for you?', 'are you available on Saturday?'];

    it('triage: no exception, lane scoper, dateAsked set, and the reason says why', () => {
        for (const t of asks) {
            const r = triageRules(cf({}, [outbound('Could you send a photo?'), inbound(t)]));
            expect(r.lane, t).toBe('scoper');
            expect(r.exceptions, t).toEqual([]);
            expect(r.dateAsked, t).toBe(true);
            expect(r.reasons.join(' '), t).toMatch(/date lexicon: a signal for the Scoper/);
        }
    });
    it('the signal is off when nobody asked about a date', () => {
        const r = triageRules(cf({}, [outbound('hi'), inbound('the tap is in the kitchen')]));
        expect(r.dateAsked).toBe(false);
        expect(r.lane).toBe('scoper');
    });
    it('the run resolves customer.default (not the exception pack) and the Scoper runs it', () => {
        const file = cf({}, [outbound('Could you send a photo?'), inbound('Can you come Tuesday morning?')]);
        const tri = triageRules(file);
        const pack = resolveStaticPack(file, tri);
        expect(pack.id).toBe('customer.default');
        expect(pack.exceptionsToBen).not.toContain('date_question');
        expect(agentForLane(tri.lane)).toBe('scoper');
    });
    it('decide: no proposal → none; a DRAFT proposal → pending, never a flag', () => {
        const file = cf({}, [outbound('Could you send a photo?'), inbound('Can you come Tuesday morning?')]);
        const tri = triageRules(file);
        const pack = getPack('customer.default');
        expect(decide({ proposal: null, guards: null, pack, triage: tri, caseFile: file, now: DAY_NOW })).toEqual({ kind: 'none', reason: 'no proposal' });
        const proposal = { intent: 'ask_gap' as const, body: DATES_BUBBLES, reasons: ['dates come with the quote; next gap is the photo'] };
        const guards = checkProposal(proposal, pack, file);
        expect(guards.ok).toBe(true);
        const d = decide({ proposal, guards, pack, triage: tri, caseFile: file, now: DAY_NOW });
        expect(d.kind).toBe('pending');
        if (d.kind === 'pending') expect(d.reason).toMatch(/tier DRAFT/);
    });
    it('a first-contact date question still goes to the rules lane (the ack), not to Ben', () => {
        const r = triageRules(cf({ stage: 'enquiry' }, [inbound('Hi, need a tap fixed, when could you come?')]));
        expect(r.lane).toBe('rules');
        expect(r.exceptions).toEqual([]);
        expect(r.dateAsked).toBe(true);
    });
});

// ------------------------------------------------------------------ row 2: a live quote exists

describe('§7 row 2 — a live unpaid quote: point at the picker', () => {
    const file = cf({ stage: 'quote_sent', quote: LIVE_QUOTE }, [outbound('Your quote is ready: https://handyservices.app/quote/q1'), inbound('Can you do Saturday morning?')]);

    it('triage lanes post_quote with no exception; the run resolves customer.post_quote and the Scoper', () => {
        const tri = triageRules(file);
        expect(tri.lane).toBe('post_quote');
        expect(tri.exceptions).toEqual([]);
        expect(tri.dateAsked).toBe(true);
        const pack = resolveStaticPack(file, tri);
        expect(pack.id).toBe('customer.post_quote');
        expect(pack.allowedIntents).toContain('point_to_picker');
        expect(pack.exceptionsToBen).not.toContain('date_question');
        expect(agentForLane(tri.lane)).toBe('scoper');
    });
    it('dateQuestionNeedsBen is false wherever the pack can point at the picker, true where it cannot', () => {
        expect(dateQuestionNeedsBen(file, getPack('customer.post_quote'))).toBe(false);
        expect(dateQuestionNeedsBen(file, getPack('customer.default'))).toBe(false); // B3: point_to_picker is on the default pack too
        expect(dateQuestionNeedsBen(cf(), getPack('customer.post_quote'))).toBe(true);   // no quote: nothing to point at
        expect(dateQuestionNeedsBen(cf({ quote: PAID_QUOTE }), getPack('customer.post_quote'))).toBe(true); // paid: no picker
    });
    it('point_to_picker is DRAFT on both customer packs; nothing moved to SEND', () => {
        for (const id of ['customer.default', 'customer.post_quote']) {
            const pack = getPack(id);
            expect(pack.allowedIntents).toContain('point_to_picker');
            expect(pack.tierByIntent.point_to_picker ?? pack.defaultTier).toBe('DRAFT');
            expect(Object.values(pack.tierByIntent)).not.toContain('SEND');
            expect(pack.defaultTier).not.toBe('SEND');
        }
    });
    it('the picker line passes the pack guards and decides DRAFT-pending, never a flag', () => {
        const tri = triageRules(file);
        const pack = getPack('customer.post_quote');
        const proposal = { intent: 'point_to_picker' as const, body: ['The dates on offer are on your quote page, pick the one that suits and it books in with the deposit.'], reasons: ['live quote has a picker'], citations: ['q1'] };
        const guards = checkProposal(proposal, pack, file);
        expect(guards.ok).toBe(true);
        expect(decide({ proposal, guards, pack, triage: tri, caseFile: file, now: DAY_NOW }).kind).toBe('pending');
    });
});

// ------------------------------------------------------------------ row 3: after booking (OPEN → interim)

describe('§7 row 3 — after booking is OPEN (§13); the interim keeps today\'s behaviour: Ben', () => {
    it('afterBooking: a paid quote, or stage booked / won', () => {
        expect(afterBooking(cf({ quote: PAID_QUOTE }))).toBe(true);
        expect(afterBooking(cf({ stage: 'booked' }))).toBe(true);
        expect(afterBooking(cf({ stage: 'won' }))).toBe(true);
        expect(afterBooking(cf({ quote: LIVE_QUOTE, stage: 'quote_sent' }))).toBe(false);
        expect(afterBooking(cf())).toBe(false);
    });
    it('a date question on a booked job is still the date_question exception, lane ben, exception pack, no agent', () => {
        for (const over of [{ quote: PAID_QUOTE, stage: 'booked' as const }, { quote: PAID_QUOTE, stage: 'won' as const }, { stage: 'booked' as const }]) {
            const file = cf(over, [outbound('Booked for Thursday, Craig will be with you.'), inbound('Is it AM or PM? I need to know for work')]);
            const tri = triageRules(file);
            expect(tri.lane).toBe('ben');
            expect(tri.exceptions).toContain('date_question');
            expect(tri.reasons.join(' ')).toMatch(/booked job/);
            expect(resolveStaticPack(file, tri).id).toBe('customer.exception');
            expect(agentForLane(tri.lane)).toBeNull();
            expect(decide({ proposal: null, guards: null, pack: getPack('customer.exception'), triage: tri, caseFile: file, now: DAY_NOW })).toMatchObject({ kind: 'flag', exception: 'date_question' });
        }
    });
    it('a booked-job thread that is NOT asking about a date is unchanged: no exception', () => {
        const r = triageRules(cf({ quote: PAID_QUOTE, stage: 'booked' }, [outbound('Booked for Thursday.'), inbound('great, the side gate will be unlocked')]));
        expect(r.exceptions).toEqual([]);
        expect(r.dateAsked).toBe(false);
    });
});

// ------------------------------------------------------------------ the model cannot force Ben for a date

describe('the model may not add date_question on its own', () => {
    const modelWithDate = { audience: 'customer', intent: 'unknown', lane: 'ben', exceptions: ['date_question'], stage: 'scoping', tags: [], reasons: ['asked about dates'] } as any;

    it('pre-quote: a model-only date_question is dropped and the lane falls back to the rules\' lane', () => {
        const rules = triageRules(cf({}, [outbound('hi'), inbound('the tap is in the kitchen, when could you come?')]));
        const merged = mergeTriage(rules, modelWithDate, 'haiku');
        expect(merged.exceptions).toEqual([]);
        expect(merged.lane).toBe('scoper');
        expect(merged.dateAsked).toBe(true);
    });
    it('the P7 promised-more case: no exception, and decide waits rather than routing to Ben', () => {
        const file = cf({}, [outbound('Could you send the measurement?'), inbound("That's the only cladding, back soon with measurement")]);
        const rules = triageRules(file);
        const merged = mergeTriage(rules, modelWithDate, 'haiku');
        expect(merged.exceptions).toEqual([]);
        expect(merged.lane).not.toBe('ben');
        expect(merged.customerPromisedMore).toBe(true);
        expect(decide({ proposal: null, guards: null, pack: getPack('customer.default'), triage: merged, caseFile: file, now: DAY_NOW })).toEqual({ kind: 'none', reason: 'waiting_for_promised' });
    });
    it('a real date question beside a promise: still no exception (row 1), and the run waits', () => {
        const file = cf({}, [outbound('hi'), inbound('what day can you come? back soon with the measurement')]);
        const rules = triageRules(file);
        expect(rules.exceptions).toEqual([]);
        expect(rules.dateAsked).toBe(true);
        expect(rules.customerPromisedMore).toBe(true);
        expect(decide({ proposal: null, guards: null, pack: getPack('customer.default'), triage: rules, caseFile: file, now: DAY_NOW })).toEqual({ kind: 'none', reason: 'waiting_for_promised' });
    });
    it('on the interim path the rules\' date_question is kept whatever the model says', () => {
        const rules = triageRules(cf({ quote: PAID_QUOTE, stage: 'booked' }, [outbound('Booked.'), inbound('can we move it to another day?')]));
        const merged = mergeTriage(rules, { ...modelWithDate, exceptions: [], lane: 'scoper' }, 'haiku');
        expect(merged.exceptions).toContain('date_question');
        expect(merged.lane).toBe('ben');
    });
    it('the other model exceptions are untouched by the date rule', () => {
        const rules = triageRules(cf({}, [outbound('hi'), inbound('when could you come?')]));
        expect(mergeTriage(rules, { ...modelWithDate, exceptions: ['date_question', 'out_of_scope'] }, 'haiku').exceptions).toEqual(['out_of_scope']);
    });
    it('the triage prompt no longer tells the model to raise date_question', () => {
        expect(TRIAGE_SYSTEM).not.toMatch(/dates or availability \(date_question\)/);
        expect(TRIAGE_SYSTEM).toMatch(/date_question is NOT yours to add/);
    });
});

// ------------------------------------------------------------------ the line itself passes the guards (§5.2 stays)

describe('"Dates come with your quote" carries no date, so date_promise passes it', () => {
    const file = cf({}, [outbound('Could you send a photo?'), inbound('Can you come Tuesday morning?')]);

    it('the exact line and the bubble variant trip no detector', () => {
        for (const body of [DATES_LINE, DATES_BUBBLES.join('\n---\n')]) {
            expect(detectDatePromise(body), body).toBeNull();
            expect(detectSoftCommitment(body), body).toBeNull();
            expect(detectDurationClaim(body), body).toBeNull();
            expect(checkDraft({ body, intent: 'ask_gap', quoteSeen: false, quoteTotalPence: null, customerText: 'Can you come Tuesday morning?' }), body).toBeNull();
        }
    });
    it('the Scoper\'s own belt accepts it, and the customer.default guard set passes it', () => {
        expect(checkProposedBody({ bubbles: DATES_BUBBLES, intent: 'ask_gap', caseFile: file })).toBeNull();
        const verdict = checkProposal({ intent: 'ask_gap', body: DATES_BUBBLES, reasons: ['r'] }, getPack('customer.default'), file);
        expect(verdict).toMatchObject({ ok: true, guardsHit: [], escalate: false });
    });
    it('the guard is still there: a reply that names a day is refused and escalates as before', () => {
        const verdict = checkProposal({ intent: 'ask_gap', body: ['Tuesday morning works, see you then.'], reasons: ['r'] }, getPack('customer.default'), file);
        expect(verdict.ok).toBe(false);
        expect(verdict.guardsHit).toContain('date_promise');
        expect(verdict.escalate).toBe(true);
        expect(getPack('customer.default').guardSet).toContain('date_promise');
        expect(getPack('customer.post_quote').guardSet).toContain('date_promise');
    });
});

// ------------------------------------------------------------------ what the Scoper is told

describe('the Scoper is told the §7 table, not to flag dates', () => {
    it('the core prompt says the line and no longer lists dates as Ben\'s', () => {
        const core = loadScoperCore();
        expect(core).toMatch(/Dates come with your quote\./);
        expect(core).toMatch(/DATES ARE NOT BEN'S/);
        expect(core).not.toMatch(/TWO THINGS ARE BEN'S/);
        expect(core).toMatch(/FLAG CHARTER\. flag\(exception, note\) exists for: money decisions, complaints/);
        expect(core).not.toMatch(/[—–]/);
    });
    it('the post-quote fragment no longer says flag(\'date_question\') when there is no quote', () => {
        expect(loadScoperPostQuote()).not.toMatch(/flag\('date_question'\)/);
        expect(loadScoperPostQuote()).toMatch(/Dates come with your quote\./);
    });
    it('the system block for customer.default no longer names date_question as a Ben exception, and stays a scoping prompt', () => {
        const system = buildScoperSystem(getPack('customer.default'), { voice: 'VOICE STUB' });
        expect(system).toMatch(/EXCEPTIONS THAT GO TO BEN in this pack: complaint, trust_concern, refund, out_of_scope, regulated_trade, money_question, callback_requested\./);
        expect(system).not.toMatch(/POST-QUOTE/); // point_to_picker on the default pack must not bolt the post-quote fragment on
        expect(system).toMatch(/point_to_picker/);
    });
    it('the case file render states which row applies', () => {
        const noQuote = cf({}, [outbound('hi'), inbound('when could you come?')]);
        const noQuoteText = renderCaseFile(noQuote, triageRules(noQuote));
        expect(noQuoteText).toMatch(/DATE ASKED: .*No quote is out yet: say "Dates come with your quote\."/);
        const live = cf({ stage: 'quote_sent', quote: LIVE_QUOTE }, [outbound('quote link'), inbound('when could you come?')]);
        expect(renderCaseFile(live, triageRules(live))).toMatch(/DATE ASKED: .*point them at the date picker on \/quote\/q1/);
        const plain = cf({}, [outbound('hi'), inbound('the tap is in the kitchen')]);
        expect(renderCaseFile(plain, triageRules(plain))).not.toMatch(/DATE ASKED/);
    });
    it('sanity: the fixtures above really are the customer\'s last inbound', () => {
        const file = cf({}, [outbound('hi'), inbound('when could you come?')]);
        expect(lastInbound(file)?.body).toBe('when could you come?');
        const tri: TriageResult = triageRules(file);
        expect(tri.source).toBe('rules');
    });
});
