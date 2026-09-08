/**
 * B7a vitest: the send preconditions — the deterministic gate on the MOVE of a SEND-tier customer
 * reply. Pure, no model, no DB. Each rule is pinned both ways (refuses the bad shape, allows the
 * plain case), then through the real `decide` at SEND vs DRAFT, then over the five incident
 * contexts from eval-cases/guards/incident-v2-unguarded.json with a synthetic live quote.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { decide, isReactive, REACTIVE_WINDOW_MINUTES } from './decide';
import { getPack, PACKS, applyTierOverlay, isNeverSend } from './packs';
import { sendPrecondition, PRECONDITION, PRECONDITION_REASON_PREFIX, PRECONDITIONED_INTENTS, newestConversationItem, lastInboundBroughtSomething } from './send-preconditions';
import { triageRules } from './triage';
import { caseFileFromContext } from '../evals/case-file-from-context';
import type { EvalCaseV2 } from '../evals/case-schema';
import type { CaseFile, PolicyPack, Proposal, TimelineItem, TriageResult, GuardVerdict } from './types';

const NOW = new Date('2026-09-07T10:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const inbound = (body: string, m = 2, extra: Partial<TimelineItem> = {}): TimelineItem => ({ at: minsAgo(m), kind: 'message_in', channel: 'whatsapp', body, by: 'customer', ...extra });
const outbound = (body: string, m = 1): TimelineItem => ({ at: minsAgo(m), kind: 'message_out', channel: 'whatsapp', body, by: 'agent.scoper' });

function cf(over: Partial<CaseFile> = {}): CaseFile {
    const timeline = over.timeline ?? [outbound('What needs doing?', 5), inbound('Need a tap fitting in the kitchen', 2)];
    const lastIn = [...timeline].filter((t) => t.kind === 'message_in').sort((a, b) => a.at.localeCompare(b.at)).pop();
    return {
        conversationId: 'c1', phone: '+447700900001', audience: 'customer', stage: 'scoping', contactName: 'Sam',
        media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: lastIn?.at ?? null, channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: NOW.toISOString(),
        ...over, timeline,
    };
}
const tri = (over: Partial<TriageResult> = {}): TriageResult => ({ audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [], reasons: ['r'], source: 'rules', ...over });
const prop = (over: Partial<Proposal> = {}): Proposal => ({ intent: 'ask_gap', body: ['Is it a mixer tap or two separate taps?'], reasons: ['gap'], ...over });
const ok: GuardVerdict = { ok: true, guardsHit: [], escalate: false, notes: [] };
const QUOTE = { slug: 'q1', total: 32000, lines: 1, viewedAt: null, expiresAt: null, paid: false };
const check = (intent: string, over: { caseFile?: Partial<CaseFile>; triage?: Partial<TriageResult>; proposal?: Partial<Proposal>; now?: Date } = {}) =>
    sendPrecondition({ intent, caseFile: cf(over.caseFile), triage: tri(over.triage), proposal: prop({ intent: intent as any, ...over.proposal }), now: over.now ?? NOW });

describe('sendPrecondition — every customer intent', () => {
    it('allows the plain reactive gap ask on a fresh pre-quote thread', () => {
        expect(check('ask_gap')).toBeNull();
    });
    it('refuses a proactive send (the customer has not written within the reactive window)', () => {
        const stale = cf({ timeline: [inbound('Need a tap fitting', REACTIVE_WINDOW_MINUTES + 1)] });
        expect(isReactive(stale, NOW)).toBe(false);
        expect(check('ask_gap', { caseFile: stale })).toBe(PRECONDITION.notReactive);
        expect(check('ask_gap', { caseFile: cf({ window: { canFreeform: true, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' } }) })).toBe(PRECONDITION.notReactive);
    });
    it('refuses a second outbound in a row: the newest conversation item is ours', () => {
        const ours = cf({ timeline: [inbound('Need a tap fitting', 3), outbound('Which room?', 1)] });
        expect(newestConversationItem(ours)?.kind).toBe('message_out');
        expect(check('ask_gap', { caseFile: ours })).toBe(PRECONDITION.oursIsNewest);
        const call = cf({ timeline: [inbound('Need a tap fitting', 3), { at: minsAgo(1), kind: 'call_out', channel: 'call' }] });
        expect(check('ask_gap', { caseFile: call })).toBe(PRECONDITION.oursIsNewest);
        const draft = cf({ timeline: [inbound('Need a tap fitting', 3), { at: minsAgo(1), kind: 'draft_pending', body: 'Which room?' }] });
        expect(check('ask_gap', { caseFile: draft })).toBe(PRECONDITION.oursIsNewest);
    });
    it('a note or a flag after the customer\'s message is not a turn of ours', () => {
        const noted = cf({ timeline: [inbound('Need a tap fitting', 3), { at: minsAgo(1), kind: 'note', body: 'internal' }, { at: minsAgo(1), kind: 'flag', body: 'x' }] });
        expect(check('ask_gap', { caseFile: noted })).toBeNull();
    });
    it('timeline order does not matter: the newest item is found by time', () => {
        const shuffled = cf({ timeline: [outbound('Which room?', 1), inbound('Need a tap fitting', 3)] });
        expect(check('ask_gap', { caseFile: shuffled })).toBe(PRECONDITION.oursIsNewest);
        const fine = cf({ timeline: [inbound('Need a tap fitting', 1), outbound('Which room?', 3)] });
        expect(check('ask_gap', { caseFile: fine })).toBeNull();
    });
    it('refuses an empty body (BACKLOG D4) for any intent', () => {
        expect(check('ask_gap', { proposal: { body: [] } })).toBe(PRECONDITION.emptyBody);
        expect(check('ask_gap', { proposal: { body: ['', '  '] } })).toBe(PRECONDITION.emptyBody);
    });
    it('refuses an intent with no rule, and the ruled set is exactly PRD §5.1', () => {
        expect(check('holding', { proposal: { body: ['Got it, back shortly.'] } })).toBe('no_rule:holding');
        expect(check('clarify_scope', { proposal: { body: ['So that is one tap in the kitchen.'] } })).toBe('no_rule:clarify_scope');
        expect(check('closing', { proposal: { body: ['Cheers, speak soon.'] } })).toBe('no_rule:closing');
        expect([...PRECONDITIONED_INTENTS]).toEqual(['ask_gap', 'confirm_received', 'point_to_quote_page', 'point_to_picker']);
    });
});

describe('sendPrecondition — ask_gap', () => {
    it('refuses a gap ask with a quote on the case file, paid or not', () => {
        expect(check('ask_gap', { caseFile: { quote: QUOTE } })).toBe(PRECONDITION.askGapQuoteOnCase);
        expect(check('ask_gap', { caseFile: { quote: { ...QUOTE, paid: true }, stage: 'booked' } })).toBe(PRECONDITION.askGapQuoteOnCase);
    });
    it('refuses a gap ask on a run where a date was asked', () => {
        expect(check('ask_gap', { triage: { dateAsked: true } })).toBe(PRECONDITION.askGapDateAsked);
        expect(check('ask_gap', { triage: { dateAsked: false } })).toBeNull();
    });
    it('refuses a gap ask under a customer question', () => {
        expect(check('ask_gap', { caseFile: cf({ timeline: [inbound('Can you do a tap in the kitchen?', 2)] }) })).toBe(PRECONDITION.askGapCustomerQuestion);
        expect(check('ask_gap', { caseFile: cf({ timeline: [inbound('Tap in the kitchen please', 2)] }) })).toBeNull();
    });
    it('reads the customer\'s NEWEST message, not an older question', () => {
        const older = cf({ timeline: [inbound('How does this work?', 10), outbound('Send a photo and we go from there.', 8), inbound('Here is the tap', 2)] });
        expect(check('ask_gap', { caseFile: older })).toBeNull();
    });
});

describe('sendPrecondition — confirm_received', () => {
    it('allows an acknowledgement when media arrived on the last inbound', () => {
        const withMedia = cf({ timeline: [inbound('here you go', 2, { mediaIds: ['m1', 'm2'] })], media: [{ id: 'm1', kind: 'image' }, { id: 'm2', kind: 'image' }] });
        expect(lastInboundBroughtSomething(withMedia)).toBe(true);
        expect(check('confirm_received', { caseFile: withMedia, proposal: { body: ['Got those, thanks.'] } })).toBeNull();
    });
    it('allows an acknowledgement when a UK postcode arrived, however it is typed', () => {
        for (const pc of ['NG7 4FT', 'ng74ft', 'Ng37eg']) {
            expect(check('confirm_received', { caseFile: cf({ timeline: [inbound(pc, 2)] }), proposal: { body: ['Perfect, got your postcode.'] } })).toBeNull();
        }
    });
    it('refuses a bare "we\'ve got it" when nothing arrived — even if the customer says it was sent', () => {
        expect(check('confirm_received', { caseFile: cf({ timeline: [inbound('Sent the video just now', 2)] }), proposal: { body: ['Got it, thanks.'] } })).toBe(PRECONDITION.confirmNothingArrived);
        expect(check('confirm_received', { caseFile: cf({ timeline: [inbound('I will come back to you once I know more.', 2)] }), proposal: { body: ['No worries, thanks for the update.'] } })).toBe(PRECONDITION.confirmNothingArrived);
    });
    it('media on an OLDER inbound does not count for this acknowledgement', () => {
        const older = cf({ timeline: [inbound('photos', 10, { mediaIds: ['m1'] }), outbound('Thanks, and the postcode?', 8), inbound('will send it later', 2)], media: [{ id: 'm1', kind: 'image' }] });
        expect(check('confirm_received', { caseFile: older, proposal: { body: ['Got it.'] } })).toBe(PRECONDITION.confirmNothingArrived);
    });
});

describe('sendPrecondition — point_to_quote_page and point_to_picker', () => {
    const page = { body: ['It is all itemised on your quote page: https://handyservices.app/quote/q1'] };
    const noSlug = { body: ['It is all on your quote page.'] };
    it('point_to_quote_page needs a quote (paid or not) and the slug in the body', () => {
        expect(check('point_to_quote_page', { caseFile: { quote: QUOTE }, proposal: page })).toBeNull();
        expect(check('point_to_quote_page', { caseFile: { quote: { ...QUOTE, paid: true }, stage: 'booked' }, proposal: page })).toBeNull();
        expect(check('point_to_quote_page', { caseFile: { quote: null }, proposal: page })).toBe(PRECONDITION.quotePageNoQuote);
        expect(check('point_to_quote_page', { caseFile: { quote: QUOTE }, proposal: noSlug })).toBe(PRECONDITION.quotePageSlugNotInBody);
    });
    it('point_to_picker needs a LIVE (unpaid) quote and the slug in the body', () => {
        expect(check('point_to_picker', { caseFile: { quote: QUOTE, stage: 'quote_sent' }, proposal: page })).toBeNull();
        expect(check('point_to_picker', { caseFile: { quote: null }, proposal: page })).toBe(PRECONDITION.pickerNoLiveQuote);
        expect(check('point_to_picker', { caseFile: { quote: { ...QUOTE, paid: true }, stage: 'booked' }, proposal: page })).toBe(PRECONDITION.pickerNoLiveQuote);
        expect(check('point_to_picker', { caseFile: { quote: QUOTE, stage: 'quote_sent' }, proposal: noSlug })).toBe(PRECONDITION.pickerSlugNotInBody);
    });
    it('the slug is read across bubbles', () => {
        expect(check('point_to_picker', { caseFile: { quote: QUOTE, stage: 'quote_sent' }, proposal: { body: ['Pick a day on your quote page.', 'https://handyservices.app/quote/q1'] } })).toBeNull();
    });
});

// ---------------------------------------------------------------- through the real decide

const sendPack = (base: PolicyPack, intent: string): PolicyPack => ({ ...base, tierByIntent: { ...base.tierByIntent, [intent]: 'SEND' } });

describe('decide at SEND tier runs the preconditions; at DRAFT nothing changes', () => {
    const pack = getPack('customer.default');
    it('SEND + every precondition met → send with the Scoper approver', () => {
        expect(decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf(), now: NOW })).toEqual({ kind: 'send', approver: 'agent.scoper' });
    });
    it('SEND + a refused precondition → pending for Ben with the reason named', () => {
        const d = decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf({ quote: QUOTE }), now: NOW });
        expect(d).toMatchObject({ kind: 'pending', reason: `${PRECONDITION_REASON_PREFIX}${PRECONDITION.askGapQuoteOnCase}` });
        if (d.kind === 'pending') expect(new Date(d.dueAt).getTime()).toBeGreaterThan(NOW.getTime());
    });
    it('DRAFT tier is byte-for-byte what it was: the preconditions are never consulted', () => {
        // T35 promoted four intents on this pack, so the DRAFT arm is shown with one it did not
        // touch. The claim is the same: at DRAFT, decide never reaches sendPrecondition.
        const draft = prop({ intent: 'clarify_scope' });
        const before = decide({ proposal: draft, guards: ok, pack, triage: tri(), caseFile: cf({ quote: QUOTE }), now: NOW });
        expect(before).toMatchObject({ kind: 'pending', reason: expect.stringMatching(/tier DRAFT/) });
        expect((before as any).reason).not.toMatch(/precondition/);
        const proactive = decide({ proposal: draft, guards: ok, pack, triage: tri(), caseFile: cf({ timeline: [inbound('x', 500)] }), now: NOW });
        expect((proactive as any).reason).not.toMatch(/precondition/);
    });
    it('a SEND-tier intent on the pack\'s neverSend list is refused as a belt, even if a stored tier says SEND', () => {
        const forced: PolicyPack = { ...pack, tierByIntent: { holding: 'SEND' } }; // bypasses applyTierOverlay on purpose
        const d = decide({ proposal: prop({ intent: 'holding', body: ['Got it, back shortly.'] }), guards: ok, pack: forced, triage: tri(), caseFile: cf(), now: NOW });
        expect(d).toMatchObject({ kind: 'pending', reason: expect.stringMatching(/^precondition: never_send:holding/) });
    });
    it('the overlay itself will not put a neverSend intent at SEND', () => {
        const overlaid = applyTierOverlay(pack, { holding: 'SEND', ask_gap: 'SEND' });
        expect(overlaid.tierByIntent.holding).toBeUndefined();
        expect(overlaid.tierByIntent.ask_gap).toBe('SEND');
    });
    it('the rules packs (content-free, SEND by construction) never see the preconditions', () => {
        const rules = getPack('rules.first_contact');
        const stale = cf({ timeline: [inbound('Need a tap fitting', 500)] }); // proactive, and ask_media has no rule
        const d = decide({ proposal: prop({ intent: 'ask_media', body: ['Could you send a quick video?'] }), guards: ok, pack: rules, triage: tri({ lane: 'rules', intent: 'ask_media' }), caseFile: stale, now: NOW });
        expect(d).toEqual({ kind: 'send', approver: 'rules.ask' });
    });
    it('runs last: an open exception, the hours and the window keep their own reasons and due times', () => {
        const flagged = decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf({ quote: QUOTE, tags: ['needs_ben'] }), now: NOW });
        expect(flagged).toMatchObject({ kind: 'pending', reason: expect.stringMatching(/open exception/) });
        const lateNight = new Date('2026-09-07T22:30:00Z');
        const proactive = decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf({ timeline: [inbound('x', 180)] }), now: lateNight });
        expect(proactive).toMatchObject({ kind: 'pending', reason: expect.stringMatching(/outside proactive hours/) });
        const shut = decide({ proposal: prop(), guards: ok, pack: sendPack(pack, 'ask_gap'), triage: tri(), caseFile: cf({ window: { canFreeform: false, templateRequired: true, lastInboundAt: minsAgo(2), channelLastUsed: 'whatsapp' } }), now: NOW });
        expect(shut).toMatchObject({ kind: 'pending', reason: expect.stringMatching(/window shut/) });
    });
    it('contractor and internal packs are untouched by the customer preconditions', () => {
        const contractor = getPack('contractor.default');
        const d = decide({ proposal: prop({ intent: 'confirm_receipt', body: ['Received, cheers.'] }), guards: ok, pack: sendPack(contractor, 'confirm_receipt'), triage: tri({ audience: 'contractor', lane: 'contractor' }), caseFile: cf({ audience: 'contractor', timeline: [inbound('On my way', 60)] }), now: NOW });
        expect((d as any).reason ?? '').not.toMatch(/precondition/);
    });
});

describe('what may hold a SEND tier at all (B7a, as T35 left it)', () => {
    it('only customer.default carries a static SEND, only for the four §5.1 intents, and no pack defaults to SEND', () => {
        const agentPacks = Object.values(PACKS).filter((p) => p.audience === 'customer' && p.id.startsWith('customer.'));
        expect(agentPacks.map((p) => p.id).sort()).toEqual(['customer.default', 'customer.exception', 'customer.post_quote']);
        for (const pack of agentPacks) {
            expect(pack.defaultTier, pack.id).not.toBe('SEND');
            // T35 (8 Sep 2026): customer.default starts the four PRECONDITIONED_INTENTS at SEND
            // and nothing else; the other two agent-facing customer packs are untouched.
            const expected = pack.id === 'customer.default'
                ? Object.fromEntries([...PRECONDITIONED_INTENTS].map((i) => [i, 'SEND']))
                : {};
            expect(pack.tierByIntent, pack.id).toEqual(expected);
        }
    });
    it('every statically promoted intent has a precondition rule and is not on neverSend', () => {
        const pack = getPack('customer.default');
        for (const [intent, tier] of Object.entries(pack.tierByIntent)) {
            if (tier !== 'SEND') continue;
            expect(PRECONDITIONED_INTENTS, `${intent} would refuse with no_rule`).toContain(intent as any);
            expect(isNeverSend(pack, intent), intent).toBe(false);
        }
    });
});

// ---------------------------------------------------------------- the five incident contexts

const INCIDENT_FILE = path.resolve(process.cwd(), 'eval-cases/guards/incident-v2-unguarded.json');
const FOUR_POST_QUOTE = ['guards-incident-9bdaa1853b', 'guards-incident-5e5f585796', 'guards-incident-bc77d44614', 'guards-incident-ef67198bd0'];
const FIFTH_PRE_QUOTE = 'guards-incident-e83dd6aaaf';

function incidentCase(id: string): EvalCaseV2 {
    const raw = JSON.parse(fs.readFileSync(INCIDENT_FILE, 'utf8'));
    const c = (raw.cases as EvalCaseV2[]).find((x) => x.id === id);
    if (!c) throw new Error(`no incident case ${id}`);
    return c;
}
/** The case file as it stood BEFORE the recorded reply: the trailing outbound context IS the reply. */
function contextBeforeReply(c: EvalCaseV2, quote: EvalCaseV2['quote'] | undefined, now: Date): CaseFile {
    const context = [...(c.context ?? [])];
    while (context.length && context[context.length - 1].direction === 'outbound') context.pop();
    return caseFileFromContext({ ...c, context, quote }, now);
}
const recordedReply = (c: EvalCaseV2): Proposal => ({ intent: 'ask_gap', body: (c.candidate?.body ?? '').split(/\s*---\s*/).filter(Boolean), reasons: ['recorded'] });

