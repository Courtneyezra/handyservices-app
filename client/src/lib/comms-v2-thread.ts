/**
 * Handy Desk B4 - how one case file from the new desk (GET /api/comms-v2/case-files/:id,
 * server/comms-v2/api/board.ts `detailOf`) reads in the thread view, drawn like a WhatsApp chat: the
 * header line and its links, each turn as a bubble, a media bubble, a call note or a system note, the
 * day chips and runs between them, and what Ben reads when a send from the thread is refused. Pure, so the mapping is tested apart from the component
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

/** A turn's clock alone, as it sits inside a bubble: "09:14", in London. */
export function clockOf(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LONDON });
}

/** The day chip above a day's first turn: "Today", "Yesterday", else "Tue 15 Sept", in London. */
export function dayLabel(iso: string, now: Date = new Date()): string {
    const day = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: LONDON });
    const at = new Date(iso);
    if (day(at) === day(now)) return 'Today';
    if (day(at) === day(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
    return at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: LONDON });
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

/**
 * A bubble's own fields beside the older `meta` line: who wrote it (`speaker`: "Desk", a staff name,
 * or the customer), its clock, and its channel as a word only when it is not WhatsApp (captain, 18 Sep
 * 2026: WhatsApp is the normal case and says nothing).
 */
interface BubbleFields { speaker: string; clock: string; channelWord: string | null; iso: string }

export type ThreadRow =
    | ({ kind: 'text'; id: string; side: 'customer' | 'desk'; body: string; meta: string; media: Turn['media'] } & BubbleFields)
    | ({ kind: 'media'; id: string; side: 'customer' | 'desk'; body: string; meta: string; media: Turn['media'] } & BubbleFields)
    | { kind: 'call'; id: string; headline: string; meta: string; pending: boolean; summary: string | null; transcript: string | null; iso: string }
    | { kind: 'system'; id: string; body: string; at: string; iso: string };

/** A channel as a word on a bubble or a card, or nothing for WhatsApp; a file with no channel says so. */
export function channelWord(channel: string | null | undefined): string | null {
    if (channel === 'whatsapp') return null;
    if (!channel) return 'No channel';
    return channelLabel(channel);
}

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
                summary: t.call.summary, transcript: t.call.transcript, iso: t.at,
            };
        }
        if (t.kind === 'system') return { kind: 'system', id: t.id, body: t.body, at, iso: t.at };
        const who = speakerOf(t, customerName, detail.speakerNames);
        const meta = [who.label, channelLabel(t.channel), at].filter(Boolean).join(' · ');
        const side = who.desk ? 'desk' : 'customer';
        const media = t.media ?? [];
        const bubble = { speaker: who.label, clock: clockOf(t.at), channelWord: channelWord(t.channel), iso: t.at };
        return media.length
            ? { kind: 'media', id: t.id, side, body: t.body, meta, media, ...bubble }
            : { kind: 'text', id: t.id, side, body: t.body, meta, media, ...bubble };
    });
}

/**
 * The chat as it is drawn: a day chip before each day's first row, and each bubble marked `first`
 * when it opens a run (the previous row is not a bubble on the same side by the same speaker), which
 * is the bubble that wears the tail and, on our side, the small "Desk" or "Ben" name.
 */
export type ChatItem =
    | { kind: 'day'; id: string; label: string }
    | { kind: 'row'; id: string; row: ThreadRow; first: boolean };

export function chatItems(rows: ThreadRow[], now: Date = new Date()): ChatItem[] {
    const out: ChatItem[] = [];
    let lastDay: string | null = null;
    let prev: ThreadRow | null = null;
    for (const row of rows) {
        const label = dayLabel(row.iso, now);
        if (label !== lastDay) {
            out.push({ kind: 'day', id: `day-${row.id}`, label });
            lastDay = label;
            prev = null;
        }
        const bubble = row.kind === 'text' || row.kind === 'media';
        const sameRun = bubble && prev !== null && (prev.kind === 'text' || prev.kind === 'media') && prev.side === row.side && prev.speaker === row.speaker;
        out.push({ kind: 'row', id: row.id, row, first: !sameRun });
        prev = row;
    }
    return out;
}

/** Where the thread's "More" menu and Call go: the customer's record, the quote on file, their phone. */
export interface ThreadLinks {
    customer: string | null;
    quote: string | null;
    call: string | null;
}

/**
 * The record is keyed by the party's canonical address (`phone:…` or `email:…`); a UK number reads
 * as E.164 for the dialler. Each is null when the file has nothing to link to, so its item hides.
 */
export function threadLinks(detail: Pick<CaseFileDetail, 'party' | 'job'>): ThreadLinks {
    const key = detail.party?.address ?? '';
    const known = /^(phone|email):./.test(key);
    const national = key.startsWith('phone:') ? key.slice('phone:'.length).replace(/\D/g, '') : '';
    const e164 = !national ? null : national.startsWith('0') ? `+44${national.slice(1)}` : `+${national}`;
    return {
        customer: known ? `/admin/clients/${encodeURIComponent(key)}` : null,
        quote: detail.job.quoteRef ? `/admin/price/${encodeURIComponent(detail.job.quoteRef)}` : null,
        call: e164 ? `tel:${e164}` : null,
    };
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

export type RefusalKind = 'shut_window' | 'no_draft' | 'other';

/** A refused send or release, as the thread shows it: its kind, the lead-in, and the desk's own words verbatim. */
export interface Refusal {
    kind: RefusalKind;
    lead: string;
    message: string;
}

export function refusalOf(action: 'answer' | 'send_held_draft' | 'release', status: number, error: string | undefined): Refusal {
    const message = refusalMessage(status, error);
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
