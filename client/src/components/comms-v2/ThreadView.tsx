/**
 * Handy Desk B4 - one customer's thread on the new desk, opened by tapping a card: beside the comms
 * board (≥1024px) only while a card is picked, full screen below it, and from a Handy Desk queue card.
 * Drawn like a WhatsApp chat (captain, 18 Sep 2026): the customer's messages in white on the left,
 * ours in green on the right with a small "Desk" or staff name on the first bubble of a run, the time
 * inside each bubble, a day chip between days, calls and system turns as centred notes, and a round
 * message field with one send button. The held draft sits in the chat as a dashed bubble that has not
 * gone, with Send this under it. The header is words: More (Call, the customer's record, the latest
 * quote, Close file) and Close.
 *
 * Reads GET /api/comms-v2/case-files/:id every fifteen seconds. Every write is one of the board's own
 * human-send routes, and the server decides who may act:
 *   - "Send this" posts send-held-draft with the draft on screen as `expectedDraft`; when the desk
 *     has replaced it since (409 HELD_DRAFT_CHANGED), the view re-reads the file, shows the new one
 *     and asks again instead of sending;
 *   - "Send reply" posts answer with Ben's words, which go as typed with no guards run;
 *   - "Release hold only" posts release with the same words, for the file;
 *   - on a shut WhatsApp window, the template card previews GET template-offer (the template the send
 *     would pick and its wording, or its refusal) and "Send template" posts send-template;
 *   - "Close file" in the More menu opens CloseFileForm.tsx above the composer on a file not yet done,
 *     which posts close after a second tap, with words required on a held file; the file is then read
 *     again and the board or queue refreshed.
 * Every refusal is shown as the desk worded it, with the words kept in the box. A reply shows as a
 * sending bubble at once and as sent from the response, until the next read carries the turn. A
 * session that may not act sees the thread with every action hidden and one line saying why; the
 * page may hold the composer's words (`words`, `onWords`) so they outlive the thread being replaced.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2, Send } from 'lucide-react';
import { Link } from 'wouter';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { CloseFileForm } from '@/components/comms-v2/CloseFileForm';
import { adminAuthHeaders } from '@/lib/admin-auth';
import { channelLabel, refusalMessage } from '@/lib/handy-desk-queue';
import { addressLabel } from '@/lib/handy-desk-answer';
import { HELD_DRAFT_CHANGED } from '@shared/ops-types';
import {
    chatItems, hasCustomerTurn, headerLine, heldFor, refusalOf, slotLabel, threadLinks, threadRows,
    type Refusal, type SentReply, type TemplateOffer, type ThreadLinks, type ThreadRow,
} from '@/lib/comms-v2-thread';
import { STAGE_LABELS } from '@/lib/comms-board';
import type { CaseFileDetail, TurnMedia } from '@/pages/admin/CommsV2BoardPage';

/** How often an open thread re-reads its case file; matches the board and the queue. */
export const THREAD_REFETCH_MS = 15_000;

type PostResult = { ok: true; data: any } | { ok: false; status: number; error: string | undefined };

