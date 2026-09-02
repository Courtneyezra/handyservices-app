/**
 * The Scoper against eight synthetic case files with a STUBBED runner — no network, no DB.
 *
 * The stub plays the model: each case scripts the tool calls a competent model would make, and
 * what is asserted is the BELT and the STRUCTURE around it — intents ∈ allowedIntents, bodies pass
 * the draft-guard detectors, money/complaint/date exceptions come back as flags whatever the model
 * did, opted-out threads never reach the model, placeholder names are refused, and the tool
 * boundary rejects what it must.
 */
import { describe, it, expect, vi } from 'vitest';
import type { AgentRunResult, AgentTool } from '../../agents/runner';
import type { CaseFile, PolicyPack, Proposal, TriageResult, TimelineItem } from '../types';
import {
    createScoperAgent, buildScoperSystem, renderCaseFile, loadScoperCore, checkProposedBody,
    normaliseBody, dateQuestionNeedsBen, SCOPER_APPROVER, PROPOSABLE_TAGS,
} from './scoper';
import { proposalToLegacyOutcome } from './scoper-adapter';
import { checkDraft, detectLiabilityAdmission, detectMoneyFigure, detectDatePromise, detectDiscountOffer } from '../../agents/draft-guards';
import { isApprover } from '../../approver';

// ---------------------------------------------------------------- fixtures

const DEFAULT_PACK: PolicyPack = {
    id: 'customer.default', version: 1, audience: 'customer',
    allowedIntents: ['ask_gap', 'clarify_scope', 'confirm_received', 'faq_from_kb', 'point_to_quote_page', 'closing', 'holding', 'quote_on_its_way'],
    guardSet: ['money', 'discount', 'date_promise', 'duration_claim', 'capability_claim', 'liability', 'policy_commitment', 'capitulation', 'voice', 'unseen_implication'],
    tierByIntent: {}, defaultTier: 'DRAFT',
    hours: { reactiveAlways: true, proactiveFromHour: 8, proactiveToHour: 20 },
    exceptionsToBen: ['complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade', 'money_question', 'date_question', 'callback_requested'],
    voiceFile: 'whatsapp-comms.md',
    templates: {},
};
const POST_QUOTE_PACK: PolicyPack = {
    ...DEFAULT_PACK, id: 'customer.post_quote', stage: 'quote_sent',
    allowedIntents: [...DEFAULT_PACK.allowedIntents.filter((i) => i !== 'quote_on_its_way'), 'answer_from_quote', 'point_to_picker'],
    guardSet: [...DEFAULT_PACK.guardSet, 'price_objection'],
};

let n = 0;
function msg(kind: TimelineItem['kind'], body: string, extra: Partial<TimelineItem> = {}): TimelineItem {
    n++;
    return { at: new Date(Date.UTC(2026, 8, 2, 9, n)).toISOString(), kind, channel: 'whatsapp', body, ...extra };
}

function caseFile(over: Partial<CaseFile> & { timeline: TimelineItem[] }): CaseFile {
    return {
        conversationId: 'conv_test', phone: '+447700123456', audience: 'customer', stage: 'scoping', city: 'nottingham',
        contactName: 'Sarah', media: [], client: null, quote: null, openPromises: [], openFlags: [], tags: [],
        window: { canFreeform: true, templateRequired: false, lastInboundAt: '2026-09-02T09:05:00.000Z', channelLastUsed: 'whatsapp' },
        lastRun: null, hash: 'a'.repeat(64), builtAt: '2026-09-02T09:10:00.000Z',
        ...over,
    };
}

function triage(over: Partial<TriageResult> = {}): TriageResult {
    return { audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [], reasons: ['test'], source: 'rules', ...over };
}

type Script = (tools: Record<string, AgentTool>) => Promise<void>;

/** A runner stub: runs the script against the real belt, returns a run result, no network. */
function stubRunner(script: Script) {
    const calls: Array<{ system: string; goal: string; model?: string; runId?: string; persist?: boolean }> = [];
    const runAgent = vi.fn(async (opts: any): Promise<AgentRunResult> => {
        calls.push({ system: opts.system, goal: opts.goal, model: opts.model, runId: opts.runId, persist: opts.persist });
        const byName = Object.fromEntries((opts.tools as AgentTool[]).map((t) => [t.name, t]));
        await script(byName);
        return {
            finalText: 'stub done', transcript: [], turns: 1,
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            runId: opts.runId ?? 'run_stub', model: opts.model ?? 'stub', costPence: 0, durationMs: 1,
        };
    });
    return { runAgent: runAgent as any, calls };
}

