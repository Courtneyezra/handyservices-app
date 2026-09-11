/**
 * Goal 2 - Ben's desk, kanban. Read and act queries over Contract 2's case file, for the board and
 * its detail view. No new mutation here beyond release: every other call is a read shaped for a
 * card or a file's turns and facts. The release call is a thin wrapper over the case file's own
 * `release` (case-file.ts), so the invariant - only the named approver, only with words - is
 * enforced there, not here.
 */
import {
    approverLabel, release as releaseOnFile, STAGES,
    type ApproverSlot, type CaseFile, type Fact, type Hold, type Job, type LedgerEntry, type Outcome,
    type ReplyChannel, type SendRecord, type Stage, type Turn,
} from '../desk/case-file';

export type BoardMode = 'sandbox' | 'live';

export interface BoardCard {
    id: string;
    stage: Stage;
    mode: BoardMode;
    held: boolean;
    holdReason: string | null;
    holdApprover: string | null;
    holdSince: string | null;
    customerName: string | null;
    customerAddress: string;
    role: string;
    jobType: string | null;
    location: string | null;
    lastCustomerMessage: string | null;
    lastCustomerMessageAt: string | null;
    replyChannel: ReplyChannel | null;
    openedAt: string;
}

export interface CaseFileDetail {
    id: string;
    stage: Stage;
    mode: BoardMode;
    party: { name: string | null; role: string; address: string } | null;
    job: Job;
    turns: Turn[];
    facts: Fact[];
    ledger: LedgerEntry[];
    hold: Hold | null;
    sends: SendRecord[];
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

export function cardOf(file: CaseFile): BoardCard {
    const party = file.parties[0] ?? null;
    const last = lastCustomerTurn(file);
    return {
        id: file.id,
        stage: file.stage,
        mode: modeOf(file),
        held: !!file.hold,
        holdReason: file.hold?.reason ?? null,
        holdApprover: file.hold ? approverLabel(file.hold.approver) : null,
        holdSince: file.hold?.since ?? null,
        customerName: party?.name ?? null,
        customerAddress: party?.canonical ?? '',
        role: party?.role ?? 'homeowner',
        jobType: file.job.type,
        location: file.job.location,
        lastCustomerMessage: last?.body ?? null,
        lastCustomerMessageAt: last?.at ?? null,
        replyChannel: replyChannelOf(file),
        openedAt: file.openedAt,
    };
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
export function boardOf(files: CaseFile[], filter: BoardFilter = {}): Board {
    const columns = Object.fromEntries(STAGES.map((s) => [s, [] as BoardCard[]])) as Record<Stage, BoardCard[]>;
    for (const file of files) {
        const card = cardOf(file);
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

/** The file's turns and facts, read-only, for a card opened in detail. */
export function detailOf(file: CaseFile): CaseFileDetail {
    const party = file.parties[0] ?? null;
    return {
        id: file.id,
        stage: file.stage,
        mode: modeOf(file),
        party: party ? { name: party.name, role: party.role, address: party.canonical } : null,
        job: file.job,
        turns: file.turns,
        facts: file.facts,
        ledger: file.ledger,
        hold: file.hold,
        sends: file.sends,
    };
}

/** Releases a hold on the file, through the case file's own `release` call. */
export function releaseHold(file: CaseFile, approver: ApproverSlot, words: string): Outcome<unknown> {
    return releaseOnFile(file, approver, words);
}
