/**
 * T28 vitest — "never ask twice, never thank twice, never hand off twice" (plan v2 item 0.3).
 * No database, no model. The captain's cross-cutting rule 7; s28 finding M and E.
 *
 *   A  the ledger the case file renders: per ask subject, when it was last asked and whether the
 *      customer has answered since; and which media batch has already been acknowledged
 *   B  the belts, generalised from T20's media rule with its semantics kept exactly
 *   C  the hand-off line's named slot: once per open flag (item 1.4 writes the line itself)
 *   D  the Scoper reads the fact off the case file instead of inferring it
 *   E  a second ask is refused with a named reason; an answered ask re-opens; one thank-you per
 *      batch when two photos arrive a minute apart; the rendering is stable across a replay
 */
import { describe, it, expect, vi } from 'vitest';
import {
    ASK_SUBJECTS, HANDOFF_SUBJECT, askLedgerLines, askLedgerOf, askSubjectRefusal, askSubjectState,
    asksForAccess, asksForPostcode, buildAskLedger, bodyAsksFor, saysHandoffLine, type AskLedger,
} from './ask-ledger';
import { mediaAckState, turnsFromCaseFile } from './media-ask';
import { hashCaseFile, stableStringify } from './case-file';
import { sendPrecondition, PRECONDITION } from './send-preconditions';
import { createScoperAgent, renderCaseFile } from './agents/scoper';
import type { AgentRunResult, AgentTool } from '../agents/runner';
import type { CaseFile, PolicyPack, Proposal, TimelineItem, TriageResult } from './types';

// ---------------------------------------------------------------- fixtures

const NOW = new Date('2026-09-08T15:00:00.000Z');
const at = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const inbound = (body: string, minsAgo: number, extra: Partial<TimelineItem> = {}): TimelineItem => ({ at: at(minsAgo), kind: 'message_in', channel: 'whatsapp', body, by: 'customer', ...extra });
const outbound = (body: string, minsAgo: number, extra: Partial<TimelineItem> = {}): TimelineItem => ({ at: at(minsAgo), kind: 'message_out', channel: 'whatsapp', body, ...extra });
const flag = (note: string, minsAgo: number): TimelineItem => ({ at: at(minsAgo), kind: 'flag', body: `[money_question] ${note}` });

function cf(timeline: TimelineItem[], over: Partial<CaseFile> = {}): CaseFile {
    const lastIn = [...timeline].filter((t) => t.kind === 'message_in').sort((a, b) => a.at.localeCompare(b.at)).pop();
    const body = {
        conversationId: 'c_t28', phone: '+447700900043', audience: 'customer' as const, stage: 'scoping' as const, contactName: 'Sam',
        timeline, media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: lastIn?.at ?? null, channelLastUsed: 'whatsapp' as const },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null,
        ...over,
    };
    // The case file stores the ledger it derived; every fixture is built the way buildCaseFile builds one.
    const withAsks = { ...body, asks: buildAskLedger({ timeline }) } as Omit<CaseFile, 'hash' | 'builtAt'>;
    return { ...withAsks, hash: hashCaseFile(withAsks), builtAt: NOW.toISOString() };
}

/** Michael, 31 Aug (eval-cases/guards/incident-v2-unguarded.json): the postcode asked, then refused. */
const postcodeRefused = () => cf([
    outbound('Ok perfect, could we get your postcode and we will get you a quote sent over shortly', 20),
    inbound("Send me a quote first mate, if I'm happy I'll send you the postcode", 15),
    inbound('I have a couple of quotes already', 12),
]);

const accessAsked = () => cf([
    inbound('Need three internal doors hanging', 30),
    outbound('Will someone be in on the day so we can get in?', 20),
    inbound('It is a rental, the tenant works shifts', 10),
]);

// ---------------------------------------------------------------- A: the detectors and the ledger

