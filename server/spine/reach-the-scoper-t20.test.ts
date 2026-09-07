/**
 * T20 vitest (docs/comms-build/BRIEF-T20-reach-the-scoper.md). No database, no model.
 *
 *   Fault A   the model may not move a thread onto the rules lane (mergeTriage); a second
 *             customer message with no outbound is not first contact (triageRules); the whole
 *             thing end to end through `triage` with a fake Haiku that answers `rules`.
 *   Fault B   ask once: the media-ask reader over the thread; the Scoper's tool refuses a second
 *             media ask and the rendered case file says so; the send-precondition belt.
 *   Addition 1  thank once: the acknowledgement reader; the tool and the belt.
 *   Addition 2  a bare pause is not a promise; a named deliverable or a deferred return still is;
 *               decide no longer waits on "one second let me check".
 *   Price screen  the payload carries the customer-media fact off the thread it already embeds.
 */
import { describe, it, expect, vi } from 'vitest';
import { triage, triageRules, mergeTriage, customerPromisedMore, RE_PAUSE_ONLY, type TriageModelOutput } from './triage';
import { decide } from './decide';
import { resolvePack, setTierOverlayForTests } from './packs';
import { sendPrecondition, PRECONDITION } from './send-preconditions';
import { asksForMedia, acknowledgesMedia, mediaAskState, mediaAckState, turnsFromCaseFile, turnsFromThreadMessages, turnsFromMessageRows, mediaAskLine } from './media-ask';
import { createScoperAgent, renderCaseFile } from './agents/scoper';
import { buildPricePayload, type DraftRowShape } from './price-screen';
import { buildThread } from './price-brief';
import type { AgentRunResult, AgentTool } from '../agents/runner';
import type { CaseFile, PolicyPack, Proposal, TimelineItem, TriageResult } from './types';

// ---------------------------------------------------------------- fixtures

const NOW = new Date('2026-09-07T17:50:00.000Z');
const at = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString(); // m minutes ago

const inbound = (body: string, minsAgo: number, extra: Partial<TimelineItem> = {}): TimelineItem => ({ at: at(minsAgo), kind: 'message_in', channel: 'whatsapp', body, by: 'customer', ...extra });
const outbound = (body: string, minsAgo: number, extra: Partial<TimelineItem> = {}): TimelineItem => ({ at: at(minsAgo), kind: 'message_out', channel: 'whatsapp', body, ...extra });

function cf(timeline: TimelineItem[], over: Partial<CaseFile> = {}): CaseFile {
    const lastIn = [...timeline].filter((t) => t.kind === 'message_in').sort((a, b) => a.at.localeCompare(b.at)).pop();
    return {
        conversationId: 'c_t20', phone: '+447700900042', audience: 'customer', stage: 'enquiry', contactName: 'Sam',
        timeline, media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: lastIn?.at ?? null, channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h'.repeat(64), builtAt: NOW.toISOString(),
        ...over,
    };
}

const ACK = 'Hi Sam, thanks for getting in touch. --- Is it OK if we give you a quick call to run through it? Or just reply here with the details.';
const LIST = 'its just a few jobs, happy to send a list:\n- Mount tv to wall\n- Fit lock to bathrrom door\n- Change a light fitting';

/** The Fault A thread as the ledger showed it: ack out at 17:46, the list at 17:47. */
const faultA = () => cf([inbound('Hi i have a few jobs i need a quote for please', 4), outbound(ACK, 3), inbound(LIST, 2)]);

const modelSaysRules = (over: Partial<TriageModelOutput> = {}): TriageModelOutput => ({
    audience: 'customer', intent: 'ack_enquiry', lane: 'rules', exceptions: [], stage: 'enquiry',
    tags: ['needs_quote', 'chillwell', 'multiple_jobs'], reasons: ['first contact: only our ack has gone'], ...over,
});

// ---------------------------------------------------------------- Fault A

