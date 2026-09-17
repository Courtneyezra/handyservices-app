/**
 * Ben's desk, kanban style (Goal 2 of the clean-sheet comms desk rebuild). One column per
 * Contract 2 stage, read from GET /api/comms-v2/board. Held cards float to the top of their
 * column with the hold reason and approver visible; a tap opens the file as a live conversation
 * (Firstmate decision hsa-comms-v2-board-conversation-view): thread first, customer turns on one
 * side and the desk's or a staff member's (by name, not by raw approver) on the other, each
 * turn's own media shown inline, with the release/answer actions docked beneath the newest turn,
 * in a docked panel or a sheet depending on width (`useIsWideBoard`, below). While a file is open
 * it re-reads every 15s, so a message arriving mid-conversation appears without closing and
 * reopening it, and the pane scrolls to the newest turn once per open rather than on every
 * refetch.
 *
 * When held, the release form (Contract 2's release: the signed-in approver and their words,
 * enforced by the case file itself, not here) also offers one-tap send of the desk's own held-back
 * draft exactly as it stands (POST /case-files/:id/send-held-draft).
 *
 * Beside release, the answer form: Ben writes to the customer in his own words and they go out
 * through the desk's one sender with him as approver (POST /case-files/:id/answer, over
 * server/comms-v2/desk/human-reply.ts). The desk never rewrites his words, his line breaks inside
 * a bubble included, and the guards never run over them; anything the sender refuses, a shut
 * window or a reply over the bubble ceiling, comes back here to be shown and fixed, never held
 * silently. On a shut window the form, and the held draft's one-tap send, instead offer a template
 * send (POST /case-files/:id/send-template) only when one's wording is true for the thread; when
 * none is, it says so rather than offering a retry.
 *
 * Not polished, just visible and operable: it doubles as the window onto the sandbox while the
 * rest of the desk is built, so the header carries a control that starts a sandbox thread and
 * sends the next customer message through the board's own sandbox door. The board itself polls
 * every fifteen seconds; no websockets.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Loader2, MessageSquare, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** How often an open case file re-checks for new turns; matches the board query's own interval. */
const CASE_FILE_REFETCH_MS = 15_000;

/**
 * Kanban + docked conversation panel (hsa-comms-v2-ben-board-layouts-s33, option 01): at this width
 * and up the board and the open case file sit side by side, permanent rather than an overlay sheet.
 * Below it, a full-screen sheet, chat-first, with a way back to the board. jsdom has no matchMedia:
 * defaults to narrow, which is the existing sheet behaviour every current test exercises.
 */
const WIDE_BOARD_QUERY = '(min-width: 1024px)';

export function useIsWideBoard(): boolean {
    const [wide, setWide] = useState<boolean>(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_BOARD_QUERY).matches : false);
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(WIDE_BOARD_QUERY);
        const on = () => setWide(mq.matches);
        on();
        if (typeof mq.addEventListener === 'function') { mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }
        mq.addListener?.(on);
        return () => mq.removeListener?.(on);
    }, []);
    return wide;
}

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------- shapes (mirror server/comms-v2/api/board.ts)

export const STAGES = ['first_contact', 'scoping', 'ready', 'quoted', 'accepted', 'booked', 'done'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
    first_contact: 'First contact',
    scoping: 'Scoping',
    ready: 'Ready',
    quoted: 'Quoted',
    accepted: 'Accepted',
    booked: 'Booked',
    done: 'Done',
};

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
    customerName: string | null;
    customerAddress: string;
    role: string;
    jobType: string | null;
    location: string | null;
    lastCustomerMessage: string | null;
    lastCustomerMessageAt: string | null;
    replyChannel: 'whatsapp' | 'sms' | 'email' | null;
    openedAt: string;
    benToRequest: string[];
    /** The desk's newest automatic reissue of an expired quote (server/comms-v2/api/board.ts). */
    quoteReissue?: { amount: string; previous: string; automatic: true; sentAt: string | null; notSent: string | null; at: string } | null;
}