describe('T28 A — what has been asked, read off the thread', () => {
    it('asksForPostcode reads every asker and ignores an answer, a negation and a bare postcode', () => {
        for (const t of [
            'Could you send us your postcode please? Just the postcode is fine for now.',   // rules layer ask_postcode
            'Just need your postcode to factor in travel time.',                            // the 31 Aug incident send
            "Quick one - what's your postcode so we can factor in travel time?",
            'Can I take the address for the quote?',
            'Whereabouts are you?',
        ]) expect(asksForPostcode(t), t).toBe(true);
        for (const t of [
            'Thanks, got the postcode.',
            'No need for the postcode yet.',
            'NG7 2AB',
            'Is the door internal or external?',
            '',
        ]) expect(asksForPostcode(t), t).toBe(false);
    });

    it('asksForAccess reads the access asks and ignores the rest', () => {
        for (const t of [
            'Will someone be in on the day so we can get in?',
            'How do we get in if you are at work?',
            'Is there access round the back?',
            'Is there parking outside?',
            'Is there a key safe?',
        ]) expect(asksForAccess(t), t).toBe(true);
        for (const t of ['Could you send a photo of the door?', 'We already have access sorted.', 'Is the wall brick?', '']) expect(asksForAccess(t), t).toBe(false);
    });

    it('saysHandoffLine reads the hand-off promise, including the one the prompt itself endorses', () => {
        for (const t of [
            'Let me check on that and come straight back to you.',
            'Ben will come back to you on the price.',
            "I'll get back to you on that shortly.",
            "He'll be in touch about the price.",
        ]) expect(saysHandoffLine(t), t).toBe(true);
        for (const t of ['Got it, thanks.', 'Dates come with your quote.', 'Could you send a photo?', '']) expect(saysHandoffLine(t), t).toBe(false);
    });

    it('the ledger carries every subject, and the outstanding one states when it was asked', () => {
        const ledger = buildAskLedger(postcodeRefused());
        expect(Object.keys(ledger.subjects).sort()).toEqual([...ASK_SUBJECTS].sort());
        expect(ledger.subjects.postcode).toMatchObject({ asked: true, repliedSince: true, answeredSince: false, outstanding: true });
        expect(ledger.subjects.postcode.askedAt).toBe(at(20));
        expect(ledger.subjects.media).toMatchObject({ asked: false, outstanding: false });
        expect(ledger.subjects.access).toMatchObject({ asked: false, outstanding: false });
    });

    it('the ledger does not depend on the order the timeline is given in', () => {
        const file = postcodeRefused();
        const shuffled = { timeline: [...file.timeline].reverse() };
        expect(buildAskLedger(shuffled)).toEqual(buildAskLedger(file));
    });

    it('access is never answered by machine: they replied, so we do not insist', () => {
        expect(buildAskLedger(accessAsked()).subjects.access).toMatchObject({ asked: true, repliedSince: true, answeredSince: false, outstanding: true });
    });

    it('the media subject is mediaAskState, verbatim (media-ask.ts still owns that rule)', () => {
        const asked = cf([
            inbound('Front door needs a doorbell', 20),
            outbound('Could you send a photo of the door and the wall around it?', 15),
            inbound('It is on the front door, left of the frame', 5),
        ]);
        const m = askSubjectState('media', turnsFromCaseFile(asked));
        expect(m).toMatchObject({ asked: true, repliedSince: true, answeredSince: false, outstanding: true, subject: 'media' });
    });
});

// ---------------------------------------------------------------- E: an answered ask re-opens

describe('T28 E — an ask becomes allowed again exactly as the media belt has it', () => {
    it('a postcode that arrived answers the ask, so asking for the one missing thing is allowed again', () => {
        const answered = cf([...postcodeRefused().timeline, inbound('fine, NG7 2AB', 2)]);
        expect(buildAskLedger(answered).subjects.postcode).toMatchObject({ answeredSince: true, outstanding: false });
    });

    it('a photo that arrived answers the media ask (T20\'s own invalidation rule, unchanged)', () => {
        const withPhoto = cf([
            outbound('Could you send a photo of the door?', 15),
            inbound('It is the front door', 8),
            inbound('', 3, { mediaIds: ['m1'] }),
        ]);
        expect(buildAskLedger(withPhoto).subjects.media).toMatchObject({ answeredSince: true, outstanding: false });
    });

    it('an ask nobody has replied to yet is not outstanding: the belt fences repeats, not first asks', () => {
        const justAsked = cf([inbound('need a doorbell fitting', 10), outbound('What is the postcode?', 2)]);
        expect(buildAskLedger(justAsked).subjects.postcode).toMatchObject({ asked: true, repliedSince: false, outstanding: false });
    });
});

