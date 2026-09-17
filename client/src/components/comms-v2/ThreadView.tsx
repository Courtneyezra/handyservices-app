/**
 * Handy Desk B4 - one customer's thread on the new desk, opened by tapping a card: the comms board's
 * docked panel (≥1024px) or bottom sheet, and a Handy Desk queue card. A recreation of section 3 of
 * the Claude Design export's `Comms Board.dc.html`, in Handy Desk's slate and amber, with a held
 * hold in amber.
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
 *   - below the composer, on a file not yet done, "Close file" posts close (CloseFileForm.tsx) after a
 *     second tap, with words required on a held file; the file is then read again and the board or
 *     queue refreshed.
 * Every refusal is shown as the desk worded it, with the words kept in the box. A reply shows as a
 * sending bubble at once and as sent from the response, until the next read carries the turn.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, Loader2, Phone, Send, X } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { CloseFileForm } from '@/components/comms-v2/CloseFileForm';
import { refusalMessage } from '@/lib/handy-desk-queue';
import { HELD_DRAFT_CHANGED } from '@shared/ops-types';
import {
    channelLabel, hasCustomerTurn, headerLine, heldFor, holdDetailLine, refusalOf, slotLabel, threadRows,
    type Refusal, type SentReply, type TemplateOffer, type ThreadRow,
} from '@/lib/comms-v2-thread';
import { STAGE_LABELS, type CaseFileDetail, type TurnMedia } from '@/pages/admin/CommsV2BoardPage';

/** How often an open thread re-reads its case file; matches the board and the queue. */
export const THREAD_REFETCH_MS = 15_000;

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

type PostResult = { ok: true; data: any } | { ok: false; status: number; error: string | undefined };

