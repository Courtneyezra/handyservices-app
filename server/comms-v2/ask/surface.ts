/**
 * Handy Desk - the answer surface, built from the new desk's own records.
 *
 * The ask agent chooses what to show (a thread, the floor, or words) and names the file; every
 * datum on the surface is read here, off the case file and the comms-v2 board, never taken from the
 * model. So a surface can show only what the desk holds, and the outgoing tiles and the confirm
 * footer appear only while a held draft actually stands on the file.
 *
 * Sources: thread -> the case file's turns (desk/case-file.ts), with a call turn's summary from
 * api/board.ts `callViewOf`; floor -> api/board.ts `boardOf`, the same columns Ben's kanban shows.
 * The other four surface types in shared/ops-types.ts are not produced here yet.
 */
import type {
    AnswerSurface, CaseStage, ConfirmAction, OpsAnswer, OpsOutgoing, SurfaceBoardCard, SurfaceTurn,
} from '@shared/ops-types';
import { boardOf, callViewOf, replyChannelOf } from '../api/board';
import type { ApproverAssignments } from '../api/approvers';
import type { CaseFile, Party, Turn } from '../desk/case-file';

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

export function threadSurface(file: CaseFile, cap = THREAD_TURN_CAP): Extract<AnswerSurface, { type: 'thread' }> {
    return {
        type: 'thread',
        caseFileId: file.id,
        phone: replyAddressOf(file),
        customerName: customerOf(file)?.name ?? null,
        stage: file.stage,
        turns: file.turns.slice(-cap).map((t) => surfaceTurnOf(file, t)),
    };
}

/** The seven bays, every card with its hold ring, from the board's own columns and order. */
export function floorSurface(files: CaseFile[], assignments: ApproverAssignments = {}): Extract<AnswerSurface, { type: 'floor' }> {
    const board = boardOf(files, {}, assignments);
    const drafts = new Set(files.filter((f) => !!f.hold?.draft).map((f) => f.id));
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
                hasDraft: drafts.has(c.id),
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

/** The one confirm the ask agent proposes: send the held draft as it stands, through the board's human send path. */
export function releaseConfirm(file: CaseFile): { label: string; action: ConfirmAction } | null {
    if (!file.hold?.draft) return null;
    return { label: 'Send as is', action: { kind: 'draft.release', args: { caseFileId: file.id } } };
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
    /** The files a draft was held on during this run, oldest first. Their drafts are the outgoing tiles. */
    drafted?: string[];
    note?: string | null;
}

/**
 * The OpsAnswer for a run. A thread naming a file the store does not hold falls back to words with
 * the reason on the note. Outgoing tiles are the held drafts on the files this run drafted on, read
 * back off the files; the confirm is offered only when exactly one such draft stands, so one press
 * sends one known message.
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
    const outgoing = drafted.flatMap(outgoingOf);
    const confirm = drafted.length === 1 ? releaseConfirm(drafted[0]) : null;

    const answer: OpsAnswer = { finalText: input.finalText.trim() || 'Done.', surface };
    if (outgoing.length) answer.outgoing = outgoing;
    if (confirm) answer.confirm = confirm;
    if (notes.length) answer.note = notes.join(' ');
    return answer;
}
