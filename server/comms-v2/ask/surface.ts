/**
 * Handy Desk - the answer surface, built from the new desk's own records.
 *
 * The ask agent chooses what to show (a thread, the floor, or words) and names the file; every
 * datum on the surface is read here, off the case file and the comms-v2 board, never taken from the
 * model. So a surface can show only what the desk holds. The confirm footer appears only for a
 * proposal the run saved (actions.ts), carrying its id, and the outgoing tiles are that proposal's
 * preview, or a held draft this run wrote when nothing could be proposed for it.
 *
 * Sources: thread -> the case file's turns (desk/case-file.ts), with a call turn's summary from
 * api/board.ts `callViewOf`; floor -> api/board.ts `boardOf`, the same columns Ben's kanban shows.
 * The other four surface types in shared/ops-types.ts are not produced here yet.
 */
import type {
    AnswerSurface, CaseStage, OpsAnswer, OpsOutgoing, PlanStep, SurfaceBoardCard, SurfaceTurn,
} from '@shared/ops-types';
import { boardOf, callViewOf, replyChannelOf } from '../api/board';
import type { ApproverAssignments } from '../api/approvers';
import type { CaseFile, Party, SystemTurn, Turn } from '../desk/case-file';
import type { RunProposal } from './tools';

/** Most recent turns a thread surface carries. */
export const THREAD_TURN_CAP = 40;

/** The customer on the file: the first party who is not one of ours. */
export function customerOf(file: CaseFile): Party | null {
    return file.parties.find((p) => p.role !== 'internal') ?? file.parties[0] ?? null;
}

/** The address a reply goes to on the file's reply channel: E.164 or an email address; the canonical key when the party has no such channel. */
export function replyAddressOf(file: CaseFile): string {
    const party = customerOf(file);
    if (!party) return '';
    const channel = replyChannelOf(file);
    const ch = channel ? party.channels.find((c) => c.kind === channel) : null;
    return ch?.address ?? party.channels[party.channels.length - 1]?.address ?? party.canonical;
}

/** Whether a phone number or email address the desk was handed names this file's customer. */
export function fileAnswersTo(file: CaseFile, address: string): boolean {
    const want = address.trim().toLowerCase();
    if (!want) return false;
    const digits = want.replace(/\D/g, '');
    const national = digits.startsWith('44') ? `0${digits.slice(2)}` : digits;
    return file.parties.some((p) => {
        if (p.canonical.toLowerCase() === want) return true;
        if (digits.length >= 10 && p.canonical === `phone:${national}`) return true;
        return p.channels.some((c) => c.address.toLowerCase() === want);
    });
}

function whoOf(turn: Turn): SurfaceTurn['who'] {
    if (turn.direction === 'inbound') return turn.kind === 'system' ? 'system' : 'customer';
    if (turn.approver?.startsWith('human:')) return 'person';
    return turn.kind === 'system' ? 'system' : 'desk';
}

export function surfaceTurnOf(file: CaseFile, turn: Turn): SurfaceTurn {
    const call = callViewOf(file, turn);
    return {
        id: turn.id,
        at: turn.at,
        who: whoOf(turn),
        channel: turn.channel,
        kind: turn.kind,
        body: turn.body,
        approver: turn.approver,
        ...(call ? { callSummary: call.summary } : {}),
    };
}

/** A confirmed change that sent nothing (desk/case-file.ts `SystemTurn`), as a thread line. */
export function surfaceSystemTurnOf(turn: SystemTurn): SurfaceTurn {
    return { id: turn.id, at: turn.at, who: 'system', channel: 'system', kind: 'system', body: turn.body, approver: turn.approver };
}

/** The thread's turns and its system lines, in time order (a turn first on a tie), the newest `cap`. */
export function threadSurface(file: CaseFile, cap = THREAD_TURN_CAP): Extract<AnswerSurface, { type: 'thread' }> {
    const lines = [
        ...file.turns.map((t, i) => ({ at: Date.parse(t.at), order: 0, i, turn: surfaceTurnOf(file, t) })),
        ...(file.systemTurns ?? []).map((t, i) => ({ at: Date.parse(t.at), order: 1, i, turn: surfaceSystemTurnOf(t) })),
    ].sort((a, b) => a.at - b.at || a.order - b.order || a.i - b.i);
    return {
        type: 'thread',
        caseFileId: file.id,
        phone: replyAddressOf(file),
        customerName: customerOf(file)?.name ?? null,
        stage: file.stage,
        turns: lines.slice(-cap).map((l) => l.turn),
    };
}

