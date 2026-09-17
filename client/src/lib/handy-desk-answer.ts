/**
 * Handy Desk T3 - how the ask agent's OpsAnswer (shared/ops-types.ts, built by
 * server/comms-v2/ask/surface.ts) reads on the answer surface: who each thread turn is, what a
 * floor bay and a diary cell look like, how money and lateness read, what the confirm button posts,
 * and which answer on the person's session is the newest. Pure, so the mapping is tested apart from
 * the page.
 *
 * Every datum comes from the new desk: an answer's surface is read off the comms-v2 case file and
 * board by the server, and the idle thread (a card selected with no answer showing) is the same
 * `thread` surface mapped here from GET /api/comms-v2/case-files/:id.
 */
import type {
    AnswerSurface, AskMessageDTO, AskVia, CaseStage, ConfirmAction, OpsAnswer, OpsOutgoing, SurfaceTurn,
} from '@shared/ops-types';
import type { AskExchange } from '@/lib/handy-desk-ask';
import type { CaseFileDetail, Turn } from '@/pages/admin/CommsV2BoardPage';

export type ThreadSurface = Extract<AnswerSurface, { type: 'thread' }>;

// ---------------------------------------------------------------- the idle thread

function whoOfDetailTurn(turn: Turn): SurfaceTurn['who'] {
    if (turn.direction === 'inbound') return turn.kind === 'system' ? 'system' : 'customer';
    if (turn.approver?.startsWith('human:')) return 'person';
    return turn.kind === 'system' ? 'system' : 'desk';
}

/**
 * The selected card's conversation as a `thread` surface, the same shape the agent's answer
 * carries, so one renderer shows both. Mirrors `surfaceTurnOf` in server/comms-v2/ask/surface.ts.
 */
export function threadSurfaceOfDetail(detail: CaseFileDetail): ThreadSurface {
    return {
        type: 'thread',
        caseFileId: detail.id,
        phone: detail.party?.address ?? '',
        customerName: detail.party?.name ?? null,
        stage: detail.stage,
        turns: detail.turns.map((t) => ({
            id: t.id,
            at: t.at,
            who: whoOfDetailTurn(t),
            channel: t.channel,
            kind: t.kind,
            body: t.call ? (t.call.headline || t.body) : t.body,
            approver: t.approver ?? null,
            ...(t.call ? { callSummary: t.call.summary } : {}),
        })),
    };
}

/**
 * The label over a thread turn: the customer's name, "Desk" for the desk's own sends, and for a
 * person's send their staff name (`speakerNames`, keyed by lowercased login) else the login's local
 * part. `amber` is the design's desk-side colour; the customer reads grey.
 */
export function turnLabel(turn: SurfaceTurn, customerName: string | null, speakerNames: Record<string, string> = {}): { label: string; amber: boolean } {
    if (turn.who === 'customer') return { label: customerName || 'Customer', amber: false };
    if (turn.who === 'system') return { label: 'Note', amber: false };
    if (turn.who === 'person' && turn.approver?.startsWith('human:')) {
        const login = turn.approver.slice('human:'.length);
        return { label: speakerNames[login.toLowerCase()] || login.split('@')[0] || 'Staff', amber: true };
    }
    return { label: 'Desk', amber: true };
}

/** What a turn's line says: a call reads as its summary once transcription has filled it in. */
export function turnText(turn: SurfaceTurn): string {
    if (turn.callSummary) return turn.callSummary;
    return turn.body;
}

// ---------------------------------------------------------------- labels and figures

export const STAGE_LABEL: Record<CaseStage, string> = {
    first_contact: 'First contact',
    scoping: 'Scoping',
    ready: 'Ready',
    quoted: 'Quoted',
    accepted: 'Accepted',
    booked: 'Booked',
    done: 'Done',
};

export const CHANNEL_LABEL: Record<OpsOutgoing['channel'], string> = { wa: 'WhatsApp', sms: 'SMS', email: 'Email' };

