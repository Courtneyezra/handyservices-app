/**
 * Handy Desk - the ask agent's tool belt.
 *
 * Reads: the comms-v2 board and its case files, from the same store Ben's kanban reads
 * (api/store.ts `boardSourceFor`: the live intake's durable store while the new desk is live, the
 * board's sandbox door otherwise). Nothing else: no old inbox board, no message_drafts, no VA call
 * sheet, no old comms agent.
 *
 * One write: `draft_reply` composes a reply on the writing model and holds it on the file
 * (hold-draft.ts), then puts the file back to that store. It never sends, and it is refused to a
 * session that holds no approver slot, as every write on the board is.
 *
 * Every change beyond that is a proposal (actions.ts), made through `proposeInRun`: the tool saves
 * it and Ben confirms it on the answer. One new proposal per run, so each change is confirmed on its
 * own and the next step is proposed after it, reading what it changed; the first refusal stops the
 * run's chain. There is no cap on how many steps a chain takes across runs (answer A5).
 * `propose_send_held_draft` is this group's one proposal.
 *
 * `give_answer` records what the answer surface shows and the plan strip's steps; surface.ts and
 * plan.ts read the data for them. The tools are offered by group (tool-groups.ts); these are the
 * `messages` group and the answer.
 */
import type { ConfirmKind } from '@shared/ops-types';
import type { AgentTool } from '../../agents/runner';
import type { ApproverSlot, CaseFile, ModelCallRecord } from '../desk/case-file';
import type { ModelClient } from '../desk/models';
import { cardOf, detailOf, type BoardCard } from '../api/board';
import type { ApproverAssignments } from '../api/approvers';
import type { BoardSource } from '../api/store';
import { composeDraft } from './composer';
import { holdDraft } from './hold-draft';
import { fileAnswersTo, type SurfaceChoice } from './surface';
import { proposeAction, type AskActionStore } from './actions';
import type { ActionKinds } from './action-kinds';
import { cleanSteps, type PlannedStep } from './plan';

export const BOARD_CARD_CAP = 60;
export const FIND_CAP = 10;
const TURN_CAP = 30;
const TEXT_CAP = 400;
/** Writing attempts per draft: the first, and one more with the refusal named. */
const COMPOSE_ATTEMPTS = 2;

export const ASK_READ_TOOLS = ['get_board', 'find_case_files', 'get_case_file'] as const;
export const ASK_WRITE_TOOLS = ['draft_reply'] as const;
export const ASK_PROPOSAL_TOOLS = ['propose_send_held_draft'] as const;
/** The `messages` group, then the answer. */
export const ASK_TOOL_NAMES = [...ASK_READ_TOOLS, ...ASK_WRITE_TOOLS, ...ASK_PROPOSAL_TOOLS, 'give_answer'] as const;

export interface AskToolDeps {
    /** The store this run reads and drafts on. */
    source: () => Promise<BoardSource>;
    assignments: ApproverAssignments;
    /** The signed-in person's approver slot; null means the run may read but not draft. */
    approver: ApproverSlot | null;
    /** Who is asking: their email or user id, written on the hold's reason. */
    person: string;
    client: ModelClient;
    now?: () => Date;
    /** Where proposals are saved; without one, the run proposes nothing. */
    actions?: AskActionStore;
    kinds?: ActionKinds;
    sessionId?: string;
    /** The ask run the proposals belong to. */
    askRunId?: string | null;
}

export interface GiveAnswerInput {
    finalText: string;
    surface: SurfaceChoice;
    note: string | null;
    /** The plan strip's steps as the reasoner sees them; empty when it named none. */
    plan: PlannedStep[];
}

/** A proposal this run made, as its answer offers it. */
export interface RunProposal {
    id: string;
    kind: ConfirmKind;
    caseFileId: string | null;
    label: string;
    outgoing: import('@shared/ops-types').OpsOutgoing[];
}

/** What the tools learned during one run, for the answer. */
export interface AskRunState {
    drafted: string[];
    answer: GiveAnswerInput | null;
    calls: ModelCallRecord[];
    /** The one change this run proposed (at most one: the next is proposed after Ben confirms it). */
    proposal: RunProposal | null;
    /** The refusal that stopped this run's chain, verbatim. */
    refusal: string | null;
}

export function newRunState(): AskRunState {
    return { drafted: [], answer: null, calls: [], proposal: null, refusal: null };
}