/** The seven bays, every card with its hold ring, from the board's own columns and order. */
export function floorSurface(files: CaseFile[], assignments: ApproverAssignments = {}): Extract<AnswerSurface, { type: 'floor' }> {
    const board = boardOf(files, {}, assignments);
    return {
        type: 'floor',
        bays: board.stages.map((stage) => ({
            stage: stage as CaseStage,
            cards: board.columns[stage].map((c): SurfaceBoardCard => ({
                id: c.id,
                stage: c.stage,
                held: c.held,
                holdReason: c.holdReason,
                holdSince: c.holdSince,
                hasDraft: c.hasDraft,
                customerName: c.customerName,
                customerAddress: c.customerAddress,
                jobType: c.jobType,
                location: c.location,
                lastCustomerMessageAt: c.lastCustomerMessageAt,
            })),
        })),
    };
}

const WIRE_CHANNEL = { whatsapp: 'wa', sms: 'sms', email: 'email' } as const;

/** The held draft as the tile "what goes out when you confirm" shows it; empty when nothing is held with a draft. */
export function outgoingOf(file: CaseFile): OpsOutgoing[] {
    const draft = file.hold?.draft;
    const channel = replyChannelOf(file);
    if (!draft || !channel) return [];
    return [{ to: replyAddressOf(file), channel: WIRE_CHANNEL[channel], text: draft }];
}

/** The confirm footer for a proposal: its id and kind; a held-draft send also names the file, for the surface built before proposals. */
export function confirmOf(p: RunProposal): NonNullable<OpsAnswer['confirm']> {
    return p.kind === 'draft.release' && p.caseFileId
        ? { label: p.label, actionId: p.id, kind: p.kind, action: { kind: 'draft.release', args: { caseFileId: p.caseFileId } } }
        : { label: p.label, actionId: p.id, kind: p.kind };
}

/** What the agent chose to show, before the data is read. */
export type SurfaceChoice =
    | { type: 'thread'; caseFileId: string }
    | { type: 'floor' }
    | { type: 'words' };

export interface BuildAnswerInput {
    finalText: string;
    choice: SurfaceChoice;
    files: CaseFile[];
    assignments?: ApproverAssignments;
    /** The files a draft was held on during this run, oldest first. */
    drafted?: string[];
    /** The change this run proposed: its preview is the outgoing tiles and its id the confirm. */
    proposal?: RunProposal | null;
    plan?: PlanStep[];
    note?: string | null;
}

/**
 * The OpsAnswer for a run. A thread naming a file the store does not hold falls back to words with
 * the reason on the note. The confirm is the run's one proposal, so one press runs one known change;
 * its preview is the outgoing tiles. With no proposal, a draft this run held still shows as a tile
 * (with no confirm), read back off the file.
 */
export function buildAnswer(input: BuildAnswerInput): OpsAnswer {
    const byId = new Map(input.files.map((f) => [f.id, f]));
    const notes: string[] = [];
    if (input.note?.trim()) notes.push(input.note.trim());
    let surface: AnswerSurface;
    if (input.choice.type === 'thread') {
        const file = byId.get(input.choice.caseFileId);
        if (file) surface = threadSurface(file);
        else {
            surface = { type: 'words' };
            notes.push(`No case file ${input.choice.caseFileId} is on the desk, so there is no thread to show.`);
        }
    } else if (input.choice.type === 'floor') {
        surface = floorSurface(input.files, input.assignments);
    } else {
        surface = { type: 'words' };
    }

    const drafted = Array.from(new Set(input.drafted ?? [])).map((id) => byId.get(id)).filter((f): f is CaseFile => !!f && !!f.hold?.draft);
    const proposal = input.proposal ?? null;
    const outgoing = proposal
        ? [...proposal.outgoing, ...drafted.filter((f) => f.id !== proposal.caseFileId).flatMap(outgoingOf)]
        : drafted.flatMap(outgoingOf);

    const answer: OpsAnswer = { finalText: input.finalText.trim() || 'Done.', surface };
    if (outgoing.length) answer.outgoing = outgoing;
    if (proposal) answer.confirm = confirmOf(proposal);
    if (input.plan?.length) answer.plan = input.plan;
    if (notes.length) answer.note = notes.join(' ');
    return answer;
}