async function runCase(input: { cf: CaseFile; tri: TriageResult; pack?: PolicyPack; script: Script; recontact?: any }) {
    const stub = stubRunner(input.script);
    const proposed = vi.fn(async () => ({ proposed: true, note: 'proposed' }));
    const agent = createScoperAgent({
        runAgent: stub.runAgent, persist: false,
        loadQuickReplies: async () => [{ label: 'photo_ask', body: 'Could you send me a picture of the current one and where it goes?' }],
        proposeRecontact: input.recontact ?? proposed,
        now: () => new Date('2026-09-02T10:00:00.000Z'),
    });
    const proposal = await agent.run({ caseFile: input.cf, pack: input.pack ?? DEFAULT_PACK, triage: input.tri, runId: 'run_test_1' });
    return { proposal, stub, proposed };
}

/** Everything a proposal must satisfy whatever the case. */
function assertWellFormed(p: Proposal | null, pack: PolicyPack = DEFAULT_PACK) {
    if (!p) return;
    expect(pack.allowedIntents).toContain(p.intent);
    for (const b of p.body) {
        expect(detectMoneyFigure(b)).toBeNull();
        expect(detectDatePromise(b)).toBeNull();
        expect(detectDiscountOffer(b)).toBeNull();
        expect(b).not.toMatch(/[—–]/);
    }
    if (p.body.length) {
        expect(checkDraft({ body: p.body.join('\n---\n'), intent: p.intent, quoteSeen: true, customerText: null })).toBeNull();
    }
}

// ---------------------------------------------------------------- the eight