export type ProposeInRunResult =
    | { status: 'proposed'; actionId: string; kind: ConfirmKind; preview: string; expiresAt: string; note: string }
    | { status: 'refused'; reason: string };

/**
 * The one way an ask tool proposes a change. Refused once this run has proposed one (the next step
 * is proposed after Ben confirms it) or once a proposal has been refused (the chain stops there).
 * A refusal from the proposal store stops the chain too.
 */
export async function proposeInRun(deps: AskToolDeps, state: AskRunState, kind: ConfirmKind, args: unknown): Promise<ProposeInRunResult> {
    if (state.refusal) return { status: 'refused', reason: `the plan stopped at a refusal (${state.refusal}); tell Ben and propose nothing more` };
    if (state.proposal) return { status: 'refused', reason: `one change at a time: ${state.proposal.kind} is waiting for Ben's confirm, and the next step is proposed after it` };
    if (!deps.actions || !deps.sessionId) return { status: 'refused', reason: 'this run cannot propose changes' };
    const out = await proposeAction(
        { kind, args, sessionId: deps.sessionId, askRunId: deps.askRunId ?? null, person: deps.person, approver: deps.approver },
        { store: deps.actions, source: deps.source, kinds: deps.kinds, now: deps.now },
    );
    if (!out.ok) {
        state.refusal = out.reason;
        return { status: 'refused', reason: out.reason };
    }
    state.proposal = { id: out.action.id, kind, caseFileId: out.action.caseFileId, label: out.label, outgoing: out.outgoing };
    return { status: 'proposed', actionId: out.action.id, kind, preview: out.action.previewText, expiresAt: out.action.expiresAt, note: 'Nothing has run. Ben confirms it on your answer; stop here and answer.' };
}

const clip = (s: string | null | undefined, n = TEXT_CAP): string | null => (s == null ? null : s.length > n ? `${s.slice(0, n)}...` : s);

function compactCard(c: BoardCard, file: CaseFile | null) {
    return {
        caseFileId: c.id,
        stage: c.stage,
        held: c.held,
        holdReason: clip(c.holdReason, 200),
        holdSince: c.holdSince,
        hasDraft: !!file?.hold?.draft,
        customerName: c.customerName,
        customerAddress: c.customerAddress,
        jobType: c.jobType,
        location: c.location,
        lastCustomerMessage: clip(c.lastCustomerMessage, 200),
        lastCustomerMessageAt: c.lastCustomerMessageAt,
        replyChannel: c.replyChannel,
        benToRequest: c.benToRequest,
    };
}

function sortedCards(files: CaseFile[], assignments: ApproverAssignments): BoardCard[] {
    return files.map((f) => cardOf(f, assignments)).sort((a, b) => {
        if (a.held !== b.held) return a.held ? -1 : 1;
        if (a.held && b.held) return Date.parse(a.holdSince ?? a.openedAt) - Date.parse(b.holdSince ?? b.openedAt);
        return Date.parse(b.lastCustomerMessageAt ?? b.openedAt) - Date.parse(a.lastCustomerMessageAt ?? a.openedAt);
    });
}

function matches(file: CaseFile, card: BoardCard, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    if (file.id.toLowerCase() === q) return true;
    if (fileAnswersTo(file, q)) return true;
    return [card.customerName, card.jobType, card.location, card.lastCustomerMessage]
        .some((v) => !!v && v.toLowerCase().includes(q));
}