// ---------------------------------------------------------------- E: thank once per media batch

describe('T28 E — one thank-you per media batch', () => {
    it('two photos a minute apart are ONE batch: the thank-you between them still counts', () => {
        const racing = cf([
            inbound('here is the fan', 6, { mediaIds: ['m1'] }),
            outbound('Thanks, got the photo, that is helpful.', 5),
            inbound('and this one', 4, { mediaIds: ['m2'] }),
            inbound('does that help?', 1),
        ]);
        const ack = buildAskLedger(racing).mediaAck;
        expect(ack).toMatchObject({ batchSize: 2, alreadyThanked: true });
        expect(ack.batchStartedAt).toBe(at(6));
    });

    it('two photos before any reply are one batch, thanked once', () => {
        const pair = cf([
            inbound('here', 8, { mediaIds: ['m1'] }),
            inbound('and here', 7, { mediaIds: ['m2'] }),
            outbound('Thanks, the pictures came through fine.', 6),
            inbound('no rush', 1),
        ]);
        expect(buildAskLedger(pair).mediaAck).toMatchObject({ batchSize: 2, alreadyThanked: true });
    });

    it('a photo sent after they moved the conversation on is a NEW batch and may be thanked for', () => {
        const later = cf([
            inbound('here is the fan', 20, { mediaIds: ['m1'] }),
            outbound('Thanks, got the photo.', 19),
            inbound('it is worse upstairs', 10),
            inbound('this is the upstairs one', 2, { mediaIds: ['m2'] }),
        ]);
        expect(buildAskLedger(later).mediaAck).toMatchObject({ batchSize: 1, alreadyThanked: false });
    });

    it('photos hours apart are never one batch', () => {
        const farApart = cf([
            inbound('one', 200, { mediaIds: ['m1'] }),
            outbound('Thanks, got the photo.', 199),
            inbound('two', 2, { mediaIds: ['m2'] }),
        ]);
        expect(mediaAckState(turnsFromCaseFile(farApart))).toMatchObject({ batchSize: 1, alreadyThanked: false });
    });

    it('the belt: a second thank-you for the same batch does not move at SEND', () => {
        const racing = cf([
            inbound('here is the fan', 6, { mediaIds: ['m1'] }),
            outbound('Thanks, got the photo, that is helpful.', 5),
            inbound('and this one', 4, { mediaIds: ['m2'] }),
            inbound('does that help', 1),
        ]);
        const p: Proposal = { intent: 'confirm_received', body: ['Thanks for the photos, they are really helpful.'], reasons: ['t'] };
        expect(sendPrecondition({ intent: 'confirm_received', caseFile: racing, triage: tri(), proposal: p, now: NOW })).toBe(PRECONDITION.mediaAlreadyAcknowledged);
    });
});

// ---------------------------------------------------------------- B: the belts, per subject

const tri = (over: Partial<TriageResult> = {}): TriageResult => ({ audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [], reasons: ['t'], source: 'rules', ...over });
const prop = (intent: string, body: string[]): Proposal => ({ intent: intent as any, body, reasons: ['t'] });