describe('Scoper on eight synthetic case files (stubbed runner)', () => {
    it('1. first contact with photos → confirms receipt and asks the one gap, no name ask in a first reply', async () => {
        const cf = caseFile({
            contactName: 'Just Me', stage: 'enquiry',
            media: [{ id: 'm1', kind: 'image', description: 'a kitchen mixer tap, base corroded' }],
            timeline: [msg('message_in', 'Hi, my kitchen tap is leaking at the base, photos attached', { mediaIds: ['m1'] })],
        });
        const { proposal, stub } = await runCase({
            cf, tri: triage({ intent: 'ack_photos', stage: 'enquiry' }),
            script: async (t) => {
                await t.propose_reply.run({ intent: 'ask_gap', body: ['Thanks, that photo is really useful.', 'Could you send a quick video of where it is dripping from?'], reasons: ['photo shows the tap; need the leak point'] });
            },
        });
        expect(proposal).not.toBeNull();
        assertWellFormed(proposal);
        expect(proposal!.intent).toBe('ask_gap');
        expect(proposal!.body).toHaveLength(2);
        // The case file told the model the name is a placeholder.
        expect(stub.calls[0].goal).toMatch(/PLACEHOLDER/);
        expect(stub.calls[0].persist).toBe(false);
        expect(stub.calls[0].runId).toBe('run_test_1');
    });

    it('2. mid-scope answer → asks the next gap; quote_on_its_way tags needs_quote when scoped', async () => {
        const cf = caseFile({
            timeline: [
                msg('message_in', 'Fence panel blown down, 6ft, three panels'),
                msg('message_out', 'Could you send me a picture of the fence and the posts?', { by: 'agent.comms' }),
                msg('message_in', 'Here you go, posts are concrete. NG5 2AB', { mediaIds: ['m2'] }),
            ],
            media: [{ id: 'm2', kind: 'image', description: 'three fence panels down, concrete posts intact' }],
        });
        const { proposal } = await runCase({
            cf, tri: triage({ intent: 'clarify_scope' }),
            script: async (t) => {
                await t.propose_reply.run({ intent: 'quote_on_its_way', body: ['Perfect, that is everything we need.', 'I will get your quote over to you shortly.'], reasons: ['job, photos and postcode all in'], tags: ['needs_quote'] });
            },
        });
        assertWellFormed(proposal);
        expect(proposal!.intent).toBe('quote_on_its_way');
        expect(proposal!.tags).toContain('needs_quote');
    });

    it('3. money question → ALWAYS a flag, never a figure in the body', async () => {
        const cf = caseFile({
            quote: { slug: 'abc123', total: 34000, lines: 2, viewedAt: '2026-09-02T08:00:00.000Z', expiresAt: null, paid: false },
            timeline: [msg('message_in', 'Can you do it for 300 instead of 340?')],
        });
        const tri = triage({ intent: 'unknown', exceptions: ['money_question'], reasons: ['asked for a lower figure'] });
        // The model tries to answer with a figure (refused), then does it right.
        const { proposal } = await runCase({
            cf, tri, pack: POST_QUOTE_PACK,
            script: async (t) => {
                await expect(t.propose_reply.run({ intent: 'answer_from_quote', body: ['We could do £300 for you.'], reasons: ['x'] })).rejects.toThrow(/money_figure|discount/);
                await expect(t.propose_reply.run({ intent: 'answer_from_quote', body: ['We can knock 10% off if you book today.'], reasons: ['x'] })).rejects.toThrow(/discount/);
                await t.propose_reply.run({ intent: 'holding', body: ['Let me check on that and come straight back to you.'], reasons: ['money is Ben\'s'] });
            },
        });
        assertWellFormed(proposal, POST_QUOTE_PACK);
        expect(proposal!.flag?.exception).toBe('money_question'); // attached structurally: the script never called flag
        expect(proposal!.body.join(' ')).not.toMatch(/\d/);
    });

    it('3b. money question where the model forgets to reply entirely → flag-only proposal', async () => {
        const cf = caseFile({ timeline: [msg('message_in', 'how much roughly?')] });
        const { proposal } = await runCase({ cf, tri: triage({ exceptions: ['money_question'] }), script: async () => {} });
        expect(proposal).not.toBeNull();
        expect(proposal!.body).toEqual([]);
        expect(proposal!.flag?.exception).toBe('money_question');
    });

    it('4. date question → point_to_picker only with a live quote, else a flag', async () => {
        const noQuote = caseFile({ timeline: [msg('message_in', 'Can you come Tuesday morning?')] });
        expect(dateQuestionNeedsBen(noQuote, POST_QUOTE_PACK)).toBe(true);
        const a = await runCase({
            cf: noQuote, tri: triage({ exceptions: ['date_question'] }), pack: POST_QUOTE_PACK,
            script: async (t) => {
                await expect(t.propose_reply.run({ intent: 'point_to_picker', body: ['Pick a date on your quote page.'], reasons: ['x'] })).rejects.toThrow(/live, unpaid quote/);
                await expect(t.propose_reply.run({ intent: 'holding', body: ['Tuesday morning works, see you then.'], reasons: ['x'] })).rejects.toThrow(/date_promise/);
                await t.propose_reply.run({ intent: 'holding', body: ['Let me check the diary and come straight back to you.'], reasons: ['date is Ben\'s'] });
            },
        });
        assertWellFormed(a.proposal, POST_QUOTE_PACK);
        expect(a.proposal!.flag?.exception).toBe('date_question');

        const withQuote = caseFile({
            quote: { slug: 'q9', total: 22000, lines: 1, viewedAt: '2026-09-01T12:00:00.000Z', expiresAt: null, paid: false },
            timeline: [msg('message_in', 'Can you come Tuesday morning?')],
        });
        expect(dateQuestionNeedsBen(withQuote, POST_QUOTE_PACK)).toBe(false);
        const b = await runCase({
            cf: withQuote, tri: triage({ exceptions: ['date_question'] }), pack: POST_QUOTE_PACK,
            script: async (t) => {
                await t.propose_reply.run({ intent: 'point_to_picker', body: ['You can pick the day that suits on your quote page, the booking goes in there with the deposit.'], reasons: ['live quote has a picker'], citations: ['q9'] });
            },
        });
        assertWellFormed(b.proposal, POST_QUOTE_PACK);
        expect(b.proposal!.intent).toBe('point_to_picker');
        expect(b.proposal!.flag ?? null).toBeNull(); // no flag needed: the picker answers it
    });

    it('5. complaint → flag, and no apology that admits fault', async () => {
        const cf = caseFile({ timeline: [msg('message_in', 'Your guy scratched my floor and left a mess, this is not good enough')] });
        const { proposal } = await runCase({
            cf, tri: triage({ exceptions: ['complaint'], reasons: ['damage claim'] }),
            script: async (t) => {
                await expect(t.propose_reply.run({ intent: 'holding', body: ['So sorry, that was our fault, we will cover the damage.'], reasons: ['x'] })).rejects.toThrow(/liability/);
                await t.flag.run({ exception: 'complaint', note: 'Customer reports a scratched floor and mess after the visit. I have acknowledged and promised nothing.' });
                await t.propose_reply.run({ intent: 'holding', body: ['Really sorry to hear that.', 'I am finding out where we are up to and will come straight back to you today.'], reasons: ['acknowledge, commit to nothing'] });
            },
        });
        assertWellFormed(proposal);
        expect(proposal!.flag?.exception).toBe('complaint');
        for (const b of proposal!.body) expect(detectLiabilityAdmission(b)).toBeNull();
    });

    it('6. returning customer → confirm_received in voice, stated name saved, pushname rejected', async () => {
        const cf = caseFile({
            contactName: 'S JONES LETTINGS',
            timeline: [
                msg('message_in', 'Hi again, you did our bathroom last year. Got a dripping shower now. Cheers, Mike'),
            ],
        });
        const { proposal } = await runCase({
            cf, tri: triage({ intent: 'ack_returning' }),
            script: async (t) => {
                await expect(t.set_contact_name.run({ name: 'S JONES LETTINGS' })).rejects.toThrow(/real-name check/);
                await expect(t.set_contact_name.run({ name: 'Just Me' })).rejects.toThrow(/real-name check/);
                await t.set_contact_name.run({ name: 'Mike' });
                await t.propose_reply.run({ intent: 'confirm_received', body: ['Hiya Mike, good to hear from you again.', 'Could you send a quick video of the shower dripping so we can see where it is coming from?'], reasons: ['returning customer, media first'] });
            },
        });
        assertWellFormed(proposal);
        expect(proposal!.contactName).toBe('Mike');
        expect(proposal!.intent).toBe('confirm_received');
    });

    it('7. opted-out → null before any model call', async () => {
        const cf = caseFile({ tags: ['opted_out'], timeline: [msg('message_in', 'STOP')] });
        const { proposal, stub } = await runCase({ cf, tri: triage({ exceptions: ['opted_out'] }), script: async () => { throw new Error('model must not run'); } });
        expect(proposal).toBeNull();
        expect(stub.runAgent).not.toHaveBeenCalled();
        const cf2 = caseFile({ timeline: [msg('message_in', 'hello')] });
        const r2 = await runCase({ cf: cf2, tri: triage({ exceptions: ['opted_out'] }), script: async () => { throw new Error('model must not run'); } });
        expect(r2.proposal).toBeNull();
    });

    it('8. post-quote objection → no graceful exit, no discount; figure flagged, content-free half proposed, recontact proposed', async () => {
        const cf = caseFile({
            stage: 'quote_sent',
            quote: { slug: 'shed984', total: 98400, lines: 3, viewedAt: '2026-09-01T18:00:00.000Z', expiresAt: null, paid: false },
            timeline: [
                msg('message_out', 'Your quote is ready: https://handyservices.app/quote/shed984', { by: 'system.quotes' }),
                msg('message_in', 'That is far too expensive for me, thanks anyway. Maybe after Christmas.'),
            ],
        });
        const recontact = vi.fn(async () => ({ proposed: true, note: 'proposed' }));
        const { proposal } = await runCase({
            cf, tri: triage({ intent: 'unknown', stage: 'quote_sent', exceptions: ['money_question'], reasons: ['price objection'] }), pack: POST_QUOTE_PACK, recontact,
            script: async (t) => {
                // The graceful exit is refused (capitulation), so is a discount.
                await expect(t.propose_reply.run({ intent: 'closing', body: ['No problem at all, thanks for letting us know.'], reasons: ['x'] })).rejects.toThrow(/capitulation/);
                await expect(t.propose_reply.run({ intent: 'answer_from_quote', body: ['We could take a bit off if you go ahead this month.'], reasons: ['x'] })).rejects.toThrow(/discount/);
                await expect(t.schedule_recontact.run({ date: '2026-09-01', note: 'past' })).rejects.toThrow(/not in the future/);
                await t.schedule_recontact.run({ date: '2027-01-06', note: 'said maybe after Christmas' });
                await t.flag.run({ exception: 'money_question', note: 'Price objection on the shed quote, wall band. I offered a re-scope and said I would check back in January.' });
                await t.propose_reply.run({ intent: 'answer_from_quote', body: ['Understood, it is a big job and the price covers two people and a clean finish.', 'Happy to edit it if some bits matter more than others, which would you keep?', 'No rush either way, I will check back in the new year.'], reasons: ['name what the money buys, offer re-scope'] });
            },
        });
        assertWellFormed(proposal, POST_QUOTE_PACK);
        expect(proposal!.flag?.exception).toBe('money_question');
        expect(proposal!.recontactAt).toBe('2027-01-06');
        expect(recontact).toHaveBeenCalledTimes(1);
        const arg = recontact.mock.calls[0][0] as any;
        expect(arg.message).toMatch(/quote\/shed984/);
        expect(detectMoneyFigure(arg.message)).toBeNull();
        expect(arg.runId).toBe('run_test_1');
    });
});