/** Pence as the design shows money: whole pounds when whole, else two places. */
export function formatPence(pence: number): string {
    const pounds = pence / 100;
    const whole = Number.isInteger(pounds);
    return `£${pounds.toLocaleString('en-GB', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** A ledger row reads late (amber-700) past fourteen days. */
export const LATE_DAYS = 14;
export function isLate(daysLate: number): boolean {
    return daysLate > LATE_DAYS;
}

/** The address a tile names: the channel address without its kind prefix. */
export function addressLabel(address: string): string {
    return address.replace(/^[a-z]+:/, '');
}

/** Two-letter token for a floor card, from the name or the address. */
export function tokenOf(name: string | null, address: string): string {
    const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    const digits = address.replace(/\D/g, '');
    return digits ? digits.slice(-2) : '?';
}

/** A diary cell's look: booked grey, changed amber, open white dashed, off blank. */
export type DiaryCellLook = 'booked' | 'changed' | 'open' | 'off';

export function diaryCellLook(state: 'off' | 'open' | 'booked', changed: boolean): DiaryCellLook {
    if (changed) return 'changed';
    return state;
}

/** The key the diary surface's `changed` list names a cell by: `<contractorId>:<date>:<am|pm>`. */
export function diaryCellKey(contractorId: string, date: string, slot: 'am' | 'pm'): string {
    return `${contractorId}:${date}:${slot}`;
}

/** Whether a cell is in the `changed` list, by its slot key or its whole day. */
export function isChangedCell(changed: readonly string[] | undefined, contractorId: string, date: string, slot: 'am' | 'pm'): boolean {
    if (!changed?.length) return false;
    return changed.includes(diaryCellKey(contractorId, date, slot)) || changed.includes(`${contractorId}:${date}`);
}

// ---------------------------------------------------------------- the confirm

/**
 * Where a confirm posts. Only `draft.release` exists: the board's own human send path, which
 * carries the approver check, the window rule, the bubble ceiling and the opt-out ledger.
 */
export function confirmRequest(action: ConfirmAction): { url: string; method: 'POST' } {
    switch (action.kind) {
        case 'draft.release':
            return { url: `/api/comms-v2/case-files/${encodeURIComponent(action.args.caseFileId)}/send-held-draft`, method: 'POST' };
    }
}

/**
 * The draft the confirm expects to send: the one outgoing tile, since the agent offers a confirm
 * only when exactly one held draft stands. send-held-draft refuses when the file's draft differs.
 */
export function expectedDraftOf(answer: OpsAnswer): string | undefined {
    return answer.outgoing?.length === 1 ? answer.outgoing[0].text : undefined;
}

/** The case file a confirm acts on, for the template offer a shut window needs. */
export function confirmCaseFileId(action: ConfirmAction): string {
    return action.args.caseFileId;
}

/** What the done state says once a confirm went through. */
export function confirmedNote(answer: OpsAnswer): string {
    const first = answer.outgoing?.[0];
    if (!first) return 'Done.';
    const more = (answer.outgoing?.length ?? 0) > 1 ? ` and ${answer.outgoing!.length - 1} more` : '';
    return `Sent to ${addressLabel(first.to)} on ${CHANNEL_LABEL[first.channel]}${more}.`;
}

// ---------------------------------------------------------------- the answer's age

function londonDay(at: Date): string {
    return at.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/** Whether an answer was given on an earlier Europe/London day than `now`; its draft is not offered for sending. */
export function isEarlierDay(at: string, now: Date): boolean {
    return londonDay(new Date(at)) < londonDay(now);
}

/** How old an answer is, as the outgoing tile says it. */
export function ageLabel(at: string, now: Date): string {
    const minutes = Math.floor((now.getTime() - new Date(at).getTime()) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

// ---------------------------------------------------------------- the newest answer on a session

/** The newest answered ask on a session: the assistant row carrying an answer, with the ask before it. */
export interface AnsweredAsk {
    id: string;
    at: string;
    ask: { text: string; via: AskVia } | null;
    answer: OpsAnswer;
    /** The assistant row itself, for the answer card. */
    message: AskMessageDTO;
}

export function latestAnswered(messages: readonly AskMessageDTO[]): AnsweredAsk | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role !== 'assistant' || !m.answer) continue;
        let ask: AnsweredAsk['ask'] = null;
        for (let j = i - 1; j >= 0; j--) {
            if (messages[j].role === 'user') {
                ask = { text: messages[j].content, via: messages[j].via ?? 'typed' };
                break;
            }
        }
        return { id: m.id, at: m.createdAt, ask, answer: m.answer, message: m };
    }
    return null;
}

/** A settled answer as the answer card takes it; an answer with no ask before it shows no "You said". */
export function exchangeOfAnswered(answered: AnsweredAsk): AskExchange {
    return {
        ask: answered.ask ?? { text: '', via: 'typed' },
        answer: answered.message,
        steps: answered.message.transcript ?? [],
        live: false,
        failed: false,
    };
}