describe('T28 B — the send-precondition belt refuses a second ask with a named reason', () => {
    it('a third postcode ask on the 31 Aug thread is refused, whatever the intent says', () => {
        const file = postcodeRefused();
        expect(sendPrecondition({ intent: 'ask_gap', caseFile: file, triage: tri(), proposal: prop('ask_gap', ["Quick one - what's your postcode?"]), now: NOW })).toBe(PRECONDITION.postcodeAlreadyAsked);
        expect(sendPrecondition({ intent: 'confirm_received', caseFile: file, triage: tri(), proposal: prop('confirm_received', ['Got it. Just need your postcode to factor in travel time.']), now: NOW })).toBe(PRECONDITION.postcodeAlreadyAsked);
    });

    it('a second access ask is refused', () => {
        expect(sendPrecondition({ intent: 'ask_gap', caseFile: accessAsked(), triage: tri(), proposal: prop('ask_gap', ['Will someone be in on the day?']), now: NOW })).toBe(PRECONDITION.accessAlreadyAsked);
    });

    it('a different ask on the same thread still moves: the belt fences the repeat, not the reply', () => {
        expect(sendPrecondition({ intent: 'ask_gap', caseFile: postcodeRefused(), triage: tri(), proposal: prop('ask_gap', ['Are the doors internal or external?']), now: NOW })).toBeNull();
    });

    it('once the postcode arrives, asking again about where is allowed (the answer invalidated it)', () => {
        const answered = cf([...postcodeRefused().timeline, inbound('NG7 2AB', 2)]);
        expect(sendPrecondition({ intent: 'ask_gap', caseFile: answered, triage: tri(), proposal: prop('ask_gap', ['Is that the postcode for the job address?']), now: NOW })).toBeNull();
    });

    it('every refusal code is named and closed', () => {
        expect(PRECONDITION.postcodeAlreadyAsked).toBe('already_asked:postcode');
        expect(PRECONDITION.accessAlreadyAsked).toBe('already_asked:access');
        expect(PRECONDITION.handoffAlreadySaid).toBe('handoff_already_said');
    });
});

// ---------------------------------------------------------------- C: the hand-off line's slot

const heldThread = () => cf([
    inbound('what would that cost roughly', 40),
    flag('customer asking for a rough price on the skirting', 35),
    outbound('Let me check on that and come straight back to you.', 30),
    inbound('ok thanks', 10),
], { openFlags: [{ exception: 'money_question', note: 'rough price', dueAt: at(-60) }], tags: ['needs_ben'] });

describe('T28 C — the hand-off line is said once per open flag', () => {
    it('the subject is named so item 1.4 has only to use it', () => {
        expect(HANDOFF_SUBJECT).toBe('handoff');
        expect(ASK_SUBJECTS).toContain(HANDOFF_SUBJECT);
        expect(bodyAsksFor('handoff', 'Ben will come back to you on the price.')).toBe(true);
    });

    it('said once on this flag: a second hand-off line on the same open flag is refused', () => {
        const file = heldThread();
        expect(buildAskLedger(file).subjects.handoff).toMatchObject({ asked: true, outstanding: true });
        expect(sendPrecondition({ intent: 'ask_gap', caseFile: file, triage: tri(), proposal: prop('ask_gap', ['Ben will come back to you on the price.', 'Meanwhile, are the doors internal?']), now: NOW })).toBe(PRECONDITION.handoffAlreadySaid);
    });

    it('the rest of the reply still moves while the thread sits with Ben (answer 14)', () => {
        expect(sendPrecondition({ intent: 'ask_gap', caseFile: heldThread(), triage: tri(), proposal: prop('ask_gap', ['Are the doors internal or external?']), now: NOW })).toBeNull();
    });

    it('a NEW flag opened since re-opens the line: one hand-off per flag, not one per thread', () => {
        const second = cf([...heldThread().timeline, flag('now asking for a refund', 5), inbound('and I want the deposit back', 3)], {
            openFlags: [{ exception: 'refund', note: 'deposit back', dueAt: at(-60) }], tags: ['needs_ben'],
        });
        expect(buildAskLedger(second).subjects.handoff).toMatchObject({ asked: true, outstanding: false });
        expect(sendPrecondition({ intent: 'ask_gap', caseFile: second, triage: tri(), proposal: prop('ask_gap', ['Let me check on that and come straight back to you.']), now: NOW })).toBeNull();
    });

    it('a thread that has never had the line said may say it', () => {
        const fresh = cf([inbound('what would that cost roughly', 5)]);
        expect(sendPrecondition({ intent: 'ask_gap', caseFile: fresh, triage: tri(), proposal: prop('ask_gap', ['Let me check on that and come straight back to you.']), now: NOW })).toBeNull();
    });

    it('the refusal names the fact and says what to do instead', () => {
        const state = buildAskLedger(heldThread()).subjects.handoff;
        expect(askSubjectRefusal(state)).toMatch(/already told them someone will come back to them/);
        expect(askSubjectRefusal(state)).toMatch(/Do not promise it a second time/);
    });
});