export interface Board {
    stages: readonly Stage[];
    columns: Record<Stage, BoardCard[]>;
    /**
     * Whether the sandbox door could write on the server answering this request (GET
     * /api/comms-v2/board, server/comms-v2/live-database.ts's commsV2DatabaseCheck): true only on a
     * branch database the sandbox is allowed to touch, never on production. Missing or falsy hides
     * every sandbox-only control - the pipeline's live test runs against the branch database, where
     * this is true, so the control it drives stays available there.
     */
    sandboxAvailable?: boolean;
}

export interface TurnMedia {
    id: string;
    kind: 'image' | 'video';
    mime: string;
    url: string | null;
}

export interface Turn {
    id: string;
    at: string;
    channel: string;
    direction: 'inbound' | 'outbound';
    kind: string;
    body: string;
    media: TurnMedia[];
    /** Outbound only: who sent it, `human:<their email or user id>` for a person, `agent.comms_v2` for the desk. */
    approver?: string | null;
    /** Call turns only: the transcript and summary land after the call does, so both may be null. */
    call?: { outcome: string; headline: string; summary: string | null; transcript: string | null };
}

/**
 * Who a turn reads as in the thread: the customer on one side, the desk or Ben's name on the
 * other. A human turn is looked up by staff name (`speakerNames`, from the `users` table) rather
 * than shown as its raw `human:<login>` approver; a login with no match falls back to its local
 * part, still short of the full login.
 */
function speakerOf(turn: Turn, customerName: string | null, speakerNames: Record<string, string> = {}): string {
    if (turn.direction === 'inbound') return customerName || 'Customer';
    if (!turn.approver || turn.approver === 'agent.comms_v2') return 'Desk';
    if (turn.approver.startsWith('human:')) {
        const login = turn.approver.slice('human:'.length);
        return speakerNames[login.toLowerCase()] || login.split('@')[0] || 'Ben';
    }
    return turn.approver;
}

function TurnMediaView({ media }: { media: TurnMedia }) {
    if (!media.url) return null;
    if (media.kind === 'image') {
        return (
            <a href={media.url} target="_blank" rel="noreferrer">
                <img src={media.url} alt="" className="mb-1 max-h-56 w-full max-w-[240px] rounded-md object-cover" loading="lazy" />
            </a>
        );
    }
    return <video src={media.url} controls preload="metadata" className="mb-1 max-h-56 w-full max-w-[280px] rounded-md bg-black" />;
}

/** A call turn's bubble body: what happened, the summary, and the transcript behind a toggle. Minimal on purpose; the bubble's design comes later. */
function CallTurnBody({ turnId, call }: { turnId: string; call: NonNullable<Turn['call']> }) {
    const [open, setOpen] = useState(false);
    const missed = call.outcome === 'missed';
    return (
        <div data-testid={`call-turn-${turnId}`}>
            <p className="text-xs text-muted-foreground">{call.headline}</p>
            {/* A missed call never gets a transcript, and a summary only when the telephony side wrote one. */}
            {call.summary || !missed ? <p data-testid={`call-summary-${turnId}`}>{call.summary ?? 'No summary yet'}</p> : null}
            {call.transcript ? (
                <>
                    <button
                        type="button"
                        className="mt-1 text-xs underline"
                        aria-expanded={open}
                        onClick={() => setOpen((v) => !v)}
                    >
                        {open ? 'Hide transcript' : 'Show transcript'}
                    </button>
                    {open && <p data-testid={`call-transcript-${turnId}`} className="mt-1 whitespace-pre-wrap text-xs">{call.transcript}</p>}
                </>
            ) : missed ? null : (
                <p className="mt-1 text-xs text-muted-foreground">No transcript yet</p>
            )}
        </div>
    );
}

export interface Fact {
    id: string;
    key: string;
    value: string;
    at: string;
    source: { kind: string;[key: string]: unknown };
}