function str(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

/** Every tool this file holds: the `messages` group and the answer. */
export function askTools(deps: AskToolDeps, state: AskRunState): AgentTool[] {
    return [...messageTools(deps, state), answerTool(state)];
}

/** The `messages` group: the board and case-file reads, the held draft, and its send as a proposal. */
export function messageTools(deps: AskToolDeps, state: AskRunState): AgentTool[] {
    const now = deps.now ?? (() => new Date());
    const fileOr = async (id: string): Promise<{ src: BoardSource; file: CaseFile | null }> => {
        const src = await deps.source();
        return { src, file: id ? src.store.get(id) : null };
    };

    return [
        {
            name: 'get_board',
            description: 'The new comms desk board: every case file as a card, held files first (oldest hold first), then by newest customer activity. Use it for "what needs me", "what is waiting", counts, or to find a file id. Set held to true for only the files held for a person.',
            input_schema: {
                type: 'object',
                properties: {
                    held: { type: 'boolean', description: 'Only files held for a person.' },
                    stage: { type: 'string', enum: ['first_contact', 'scoping', 'ready', 'quoted', 'accepted', 'booked', 'done'], description: 'Only files at this stage.' },
                },
            },
            run: async (input: { held?: boolean; stage?: string }) => {
                const src = await deps.source();
                const files = src.store.all();
                const byId = new Map(files.map((f) => [f.id, f]));
                let cards = sortedCards(files, deps.assignments);
                if (input?.held) cards = cards.filter((c) => c.held);
                if (input?.stage) cards = cards.filter((c) => c.stage === input.stage);
                return {
                    live: src.live,
                    total: cards.length,
                    held: cards.filter((c) => c.held).length,
                    cards: cards.slice(0, BOARD_CARD_CAP).map((c) => compactCard(c, byId.get(c.id) ?? null)),
                    truncated: cards.length > BOARD_CARD_CAP,
                };
            },
        },
        {
            name: 'find_case_files',
            description: 'Find case files by the customer\'s name, phone number, email address, job type, area, words from their last message, or a case file id. Returns up to ten cards.',
            input_schema: {
                type: 'object',
                properties: { query: { type: 'string', description: 'A name, number, address, job or phrase.' } },
                required: ['query'],
            },
            run: async (input: { query?: string }) => {
                const src = await deps.source();
                const query = str(input?.query);
                const hits = sortedCards(src.store.all(), deps.assignments)
                    .map((c) => ({ c, f: src.store.get(c.id) }))
                    .filter(({ c, f }) => !!f && matches(f, c, query));
                return { matches: hits.slice(0, FIND_CAP).map(({ c, f }) => compactCard(c, f)), total: hits.length };
            },
        },
        {
            name: 'get_case_file',
            description: 'One case file in full: the customer, the job, the stage, the hold (its reason, how long, and any draft on it), what the file records, and the most recent turns of the thread. Use it before answering anything about one customer and before drafting.',
            input_schema: {
                type: 'object',
                properties: { caseFileId: { type: 'string' } },
                required: ['caseFileId'],
            },
            run: async (input: { caseFileId?: string }) => {
                const { file } = await fileOr(str(input?.caseFileId));
                if (!file) return { error: 'no such case file' };
                const d = detailOf(file, deps.assignments);
                return {
                    caseFileId: d.id,
                    stage: d.stage,
                    mode: d.mode,
                    party: d.party,
                    job: d.job,
                    hold: d.hold ? { reason: d.hold.reason, since: d.hold.since, draft: d.hold.draft, failures: d.hold.failures, approverAssigned: d.holdApproverAssigned } : null,
                    facts: d.facts.map((f) => ({ key: f.key, value: clip(f.value, 200), source: f.source.kind, at: f.at })),
                    turnCount: d.turns.length,
                    turns: d.turns.slice(-TURN_CAP).map((t) => ({
                        at: t.at,
                        direction: t.direction,
                        channel: t.channel,
                        kind: t.kind,
                        body: clip(t.body),
                        approver: t.approver,
                        ...(t.media.length ? { media: t.media.map((m) => ({ kind: m.kind, description: clip(m.description?.description, 200) })) } : {}),
                        ...(t.call ? { call: { outcome: t.call.outcome, summary: clip(t.call.summary) } } : {}),
                    })),
                };
            },
        },
        {
            name: 'draft_reply',
            description: 'Draft a reply to the customer on one case file and hold it for Ben to send. It never sends: Ben reads the draft on the file and sends it himself. Give a brief of what the reply should say; the words are written for you and checked. A draft may not carry a price, a date or time, a commitment, a claim about the business, or a repeated ask; a refusal says which, and a second attempt with a different brief is fine. Refused when the file already holds a draft.',
            input_schema: {
                type: 'object',
                properties: {
                    caseFileId: { type: 'string' },
                    brief: { type: 'string', description: 'What the reply should say, in a sentence or two.' },
                },
                required: ['caseFileId', 'brief'],
            },
            run: async (input: { caseFileId?: string; brief?: string }) => {
                if (!deps.approver) return { status: 'refused', reason: 'no approver slot is assigned to this user, so nothing can be drafted from this session' };
                const brief = str(input?.brief).trim();
                if (!brief) return { status: 'refused', reason: 'a draft needs a brief' };
                const { src, file } = await fileOr(str(input?.caseFileId));
                if (!file) return { status: 'refused', reason: 'no such case file' };
                if (file.hold?.draft) return { status: 'refused', reason: 'the file already holds a draft: Ben can send it, answer in his own words, or release the hold', standingDraft: file.hold.draft };

                let failures: string[] = [];
                let previous: string | null = null;
                let lastReason = 'the draft could not be written';
                for (let attempt = 0; attempt < COMPOSE_ATTEMPTS; attempt++) {
                    const composed = await composeDraft(deps.client, { file, brief, failures, previous });
                    state.calls.push(composed.record);
                    if (!composed.words) return { status: 'refused', reason: `the writing model gave no draft: ${composed.error ?? 'no output'}` };
                    const held = holdDraft({ file, words: composed.words, requestedBy: deps.person, why: brief }, { now });
                    if (held.ok) {
                        src.store.put(file);
                        state.drafted.push(file.id);
                        return { status: 'held', caseFileId: file.id, draft: held.draft, channel: held.channel, warnings: held.warnings, holdReason: held.hold.reason };
                    }
                    lastReason = held.reason;
                    failures = held.failures.length ? held.failures : [held.reason];
                    previous = composed.words;
                    // Only the guards and the render are worth a second attempt; anything else will refuse again.
                    if (!/guards|bubbles|segments/.test(held.reason)) break;
                }
                return { status: 'refused', reason: lastReason, failures, lastDraft: previous };
            },
        },
        {
            name: 'propose_send_held_draft',
            description: 'Propose sending the reply held on one case file exactly as it stands. It does not send: Ben reads the preview on your answer and confirms or cancels it. Use it when Ben asks to send a held draft; a draft you held this turn is proposed for you. Refused when the file holds no draft, when another send of it is waiting, or after this turn already proposed a change.',
            input_schema: {
                type: 'object',
                properties: { caseFileId: { type: 'string' } },
                required: ['caseFileId'],
            },
            run: async (input: { caseFileId?: string }) => proposeInRun(deps, state, 'draft.release', { caseFileId: str(input?.caseFileId) }),
        },
    ];
}

/** `give_answer`: offered in every run, whichever groups are. */
export function answerTool(state: AskRunState): AgentTool {
    return {
        name: 'give_answer',
        description: 'Your answer to Ben, and what his answer surface shows. Call it exactly once, last, before your closing line. surface "thread" shows one case file\'s conversation (give caseFileId); "floor" shows the whole board; "words" shows only your reply. A change you proposed this turn is shown with its preview and a confirm button automatically. For an ask with more than one step, give plan: every step of what Ben asked, in order, with done true for the ones finished.',
        input_schema: {
            type: 'object',
            properties: {
                finalText: { type: 'string', description: 'The reply line: one to three short sentences, what you found or did.' },
                surface: { type: 'string', enum: ['thread', 'floor', 'words'] },
                caseFileId: { type: 'string', description: 'Required for surface "thread".' },
                note: { type: 'string', description: 'Optional footer: anything Ben must know before he confirms, such as a shut window.' },
                plan: {
                    type: 'array',
                    description: 'The steps of a multi-step ask, in order, each a few words ("Find Marcus", "Move to Tue 23", "Tell Marcus"). Leave out for a one-step ask.',
                    items: { type: 'object', properties: { label: { type: 'string' }, done: { type: 'boolean' } }, required: ['label', 'done'] },
                },
            },
            required: ['finalText', 'surface'],
        },
        run: async (input: { finalText?: string; surface?: string; caseFileId?: string; note?: string; plan?: unknown }) => {
            const finalText = str(input?.finalText).trim();
            if (!finalText) return { ok: false, error: 'finalText is required' };
            let surface: SurfaceChoice;
            if (input?.surface === 'thread') {
                const id = str(input.caseFileId).trim();
                if (!id) return { ok: false, error: 'a thread surface needs caseFileId' };
                surface = { type: 'thread', caseFileId: id };
            } else if (input?.surface === 'floor') surface = { type: 'floor' };
            else surface = { type: 'words' };
            state.answer = { finalText, surface, note: str(input?.note).trim() || null, plan: cleanSteps(input?.plan) };
            return { ok: true };
        },
    };
}