// ---------------------------------------------------------------- D: the Scoper stops guessing

const PACK: PolicyPack = {
    id: 'customer.default', version: 1, audience: 'customer',
    allowedIntents: ['ask_gap', 'clarify_scope', 'confirm_received', 'faq_from_kb', 'point_to_quote_page', 'closing', 'holding'],
    guardSet: ['money', 'discount', 'date_promise', 'duration_claim', 'capability_claim', 'liability', 'policy_commitment', 'capitulation', 'voice', 'unseen_implication'],
    tierByIntent: {}, defaultTier: 'DRAFT', hours: { reactiveAlways: true, proactiveFromHour: 8, proactiveToHour: 20 },
    exceptionsToBen: ['complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade', 'money_question', 'callback_requested'],
    voiceFile: 'whatsapp-comms.md', templates: {},
};

type Script = (tools: Record<string, AgentTool>) => Promise<void>;
async function runScoper(file: CaseFile, script: Script): Promise<{ proposal: Proposal | null; goal: string }> {
    let goal = '';
    const runAgent = vi.fn(async (opts: any): Promise<AgentRunResult> => {
        goal = opts.goal;
        await script(Object.fromEntries((opts.tools as AgentTool[]).map((t) => [t.name, t])));
        return { finalText: 'done', transcript: [], turns: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, runId: 'run_t28', model: 'stub', costPence: 0, durationMs: 1 };
    });
    const agent = createScoperAgent({ runAgent: runAgent as any, persist: false, loadQuickReplies: async () => [], now: () => NOW });
    const proposal = await agent.run({ caseFile: file, pack: PACK, triage: tri(), runId: 'run_t28' });
    return { proposal, goal };
}

describe('T28 D — the Scoper is told, not left to infer', () => {
    it('the rendered case file states each outstanding ask, and nothing when there is none', () => {
        expect(renderCaseFile(postcodeRefused(), tri())).toMatch(/POSTCODE ASKED ONCE: we asked where the job is/);
        expect(renderCaseFile(accessAsked(), tri())).toMatch(/ACCESS ASKED ONCE/);
        expect(renderCaseFile(heldThread(), tri())).toMatch(/HAND-OFF ALREADY SAID/);
        const clean = renderCaseFile(cf([inbound('need three doors hanging', 1)]), tri());
        expect(clean).not.toMatch(/ASKED ONCE|ALREADY THANKED|HAND-OFF/);
    });

    it('the rendered case file states an acknowledged media batch', () => {
        const thanked = cf([
            inbound('here is the fan', 6, { mediaIds: ['m1'] }),
            outbound('Thanks, got the photo, that is helpful.', 5),
            inbound('anything else', 1),
        ]);
        expect(renderCaseFile(thanked, tri())).toMatch(/MEDIA ALREADY THANKED: we thanked them for what arrived/);
    });

    it('the tool refuses a second postcode ask and the refusal says to carry on', async () => {
        let refusal = '';
        const { proposal } = await runScoper(postcodeRefused(), async (tools) => {
            try { await tools.propose_reply.run({ intent: 'ask_gap', body: ["Quick one, what's your postcode?"], reasons: ['need it to price'] }); } catch (e: any) { refusal = e.message; }
        });
        expect(refusal).toMatch(/^Refused: we already asked them for the postcode/);
        expect(refusal).toMatch(/Do not ask again/);
        expect(proposal).toBeNull();
    });

    it('the tool refuses a second hand-off line on the same flag, and takes the substance without it', async () => {
        let refusal = '';
        const { proposal } = await runScoper(heldThread(), async (tools) => {
            try { await tools.propose_reply.run({ intent: 'ask_gap', body: ['Let me check on that and come straight back to you.'], reasons: ['held'] }); } catch (e: any) { refusal = e.message; }
            await tools.propose_reply.run({ intent: 'ask_gap', body: ['Are the doors internal or external?'], reasons: ['carry on scoping'] });
        });
        expect(refusal).toMatch(/^Refused: we have already told them someone will come back/);
        expect(proposal?.body).toEqual(['Are the doors internal or external?']);
    });

    it('the goal the model is given carries the same lines the case file does', async () => {
        const { goal } = await runScoper(postcodeRefused(), async () => undefined);
        expect(goal).toMatch(/POSTCODE ASKED ONCE/);
    });

    it('the prompt tells the model to read the fact instead of working it out', () => {
        const core = require('fs').readFileSync('server/spine/prompts/scoper.core.md', 'utf8');
        expect(core).toMatch(/ASK ONCE, THANK ONCE, HAND OFF ONCE/);
        expect(core).toMatch(/ALREADY THANKED/);
        expect(core).toMatch(/HAND-OFF ALREADY SAID/);
    });
});