export interface CaseFileDetail {
    id: string;
    stage: Stage;
    mode: BoardMode;
    party: { name: string | null; role: string; address: string } | null;
    job: { type: string | null; location: string | null; quoteRef: string | null; bookingRef: string | null };
    turns: Turn[];
    facts: Fact[];
    hold: { approver: { kind: string; id: string }; reason: string; since: string; draft: string | null } | null;
    holdApproverAssigned: boolean;
    /** login (lowercased) -> staff name, for every human turn on the file. */
    speakerNames?: Record<string, string>;
}

// ---------------------------------------------------------------- filters

export interface BoardFilters {
    heldOnly: boolean;
    mode: 'all' | BoardMode;
}

export function boardQuery(filters: BoardFilters): string {
    const params = new URLSearchParams();
    if (filters.heldOnly) params.set('held', 'true');
    if (filters.mode !== 'all') params.set('mode', filters.mode);
    const qs = params.toString();
    return `/api/comms-v2/board${qs ? `?${qs}` : ''}`;
}

// ---------------------------------------------------------------- presentation helpers

export function relativeTime(iso: string | null, nowMs: number = Date.now()): string {
    if (!iso) return '';
    const ms = nowMs - Date.parse(iso);
    if (ms < 60_000) return 'just now';
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

// ---------------------------------------------------------------- board card

export function BoardCardView({ card, onOpen, showMode = false }: { card: BoardCard; onOpen: () => void; showMode?: boolean }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            data-testid={`board-card-${card.id}`}
            className={cn(
                'w-full select-none rounded-lg border bg-card p-3 text-left shadow-sm transition-colors',
                'hover:border-primary/50',
                card.held && 'border-red-500/60 bg-red-500/5',
            )}
        >
            {card.held && (
                <div data-testid={`board-card-hold-${card.id}`} className="mb-2 rounded bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-600">
                    <div className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 shrink-0" /> Held for {card.holdApprover ?? 'approval'}</div>
                    <div className="mt-0.5 font-normal text-red-600/90">{card.holdReason}</div>
                    {!card.holdApproverAssigned && <div className="mt-0.5 font-normal text-red-600/90">No approver assigned</div>}
                </div>
            )}
            <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{card.customerName || card.customerAddress || 'Unknown'}</span>
                {showMode && <Badge variant={card.mode === 'live' ? 'default' : 'secondary'} className="shrink-0 text-[10px] uppercase">{card.mode}</Badge>}
            </div>
            {(card.jobType || card.location) && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                    {card.jobType ?? 'job not yet known'}{card.location ? ` · ${card.location}` : ''}
                </p>
            )}
            {card.lastCustomerMessage && (
                <p className="mt-2 line-clamp-2 text-xs italic text-muted-foreground">&ldquo;{card.lastCustomerMessage}&rdquo;</p>
            )}
            {card.benToRequest.length > 0 && (
                <div data-testid={`board-card-ben-to-request-${card.id}`} className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-700">
                    <span className="font-semibold">Ask for:</span> {card.benToRequest.join(', ')}
                </div>
            )}
            {card.quoteReissue && (
                <div data-testid={`board-card-reissue-${card.id}`} className="mt-2 rounded bg-sky-500/10 px-2 py-1 text-xs text-sky-700">
                    <span className="font-semibold">Quote reissued automatically:</span> {card.quoteReissue.amount} (was {card.quoteReissue.previous}),{' '}
                    {card.quoteReissue.sentAt ? `sent ${relativeTime(card.quoteReissue.sentAt)}` : `not sent: ${card.quoteReissue.notSent ?? 'unknown'}`}
                </div>
            )}
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {relativeTime(card.lastCustomerMessageAt ?? card.openedAt)}</span>
                {card.replyChannel && <span>{CHANNEL_LABEL[card.replyChannel] ?? card.replyChannel}</span>}
            </div>
        </button>
    );
}

// ---------------------------------------------------------------- column