// ---------------------------------------------------------------- belt boundaries

describe('tool boundary', () => {
    it('rejects an intent outside the pack, and a second propose_reply', async () => {
        const cf = caseFile({ timeline: [msg('message_in', 'hi')] });
        await runCase({
            cf, tri: triage(),
            script: async (t) => {
                await expect(t.propose_reply.run({ intent: 'answer_from_quote', body: ['x'], reasons: ['x'] })).rejects.toThrow(/not in this pack/);
                await expect(t.propose_reply.run({ intent: 'job_brief', body: ['x'], reasons: ['x'] })).rejects.toThrow(/not in this pack/);
                await t.propose_reply.run({ intent: 'ask_gap', body: ['Could you send a photo of it?'], reasons: ['first ask'] });
                await expect(t.propose_reply.run({ intent: 'ask_gap', body: ['again'], reasons: ['x'] })).rejects.toThrow(/run has ended/);
            },
        });
    });
    it('refuses quote_on_its_way when a live quote is already out, and recontact without one', async () => {
        const withQuote = caseFile({ quote: { slug: 'q1', total: 100, lines: 1, viewedAt: null, expiresAt: null, paid: false }, timeline: [msg('message_in', 'hi')] });
        await runCase({ cf: withQuote, tri: triage(), script: async (t) => {
            await expect(t.propose_reply.run({ intent: 'quote_on_its_way', body: ['Quote coming.'], reasons: ['x'] })).rejects.toThrow(/already out/);
        } });
        const noQuote = caseFile({ timeline: [msg('message_in', 'hi')] });
        await runCase({ cf: noQuote, tri: triage(), script: async (t) => {
            await expect(t.schedule_recontact.run({ date: '2026-12-01', note: 'x' })).rejects.toThrow(/no live quote/);
        } });
    });
    it('body rules: bubbles, length, voice, one question', () => {
        const cf = caseFile({ timeline: [msg('message_in', 'hi')] });
        expect(checkProposedBody({ bubbles: [], intent: 'ask_gap', caseFile: cf })).toMatch(/empty/);
        expect(checkProposedBody({ bubbles: ['a', 'b', 'c', 'd'], intent: 'ask_gap', caseFile: cf })).toMatch(/maximum is 3/);
        expect(checkProposedBody({ bubbles: ['Could you send a photo? And your postcode?'], intent: 'ask_gap', caseFile: cf })).toMatch(/one question/);
        expect(checkProposedBody({ bubbles: ['Thanks — sorted.'], intent: 'ask_gap', caseFile: cf })).toMatch(/voice/);
        expect(checkProposedBody({ bubbles: ['Let me know when suits and we will get it done.'], intent: 'ask_gap', caseFile: cf })).toMatch(/voice|closer/);
        expect(checkProposedBody({ bubbles: ['Could you send a photo of the tap?'], intent: 'ask_gap', caseFile: cf })).toBeNull();
        expect(normaliseBody('one\n---\ntwo')).toEqual(['one', 'two']);
        expect(normaliseBody([' a ', '', 'b'])).toEqual(['a', 'b']);
    });
    it('flag validates its vocabulary; tags are limited to the proposable set', async () => {
        const cf = caseFile({ timeline: [msg('message_in', 'hi')] });
        const { proposal } = await runCase({ cf, tri: triage(), script: async (t) => {
            await expect(t.flag.run({ exception: 'vibes', note: 'a long enough note for Ben to read' })).rejects.toThrow(/exception must be/);
            await expect(t.flag.run({ exception: 'refund', note: 'short' })).rejects.toThrow(/too short/);
            await t.propose_reply.run({ intent: 'ask_gap', body: ['Could you send a photo of it?'], reasons: ['x'], tags: ['needs_quote', 'won', 'trust_concern'] });
        } });
        expect(proposal!.tags!.sort()).toEqual(['needs_quote', 'trust_concern']);
        expect(PROPOSABLE_TAGS).not.toContain('won');
    });
    it('a runner failure degrades to a flag when triage had one, else null', async () => {
        const cf = caseFile({ timeline: [msg('message_in', 'hi')] });
        const boom = vi.fn(async () => { throw new Error('api down'); });
        const agent = createScoperAgent({ runAgent: boom as any, persist: false });
        expect(await agent.run({ caseFile: cf, pack: DEFAULT_PACK, triage: triage(), runId: 'r' })).toBeNull();
        const p = await agent.run({ caseFile: cf, pack: DEFAULT_PACK, triage: triage({ exceptions: ['refund'] }), runId: 'r' });
        expect(p?.flag?.exception).toBe('refund');
    });
});