describe('T20 Fault A — a reply to the ack reaches an agent, never the dead rules lane', () => {
    it('triageRules: the ack is an outbound, so the reply is not first contact (scoper by default)', () => {
        const r = triageRules(faultA());
        expect(r.lane).toBe('scoper');
        expect(r.reasons).toContain('no rule fired: scoper');
    });

    it('mergeTriage: the model may not move the thread ONTO the rules lane; the rules\' lane is kept, the ack intent dropped, the reason recorded', () => {
        const rules = triageRules(faultA());
        const merged = mergeTriage(rules, modelSaysRules(), 'haiku');
        expect(merged.lane).toBe('scoper');
        expect(merged.intent).toBe('unknown');
        expect(merged.tags).toEqual(expect.arrayContaining(['needs_quote', 'chillwell', 'multiple_jobs']));
        expect(merged.reasons.some((x) => /model chose lane rules on a thread that is not first contact/.test(x))).toBe(true);
    });

    it('mergeTriage: with needs_quote already on the row the kept lane is the clerk\'s', () => {
        const rules = triageRules(cf(faultA().timeline, { tags: ['needs_quote'] }));
        expect(rules.lane).toBe('quote_clerk');
        expect(mergeTriage(rules, modelSaysRules(), 'haiku').lane).toBe('quote_clerk');
    });

    it('mergeTriage: on a genuine first contact the model may confirm rules, or leave it for the scoper (unchanged)', () => {
        const first = triageRules(cf([inbound('hi, need some shelves put up', 1)]));
        expect(first.lane).toBe('rules');
        expect(mergeTriage(first, modelSaysRules(), 'haiku').lane).toBe('rules');
        expect(mergeTriage(first, modelSaysRules({ lane: 'scoper', intent: 'unknown' }), 'haiku').lane).toBe('scoper');
    });

    it('mergeTriage: an exception still wins over everything', () => {
        const rules = triageRules(faultA());
        expect(mergeTriage(rules, modelSaysRules({ exceptions: ['money_question'] }), 'haiku').lane).toBe('ben');
    });

    it('end to end through triage with a fake Haiku answering `rules`: the run lanes the scoper, the pack is customer.default', async () => {
        const llm = vi.fn(async () => ({ data: modelSaysRules(), usage: null, model: 'fake-haiku' }));
        const file = faultA();
        const result = await triage(file, { llm, writeConversation: false, persist: false, model: 'fake-haiku' });
        expect(llm).toHaveBeenCalledTimes(1);
        expect(result.source).toBe('model');
        expect(result.lane).toBe('scoper');
        expect(resolvePack(file, result).id).toBe('customer.default');
    });

    it('triageRules: two customer messages with nothing from us between are NOT first contact (the ack did not land)', () => {
        const r = triageRules(cf([inbound('Hi i have a few jobs i need a quote for please', 4), inbound(LIST, 2)]));
        expect(r.lane).toBe('scoper');
        expect(r.reasons.some((x) => /2 customer messages: the ack did not land/.test(x))).toBe(true);
        // …and the tags still route: needs_quote on the row → the clerk.
        expect(triageRules(cf([inbound('Hi', 4), inbound(LIST, 2)], { tags: ['needs_quote'] })).lane).toBe('quote_clerk');
    });

    it('triageRules: one customer message and no outbound is still first contact (the ack answers it)', () => {
        expect(triageRules(cf([inbound('hi, need some shelves put up', 1)]))).toMatchObject({ lane: 'rules', intent: 'ack_enquiry' });
        expect(triageRules(cf([inbound('here you go', 1, { mediaIds: ['m1'] })]))).toMatchObject({ lane: 'rules', intent: 'ack_photos' });
    });

    it('triageRules: a call (its own row and its call-channel message) does not count as a second message', () => {
        const call: TimelineItem = { at: at(5), kind: 'call_in', channel: 'call', by: 'customer', transcript: 'hello, I need a fence panel fixing' };
        const callMsg: TimelineItem = { at: at(5), kind: 'message_in', channel: 'call', by: 'customer', body: 'Inbound call' };
        expect(triageRules(cf([call, callMsg, inbound('Hi, following up on my call about the fence', 1)])).lane).toBe('rules');
        expect(triageRules(cf([call, callMsg, inbound('Hi, following up on my call', 3), inbound('here is the postcode NG7 2AB', 1)])).lane).toBe('scoper');
    });

    it('decide on the rules lane still says "no proposal" — the lane runs no agent, which is why nothing may be moved onto it', () => {
        const file = cf([inbound('hi', 1)]);
        const tri = triageRules(file);
        expect(decide({ proposal: null, guards: null, pack: resolvePack(file, tri), triage: tri, caseFile: file, now: NOW })).toEqual({ kind: 'none', reason: 'no proposal' });
    });
});

