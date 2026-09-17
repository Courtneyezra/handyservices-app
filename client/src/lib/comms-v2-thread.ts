/**
 * Handy Desk B4 - how one case file from the new desk (GET /api/comms-v2/case-files/:id,
 * server/comms-v2/api/board.ts `detailOf`) reads in the thread view: the header line, each turn as a
 * bubble, a media row, a call row or a system rule, the held draft block, and what Ben reads when a
 * send from the thread is refused. Pure, so the mapping is tested apart from the component
 * (client/src/components/comms-v2/ThreadView.tsx).
 */
import type { CaseFileDetail, Turn } from '@/pages/admin/CommsV2BoardPage';
import { channelLabel, refusalMessage } from '@/lib/handy-desk-queue';
import { addressLabel } from '@/lib/handy-desk-answer';

/** An approver slot id as a name: `ben` reads as `Ben`. */
export function slotLabel(id: string | null | undefined): string {
    if (!id) return 'approval';
    return id.charAt(0).toUpperCase() + id.slice(1);
}

const LONDON = 'Europe/London';

/** A turn's time: the clock for today, the day and clock otherwise, in London. */
export function turnTime(iso: string, now: Date = new Date()): string {
    const at = new Date(iso);
    const day = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: LONDON });
    const clock = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LONDON });
    if (day(at) === day(now)) return clock;
    return `${at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: LONDON })} ${clock}`;
}

/** How long a hold has stood, as the held block reads it: "4m", "1h 20m", "2d 3h". */
export function heldFor(sinceIso: string, nowMs: number = Date.now()): string {
    const mins = Math.max(0, Math.floor((nowMs - Date.parse(sinceIso)) / 60_000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

/**
 * Who a turn reads as: the customer, the desk, or a person by staff name (`speakerNames`, keyed by
 * lowercased login) rather than the raw `human:<login>` approver; a login with no match falls back
 * to its local part.
 */
export function speakerOf(turn: Turn, customerName: string, speakerNames: Record<string, string> = {}): { label: string; desk: boolean } {
    if (turn.direction === 'inbound') return { label: customerName, desk: false };
    if (!turn.approver || turn.approver === 'agent.comms_v2') return { label: 'Desk', desk: true };
    if (turn.approver.startsWith('human:')) {
        const login = turn.approver.slice('human:'.length);
        return { label: speakerNames[login.toLowerCase()] || login.split('@')[0] || 'Staff', desk: true };
    }
    return { label: turn.approver, desk: true };
}

const CALL_OUTCOME_LABEL: Record<string, string> = { missed: 'missed', answered_inbound: 'answered', ben_rang: 'we rang, answered' };

export type ThreadRow =
    | { kind: 'text'; id: string; side: 'customer' | 'desk'; body: string; meta: string; media: Turn['media'] }
    | { kind: 'media'; id: string; side: 'customer' | 'desk'; body: string; meta: string; media: Turn['media'] }
    | { kind: 'call'; id: string; headline: string; meta: string; pending: boolean; summary: string | null; transcript: string | null }
    | { kind: 'system'; id: string; body: string; at: string };

/**
 * One row per turn, oldest first. A call turn is a call row: `pending` while an answered call has
 * neither summary nor transcript yet (both land after the call, on a later refresh); a missed call
 * never gets either, so it is never pending. A system turn is a rule. A turn carrying media is a
 * media row, whatever its kind, so its descriptions show.
 */
export function threadRows(detail: Pick<CaseFileDetail, 'turns' | 'speakerNames'>, customerName: string, now: Date = new Date()): ThreadRow[] {
    return detail.turns.map((t): ThreadRow => {
        const at = turnTime(t.at, now);
        if (t.call) {
            const missed = t.call.outcome === 'missed';
            const dir = t.direction === 'inbound' ? 'inbound' : 'outbound';
            return {
                kind: 'call', id: t.id, headline: t.call.headline,
                meta: [`${dir} call`, at, CALL_OUTCOME_LABEL[t.call.outcome] ?? t.call.outcome.replace(/_/g, ' ')].join(' · '),
                pending: !missed && !t.call.summary && !t.call.transcript,
                summary: t.call.summary, transcript: t.call.transcript,
            };
        }
        if (t.kind === 'system') return { kind: 'system', id: t.id, body: t.body, at };
        const who = speakerOf(t, customerName, detail.speakerNames);
        const meta = [who.label, channelLabel(t.channel), at].filter(Boolean).join(' · ');
        const side = who.desk ? 'desk' : 'customer';
        const media = t.media ?? [];
        return media.length
            ? { kind: 'media', id: t.id, side, body: t.body, meta, media }
            : { kind: 'text', id: t.id, side, body: t.body, meta, media };
    });
}

/** The header's second line: job, place, address, and the channel a reply goes on with its window. */
export function headerLine(detail: Pick<CaseFileDetail, 'job' | 'party' | 'replyChannel' | 'replyWindow'>): string {
    return [detail.job.type, detail.job.location, addressLabel(detail.party?.address) || null, replyLine(detail)]
        .filter(Boolean)
        .join(' · ');
}

/** "reply via WhatsApp · window open until 14:20", "reply via WhatsApp · window shut", "reply via Email". */
export function replyLine(detail: Pick<CaseFileDetail, 'replyChannel' | 'replyWindow'>): string | null {
    if (!detail.replyChannel) return null;
    const via = `reply via ${channelLabel(detail.replyChannel)}`;
    const w = detail.replyWindow;
    if (!w) return via;
    if (w.state === 'shut') return `${via} · window shut`;
    if (w.closesAt) {
        const until = new Date(w.closesAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LONDON });
        return `${via} · window open until ${until}`;
    }
    return via;
}

/** Whether a customer has written on the file at all; with none there is nothing to answer. */
export function hasCustomerTurn(detail: Pick<CaseFileDetail, 'turns'>): boolean {
    return detail.turns.some((t) => t.direction === 'inbound');
}

export type RefusalKind = 'shut_window' | 'no_draft' | 'no_slot' | 'other';

/** A refused send or release, as the thread shows it: its kind, the lead-in, and the desk's own words verbatim. */
export interface Refusal {
    kind: RefusalKind;
    lead: string;
    message: string;
}

export function refusalOf(action: 'answer' | 'send_held_draft' | 'release', status: number, error: string | undefined): Refusal {
    const message = refusalMessage(status, error);
    if (status === 401 || status === 403) return { kind: 'no_slot', lead: action === 'release' ? 'Not released.' : 'Not sent.', message };
    if (/window is shut/.test(message)) return { kind: 'shut_window', lead: "Can't send freeform words.", message };
    if (/there is no held draft to send/.test(message)) return { kind: 'no_draft', lead: 'Nothing to send.', message };
    return { kind: 'other', lead: action === 'release' ? 'Not released.' : 'Not sent.', message };
}

/** GET /case-files/:id/template-offer (desk/human-reply.ts `previewWindowTemplate`). */
export type TemplateOffer =
    | { ok: true; template: string; language: string; channel: string; body: string }
    | { ok: false; reason: string };

/** What a successful human send returns (server/comms-v2/api/routes.ts). */
export interface SentReply {
    approver: string;
    runId: string;
    bubbles: string[];
    turnId: string;
}