async function postTo(fileId: string, route: string, body?: unknown): Promise<PostResult> {
    try {
        const res = await fetch(`/api/comms-v2/case-files/${fileId}/${route}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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
    const res = await fetch(`/api/comms-v2/case-files/${fileId}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`Failed to load conversation (${res.status})`);
    return res.json();
}

/** Whether the focus is in a thread's reply box that holds words, which Esc must not throw away. */
function typingInThread(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLTextAreaElement && el.id.startsWith('thread-words-') && el.value !== '';
}

/** Whether the focus is in any editable field on the page, where Esc belongs to that field, not the docked panel. */
function focusInField(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        || (el instanceof HTMLElement && el.isContentEditable);
}

const PILL = 'rounded-full bg-slate-100 px-[7px] py-0.5 text-[10px] font-semibold text-slate-500';
const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50';
const BTN_AMBER = cn(BTN, 'bg-amber-400 text-slate-900 hover:bg-amber-300');
const BTN_DARK = cn(BTN, 'bg-slate-900 text-white hover:bg-slate-800');
const BTN_OUTLINE = cn(BTN, 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50');

// ---------------------------------------------------------------- rows

function MediaThumb({ media }: { media: TurnMedia }) {
    if (!media.url) {
        return <div className="flex h-[90px] items-center justify-center bg-slate-200 text-[11px] text-slate-500">{media.kind === 'video' ? 'video' : 'photo'}</div>;
    }
    if (media.kind === 'video') return <video src={media.url} controls preload="metadata" className="max-h-56 w-full bg-black" />;
    return (
        <a href={media.url} target="_blank" rel="noreferrer">
            <img src={media.url} alt="" loading="lazy" className="max-h-56 w-full object-cover" />
        </a>
    );
}

function Bubble({ side, meta, children, testId, muted }: { side: 'customer' | 'desk'; meta: React.ReactNode; children: React.ReactNode; testId?: string; muted?: boolean }) {
    const desk = side === 'desk';
    return (
        <div data-testid={testId} className={cn('flex max-w-[85%] flex-col gap-[3px]', desk ? 'self-end' : 'self-start', muted && 'opacity-60')}>
            <div className={cn('whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-normal', desk ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-900')}>{children}</div>
            <div className={cn('text-[10px] text-slate-400', desk && 'text-right')}>{meta}</div>
        </div>
    );
}

function CallRow({ row }: { row: Extract<ThreadRow, { kind: 'call' }> }) {
    const [open, setOpen] = useState(false);
    return (
        <div data-testid={`call-turn-${row.id}`} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center gap-2">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white"><Phone className="h-[13px] w-[13px]" /></span>
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900">{row.headline}</p>
                    <p className="text-[10px] text-slate-500">{row.meta}</p>
                </div>
            </div>
            {row.pending && (
                <p data-testid={`call-pending-${row.id}`} className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
                    Transcribing… summary lands within a few minutes, on the next 15s refresh.
                </p>
            )}
            {row.summary && <p data-testid={`call-summary-${row.id}`} className="text-xs leading-normal text-slate-700">{row.summary}</p>}
            {row.transcript && (
                <>
                    <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpen((v) => !v)}
                        className={cn(BTN_OUTLINE, 'h-10 self-start px-2.5 text-xs lg:h-8')}
                    >
                        {open ? 'Hide transcript' : 'Show transcript'}
                        <ChevronDown aria-hidden className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                    </button>
                    {open && <p data-testid={`call-transcript-${row.id}`} className="whitespace-pre-line border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-700">{row.transcript}</p>}
                </>
            )}
        </div>
    );
}

function Row({ row }: { row: ThreadRow }) {
    switch (row.kind) {
        case 'call':
            return <CallRow row={row} />;
        case 'system':
            return (
                <div data-testid={`turn-system-${row.id}`} className="flex items-center gap-2 py-0.5 text-[11px] text-slate-500">
                    <span aria-hidden className="h-px flex-1 bg-slate-200" />
                    <span>{row.body} · {row.at}</span>
                    <span aria-hidden className="h-px flex-1 bg-slate-200" />
                </div>
            );
        case 'media':
            return (
                <div data-testid={`turn-bubble-${row.id}`} className={cn('flex max-w-[85%] flex-col gap-[3px]', row.side === 'desk' ? 'self-end' : 'self-start')}>
                    {row.media.map((m) => (
                        <div key={m.id} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                            <MediaThumb media={m} />
                            <p data-testid={`media-description-${m.id}`} className="px-3 py-2 text-xs leading-snug text-slate-700">
                                {m.description
                                    ? <>{m.description.description} <span className="text-slate-400">· {m.description.confidence} confidence</span></>
                                    : <span className="text-slate-400">Not described yet</span>}
                            </p>
                        </div>
                    ))}
                    {row.body && <div className={cn('whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-normal', row.side === 'desk' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-900')}>{row.body}</div>}
                    <div data-testid={`turn-meta-${row.id}`} className={cn('text-[10px] text-slate-400', row.side === 'desk' && 'text-right')}>{row.meta}</div>
                </div>
            );
        default:
            return <Bubble testId={`turn-bubble-${row.id}`} side={row.side} meta={<span data-testid={`turn-meta-${row.id}`}>{row.meta}</span>}>{row.body}</Bubble>;
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

function TemplateCard({ fileId, busy, onSend, refusal }: { fileId: string; busy: boolean; onSend: () => void; refusal: string | null }) {
    const { data, isLoading, error } = useQuery<TemplateOffer>({
        queryKey: ['comms-v2-template-offer', fileId],
        queryFn: async () => {
            const res = await fetch(`/api/comms-v2/case-files/${fileId}/template-offer`, { headers: getAuthHeaders() });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(refusalMessage(res.status, body?.error));
            return body;
        },
        refetchInterval: THREAD_REFETCH_MS,
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
    /** 'panel' closes with × or Esc; 'sheet' has a drag handle and a ‹ back button. */
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
    /** Name shown while the file loads. */
    fallbackName?: string;
    showMode?: boolean;
}

interface Pending {
    status: 'sending' | 'sent';
    bubbles: string[];
    channel: string;
    turnId: string | null;
}

export function ThreadView({ fileId, layout, backTo = 'Board', onClose, onChanged, canAct = true, viewerApprover = null, fallbackName, showMode = false }: ThreadViewProps) {
    const queryClient = useQueryClient();
    const { data, isLoading, error, refetch, isFetching } = useQuery<CaseFileDetail>({
        queryKey: ['comms-v2-case-file', fileId],
        queryFn: () => readFile(fileId),
        refetchInterval: THREAD_REFETCH_MS,
    });

    const [words, setWords] = useState('');
    const [busy, setBusy] = useState<'answer' | 'draft' | 'release' | 'template' | null>(null);
    const [refusal, setRefusal] = useState<Refusal | null>(null);
    const [draftNotice, setDraftNotice] = useState<string | null>(null);
    const [draftGone, setDraftGone] = useState(false);
    const [templateRefusal, setTemplateRefusal] = useState<string | null>(null);
    const [pending, setPending] = useState<Pending | null>(null);
    const [released, setReleased] = useState(false);
    const [factsOpen, setFactsOpen] = useState(false);

    // Esc closes the docked panel, unless focus is in a field anywhere on the page; a sheet's own dialog handles Esc.
    useEffect(() => {
        if (layout !== 'panel') return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !focusInField()) onClose(); };
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

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['comms-v2-case-file', fileId] });
        queryClient.invalidateQueries({ queryKey: ['comms-v2-template-offer', fileId] });
        onChanged();
    };

    if (isLoading) {
        return (
            <ThreadFrame layout={layout} backTo={backTo} onClose={onClose} title={fallbackName ?? ''} line="">
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
            <ThreadFrame layout={layout} backTo={backTo} onClose={onClose} title={fallbackName ?? ''} line="">
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

    const name = data.party?.name || fallbackName || data.party?.address.replace(/^[a-z]+:/, '') || 'Customer';
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

    const pills = [data.party?.role ?? null, STAGE_LABELS[data.stage] ?? data.stage, showMode ? data.mode : null].filter(Boolean) as string[];

    return (
        <ThreadFrame layout={layout} backTo={backTo} onClose={onClose} title={name} pills={pills} line={headerLine(data)}>
            <div data-testid="thread-turns" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
                {rows.map((row) => <Row key={row.id} row={row} />)}
                {pending && (
                    <Bubble
                        testId="thread-pending"
                        side="desk"
                        muted={pending.status === 'sending'}
                        meta={pending.status === 'sending'
                            ? <span className="inline-flex items-center gap-1"><Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin" />Sending as {replyAs}…</span>
                            : <span>✓ Sent · {replyAs} · {channelLabel(pending.channel)} · just now</span>}
                    >
                        {pending.bubbles.join('\n\n')}
                    </Bubble>
                )}
                {released && <p data-testid="thread-released" className="text-center text-[11px] text-slate-500">✓ Hold released · the thread is the desk&apos;s again</p>}
                {data.facts.length > 0 && (
                    <div className="pt-1">
                        <button type="button" aria-expanded={factsOpen} onClick={() => setFactsOpen((v) => !v)} className="inline-flex min-h-10 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 hover:text-slate-900">
                            Facts ({data.facts.length})
                            <ChevronDown aria-hidden className={cn('h-3 w-3 transition-transform', factsOpen && 'rotate-180')} />
                        </button>
                        {factsOpen && (
                            <ul data-testid="thread-facts" className="mt-1 space-y-1 text-xs">
                                {data.facts.map((f) => (
                                    <li key={f.id} className="flex justify-between gap-2"><span className="text-slate-500">{f.key}</span><span className="text-right font-medium text-slate-900">{f.value}</span></li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
                <div ref={endRef} />
            </div>

            <div className={cn('flex shrink-0 flex-col gap-2.5 border-t border-slate-200 bg-white px-4 pt-3', layout === 'sheet' ? 'pb-5' : 'pb-3.5')}>
                {hold && (
                    <div data-testid="held-block" className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[11px] font-bold text-amber-800">Held {heldFor(hold.since)} · for {slotLabel(hold.approver.id)}</p>
                            <p data-testid="held-reason" className="text-[11px] text-amber-900">· {hold.reason}</p>
                        </div>
                        <p data-testid="held-detail" className="text-[11px] leading-normal text-amber-900/80">{holdDetailLine(hold)}</p>
                        {holdBlocked && (
                            <p data-testid="held-unassigned" className="text-[11px] text-amber-900">No one is assigned to the {slotLabel(hold.approver.id)} slot, so nobody can act on this yet. Set the comms_v2_approvers row.</p>
                        )}
                        {showDraft && (
                            <>
                                <p data-testid="hold-draft" className="whitespace-pre-wrap rounded-md border border-amber-200 bg-white px-2.5 py-2 text-[13px] leading-normal text-slate-900">{hold.draft}</p>
                                {draftNotice && <p role="status" data-testid="draft-changed" className="text-[11px] font-semibold text-amber-900">{draftNotice}</p>}
                                {canAct && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            className={cn(BTN_AMBER, layout === 'sheet' ? 'h-11 w-full text-sm' : 'h-10 px-3.5 text-[13px]')}
                                            disabled={busy !== null || holdBlocked || shut || !!unroutable}
                                            onClick={sendDraft}
                                        >
                                            {busy === 'draft' ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <Send aria-hidden className="h-3.5 w-3.5" />}
                                            Send this
                                        </button>
                                        {layout === 'panel' && <span className="text-[11px] text-slate-500">or write your own below</span>}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {canAct && (
                    <>
                        {noCustomer && (
                            <p data-testid="thread-empty" className="text-xs text-slate-500">No messages from the customer yet. Nothing to answer until they write.</p>
                        )}
                        {unroutable && <p data-testid="thread-unroutable" className="text-xs text-slate-500">No reply can go from here: {unroutable}</p>}
                        {shut && !refusal && data.replyWindow?.state === 'shut' && (
                            <p data-testid="thread-window-shut" className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-normal text-slate-700">
                                <b className="text-slate-900">Can&apos;t send freeform words.</b> The {channelLabel(data.replyChannel)} window is shut ({data.replyWindow.reason}), so only an approved template can go until the customer writes again.
                            </p>
                        )}
                        {refusal && <RefusalNote refusal={refusal} testId="thread-refusal" />}
                        {shut && <TemplateCard fileId={fileId} busy={busy === 'template'} onSend={sendTemplate} refusal={templateRefusal} />}

                        <div className={cn('flex gap-2', layout === 'sheet' ? 'items-end' : 'flex-col gap-1.5')}>
                            <label htmlFor={`thread-words-${fileId}`} className="sr-only">Your reply to the customer</label>
                            <textarea
                                id={`thread-words-${fileId}`}
                                value={words}
                                onChange={(e) => setWords(e.target.value)}
                                disabled={(noCustomer && !hold) || busy === 'answer'}
                                placeholder={noCustomer ? (hold ? 'Your words for releasing the hold' : 'Needs a customer turn to answer') : layout === 'sheet' ? 'Or your own words…' : `Your own words to ${firstName}… (no guards run)`}
                                className={cn(
                                    'w-full rounded-md border border-slate-200 px-3 text-[13px] leading-normal text-slate-900 outline-none placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25 disabled:bg-slate-50',
                                    layout === 'sheet' ? 'max-h-[120px] min-h-11 flex-1 resize-none py-[11px]' : 'min-h-[72px] resize-y py-2.5',
                                )}
                            />
                            {layout === 'sheet' ? (
                                <button type="button" aria-label="Send reply" className={cn(BTN_DARK, 'h-11 w-11 shrink-0')} disabled={busy !== null || !words.trim() || noCustomer || shut || !!unroutable} onClick={answer}>
                                    {busy === 'answer' ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Send aria-hidden className="h-4 w-4" />}
                                </button>
                            ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="flex-1 text-[11px] text-slate-500">{words.length} characters · replies as <b className="text-slate-900">{replyAs}</b>, as typed</p>
                                    {hold && (
                                        <button type="button" className={cn(BTN_OUTLINE, 'h-10 px-3.5 text-[13px]')} disabled={busy !== null || !words.trim() || holdBlocked} onClick={release}>
                                            {busy === 'release' && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                                            Release hold only
                                        </button>
                                    )}
                                    <button type="button" className={cn(BTN_DARK, 'h-10 px-4 text-[13px]')} disabled={busy !== null || !words.trim() || noCustomer || shut || !!unroutable} onClick={answer}>
                                        {busy === 'answer' && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                                        Send reply
                                    </button>
                                </div>
                            )}
                        </div>
                        {layout === 'sheet' && hold && (
                            <button type="button" className={cn(BTN_OUTLINE, 'h-11 text-sm')} disabled={busy !== null || !words.trim() || holdBlocked} onClick={release}>
                                {busy === 'release' && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                                Release hold only
                            </button>
                        )}
                        {data.stage !== 'done' && <CloseFileForm key={fileId} fileId={fileId} held={!!hold} layout={layout} onClosed={refresh} />}
                    </>
                )}
            </div>
        </ThreadFrame>
    );
}

function ThreadFrame({ layout, backTo, onClose, title, pills = [], line, children }: {
    layout: 'panel' | 'sheet';
    backTo: string;
    onClose: () => void;
    title: string;
    pills?: string[];
    line: string;
    children: React.ReactNode;
}) {
    return (
        <div data-testid="thread-view" className="flex h-full min-h-0 flex-col bg-white font-sans text-slate-900">
            {layout === 'panel' ? (
                <div className="flex shrink-0 items-start gap-2.5 border-b border-slate-200 px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <p data-testid="thread-name" className="text-[15px] font-semibold">{title}</p>
                            {pills.map((p) => <span key={p} className={PILL}>{p}</span>)}
                        </div>
                        {line && <p data-testid="thread-line" className="mt-0.5 text-[11px] text-slate-500">{line}</p>}
                    </div>
                    <button type="button" aria-label="Close" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
                        <X aria-hidden className="h-[18px] w-[18px]" />
                    </button>
                </div>
            ) : (
                <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 px-3.5 pb-2.5 pt-2">
                    <span aria-hidden className="mx-auto h-1 w-10 rounded-sm bg-slate-300" />
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={onClose} className="flex h-11 shrink-0 items-center gap-1 pl-1 pr-2 text-sm font-semibold text-slate-900">
                            <ChevronLeft aria-hidden className="h-[18px] w-[18px]" />{backTo}
                        </button>
                        <div className="min-w-0 flex-1">
                            <p data-testid="thread-name" className="truncate text-[15px] font-semibold">{title}</p>
                            {(pills.length > 1 || line) && <p data-testid="thread-line" className="truncate text-[11px] text-slate-500">{[...pills.slice(1), line].filter(Boolean).join(' · ')}</p>}
                        </div>
                    </div>
                </div>
            )}
            {children}
        </div>
    );
}

/** The thread as a bottom sheet below 1024px: the board or queue stays behind it, and closing returns to it. */
export function ThreadSheet({ fileId, onClose, ...rest }: Omit<ThreadViewProps, 'fileId' | 'layout'> & { fileId: string | null }) {
    return (
        <Sheet open={!!fileId} onOpenChange={(open) => !open && onClose()}>
            <SheetContent side="bottom" onEscapeKeyDown={(e) => { if (typingInThread()) e.preventDefault(); }} className="flex h-[92dvh] flex-col gap-0 overflow-hidden rounded-t-xl border-0 p-0 [&>button:last-child]:hidden">
                <SheetTitle className="sr-only">Conversation</SheetTitle>
                <SheetDescription className="sr-only">The conversation, with the held draft and your reply beneath it.</SheetDescription>
                {fileId && <ThreadView key={fileId} fileId={fileId} layout="sheet" onClose={onClose} {...rest} />}
            </SheetContent>
        </Sheet>
    );
}