// ---------------------------------------------------------------- Fault B: ask once

const PHOTO_ASK = 'Could you send a photo of the door and the wall around it? --- That way we can quote it right first time.';

/** Fault B's shape: we asked for a photo, they replied twice with the location and no media. */
const faultB = () => cf([
    inbound('Hi, I need a ring doorbell fitting at NG7 2AB', 20),
    outbound('Hi, thanks for getting in touch.', 19),
    outbound(PHOTO_ASK, 10),
    inbound("It's on the front door, left of the frame", 6),
    inbound('Front door, to the left as you look at it, brick wall', 2),
], { stage: 'scoping', tags: ['needs_quote', 'needs_photos'] });

describe('T20 Fault B — the media-ask reader', () => {
    it('asksForMedia recognises every asker on the thread and ignores thanks, answers and negations', () => {
        for (const t of [
            'Could you send a quick photo or video of the job?',                              // rules layer ask_media
            "If you can, send a quick photo or video of the job so we're ready when we call.", // first-contact ack, askForMedia
            'Could you send a photo of the door and the wall around it?',                     // Scoper ask_gap
            'can you whatsapp me a pic of it',                                                // Ben
            'A photo of the current one helps us get it right first time.',                   // the soft ask
            'Any chance of a quick video?',
        ]) expect(asksForMedia(t), t).toBe(true);
        for (const t of [
            'Thanks for the photos, I will get the quote over to you.',
            'Got the photo, that is really helpful.',
            'Photos are on your quote page.',
            "No need for a photo, we've got enough to go on.",
            'Is it a mixer tap or two separate taps?',
            '',
        ]) expect(asksForMedia(t), t).toBe(false);
    });

    it('mediaAskState: asked → replied without media → outstanding; media since clears it; no ask is nothing', () => {
        expect(mediaAskState(turnsFromCaseFile(faultB()))).toMatchObject({ asked: true, repliedSince: true, mediaSince: false, outstanding: true });
        const withPhoto = cf([...faultB().timeline, inbound('here', 1, { mediaIds: ['m1'] })]);
        expect(mediaAskState(turnsFromCaseFile(withPhoto))).toMatchObject({ asked: true, mediaSince: true, outstanding: false });
        const notReplied = cf([inbound('Hi', 5), outbound(PHOTO_ASK, 1)]);
        expect(mediaAskState(turnsFromCaseFile(notReplied))).toMatchObject({ asked: true, repliedSince: false, outstanding: false });
        expect(mediaAskState(turnsFromCaseFile(cf([inbound('Hi', 5), outbound('What needs doing?', 1)])))).toMatchObject({ asked: false, outstanding: false });
    });

    it('the three adapters read the same fact off the three thread shapes', () => {
        const file = faultB();
        const fromCase = mediaAskState(turnsFromCaseFile(file));
        const messages = file.timeline.map((t, i) => ({ id: `m${i}`, at: t.at, direction: t.kind === 'message_in' ? 'in' as const : 'out' as const, channel: 'whatsapp', body: t.body ?? '', media: t.mediaIds?.length ? { url: '/x', kind: 'image' as const } : null, by: null }));
        const fromThread = mediaAskState(turnsFromThreadMessages(messages));
        const rows = file.timeline.map((t) => ({ createdAt: t.at, direction: t.kind === 'message_in' ? 'inbound' : 'outbound', content: t.body ?? null, mediaUrl: t.mediaIds?.length ? '/x' : null }));
        const fromRows = mediaAskState(turnsFromMessageRows(rows));
        expect(fromThread).toEqual(fromCase);
        expect(fromRows).toEqual(fromCase);
    });

    it('mediaAskLine states the rule only while the ask is outstanding', () => {
        expect(mediaAskLine(mediaAskState(turnsFromCaseFile(faultB())))).toMatch(/^MEDIA ASKED ONCE: .*Do not ask for media again/);
        expect(mediaAskLine(mediaAskState(turnsFromCaseFile(cf([inbound('Hi', 1)]))))).toBeNull();
    });
});