describe('prompts and contract', () => {
    it('core prompt is within the 2.5k-token budget and free of em dashes', () => {
        const core = loadScoperCore();
        expect(core.length).toBeLessThanOrEqual(10_000); // ~2.5k tokens at 4 chars/token
        expect(core).not.toMatch(/[—–]/);
        expect(core).toMatch(/NEVER WRITE A MONEY FIGURE/);
    });
    it('system block adds the post-quote fragment and levers only for the post-quote pack, and names the pack intents', () => {
        const base = buildScoperSystem(DEFAULT_PACK, { voice: 'VOICE STUB' });
        const post = buildScoperSystem(POST_QUOTE_PACK, { voice: 'VOICE STUB' });
        expect(base).not.toMatch(/POST-QUOTE/);
        expect(post).toMatch(/POST-QUOTE/);
        expect(post).toMatch(/THE LEVERS/);
        expect(base).toMatch(/ask_gap, clarify_scope/);
        expect(post).toMatch(/point_to_picker/);
        expect(base).toMatch(/VOICE STUB/);
    });
    it('the case file render never carries the quote figure, marks placeholders, and tells Ben from agents', () => {
        const cf = caseFile({
            contactName: 'Website Visitor',
            quote: { slug: 'zz', total: 98400, lines: 2, viewedAt: null, expiresAt: null, paid: false },
            timeline: [msg('message_out', 'Hi, Ben here, yes we can', { by: 'human:ben' }), msg('message_out', 'holding', { by: 'rules.holding' })],
        });
        const text = renderCaseFile(cf, triage());
        expect(text).not.toMatch(/98400|984/);
        expect(text).toMatch(/PLACEHOLDER/);
        expect(text).toMatch(/US \(BEN, manual\)/);
        expect(text).toMatch(/US \(rules\.holding\)/);
    });
    it('approver and adapter shapes', () => {
        expect(isApprover(SCOPER_APPROVER)).toBe(true);
        const out = proposalToLegacyOutcome({ intent: 'ask_gap', body: ['hi'], reasons: ['r'], flag: { exception: 'refund', note: 'n' }, tags: ['needs_quote'] }, 'run_x');
        expect(out.autosent).toBe(false);
        expect(out.actions.map((a) => a.tool)).toEqual(['propose_reply', 'flag', 'tags']);
    });
});