describe('the five incident move failures (BACKLOG D2, rewritten)', () => {
    it('each of the five carries clean text: the eval case forbids any text guard from firing', () => {
        for (const id of [...FOUR_POST_QUOTE, FIFTH_PRE_QUOTE]) expect(incidentCase(id).expected.guardsMustNotTrip, id).toBe(true);
    });
    it('the four post-quote contexts, with a synthetic live quote and the money lexicon out of the way, are refused at SEND tier by the precondition', () => {
        for (const id of FOUR_POST_QUOTE) {
            const c = incidentCase(id);
            const caseFile = contextBeforeReply(c, { slug: 'synthq', totalPence: 42500, seen: true }, NOW);
            expect(caseFile.quote?.paid, id).toBe(false);
            // With the lexicon: triageRules already lanes every one of these to Ben on the customer's own words.
            const withLexicon = triageRules(caseFile);
            expect(withLexicon.lane, `${id} lexicon`).toBe('ben');
            // Without it (the wording slips past RE_MONEY): the precondition holds the MOVE on the case file alone.
            const noLexicon: TriageResult = { ...withLexicon, lane: 'post_quote', exceptions: [] };
            const pack = sendPack(getPack('customer.post_quote'), 'ask_gap');
            const now = new Date(new Date(caseFile.window.lastInboundAt!).getTime() + 60_000);
            const d = decide({ proposal: recordedReply(c), guards: ok, pack, triage: noLexicon, caseFile, now });
            // The code is whichever rule fires first, and the fixture records it per case: three
            // are ask_gap:quote_on_case; the fourth (9bdaa1853b) asks a third time for a postcode
            // the customer has twice refused, which T28's ask-once belt names first. All four hold.
            expect(d, id).toMatchObject({ kind: 'pending', reason: `${PRECONDITION_REASON_PREFIX}${c.expected.precondition}` });
            expect([PRECONDITION.askGapQuoteOnCase, PRECONDITION.postcodeAlreadyAsked], id).toContain(c.expected.precondition);
        }
    });
    it('the fifth ("Tell me price", pre-quote) is laned to Ben by the money lexicon in triageRules before any agent runs', () => {
        const c = incidentCase(FIFTH_PRE_QUOTE);
        const caseFile = contextBeforeReply(c, undefined, NOW);
        const t = triageRules(caseFile);
        expect(t.lane).toBe('ben');
        expect(t.exceptions).toContain('money_question');
        const pack = sendPack(getPack('customer.default'), 'ask_gap');
        expect(decide({ proposal: recordedReply(c), guards: ok, pack, triage: t, caseFile, now: NOW })).toMatchObject({ kind: 'flag', exception: 'money_question' });
        // The honest limit, pinned: with the lexicon off the precondition alone would let this gap ask through.
        const noLexicon: TriageResult = { ...t, lane: 'scoper', exceptions: [] };
        const now = new Date(new Date(caseFile.window.lastInboundAt!).getTime() + 60_000);
        expect(sendPrecondition({ intent: 'ask_gap', caseFile, triage: noLexicon, proposal: recordedReply(c), now })).toBeNull();
    });
});