// ---- the Scoper's tool boundary, through the real belt with a scripted model

const PACK: PolicyPack = {
    id: 'customer.default', version: 1, audience: 'customer',
    allowedIntents: ['ask_gap', 'clarify_scope', 'confirm_received', 'faq_from_kb', 'point_to_quote_page', 'closing', 'holding'],
    guardSet: ['money', 'discount', 'date_promise', 'duration_claim', 'capability_claim', 'liability', 'policy_commitment', 'capitulation', 'voice', 'unseen_implication'],
    tierByIntent: {}, defaultTier: 'DRAFT', hours: { reactiveAlways: true, proactiveFromHour: 8, proactiveToHour: 20 },
    exceptionsToBen: ['complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade', 'money_question', 'callback_requested'],
    voiceFile: 'whatsapp-comms.md', templates: {},
};
const tri = (over: Partial<TriageResult> = {}): TriageResult => ({ audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [], reasons: ['t'], source: 'rules', ...over });

type Script = (tools: Record<string, AgentTool>) => Promise<void>;
async function runScoper(file: CaseFile, script: Script): Promise<{ proposal: Proposal | null; goal: string }> {
    let goal = '';
    const runAgent = vi.fn(async (opts: any): Promise<AgentRunResult> => {
        goal = opts.goal;
        await script(Object.fromEntries((opts.tools as AgentTool[]).map((t) => [t.name, t])));
        return { finalText: 'done', transcript: [], turns: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, runId: 'run_t20', model: 'stub', costPence: 0, durationMs: 1 };
    });
    const agent = createScoperAgent({ runAgent: runAgent as any, persist: false, loadQuickReplies: async () => [], now: () => NOW });
    const proposal = await agent.run({ caseFile: file, pack: PACK, triage: tri(), runId: 'run_t20' });
    return { proposal, goal };
}