async function postTo(fileId: string, route: string, body?: unknown): Promise<PostResult> {
    try {
        const res = await fetch(`/api/comms-v2/case-files/${fileId}/${route}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return { ok: true, data };
        return { ok: false, status: res.status, error: data?.error };
    } catch (e: any) {
        return { ok: false, status: 0, error: e?.message || 'Could not reach the desk' };
    }
}

async function readFile(fileId: string): Promise<CaseFileDetail> {
    const res = await fetch(`/api/comms-v2/case-files/${fileId}`, { headers: adminAuthHeaders() });
    if (!res.ok) throw new Error(`Failed to load conversation (${res.status})`);
    return res.json();
}

/**
 * Whether a box of the thread's own - the reply, or the close-file words - holds words a dismissal
 * must not throw away. Read from the boxes rather than the focus: a tap outside moves the focus off
 * them, and on touch Radix decides on the click that follows.
 */
function threadHoldsWords(): boolean {
    return Array.from(document.querySelectorAll('textarea')).some(
        (box) => (box.id.startsWith('thread-words-') || box.id.startsWith('close-words-')) && box.value !== '',
    );
}

/** Whether the focus is in any editable field on the page, where Esc belongs to that field, not the docked panel. */
function focusInField(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        || (el instanceof HTMLElement && el.isContentEditable);
}

const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50';
const BTN_AMBER = cn(BTN, 'bg-amber-400 text-slate-900 hover:bg-amber-300');
const BTN_OUTLINE = cn(BTN, 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50');
/** A word-only action in the chat: underlined text, no box. */
const BTN_TEXT = 'inline-flex min-h-9 items-center px-1.5 text-[13px] font-medium text-[#111b21] underline underline-offset-2 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline';

// WhatsApp's own colours, so the chat reads as the shape anyone knows: the wallpaper, her white
// bubble, our green one, the grey of a bubble's time, and the header bar.
const WA_WALL = 'bg-[#efeae2]';
const WA_BAR = 'bg-[#f0f2f5]';
const WA_META = 'text-[#667781]';
const BUBBLE_SHADOW = 'shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]';
/** The tail on the first bubble of a run: a small corner flag pointing at the side it came from. */
const TAIL_IN = "rounded-tl-none before:absolute before:-left-2 before:top-0 before:border-b-[10px] before:border-r-8 before:border-b-transparent before:border-r-white before:content-['']";
const TAIL_OUT = "rounded-tr-none before:absolute before:-right-2 before:top-0 before:border-b-[10px] before:border-l-8 before:border-b-transparent before:border-l-[#d9fdd3] before:content-['']";

// ---------------------------------------------------------------- rows

function MediaThumb({ media }: { media: TurnMedia }) {
    if (!media.url) {
        return <div className="flex h-[90px] items-center justify-center rounded bg-slate-200 text-[11px] text-slate-500">{media.kind === 'video' ? 'video' : 'photo'}</div>;
    }
    if (media.kind === 'video') return <video src={media.url} controls preload="metadata" className="max-h-56 w-full rounded bg-black" />;
    return (
        <a href={media.url} target="_blank" rel="noreferrer">
            <img src={media.url} alt="" loading="lazy" className="max-h-56 w-full rounded object-cover" />
        </a>
    );
}

/**
 * One chat bubble. Hers is white on the left, ours green on the right; the first of a run wears the
 * tail and, on our side, the small name of who wrote it. The time sits inside the bubble, bottom
 * right, with the channel as a word before it only when it is not WhatsApp.
 */
function Bubble({ side, first, speaker, meta, children, testId, metaTestId, muted }: {
    side: 'customer' | 'desk';
    first: boolean;
    speaker?: string | null;
    meta: React.ReactNode;
    children: React.ReactNode;
    testId?: string;
    metaTestId?: string;
    muted?: boolean;
}) {
    const ours = side === 'desk';
    return (
        <div
            data-testid={testId}
            className={cn(
                'relative max-w-[80%] rounded-[7.5px] px-2.5 pb-1.5 pt-1.5 text-[13.5px] leading-[1.38] text-[#111b21]', BUBBLE_SHADOW,
                ours ? 'self-end bg-[#d9fdd3]' : 'self-start bg-white',
                first ? cn('mt-1.5', ours ? TAIL_OUT : TAIL_IN) : 'mt-0.5',
                muted && 'opacity-60',
            )}
        >
            {first && ours && speaker && <span className="block text-[12px] font-semibold text-[#1f7a5a]">{speaker}</span>}
            <div className="whitespace-pre-wrap break-words">{children}</div>
            <div data-testid={metaTestId} className={cn('mt-0.5 text-right text-[11px] leading-none', WA_META)}>{meta}</div>
        </div>
    );
}

/** A note in the middle of the chat, the way WhatsApp shows a call or a change: white, small, centred. */
function Note({ testId, children, className }: { testId?: string; children: React.ReactNode; className?: string }) {
    return (
        <div data-testid={testId} className={cn('my-1 max-w-[88%] self-center rounded-[7.5px] bg-white px-3 py-1.5 text-center text-[12px] leading-snug text-[#54656f]', BUBBLE_SHADOW, className)}>
            {children}
        </div>
    );
}

function CallRow({ row }: { row: Extract<ThreadRow, { kind: 'call' }> }) {
    const [open, setOpen] = useState(false);
    return (
        <Note testId={`call-turn-${row.id}`} className="flex flex-col gap-1 text-left">
            <p className="font-semibold text-[#111b21]">{row.headline}</p>
            <p className={cn('text-[11px]', WA_META)}>{row.meta}</p>
            {row.pending && (
                <p data-testid={`call-pending-${row.id}`} className="flex items-center gap-2 text-[12px]">
                    <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
                    Transcribing… summary lands within a few minutes, on the next 15s refresh.
                </p>
            )}
            {row.summary && <p data-testid={`call-summary-${row.id}`} className="text-[12px] leading-normal text-[#111b21]">{row.summary}</p>}
            {row.transcript && (
                <>
                    <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="self-start text-[12px] font-medium text-[#027eb5] hover:underline">
                        {open ? 'Hide transcript' : 'Show transcript'}
                    </button>
                    {open && <p data-testid={`call-transcript-${row.id}`} className="whitespace-pre-line border-t border-slate-200 pt-1.5 text-[12px] leading-relaxed text-[#111b21]">{row.transcript}</p>}
                </>
            )}
        </Note>
    );
}

/** The time inside a bubble, with the channel as a word before it only when it is not WhatsApp. */
function bubbleMeta(row: Extract<ThreadRow, { kind: 'text' | 'media' }>): string {
    return [row.channelWord, row.clock].filter(Boolean).join(' · ');
}

function Row({ row, first }: { row: ThreadRow; first: boolean }) {
    switch (row.kind) {
        case 'call':
            return <CallRow row={row} />;
        case 'system':
            return <Note testId={`turn-system-${row.id}`}>{row.body} · {row.at}</Note>;
        case 'media':
            return (
                <Bubble testId={`turn-bubble-${row.id}`} metaTestId={`turn-meta-${row.id}`} side={row.side} first={first} speaker={row.speaker} meta={bubbleMeta(row)}>
                    <span className="flex flex-col gap-1">
                        {row.media.map((m) => (
                            <span key={m.id} className="flex flex-col gap-1">
                                <MediaThumb media={m} />
                                <span data-testid={`media-description-${m.id}`} className="text-[12px] italic leading-snug text-[#54656f]">
                                    {m.description
                                        ? <>{m.description.description} · {m.description.confidence} confidence</>
                                        : 'Not described yet'}
                                </span>
                            </span>
                        ))}
                        {row.body && <span>{row.body}</span>}
                    </span>
                </Bubble>
            );
        default:
            return <Bubble testId={`turn-bubble-${row.id}`} metaTestId={`turn-meta-${row.id}`} side={row.side} first={first} speaker={row.speaker} meta={bubbleMeta(row)}>{row.body}</Bubble>;
    }
}

// ---------------------------------------------------------------- states

function RefusalNote({ refusal, testId }: { refusal: Refusal; testId: string }) {
    return (
        <p role="alert" data-testid={testId} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-normal text-red-900">
            <b className="text-red-700">{refusal.lead}</b> {refusal.message}
        </p>
    );
}

/**
 * The offer is read when the card appears, again on any newer customer turn (`sinceTurnId`, which is
 * what can change which template is true), and again after a send or release, which invalidate
 * `['comms-v2-template-offer', fileId]`. It is not polled on its own clock.
 */
function TemplateCard({ fileId, sinceTurnId, busy, onSend, refusal }: { fileId: string; sinceTurnId: string | null; busy: boolean; onSend: () => void; refusal: string | null }) {
    const { data, isLoading, error } = useQuery<TemplateOffer>({
        queryKey: ['comms-v2-template-offer', fileId, sinceTurnId],
        queryFn: async () => {
            const res = await fetch(`/api/comms-v2/case-files/${fileId}/template-offer`, { headers: adminAuthHeaders() });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(refusalMessage(res.status, body?.error));
            return body;
        },
    });

    const refused = (reason: string, testId: string) => (
        <p role="alert" data-testid={testId} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-normal text-red-900">
            <b className="text-red-700">Template refused:</b> {reason}
        </p>
    );

    return (
        <div data-testid="template-card" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[13px] font-semibold text-slate-900">Send a template reply instead</p>
            {isLoading ? (
                <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 aria-hidden className="h-3 w-3 animate-spin" /> Checking which template is true for this thread…</p>
            ) : error ? (
                <p role="alert" data-testid="template-offer-error" className="text-xs text-red-700">{(error as Error).message}</p>
            ) : data && !data.ok ? (
                refused(data.reason, 'template-offer-refused')
            ) : data && data.ok ? (
                <>
                    <p className="text-xs leading-normal text-slate-500">
                        Only a template whose wording is true for this thread is offered. Here: <b data-testid="template-offer-name" className="text-slate-900">{data.template}</b>
                    </p>
                    <p data-testid="template-offer-body" className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[13px] leading-normal text-slate-900">{data.body}</p>
                    {refusal && refused(refusal, 'template-send-refused')}
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className={cn(BTN_AMBER, 'h-11 px-3.5 text-[13px] lg:h-10')} disabled={busy} onClick={onSend}>
                            {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <Send aria-hidden className="h-3.5 w-3.5" />}
                            Send template
                        </button>
                        <span className="text-[11px] text-slate-500">Your words stay in the box for when they reply.</span>
                    </div>
                </>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------- thread view

export interface ThreadViewProps {
    fileId: string;
    /** 'panel' closes with Close or Esc; 'sheet' is full screen with a ‹ back arrow. */
    layout: 'panel' | 'sheet';
    /** What the way back returns to: "Board" on the comms board, "Queue" on the Handy Desk. */
    backTo?: string;
    onClose: () => void;
    /** After any send or release lands, so the board or queue re-reads. */
    onChanged: () => void;
    /** False when this session holds no approver slot: every action is hidden rather than refused. */
    canAct?: boolean;
    /** The session's approver slot, for "replies as". */
    viewerApprover?: string | null;
    /** The composer's words and their setter, held by the page so they outlive the thread being replaced; uncontrolled without them. */
    words?: string;
    onWords?: (words: string) => void;
    /** Name shown while the file loads. */
    fallbackName?: string;
    showMode?: boolean;
    /** Offered in the sheet's header: leave the thread for the ask bar with this card still the context. */
    onAskAbout?: () => void;
}

interface Pending {
    status: 'sending' | 'sent';
    bubbles: string[];
    channel: string;
    turnId: string | null;
}

export function ThreadView({ fileId, layout, backTo = 'Board', onClose, onChanged, canAct = true, viewerApprover = null, fallbackName, showMode = false, onAskAbout, words: keptWords, onWords }: ThreadViewProps) {
    const queryClient = useQueryClient();
    const { data, isLoading, error, refetch, isFetching } = useQuery<CaseFileDetail>({
        queryKey: ['comms-v2-case-file', fileId],
        queryFn: () => readFile(fileId),
        refetchInterval: THREAD_REFETCH_MS,
    });

    const [ownWords, setOwnWords] = useState('');
    const words = keptWords ?? ownWords;
    const setWords = onWords ?? setOwnWords;
    const [busy, setBusy] = useState<'answer' | 'draft' | 'release' | 'template' | null>(null);
    const [refusal, setRefusal] = useState<Refusal | null>(null);
    const [draftNotice, setDraftNotice] = useState<string | null>(null);
    const [draftGone, setDraftGone] = useState(false);
    const [templateRefusal, setTemplateRefusal] = useState<string | null>(null);
    const [pending, setPending] = useState<Pending | null>(null);
    const [released, setReleased] = useState(false);
    const [factsOpen, setFactsOpen] = useState(false);
    const [closing, setClosing] = useState(false);

    // Esc closes the docked panel, unless focus is in a field anywhere on the page or the thread's own
    // boxes hold words; the full-screen thread's own dialog handles Esc.
    useEffect(() => {
        if (layout !== 'panel') return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !focusInField() && !threadHoldsWords()) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [layout, onClose]);

    // Scroll to the newest turn once per open thread, not on every refresh.
    const endRef = useRef<HTMLDivElement>(null);
    const scrolled = useRef(false);
    useEffect(() => {
        if (!data || scrolled.current) return;
        scrolled.current = true;
        endRef.current?.scrollIntoView?.({ block: 'end' });
    }, [data]);

    // A fresh customer message may have reopened the window: a refusal about the old state is stale.
    const lastInboundId = data ? [...data.turns].reverse().find((t) => t.direction === 'inbound')?.id ?? null : null;
    useEffect(() => {
        setRefusal(null);
        setTemplateRefusal(null);
    }, [lastInboundId]);

    // The sent bubble stands in for the turn until a read carries it.
    useEffect(() => {
        if (pending?.turnId && data?.turns.some((t) => t.id === pending.turnId)) setPending(null);
    }, [data, pending]);

    // A draft that is back (or new) after a "nothing to send" refusal is offered again.
    const heldDraft = data?.hold?.draft ?? null;
    useEffect(() => {
        setDraftGone(false);
    }, [heldDraft]);

    // A new hold raised after a release is the desk's again to hand over: the release note is stale.
    const holdSince = data?.hold?.since ?? null;
    useEffect(() => {
        if (holdSince) setReleased(false);
    }, [holdSince]);

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['comms-v2-case-file', fileId] });
        queryClient.invalidateQueries({ queryKey: ['comms-v2-template-offer', fileId] });
        onChanged();
    };

    if (isLoading) {
        return (
            <ThreadFrame layout={layout} backTo={backTo} onClose={onClose} onAskAbout={onAskAbout} title={fallbackName ?? ''} line="">
                <div data-testid="thread-loading" className="flex flex-1 flex-col gap-2.5 px-4 py-3.5" aria-busy="true">
                    <div className="h-10 w-3/5 animate-pulse rounded-lg bg-slate-100" />
                    <div className="h-10 w-1/2 animate-pulse self-end rounded-lg bg-slate-100" />
                    <div className="h-10 w-2/3 animate-pulse rounded-lg bg-slate-100" />
                </div>
                <div className="border-t border-slate-200 px-4 pb-3.5 pt-3">
                    <textarea disabled aria-label="Your reply to the customer" className="min-h-[72px] w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px]" />
                </div>
            </ThreadFrame>
        );
    }

    if (error || !data) {
        return (
            <ThreadFrame layout={layout} backTo={backTo} onClose={onClose} onAskAbout={onAskAbout} title={fallbackName ?? ''} line="">
                <div className="p-4">
                    <div role="alert" data-testid="thread-error" className="flex flex-col gap-1.5 rounded-lg border border-red-200 bg-red-50 p-3">
                        <p className="text-[13px] font-semibold text-red-700">Couldn&apos;t open this thread</p>
                        <p className="text-xs text-red-900">The card is still on the {backTo.toLowerCase()}.</p>
                        <div className="flex gap-2">
                            <button type="button" className={cn(BTN, 'h-11 border border-red-200 bg-white px-3 text-xs text-red-700 lg:h-9')} disabled={isFetching} onClick={() => refetch()}>
                                {isFetching && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}Retry
                            </button>
                            <button type="button" className={cn(BTN_OUTLINE, 'h-11 px-3 text-xs lg:h-9')} onClick={onClose}>Back to {backTo.toLowerCase()}</button>
                        </div>
                    </div>
                </div>
            </ThreadFrame>
        );
    }

    const name = data.party?.name || fallbackName || addressLabel(data.party?.address) || 'Customer';
    const firstName = name.split(/\s+/)[0];
    const rows = threadRows(data, name);
    const hold = data.hold;
    const noCustomer = !hasCustomerTurn(data);
    const shut = data.replyWindow?.state === 'shut' || refusal?.kind === 'shut_window';
    const unroutable = !noCustomer && !data.replyChannel && data.replyRefusal ? data.replyRefusal : null;
    const holdBlocked = !!hold && !data.holdApproverAssigned;
    const replySlot = viewerApprover ?? hold?.approver.id ?? null;
    const replyAs = replySlot ? slotLabel(replySlot) : 'you';
    const showDraft = !!hold?.draft && !draftGone;
    const replyChannel = data.replyChannel ?? 'whatsapp';

    const sendDraft = async () => {
        const shown = hold?.draft;
        if (!shown) return;
        setBusy('draft');
        setRefusal(null);
        setDraftNotice(null);
        setPending({ status: 'sending', bubbles: [shown], channel: replyChannel, turnId: null });
        const result = await postTo(fileId, 'send-held-draft', { expectedDraft: shown });
        setBusy(null);
        if (!result.ok) {
            setPending(null);
            if (result.status === 409 && result.error === HELD_DRAFT_CHANGED) {
                setDraftNotice('The held draft changed since you saw it. This is the draft as it stands now; press Send this again to send it.');
                refetch();
                return;
            }
            const r = refusalOf('send_held_draft', result.status, result.error);
            if (r.kind === 'no_draft') { setDraftGone(true); refetch(); }
            setRefusal(r);
            return;
        }
        const sent: SentReply | undefined = result.data?.sent;
        setPending({ status: 'sent', bubbles: sent?.bubbles?.length ? sent.bubbles : [shown], channel: replyChannel, turnId: sent?.turnId ?? null });
        refresh();
    };

    const answer = async () => {
        const text = words.trim();
        if (!text) return;
        setBusy('answer');
        setRefusal(null);
        setReleased(false);
        setPending({ status: 'sending', bubbles: [text], channel: replyChannel, turnId: null });
        const result = await postTo(fileId, 'answer', { words: text });
        setBusy(null);
        if (!result.ok) {
            setPending(null);
            setRefusal(refusalOf('answer', result.status, result.error));
            return;
        }
        const sent: SentReply | undefined = result.data?.sent;
        setPending({ status: 'sent', bubbles: sent?.bubbles?.length ? sent.bubbles : [text], channel: replyChannel, turnId: sent?.turnId ?? null });
        setWords('');
        refresh();
    };

    const release = async () => {
        setBusy('release');
        setRefusal(null);
        const result = await postTo(fileId, 'release', { words: words.trim() });
        setBusy(null);
        if (!result.ok) { setRefusal(refusalOf('release', result.status, result.error)); return; }
        setWords('');
        setReleased(true);
        refresh();
    };

    const sendTemplate = async () => {
        setBusy('template');
        setTemplateRefusal(null);
        const result = await postTo(fileId, 'send-template');
        setBusy(null);
        if (!result.ok) { setTemplateRefusal(refusalMessage(result.status, result.error)); return; }
        const sent: SentReply | undefined = result.data?.sent;
        setRefusal(null);
        setPending({ status: 'sent', bubbles: sent?.bubbles ?? [], channel: replyChannel, turnId: sent?.turnId ?? null });
        refresh();
    };

    const line = [
        data.party?.role ?? null,
        STAGE_LABELS[data.stage] ?? data.stage,
        showMode ? data.mode : null,
        headerLine(data) || null,
    ].filter(Boolean).join(' · ');
    const items = chatItems(rows);

    return (
        <ThreadFrame
            layout={layout} backTo={backTo} onClose={onClose} onAskAbout={onAskAbout} title={name} line={line}
            links={threadLinks(data)}
            onCloseFile={canAct && data.stage !== 'done' ? () => setClosing(true) : undefined}
        >
            <div data-testid="thread-turns" className={cn('flex min-h-[120px] flex-1 flex-col overflow-y-auto px-4 pb-3 pt-2', WA_WALL)}>
                {items.map((item) => item.kind === 'day'
                    ? <p key={item.id} data-testid={item.id} className={cn('my-2 self-center rounded-[7.5px] bg-white px-2.5 py-1 text-[11.5px]', WA_META, BUBBLE_SHADOW)}>{item.label}</p>
                    : <Row key={item.id} row={item.row} first={item.first} />)}
                {pending && (
                    <Bubble
                        testId="thread-pending"
                        side="desk"
                        first
                        muted={pending.status === 'sending'}
                        meta={pending.status === 'sending'
                            ? <span className="inline-flex items-center gap-1"><Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin" />Sending as {replyAs}…</span>
                            : <span>✓ Sent · {replyAs} · {channelLabel(pending.channel)} · just now</span>}
                    >
                        {pending.bubbles.join('\n\n')}
                    </Bubble>
                )}
                {released && <Note testId="thread-released">✓ Hold released · the thread is the desk&apos;s again</Note>}
                {hold && (
                    // The hold sits in the chat where the next message would go: the draft as a dashed
                    // bubble on our side that has not gone, then why it is held and what Ben can do.
                    <div data-testid="held-block" className="mt-2 flex flex-col items-end gap-1.5">
                        {showDraft && (
                            <div className="relative max-w-[80%] rounded-[7.5px] border-[1.5px] border-dashed border-[#d8a106] bg-white px-2.5 py-1.5 text-[13.5px] leading-[1.38] text-[#111b21]">
                                <span className="block text-[12px] font-semibold text-amber-700">Draft · not sent</span>
                                <p data-testid="hold-draft" className="whitespace-pre-wrap break-words">{hold.draft}</p>
                            </div>
                        )}
                        <p className="max-w-[90%] text-right text-[12px] leading-snug text-[#54656f]">
                            <span className="font-semibold text-amber-800">Held {heldFor(hold.since)} · for {slotLabel(hold.approver.id)}</span>{' '}
                            <span data-testid="held-reason">· {hold.reason}</span>
                        </p>
                        {holdBlocked && (
                            <p data-testid="held-unassigned" className="max-w-[90%] text-right text-[12px] text-amber-900">No one is assigned to the {slotLabel(hold.approver.id)} slot, so nobody can act on this yet. Set the comms_v2_approvers row.</p>
                        )}
                        {showDraft && draftNotice && <p role="status" data-testid="draft-changed" className="max-w-[90%] text-right text-[12px] font-semibold text-amber-900">{draftNotice}</p>}
                        {canAct && (
                            <div className="flex flex-wrap items-center justify-end gap-1">
                                {showDraft && (
                                    <button type="button" className={BTN_TEXT} disabled={busy !== null} onClick={() => setWords(hold.draft ?? '')}>Edit</button>
                                )}
                                <button type="button" className={BTN_TEXT} disabled={busy !== null || !words.trim() || holdBlocked} onClick={release} title="Hands the file back to the desk with the words in the box, sending nothing">
                                    {busy === 'release' && <Loader2 aria-hidden className="mr-1 h-3.5 w-3.5 animate-spin" />}
                                    Release hold only
                                </button>
                                {showDraft && (
                                    <button
                                        type="button"
                                        className={cn(BTN, 'min-h-9 rounded-full bg-[#111b21] px-4 text-[13px] text-white hover:bg-slate-700')}
                                        disabled={busy !== null || holdBlocked || shut || !!unroutable}
                                        onClick={sendDraft}
                                    >
                                        {busy === 'draft' && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                                        Send this
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {data.facts.length > 0 && (
                    <div className="self-center pt-2 text-center">
                        <button type="button" aria-expanded={factsOpen} onClick={() => setFactsOpen((v) => !v)} className={cn('min-h-9 text-[12px] font-medium hover:underline', WA_META)}>
                            Facts ({data.facts.length})
                        </button>
                        {factsOpen && (
                            <ul data-testid="thread-facts" className="mt-1 space-y-1 rounded-[7.5px] bg-white px-3 py-2 text-left text-xs">
                                {data.facts.map((f) => (
                                    <li key={f.id} className="flex justify-between gap-3"><span className="text-slate-500">{f.key}</span><span className="text-right font-medium text-slate-900">{f.value}</span></li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
                <div ref={endRef} />
            </div>

            {/* Capped and scrolling on its own, so a shut notice, template card or close form never push the
                message field out of a fixed-height panel or squeeze the conversation to nothing. */}
            <div data-testid="thread-footer" className={cn('flex max-h-[60%] shrink-0 flex-col gap-2 overflow-y-auto px-2.5 pt-2', WA_BAR, layout === 'sheet' ? 'pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'pb-2.5')}>
                {canAct && (
                    <>
                        {noCustomer && (
                            <p data-testid="thread-empty" className="px-1.5 text-xs text-slate-500">No messages from the customer yet. Nothing to answer until they write.</p>
                        )}
                        {unroutable && <p data-testid="thread-unroutable" className="px-1.5 text-xs text-slate-500">No reply can go from here: {unroutable}</p>}
                        {shut && !refusal && data.replyWindow?.state === 'shut' && (
                            <p data-testid="thread-window-shut" className="rounded-[7.5px] bg-[#fff5c4] px-2.5 py-2 text-[12px] leading-normal text-[#54656f]">
                                <b className="text-[#111b21]">Can&apos;t send freeform words.</b> The {channelLabel(data.replyChannel)} window is shut ({data.replyWindow.reason}), so only an approved template can go until the customer writes again.
                            </p>
                        )}
                        {refusal && <RefusalNote refusal={refusal} testId="thread-refusal" />}
                        {shut && <TemplateCard fileId={fileId} sinceTurnId={lastInboundId} busy={busy === 'template'} onSend={sendTemplate} refusal={templateRefusal} />}
                        {closing && data.stage !== 'done' && (
                            <CloseFileForm key={fileId} fileId={fileId} held={!!hold} layout={layout} onClosed={() => { setClosing(false); refresh(); }} startConfirming onCancel={() => setClosing(false)} />
                        )}

                        <div className="flex items-end gap-2">
                            <label htmlFor={`thread-words-${fileId}`} className="sr-only">Your reply to the customer</label>
                            <textarea
                                id={`thread-words-${fileId}`}
                                value={words}
                                onChange={(e) => setWords(e.target.value)}
                                disabled={(noCustomer && !hold) || busy === 'answer'}
                                rows={1}
                                placeholder={noCustomer ? (hold ? 'Your words for releasing the hold' : 'Needs a customer turn to answer') : `Message ${firstName}, sent as typed`}
                                className="max-h-[120px] min-h-10 flex-1 resize-none rounded-[20px] border-0 bg-white px-4 py-[9px] text-[13.5px] leading-normal text-[#111b21] outline-none placeholder:text-[#8696a0] focus:ring-2 focus:ring-amber-400/40 disabled:bg-white/60"
                            />
                            <button
                                type="button"
                                aria-label="Send reply"
                                title={`Send as ${replyAs}`}
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111b21] text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={busy !== null || !words.trim() || noCustomer || shut || !!unroutable}
                                onClick={answer}
                            >
                                {busy === 'answer' ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Send aria-hidden className="h-4 w-4" />}
                            </button>
                        </div>
                    </>
                )}

                {!canAct && (
                    <p data-testid="thread-read-only" className="px-1.5 pb-1 text-xs text-slate-500">Read only: no approver slot is assigned to your login.</p>
                )}
            </div>
        </ThreadFrame>
    );
}

/**
 * The thread's "More": Call, the customer's record, the quote on file, and Close file, each shown only when
 * there is one. Words, not icons. Esc closes the menu alone, never the panel behind it.
 */
function MoreMenu({ links, onCloseFile }: { links?: ThreadLinks; onCloseFile?: () => void }) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setOpen(false); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open]);
    if (!links?.call && !links?.customer && !links?.quote && !onCloseFile) return null;
    const item = 'block w-full px-4 py-2.5 text-left text-[13px] text-[#111b21] hover:bg-[#f0f2f5]';
    return (
        <div className="relative">
            <button type="button" data-testid="thread-more" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="min-h-9 px-2 text-[13px] font-medium text-[#111b21] hover:underline">
                More
            </button>
            {open && (
                <>
                    <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div role="menu" className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md bg-white py-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.18)]">
                        {links?.call && <a role="menuitem" href={links.call} data-testid="thread-call" className={item}>Call</a>}
                        {links?.customer && <Link role="menuitem" href={links.customer} data-testid="thread-view-customer" className={item}>View customer</Link>}
                        {links?.quote && <Link role="menuitem" href={links.quote} data-testid="thread-latest-quote" className={item}>Latest quote</Link>}
                        {onCloseFile && (
                            <button type="button" role="menuitem" data-testid="close-file" className={item} onClick={() => { setOpen(false); onCloseFile(); }}>
                                Close file
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function ThreadFrame({ layout, backTo, onClose, onAskAbout, title, line, links, onCloseFile, children }: {
    layout: 'panel' | 'sheet';
    backTo: string;
    onClose: () => void;
    onAskAbout?: () => void;
    title: string;
    line: string;
    /** Set once the file has loaded: the More menu's links. */
    links?: ThreadLinks;
    onCloseFile?: () => void;
    children: React.ReactNode;
}) {
    const WORD = 'min-h-9 shrink-0 px-2 text-[13px] font-medium text-[#111b21] hover:underline';
    return (
        <div data-testid="thread-view" className={cn('flex h-full min-h-0 flex-col font-sans text-[#111b21]', WA_WALL)}>
            <div className={cn('flex shrink-0 items-center gap-1 border-b border-[#d1d7db] px-3 py-2', WA_BAR, layout === 'sheet' && 'pt-[max(0.5rem,env(safe-area-inset-top))]')}>
                {layout === 'sheet' && (
                    <button type="button" onClick={onClose} className="flex h-11 shrink-0 items-center gap-0.5 rounded-md pr-2 text-sm font-semibold text-[#111b21] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
                        <ChevronLeft aria-hidden className="h-[18px] w-[18px]" />{backTo}
                    </button>
                )}
                <div className="min-w-0 flex-1 px-1">
                    <p data-testid="thread-name" className="truncate text-[15px] font-semibold">{title}</p>
                    {line && <p data-testid="thread-line" className={cn('truncate text-[12px]', WA_META)} title={line}>{line}</p>}
                </div>
                {onAskAbout && (
                    <button type="button" data-testid="thread-ask-about" onClick={onAskAbout} className={WORD}>Ask about this</button>
                )}
                <MoreMenu links={links} onCloseFile={onCloseFile} />
                {layout === 'panel' && (
                    <button type="button" onClick={onClose} className={WORD}>Close</button>
                )}
            </div>
            {children}
        </div>
    );
}

/**
 * The thread full screen below 1024px, over the board or queue, with a back arrow that returns to
 * it. Escape and a tap outside are ignored while one of the thread's own boxes holds
 * words, so neither throws away a half-written reply or close. "Ask about this", when the page offers
 * one, is the page's own leaving rather than a close: the page hears it as it is tapped and puts the
 * sheet away itself, keeping the card, and the dialog is stopped from taking the focus back on its
 * way out so the page's focus stays where it put it.
 */
export function ThreadSheet({ fileId, onClose, onAskAbout, ...rest }: Omit<ThreadViewProps, 'fileId' | 'layout'> & { fileId: string | null }) {
    const asking = useRef(false);
    return (
        <Sheet open={!!fileId} onOpenChange={(open) => !open && onClose()}>
            <SheetContent
                side="right"
                onEscapeKeyDown={(e) => { if (threadHoldsWords()) e.preventDefault(); }}
                onPointerDownOutside={(e) => { if (threadHoldsWords()) e.preventDefault(); }}
                onCloseAutoFocus={(e) => { if (!asking.current) return; asking.current = false; e.preventDefault(); }}
                className="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden border-0 p-0 sm:max-w-none [&>button:last-child]:hidden"
            >
                <SheetTitle className="sr-only">Conversation</SheetTitle>
                <SheetDescription className="sr-only">The conversation, with the held draft and your reply beneath it.</SheetDescription>
                {fileId && (
                    <ThreadView
                        key={fileId}
                        {...rest}
                        fileId={fileId}
                        layout="sheet"
                        onClose={onClose}
                        onAskAbout={onAskAbout && (() => { asking.current = true; onAskAbout(); })}
                    />
                )}
            </SheetContent>
        </Sheet>
    );
}
