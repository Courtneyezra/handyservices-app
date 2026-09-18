/**
 * Goal 2 - Ben's desk, kanban. Read queries over Contract 2's case file, for the board and its
 * detail view: every call here is a read shaped for a card or a file's turns and facts. The one
 * mutation, release, goes straight to the case file's own `release` (case-file.ts) from routes.ts,
 * so the invariant - only the named approver, only with words - is enforced there, not here.
 */
import {
    approverLabel, STAGES,
    type CaseFile, type Fact, type Hold, type Job,
    type ReplyChannel, type Stage, type Turn,
} from '../desk/case-file';
import { slotAssigned, type ApproverAssignments } from './approvers';
import { benToRequest } from '../quoting/ben-to-request';
import { CALL_SUMMARY_KEY, callOutcomeOnFile, type CallOutcome } from '../channels/call-adapter';
import { reissueNotes, type ReissueNote } from '../quoting/quote-record';
import type { HoldException } from '../desk/router';
import { replyRouteOf } from '../desk/human-reply';

export type BoardMode = 'sandbox' | 'live';

export interface BoardCard {
    id: string;
    stage: Stage;
    mode: BoardMode;
    held: boolean;
    holdReason: string | null;
    holdApprover: string | null;
    holdApproverAssigned: boolean;
    holdSince: string | null;
    /** The router exception that raised the hold, when one did (desk/case-file.ts `Hold.exception`); null otherwise and when nothing is held. */
    holdException: HoldException | null;
    /** Whether the hold carries a draft the desk held back, for the "Draft ready" pill. */
    hasDraft: boolean;
    customerName: string | null;
    customerAddress: string;
    role: string;
    jobType: string | null;
    location: string | null;
    lastCustomerMessage: string | null;
    lastCustomerMessageAt: string | null;
    replyChannel: ReplyChannel | null;
    openedAt: string;
    benToRequest: string[];
    /** The desk's newest automatic reissue of the file's quote: the new figure, the one before, and when the customer was told (or why not). */
    quoteReissue: ReissueNote | null;
    /** The quote slug the file's job names (desk/case-file.ts `Job.quoteRef`); null while no quote is on the file. Lets a held card and its ready-to-price card merge on one row. */
    quoteSlug: string | null;
}

/**
 * What a call turn's bubble shows: the header line the turn's body opens with, the summary recorded
 * for the call, and the transcript when there is one. The transcript and summary can land after the
 * turn does (channels/channel-gateway.ts `attachCall`), so both are null until then.
 */
export interface CallView {
    outcome: CallOutcome;
    headline: string;
    summary: string | null;
    transcript: string | null;
}

export type DetailTurn = Turn & { call?: CallView };

export interface CaseFileDetail {
    id: string;
    stage: Stage;
    mode: BoardMode;
    party: { name: string | null; role: string; address: string } | null;
    job: Job;
    turns: DetailTurn[];
    facts: Fact[];
    hold: Hold | null;
    holdApproverAssigned: boolean;
    /** The channel a person's reply from this thread would go out on, as the send chooses it (desk/human-reply.ts `replyRouteOf`); null with `replyRefusal` when no reply can be routed. */
    replyChannel: ReplyChannel | null;
    /** That channel's window: WhatsApp's 24-hour window, open until `closesAt` or shut with its reason; any other channel is open with no closing time. Null when no reply can be routed. */
    replyWindow: ReplyWindow | null;
    /** Why no reply can be routed, in the send's own words; null when one can. */
    replyRefusal: string | null;
}

export interface ReplyWindow {
    state: 'open' | 'shut';
    reason: string;
    closesAt: string | null;
}

/** live once any send on the file actually delivered; sandbox otherwise, including before the first send. */
export function modeOf(file: CaseFile): BoardMode {
    return file.sends.some((s) => s.mode === 'live') ? 'live' : 'sandbox';
}

/** The channel a reply would go back on: the last send's channel, else the party's most recent channel. */
export function replyChannelOf(file: CaseFile): ReplyChannel | null {
    const lastSend = file.sends[file.sends.length - 1];
    if (lastSend) return lastSend.channel;
    const party = file.parties[0];
    const kind = party?.channels[party.channels.length - 1]?.kind;
    return kind === 'whatsapp' || kind === 'sms' || kind === 'email' ? kind : null;
}

/** The newest inbound turn - what the customer last said, and when. */
export function lastCustomerTurn(file: CaseFile): Turn | null {
    for (let i = file.turns.length - 1; i >= 0; i--) if (file.turns[i].direction === 'inbound') return file.turns[i];
    return null;
}