describe('T20 Fault B — the Scoper asks once', () => {
    it('the tool refuses a second photo ask while the first is outstanding, and the refusal says to proceed', async () => {
        let refusal = '';
        const { proposal } = await runScoper(faultB(), async (tools) => {
            try {
                await tools.propose_reply.run({ intent: 'ask_gap', body: ['Thanks. Could you send a quick photo of the door and the wall around it?'], reasons: ['no media yet'] });
            } catch (e: any) { refusal = e.message; }
        });
        expect(refusal).toMatch(/^Refused: we already asked for a photo or video/);
        expect(refusal).toMatch(/Do not ask for media again/);
        expect(refusal).toMatch(/needs_quote/);
        expect(proposal).toBeNull();
    });

    it('…whatever the intent label says', async () => {
        let refusal = '';
        await runScoper(faultB(), async (tools) => {
            try { await tools.propose_reply.run({ intent: 'clarify_scope', body: ['Which side of the frame? A pic would help.'], reasons: ['gap'] }); } catch (e: any) { refusal = e.message; }
        });
        expect(refusal).toMatch(/^Refused: we already asked/);
    });

    it('the model then proceeds: a confirm with tag needs_quote is accepted and carries the tag', async () => {
        const { proposal } = await runScoper(faultB(), async (tools) => {
            await tools.propose_reply.run({ intent: 'confirm_received', body: ['Got it, front door, left of the frame on brick.', 'I will get your quote over to you.'], reasons: ['proceed without a photo'], tags: ['needs_quote'] });
        });
        expect(proposal?.intent).toBe('confirm_received');
        expect(proposal?.tags).toContain('needs_quote');
    });

    it('the first photo ask on a thread is still allowed', async () => {
        const fresh = cf([inbound('Hi, I need a ring doorbell fitting at NG7 2AB', 2), outbound('Hi, thanks for getting in touch.', 1)]);
        const { proposal } = await runScoper(fresh, async (tools) => {
            await tools.propose_reply.run({ intent: 'ask_gap', body: ['Could you send a photo of the door and the wall around it?'], reasons: ['first ask'] });
        });
        expect(proposal?.intent).toBe('ask_gap');
    });

    it('a photo that arrived after the ask re-opens asking for the one specific missing shot', async () => {
        const withPhoto = cf([...faultB().timeline, inbound('', 1, { mediaIds: ['m1'] })]);
        const { proposal } = await runScoper(withPhoto, async (tools) => {
            await tools.propose_reply.run({ intent: 'ask_gap', body: ['Got the photo, thanks. Could you send one a bit further back, showing the wall next to it?'], reasons: ['wrong shot'] });
        });
        expect(proposal?.intent).toBe('ask_gap');
    });

    it('the rendered case file carries the MEDIA ASKED ONCE line only when the ask is outstanding', async () => {
        const { goal } = await runScoper(faultB(), async () => undefined);
        expect(goal).toMatch(/MEDIA ASKED ONCE: we asked for a photo or video/);
        const plain = renderCaseFile(cf([inbound('Hi', 1)]), tri());
        expect(plain).not.toMatch(/MEDIA ASKED ONCE/);
    });
});

describe('T20 Fault B — the send-precondition belt', () => {
    const prop = (intent: string, body: string[]): Proposal => ({ intent: intent as any, body, reasons: ['t'] });

    it('refuses a media ask at SEND while the ask is outstanding, whatever the intent', () => {
        const file = faultB();
        expect(sendPrecondition({ intent: 'ask_gap', caseFile: file, triage: tri(), proposal: prop('ask_gap', ['Could you send a photo of the door?']), now: NOW })).toBe(PRECONDITION.mediaAlreadyAsked);
        expect(sendPrecondition({ intent: 'confirm_received', caseFile: file, triage: tri(), proposal: prop('confirm_received', ['Got the postcode. Can you send a pic of the door?']), now: NOW })).toBe(PRECONDITION.mediaAlreadyAsked);
    });

    it('lets a non-media ask_gap through on the same thread (the existing rules still apply after it)', () => {
        const file = faultB();
        expect(sendPrecondition({ intent: 'ask_gap', caseFile: file, triage: tri(), proposal: prop('ask_gap', ['Is the wall brick or render where it goes?']), now: NOW })).toBeNull();
    });

    it('through decide at SEND: the second ask becomes a pending draft for Ben with the reason; a first ask sends', () => {
        setTierOverlayForTests(new Map([['customer.default', { ask_gap: 'SEND' as const }]]));
        try {
            const file = faultB();
            const pack = resolvePack(file, tri());
            const d = decide({ proposal: prop('ask_gap', ['Could you send a photo of the door?']), guards: null, pack, triage: tri(), caseFile: file, now: NOW });
            expect(d.kind).toBe('pending');
            expect((d as any).reason).toBe(`precondition: ${PRECONDITION.mediaAlreadyAsked}`);
            const fresh = cf([outbound('Hi, thanks for getting in touch.', 3), inbound('Hi, I need a ring doorbell fitting', 2)]);
            expect(decide({ proposal: prop('ask_gap', ['Could you send a photo of the door?']), guards: null, pack: resolvePack(fresh, tri()), triage: tri(), caseFile: fresh, now: NOW }).kind).toBe('send');
        } finally {
            setTierOverlayForTests(null);
        }
    });
});

// ---------------------------------------------------------------- Addition 1: thank once (Priya, 7 Sep)