export function BoardColumn({ stage, cards, onOpenCard, showMode = false }: { stage: Stage; cards: BoardCard[]; onOpenCard: (id: string) => void; showMode?: boolean }) {
    return (
        <div
            data-testid={`board-column-${stage}`}
            className="flex h-full w-72 shrink-0 flex-col rounded-lg bg-muted/40 p-3"
        >
            <div className="mb-3 flex items-center gap-2 border-b pb-2">
                <h3 className="text-sm font-semibold">{STAGE_LABELS[stage]}</h3>
                <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">{cards.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                {cards.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground/60">No conversations</p>
                ) : (
                    cards.map((card) => <BoardCardView key={card.id} card={card} onOpen={() => onOpenCard(card.id)} showMode={showMode} />)
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- release form

export function ReleaseForm({ fileId, holdReason, holdApprover, holdApproverAssigned, draft, onReleased, lastInboundTurnId = null }: {
    fileId: string;
    holdReason: string;
    holdApprover: string;
    holdApproverAssigned: boolean;
    draft: string | null;
    onReleased: () => void;
    /** As on the answer form: a fresh customer message may have reopened the window, so a stale send refusal is cleared. */
    lastInboundTurnId?: string | null;
}) {
    const [words, setWords] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [sendBusy, setSendBusy] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);

    useEffect(() => {
        setSendError(null);
    }, [lastInboundTurnId]);

    const release = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/comms-v2/case-files/${fileId}/release`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ words }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Release failed (${res.status})`);
            onReleased();
        } catch (e: any) {
            setError(e?.message || 'Release failed');
        } finally {
            setBusy(false);
        }
    };

    const sendDraft = async () => {
        setSendBusy(true);
        setSendError(null);
        try {
            const res = await fetch(`/api/comms-v2/case-files/${fileId}/send-held-draft`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Send failed (${res.status})`);
            onReleased();
        } catch (e: any) {
            setSendError(e?.message || 'Send failed');
        } finally {
            setSendBusy(false);
        }
    };

    return (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3">
            <p className="flex items-center gap-1 text-sm font-semibold text-red-600"><AlertTriangle className="h-4 w-4" /> Held for {holdApprover}: {holdReason}</p>
            {!holdApproverAssigned && (
                <p className="mt-1 text-xs text-red-600/90">No approver assigned to the {holdApprover} slot, so nobody can release this yet. Set the comms_v2_approvers row.</p>
            )}
            {draft && (
                <div className="mt-3">
                    <p className="text-xs font-medium text-muted-foreground">The reply the desk held back</p>
                    <pre data-testid="hold-draft" className="mt-1 whitespace-pre-wrap rounded-md border bg-background px-2 py-1.5 font-sans text-sm">{draft}</pre>
                    {sendError && <p data-testid="send-held-draft-error" className="mt-2 text-xs text-red-600">{sendError}</p>}
                    {sendError && /window is shut/.test(sendError) && holdApproverAssigned && <WindowTemplateOption fileId={fileId} onSent={() => onReleased()} />}
                    <Button size="sm" variant="outline" className="mt-2" disabled={sendBusy || !holdApproverAssigned} onClick={sendDraft}>
                        {sendBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                        Send as it stands
                    </Button>
                </div>
            )}
            <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="release-words">Your words, for the file</label>
            <Textarea
                id="release-words"
                value={words}
                onChange={(e) => setWords(e.target.value)}
                placeholder="What was checked, and why this is released"
                className="mt-1"
                rows={3}
            />
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <Button size="sm" className="mt-3" disabled={busy || !words.trim()} onClick={release}>
                {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Release hold
            </Button>
        </div>
    );
}

// ---------------------------------------------------------------- shut-window template

/**
 * The fallback when a freeform send is refused because the WhatsApp window is shut: one tap sends
 * the approved template the server finds true for the thread (quote_ready_link with the quote link
 * the file shows was sent, or answer_ready_reopen_v1 over an unanswered question) - the captain's
 * ruling, superseding an earlier "always the reopen nudge" call. Once a send is definitively
 * refused because nothing is true for this thread, the button is replaced by that explanation
 * rather than offered again; any other refusal (not yet Meta-approved, a sender refusal) keeps the
 * button so Ben can retry. Shown under Ben's own answer and under the held draft alike, since both
 * are refused the same way on a shut window.
 */
export function WindowTemplateOption({ fileId, onSent }: { fileId: string; onSent: (bubbles: string[]) => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const noTemplateApplies = !!error && /no template is true for this thread/.test(error);

    const sendTemplate = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/comms-v2/case-files/${fileId}/send-template`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Template send failed (${res.status})`);
            onSent(Array.isArray(data?.sent?.bubbles) ? data.sent.bubbles : []);
        } catch (e: any) {
            setError(e?.message || 'Template send failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mt-2" data-testid="send-template-option">
            {noTemplateApplies ? (
                <p data-testid="send-template-unavailable" className="text-xs text-muted-foreground">
                    No approved word is true for this thread yet - the customer needs to write again before a reply can go.
                </p>
            ) : (
                <>
                    <p className="text-xs text-muted-foreground">The window is shut, so only an approved template can go: the one that fits this thread, if one does.</p>
                    {error && <p data-testid="send-template-error" className="mt-1 text-xs text-red-600">{error}</p>}
                    <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={sendTemplate}>
                        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                        Send a template reply
                    </Button>
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------- answer form

/**
 * Ben's own reply to the customer, sent through the desk's one sender with him as approver. His
 * words go as typed, so nothing here rewrites or checks them; a refusal from the sender comes back
 * named and is shown here for him to fix rather than held quietly.
 */
export function AnswerForm({ fileId, held, onAnswered, lastInboundTurnId }: {
    fileId: string;
    held: boolean;
    onAnswered: () => void;
    /** The newest inbound turn's id: a fresh customer message may have reopened the window, so a stale refusal is cleared rather than kept showing. */
    lastInboundTurnId: string | null;
}) {
    const [words, setWords] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState<string[] | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setError(null);
    }, [lastInboundTurnId]);

    const answer = async () => {
        setBusy(true);
        setError(null);
        setSent(null);
        try {
            const res = await fetch(`/api/comms-v2/case-files/${fileId}/answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ words }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Answer failed (${res.status})`);
            setSent(Array.isArray(data?.sent?.bubbles) ? data.sent.bubbles : []);
            setWords('');
            onAnswered();
        } catch (e: any) {
            setError(e?.message || 'Answer failed');
        } finally {
            setBusy(false);
        }
    };

    // A shut window refuses freeform words outright (desk/human-reply.ts): the template offer below is
    // the fallback shown in place of retyping.
    const windowShut = !!error && /window is shut/.test(error);

    return (
        <div className="rounded-lg border p-3" data-testid="answer-form">
            <p className="text-sm font-semibold">Answer the customer yourself</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
                Your words go out as written, from you, line breaks and all. {held ? 'Sending clears the hold and hands the thread back to the desk.' : 'The thread stays with the desk after it goes.'}
            </p>
            <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="answer-words">Your reply to the customer</label>
            <Textarea
                id="answer-words"
                value={words}
                onChange={(e) => setWords(e.target.value)}
                placeholder="Write it as you would on your phone. A blank line starts a new message; line breaks inside one are kept."
                className="mt-1"
                rows={4}
            />
            {error && <p data-testid="answer-error" className="mt-2 text-xs text-red-600">{error}</p>}
            {windowShut && (
                <WindowTemplateOption
                    fileId={fileId}
                    onSent={(bubbles) => { setSent(bubbles); setError(null); onAnswered(); }}
                />
            )}
            {sent && (
                <div data-testid="answer-sent" className="mt-2 space-y-1">
                    <p className="text-xs text-muted-foreground">Sent as {sent.length} message{sent.length === 1 ? '' : 's'}</p>
                    {sent.map((b, i) => <p key={i} className="rounded-md bg-primary/5 px-2 py-1 text-sm">{b}</p>)}
                </div>
            )}
            <Button size="sm" className="mt-3" disabled={busy || !words.trim()} onClick={answer}>
                {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                Send as me
            </Button>
        </div>
    );
}

// ---------------------------------------------------------------- case file detail

export function CaseFileDetailView({ fileId, onReleased, onAnswered, showMode = false }: { fileId: string; onReleased: () => void; onAnswered: () => void; showMode?: boolean }) {
    const { data, isLoading, error } = useQuery<CaseFileDetail>({
        queryKey: ['comms-v2-case-file', fileId],
        queryFn: async () => {
            const res = await fetch(`/api/comms-v2/case-files/${fileId}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`Failed to load conversation (${res.status})`);
            return res.json();
        },
        refetchInterval: CASE_FILE_REFETCH_MS,
    });

    const threadEndRef = useRef<HTMLDivElement>(null);
    const scrolledForFileRef = useRef<string | null>(null);
    useEffect(() => {
        // Scroll to the newest turn once per open sheet, not on every 15s refetch.
        if (!data || scrolledForFileRef.current === fileId) return;
        scrolledForFileRef.current = fileId;
        threadEndRef.current?.scrollIntoView({ block: 'end' });
    }, [data, fileId]);

    if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    if (error || !data) return <p className="text-sm text-red-600">Could not load this conversation.</p>;

    const customerName = data.party?.name || data.party?.address || null;
    const lastInboundTurnId = [...data.turns].reverse().find((t) => t.direction === 'inbound')?.id ?? null;

    return (
        <div className="flex h-full flex-col overflow-y-auto">
            <div className="shrink-0 border-b pb-3">
                <p className="text-sm font-semibold">{data.party?.name || data.party?.address || 'Unknown'}</p>
                <p className="text-xs text-muted-foreground">{STAGE_LABELS[data.stage]}{showMode ? ` · ${data.mode}` : ''}</p>
                {(data.job.type || data.job.location) && (
                    <p className="mt-1 text-xs text-muted-foreground">{data.job.type ?? 'job unknown'}{data.job.location ? ` · ${data.job.location}` : ''}</p>
                )}
            </div>

            <div className="min-h-[12rem] flex-1 space-y-2 overflow-y-auto py-3">
                <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
                    <MessageSquare className="h-3 w-3" /> Turns
                </h4>
                <ul className="space-y-2">
                    {data.turns.map((t) => (
                        <li key={t.id} className={cn('flex', t.direction === 'inbound' ? 'justify-start' : 'justify-end')}>
                            <div
                                data-testid={`turn-bubble-${t.id}`}
                                className={cn(
                                    'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                                    t.direction === 'inbound' ? 'bg-muted' : 'bg-primary/10',
                                )}
                            >
                                <p data-testid={`turn-speaker-${t.id}`} className="mb-0.5 text-[10px] font-semibold text-muted-foreground">{speakerOf(t, customerName, data.speakerNames)}</p>
                                {(t.media ?? []).map((m) => <TurnMediaView key={m.id} media={m} />)}
                                {t.call ? <CallTurnBody turnId={t.id} call={t.call} /> : t.body && <p className="whitespace-pre-wrap">{t.body}</p>}
                                <p data-testid={`turn-meta-${t.id}`} className="mt-0.5 text-[10px] text-muted-foreground">
                                    {t.channel} · {relativeTime(t.at)}
                                </p>
                            </div>
                        </li>
                    ))}
                    {data.hold?.draft && (
                        <li className="flex justify-end">
                            <div data-testid="pending-draft-bubble" className="max-w-[85%] rounded-2xl border border-dashed px-3 py-2 text-sm text-muted-foreground opacity-70">
                                <p className="mb-0.5 text-[10px] font-semibold uppercase">Desk (waiting for Ben)</p>
                                <p className="whitespace-pre-wrap">{data.hold.draft}</p>
                            </div>
                        </li>
                    )}
                </ul>
                <div ref={threadEndRef} />

                {data.facts.length > 0 && (
                    <div className="pt-2">
                        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Facts</h4>
                        <ul className="space-y-1 text-xs">
                            {data.facts.map((f) => (
                                <li key={f.id} className="flex justify-between gap-2">
                                    <span className="text-muted-foreground">{f.key}</span>
                                    <span className="font-medium">{f.value}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <div className="shrink-0 space-y-3 border-t pt-3">
                {data.hold && (
                    <ReleaseForm
                        fileId={data.id}
                        holdReason={data.hold.reason}
                        holdApprover={data.hold.approver.id}
                        holdApproverAssigned={data.holdApproverAssigned}
                        draft={data.hold.draft}
                        onReleased={onReleased}
                        lastInboundTurnId={lastInboundTurnId}
                    />
                )}
                <AnswerForm fileId={data.id} held={!!data.hold} onAnswered={onAnswered} lastInboundTurnId={lastInboundTurnId} />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- sandbox thread control

/**
 * Starts a sandbox thread, or sends the next customer message on the open one, through the board's
 * own sandbox door (POST /api/comms-v2/sandbox/start and /message). Start clears the door, so the
 * board shows one sandbox thread at a time, the one being watched.
 */
export function SandboxThreadControl({ onChanged }: { onChanged: () => void }) {
    const [name, setName] = useState('Sam');
    const [text, setText] = useState('');
    const [busy, setBusy] = useState<'start' | 'message' | null>(null);
    const [error, setError] = useState<string | null>(null);

    const post = async (which: 'start' | 'message') => {
        setBusy(which);
        setError(null);
        try {
            const body = which === 'start' ? { door: 'whatsapp', text, name: name.trim() || undefined } : { channel: 'whatsapp', text };
            const res = await fetch(`/api/comms-v2/sandbox/${which}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Sandbox ${which} failed (${res.status})`);
            setText('');
            onChanged();
        } catch (e: any) {
            setError(e?.message || `Sandbox ${which} failed`);
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="flex flex-wrap items-end gap-2" data-testid="sandbox-thread-control">
            <div>
                <label className="block text-[10px] font-medium uppercase text-muted-foreground" htmlFor="sandbox-name">Customer</label>
                <input id="sandbox-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-0.5 w-24 rounded-md border bg-background px-2 py-1 text-sm" />
            </div>
            <div className="min-w-64 flex-1">
                <label className="block text-[10px] font-medium uppercase text-muted-foreground" htmlFor="sandbox-text">Customer says</label>
                <input
                    id="sandbox-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Hi, can I get a quote for a leaking tap?"
                    className="mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-sm"
                />
            </div>
            <Button size="sm" variant="outline" disabled={!!busy || !text.trim()} onClick={() => post('start')}>
                {busy === 'start' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Start sandbox thread
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy || !text.trim()} onClick={() => post('message')}>
                {busy === 'message' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Send as customer
            </Button>
            {error && <p className="w-full text-xs text-red-600">{error}</p>}
        </div>
    );
}

// ---------------------------------------------------------------- filter bar

export function FilterBar({ filters, onChange, showModeFilter = false }: { filters: BoardFilters; onChange: (f: BoardFilters) => void; showModeFilter?: boolean }) {
    return (
        <div className="flex items-center gap-2">
            <Button
                size="sm"
                variant={filters.heldOnly ? 'default' : 'outline'}
                onClick={() => onChange({ ...filters, heldOnly: !filters.heldOnly })}
            >
                Held only
            </Button>
            {showModeFilter && (['all', 'sandbox', 'live'] as const).map((m) => (
                <Button
                    key={m}
                    size="sm"
                    variant={filters.mode === m ? 'default' : 'outline'}
                    onClick={() => onChange({ ...filters, mode: m })}
                >
                    {m === 'all' ? 'All' : m === 'sandbox' ? 'Sandbox only' : 'Live only'}
                </Button>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------- page

export default function CommsV2BoardPage() {
    const queryClient = useQueryClient();
    const [filters, setFilters] = useState<BoardFilters>({ heldOnly: false, mode: 'all' });
    // `?file=<case file id>` opens that conversation, so another page (the diary's "Open thread") can link straight to it.
    const [openCardId, setOpenCardId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('file'));
    const wide = useIsWideBoard();

    const { data, isLoading, error } = useQuery<Board>({
        queryKey: ['comms-v2-board', filters],
        queryFn: async () => {
            const res = await fetch(boardQuery(filters), { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`Failed to load board (${res.status})`);
            return res.json();
        },
        refetchInterval: 15_000,
    });

    const total = useMemo(() => Object.values(data?.columns ?? {}).reduce((n, c) => n + c.length, 0), [data]);
    // Fails towards hiding: only a confirmed `true` from the server (live-database.ts's
    // commsV2DatabaseCheck) shows sandbox-only controls; missing, loading or errored data hides them.
    const sandboxAvailable = data?.sandboxAvailable === true;

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['comms-v2-board'] });
        queryClient.invalidateQueries({ queryKey: ['comms-v2-case-file'] });
    };
    const handleReleased = () => {
        setOpenCardId(null);
        refresh();
    };

    return (
        <div className="flex h-[calc(100vh-64px)] flex-col overflow-hidden">
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-3">
                <div>
                    <h1 className="text-xl font-bold tracking-tight">Customer conversations</h1>
                    <p className="text-xs text-muted-foreground">{total} conversation{total === 1 ? '' : 's'}</p>
                </div>
                <FilterBar filters={filters} onChange={setFilters} showModeFilter={sandboxAvailable} />
                {sandboxAvailable && (
                    <div className="w-full border-t pt-3">
                        <SandboxThreadControl onChanged={refresh} />
                    </div>
                )}
            </div>

            <div className="flex min-h-0 flex-1">
                {error ? (
                    <div className="m-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">
                        <AlertTriangle className="h-4 w-4" /> Could not load the board - retrying automatically.
                    </div>
                ) : isLoading ? (
                    <div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                ) : (
                    <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
                        <div className="flex h-full gap-3">
                            {(data?.stages ?? STAGES).map((stage) => (
                                <BoardColumn
                                    key={stage}
                                    stage={stage}
                                    cards={data?.columns[stage] ?? []}
                                    onOpenCard={setOpenCardId}
                                    showMode={sandboxAvailable}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {wide && (
                    <aside data-testid="docked-case-file-panel" className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l bg-background p-4">
                        {openCardId ? (
                            // Keyed by the open file so a cached conversation never inherits the last one's typed words or send state.
                            <CaseFileDetailView key={openCardId} fileId={openCardId} onReleased={handleReleased} onAnswered={refresh} showMode={sandboxAvailable} />
                        ) : (
                            <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
                                <MessageSquare className="h-5 w-5 opacity-60" />
                                <p>Select a conversation to see it.</p>
                            </div>
                        )}
                    </aside>
                )}
            </div>

            {!wide && (
                <Sheet open={!!openCardId} onOpenChange={(open) => !open && setOpenCardId(null)}>
                    <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-lg">
                        <SheetHeader className="shrink-0">
                            <SheetTitle>Conversation</SheetTitle>
                            <SheetDescription>The conversation, with the release and answer actions docked below it.</SheetDescription>
                        </SheetHeader>
                        {openCardId && <div className="mt-4 min-h-0 flex-1"><CaseFileDetailView key={openCardId} fileId={openCardId} onReleased={handleReleased} onAnswered={refresh} showMode={sandboxAvailable} /></div>}
                    </SheetContent>
                </Sheet>
            )}
        </div>
    );
}