// ---------------------------------------------------------------- E: stable across a replay

describe('T28 E — the case file\'s rendering is stable across a replay', () => {
    it('a persisted case file round-trips to the same ledger, the same hash and the same rendering', () => {
        const file = postcodeRefused();
        const replayed = JSON.parse(JSON.stringify(file)) as CaseFile;
        expect(replayed.asks).toEqual(file.asks);
        const { hash, builtAt, ...body } = replayed;
        expect(hashCaseFile(body as any)).toBe(file.hash);
        expect(renderCaseFile(replayed, tri())).toBe(renderCaseFile(file, tri()));
        expect(stableStringify(replayed.asks)).toBe(stableStringify(file.asks));
    });

    it('the replay reads the ledger the run recorded, not one derived afresh', () => {
        // A stored ledger is authoritative: that is what makes a replay show what the agent saw.
        const file = postcodeRefused();
        const doctored: CaseFile = { ...file, asks: { ...file.asks!, subjects: { ...file.asks!.subjects, postcode: { ...file.asks!.subjects.postcode, outstanding: false } } } };
        expect(askLedgerOf(doctored).subjects.postcode.outstanding).toBe(false);
        expect(buildAskLedger(doctored).subjects.postcode.outstanding).toBe(true);
    });

    it('a case file built before T28 (or by a fixture) derives its ledger on the spot', () => {
        const file = postcodeRefused();
        const old = { ...file, asks: undefined } as CaseFile;
        expect(askLedgerOf(old)).toEqual(buildAskLedger(file));
        expect(renderCaseFile(old, tri())).toMatch(/POSTCODE ASKED ONCE/);
    });

    it('a stored ledger missing a subject is rebuilt rather than trusted', () => {
        const file = postcodeRefused();
        const partial = { ...file, asks: { subjects: { media: file.asks!.subjects.media }, mediaAck: file.asks!.mediaAck } as unknown as AskLedger };
        expect(askLedgerOf(partial).subjects.postcode.outstanding).toBe(true);
    });

    it('askLedgerLines is media first, then the rest, so T20\'s wording stays where it was', () => {
        const both = cf([
            outbound('Could you send a photo of the door? And what is the postcode?', 20),
            inbound('it is the front door on the left', 5),
        ]);
        const lines = askLedgerLines(buildAskLedger(both));
        expect(lines[0]).toMatch(/^MEDIA ASKED ONCE/);
        expect(lines[1]).toMatch(/^POSTCODE ASKED ONCE/);
    });
});