const priya = () => cf([
    inbound('the extractor fan in our bathroom has stopped working and the ceiling is getting marked', 5),
    outbound('Hi Priya, thanks for getting in touch. --- Is it OK if we give you a quick call?', 5),
    inbound('This is the fan', 3, { mediaIds: ['m_fan'] }),
    outbound('Thanks Priya, got the photo, that is really helpful. --- Just to scope it right, is the damp patch soft to the touch?', 2.5),
    inbound('its just got black mould marks at the minute', 2),
], { stage: 'scoping', contactName: 'Priya' });

describe('T20 Addition 1 — thank once for the same media', () => {
    it('acknowledgesMedia reads a thank-you or a receipt, not an ask', () => {
        for (const t of ['Thanks Priya, got the photo, that is really helpful.', 'Thanks for the photo, that is helpful.', 'The pictures came through fine.', 'Lovely, got the video.']) expect(acknowledgesMedia(t), t).toBe(true);
        for (const t of ['Could you send a photo of the door?', 'Is the ceiling around the fan soft?', 'Thanks, that makes sense.', '']) expect(acknowledgesMedia(t), t).toBe(false);
    });

    it('mediaAckState: the newest media has been acknowledged → alreadyThanked; new media resets it', () => {
        expect(mediaAckState(turnsFromCaseFile(priya()))).toMatchObject({ alreadyThanked: true });
        const newer = cf([...priya().timeline, inbound('and this', 1, { mediaIds: ['m_2'] })]);
        expect(mediaAckState(turnsFromCaseFile(newer))).toMatchObject({ alreadyThanked: false });
        expect(mediaAckState(turnsFromCaseFile(cf([inbound('hi', 1)])))).toMatchObject({ newestMediaAt: null, alreadyThanked: false });
    });

    it('the tool refuses the 18:10 second thank-you and accepts the substance without it', async () => {
        let refusal = '';
        const { proposal } = await runScoper(priya(), async (tools) => {
            try { await tools.propose_reply.run({ intent: 'clarify_scope', body: ['Thanks for the photo, that is helpful.', 'Just to check, is the ceiling around the fan soft or just marked?'], reasons: ['scope'] }); } catch (e: any) { refusal = e.message; }
            await tools.propose_reply.run({ intent: 'clarify_scope', body: ['Just to check, is the ceiling around the fan soft or just marked?'], reasons: ['scope'] });
        });
        expect(refusal).toMatch(/^Refused: we already thanked them for the photo or video/);
        expect(proposal?.body).toEqual(['Just to check, is the ceiling around the fan soft or just marked?']);
    });

    it('the belt: a second thank-you does not move at SEND', () => {
        const file = cf([...priya().timeline, inbound('NG7 2AB', 1)]);
        expect(sendPrecondition({ intent: 'confirm_received', caseFile: file, triage: tri(), proposal: { intent: 'confirm_received', body: ['Thanks for the photo, that is helpful. Got the postcode too.'], reasons: ['t'] }, now: NOW })).toBe(PRECONDITION.mediaAlreadyAcknowledged);
        expect(sendPrecondition({ intent: 'confirm_received', caseFile: file, triage: tri(), proposal: { intent: 'confirm_received', body: ['Got the postcode, thanks.'], reasons: ['t'] }, now: NOW })).toBeNull();
    });
});

// ---------------------------------------------------------------- Addition 2: a pause is not a promise