export function cardOf(file: CaseFile, assignments: ApproverAssignments = {}): BoardCard {
    const party = file.parties[0] ?? null;
    const last = lastCustomerTurn(file);
    return {
        id: file.id,
        stage: file.stage,
        mode: modeOf(file),
        held: !!file.hold,
        holdReason: file.hold?.reason ?? null,
        holdApprover: file.hold ? approverLabel(file.hold.approver) : null,
        holdApproverAssigned: file.hold ? slotAssigned(file.hold.approver, assignments) : false,
        holdSince: file.hold?.since ?? null,
        holdException: file.hold?.exception ?? null,
        hasDraft: !!file.hold?.draft,
        customerName: party?.name ?? null,
        customerAddress: party?.canonical ?? '',
        role: party?.role ?? 'homeowner',
        jobType: file.job.type,
        location: file.job.location,
        lastCustomerMessage: last?.body ?? null,
        lastCustomerMessageAt: last?.at ?? null,
        replyChannel: replyChannelOf(file),
        openedAt: file.openedAt,
        benToRequest: benToRequest(file),
        quoteReissue: newestReissue(file),
        quoteSlug: file.job.quoteRef,
    };
}

/** The newest reissue the file records for the quote it names now. */
export function newestReissue(file: CaseFile): ReissueNote | null {
    const notes = reissueNotes(file).filter((n) => n.slug === file.job.quoteRef);
    return notes.length ? notes[notes.length - 1] : null;
}

export interface BoardFilter {
    held?: boolean;
    mode?: BoardMode;
}

export interface Board {
    stages: readonly Stage[];
    columns: Record<Stage, BoardCard[]>;
}

/** One column per Contract 2 stage. Held cards float to the top of their column. */
export function boardOf(files: CaseFile[], filter: BoardFilter = {}, assignments: ApproverAssignments = {}): Board {
    const columns = Object.fromEntries(STAGES.map((s) => [s, [] as BoardCard[]])) as Record<Stage, BoardCard[]>;
    for (const file of files) {
        const card = cardOf(file, assignments);
        if (filter.held && !card.held) continue;
        if (filter.mode && card.mode !== filter.mode) continue;
        columns[card.stage].push(card);
    }
    for (const stage of STAGES) {
        columns[stage].sort((a, b) => {
            if (a.held !== b.held) return a.held ? -1 : 1;
            return Date.parse(b.lastCustomerMessageAt ?? b.openedAt) - Date.parse(a.lastCustomerMessageAt ?? a.openedAt);
        });
    }
    return { stages: STAGES, columns };
}

/** A call turn's bubble, read off the turn and its facts; null for any other turn. */
export function callViewOf(file: CaseFile, turn: Turn): CallView | null {
    const outcome = callOutcomeOnFile(file, turn);
    if (!outcome) return null;
    const [first, ...rest] = turn.body.split('\n');
    const header = /^\[[^\]]*\]$/.test(first ?? '');
    const text = (header ? rest.join('\n') : turn.body).trim();
    let summary: string | null = null;
    for (let i = file.facts.length - 1; i >= 0 && summary === null; i--) {
        const f = file.facts[i];
        if (f.key === CALL_SUMMARY_KEY && f.source.kind === 'thread' && f.source.turnId === turn.id) summary = f.value;
    }
    return {
        outcome,
        headline: header ? first.slice(1, -1) : 'call',
        summary,
        transcript: text && text !== '(no transcript)' ? text : null,
    };
}

/** The file's turns and facts, read-only, for a card opened in detail. */
export function detailOf(file: CaseFile, assignments: ApproverAssignments = {}, now: Date = new Date()): CaseFileDetail {
    const party = file.parties[0] ?? null;
    const route = replyRouteOf(file, now);
    return {
        id: file.id,
        stage: file.stage,
        mode: modeOf(file),
        party: party ? { name: party.name, role: party.role, address: party.canonical } : null,
        job: file.job,
        turns: file.turns.map((t) => {
            const call = callViewOf(file, t);
            return call ? { ...t, call } : t;
        }),
        facts: file.facts,
        hold: file.hold,
        holdApproverAssigned: file.hold ? slotAssigned(file.hold.approver, assignments) : false,
        replyChannel: route.ok ? route.channel : null,
        replyWindow: route.ok ? { state: route.window.state, reason: route.window.reason, closesAt: route.window.opensUntil } : null,
        replyRefusal: route.ok ? null : route.reason,
    };
}