describe('T20 Addition 2 — where the promise line is drawn', () => {
    it('a named deliverable or a deferred return still counts as a promise (the desk waits)', () => {
        for (const t of ["That's the only cladding, back soon with measurement", 'will send the photos tonight', 'I will send the measurements tomorrow', 'sending now', 'let me get the tape', "I'll get you the size", "hang on, I'll take a photo", 'be back in ten', 'shortly']) {
            expect(customerPromisedMore(t), t).toBe(true);
        }
    });
    it('a bare pause is someone still typing, not a promise (the desk answers)', () => {
        for (const t of ['one second let me check', 'one sec', 'hang on', 'bear with me', 'give me a minute', 'in a minute', 'two secs', 'just a mo', 'let me check']) {
            expect(customerPromisedMore(t), t).toBe(false);
            expect(RE_PAUSE_ONLY.test(t), t).toBe(true);
        }
    });
    it('decide no longer waits on "one second let me check": the Scoper\'s proposal is decided on its own merits', () => {
        const file = cf([...priya().timeline, inbound('one second let me check', 1)]);
        const t = triageRules(file);
        expect(t.customerPromisedMore).toBe(false);
        const d = decide({ proposal: { intent: 'clarify_scope', body: ['Is the ceiling soft or just marked?'], reasons: ['t'] }, guards: null, pack: resolvePack(file, t), triage: t, caseFile: file, now: NOW });
        expect(d.kind).not.toBe('none');
        // …while the incident sentence still waits.
        const janet = cf([outbound('Could you send the measurement?', 5), inbound("That's the only cladding, back soon with measurement", 1)]);
        const tj = triageRules(janet);
        expect(decide({ proposal: null, guards: null, pack: resolvePack(janet, tj), triage: tj, caseFile: janet, now: NOW })).toEqual({ kind: 'none', reason: 'waiting_for_promised' });
    });
});

// ---------------------------------------------------------------- the price screen

describe('T20 — the price payload carries the customer-media fact off the thread it already embeds', () => {
    const settings = { materialsMarginPercent: 27, depositPercent: 30 };
    const row = (over: Partial<DraftRowShape> = {}): DraftRowShape => ({
        id: 'q1', short_slug: 'ab12cd34', customer_name: 'Sam Bell', phone: '+447700900042', postcode: 'NG7 2AB', customer_type: 'homeowner',
        is_draft: true, revoked_at: null, superseded_at: null,
        pricing_line_items: [{ lineId: 'l1', label: 'Fit ring doorbell', title: 'Fit ring doorbell', category: 'electrical', qty: 1, pricePence: null, labourPence: null, materialsPence: null, assumptions: [], source: 'quote_intake' }],
        pricing_suggestions: null, customer_photo_urls: null, customer_video_urls: null, source_channel: 'spine_route_a',
        ...over,
    });
    const msgs = (file: CaseFile) => file.timeline.map((t, i) => ({ id: `m${i}`, at: t.at, direction: t.kind === 'message_in' ? 'in' as const : 'out' as const, channel: 'whatsapp', body: t.body ?? '', media: t.mediaIds?.length ? { url: `/api/media/${t.mediaIds[0]}`, kind: 'image' as const } : null, by: null }));

    it('no photo, asked, replied without one', () => {
        const p = buildPricePayload({ row: row(), estimate: null, conversationId: 'c', readiness: 'quote_ready', settings, thread: buildThread(msgs(faultB())) });
        expect(p.customerMedia).toEqual({ sentPhotos: false, sentVideo: false, askedAt: expect.any(String), repliedWithoutMedia: true });
        expect(p.photos).toEqual([]);
    });
    it('a photo on the thread or on the quote: sent, nothing outstanding', () => {
        const withPhoto = cf([...faultB().timeline, inbound('here', 1, { mediaIds: ['m1'] })]);
        const p = buildPricePayload({ row: row(), estimate: null, conversationId: 'c', readiness: 'quote_ready', settings, thread: buildThread(msgs(withPhoto)) });
        expect(p.customerMedia).toMatchObject({ sentPhotos: true, repliedWithoutMedia: false });
        const onQuote = buildPricePayload({ row: row({ customer_photo_urls: ['/api/media/x'] }), estimate: null, conversationId: 'c', readiness: null, settings });
        expect(onQuote.customerMedia).toMatchObject({ sentPhotos: true, askedAt: null, repliedWithoutMedia: false });
    });
    it('no thread at all: nothing sent, nothing asked (older callers)', () => {
        const p = buildPricePayload({ row: row(), estimate: null, conversationId: null, readiness: null, settings });
        expect(p.customerMedia).toEqual({ sentPhotos: false, sentVideo: false, askedAt: null, repliedWithoutMedia: false });
    });
});
