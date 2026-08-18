/**
 * /admin/comms — the single comms surface.
 *
 * Board on the left for triage, thread on the right for replying. One route, no navigation between
 * them, because the whole point is that Ben never has to go looking for the thing he just saw.
 *
 * The organising principle is "nothing gets missed": the headline number is people we have not
 * answered, cards lead with how long someone has been waiting in WORKING hours, and columns rank by
 * that rather than by recency. Channel (WhatsApp / SMS / call / webform) is a property of each
 * message, not a separate inbox — one person is one thread.
 *
 * Replaces WhatsAppInbox, AdminInboxPage and InboxBoardPage.
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
    useDroppable, useDraggable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
    Loader2, MessageCircle, AlertTriangle, Clock, Search, Send, X, Zap,
    Phone, Smartphone, Globe, Check, CheckCheck, AlertCircle, Bot, HelpCircle, Mic, Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------- types

interface WaitState {
    awaitingReply: boolean;
    waitingWorkingHours: number;
    waitingClockHours: number;
    breached: boolean;
    severity: 'none' | 'ok' | 'due' | 'breached';
}

interface BoardCard {
    id: string;
    phoneNumber: string;
    displayPhone: string;
    contactName: string | null;
    lastMessagePreview: string | null;
    lastMessageAt: string | null;
    lastCustomerMessageAt: string | null;
    unreadCount: number;
    stage: string;
    priority: string;
    tags: string[];
    channels: string[];
    windowOpen: boolean;
    windowHoursLeft: number;
    wait: WaitState;
}

interface BoardResponse {
    stages: string[];
    columns: Record<string, BoardCard[]>;
    slaWorkingHours: number;
    totals: {
        conversations: number; unread: number; windowsOpen: number;
        closingSoon: number; awaitingReply: number; breached: number;
        pendingDrafts?: number; openQuestions?: number;
    };
}

interface ThreadMessage {
    kind?: 'message';
    id: string;
    direction: 'inbound' | 'outbound';
    channel: string;
    content: string | null;
    type: string;
    status: string;
    errorCode: string | null;
    mediaUrl: string | null;
    mediaType: string | null;
    senderName: string | null;
    createdAt: string;
}

/** A phone call, shown inline in the thread. Read-only — calls are context, not conversation. */
interface CallEvent {
    kind: 'call';
    id: string;
    direction: 'inbound' | 'outbound';
    createdAt: string;
    durationSeconds: number | null;
    outcome: string | null;
    summary: string | null;
    transcript: string | null;
    recordingUrl: string | null;
    status: string | null;
}

type TimelineItem = ThreadMessage | CallEvent;

/** A machine-authored message awaiting Ben's approval — the human gate before anything sends. */
interface PendingDraft {
    id: string;
    phone: string;
    body: string;
    source: string;
    reason: string | null;
    contentSid: string | null;
    status: string;
    createdAt: string;
}

/** A question the agent is blocked on. Ben's answer feeds the agent's next run. */
interface AgentQuestion {
    id: string;
    conversationId: string;
    question: string;
    context: string | null;
    options: string[] | null;
    answer: string | null;
    status: 'open' | 'answered';
    createdAt: string;
}

interface QuickReply {
    id: string; label: string; body: string;
    shortcut: string | null; contentSid: string | null;
}

interface Sender {
    id: string;
    transport: 'twilio' | 'meta';
    displayPhone: string;
    label: string;
    isDefault: boolean;
    available: boolean;
    note?: string;
}

// ---------------------------------------------------------------- helpers

const STAGE_META: Record<string, { label: string; hint: string; accent: string }> = {
    new: { label: 'New', hint: 'Not yet picked up', accent: 'bg-blue-600' },
    active: { label: 'Active', hint: 'In conversation', accent: 'bg-emerald-600' },
    waiting: { label: 'Waiting', hint: 'Ball in their court', accent: 'bg-amber-600' },
    closed: { label: 'Closed', hint: 'Done or dead', accent: 'bg-slate-500' },
};

const CHANNEL_META: Record<string, { icon: typeof Phone; label: string; tint: string }> = {
    whatsapp: { icon: MessageCircle, label: 'WhatsApp', tint: 'text-emerald-600' },
    sms: { icon: Smartphone, label: 'SMS', tint: 'text-blue-600' },
    call: { icon: Phone, label: 'Call', tint: 'text-purple-600' },
    webform: { icon: Globe, label: 'Web form', tint: 'text-orange-600' },
};

/** Placeholder names written by ingest — showing them is worse than showing the number. */
function isRealName(name?: string | null): boolean {
    const n = (name || '').trim();
    if (!n) return false;
    if (/^(unknown( caller)?|website visitor|customer|guest)$/i.test(n)) return false;
    if (n.includes('@c.us') || /^[+\d][\d\s()+-]{5,}$/.test(n)) return false;
    return true;
}
const displayName = (c: BoardCard) => (isRealName(c.contactName) ? c.contactName!.trim() : c.displayPhone);

function renderBody(text: string, contactName?: string | null): string {
    const full = isRealName(contactName) ? (contactName as string).trim() : '';
    const first = full.split(/\s+/)[0] || '';
    return text
        .replace(/\{\{\s*first_name\s*\}\}/gi, first || 'there')
        .replace(/\{\{\s*name\s*\}\}/gi, full || 'there');
}

/** Working hours read oddly as bare numbers once large; days are what Ben thinks in. */
function formatWait(w: WaitState): string {
    if (!w.awaitingReply) return '';
    if (w.waitingWorkingHours < 10) return `${w.waitingWorkingHours}h waiting`;
    const days = Math.round(w.waitingWorkingHours / 10); // ~10 working hours per day
    return days <= 1 ? '1 day waiting' : `${days} days waiting`;
}

function timeLabel(iso: string): string {
    const d = new Date(iso);
    const hrs = (Date.now() - d.getTime()) / 3_600_000;
    if (hrs < 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (hrs < 48) return 'Yesterday';
    return d.toLocaleDateString();
}

// ---------------------------------------------------------------- small components

function WaitBadge({ wait }: { wait: WaitState }) {
    if (!wait.awaitingReply) return null;
    const tone =
        wait.severity === 'breached' ? 'bg-red-600 text-white'
        : wait.severity === 'due' ? 'bg-amber-500 text-white'
        : 'bg-slate-200 text-slate-700';
    return (
        <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', tone)}>
            <Clock className="h-2.5 w-2.5" />
            {formatWait(wait)}
        </span>
    );
}

function ChannelIcons({ channels }: { channels: string[] }) {
    if (!channels.length) return null;
    return (
        <span className="inline-flex items-center gap-1">
            {channels.map((ch) => {
                const meta = CHANNEL_META[ch];
                if (!meta) return null;
                const Icon = meta.icon;
                return <Icon key={ch} className={cn('h-3 w-3', meta.tint)} aria-label={meta.label} />;
            })}
        </span>
    );
}

function DeliveryTick({ status }: { status: string }) {
    switch (status) {
        case 'read': return <CheckCheck className="h-3 w-3 text-sky-300" aria-label="Read" />;
        case 'delivered': return <CheckCheck className="h-3 w-3" aria-label="Delivered" />;
        case 'queued': case 'accepted': return <Clock className="h-3 w-3" aria-label="Queued" />;
        case 'failed': case 'undelivered':
            return (
                <span className="flex items-center gap-0.5 text-red-200" aria-label="Failed">
                    <AlertCircle className="h-3 w-3" /><span className="text-[9px] font-bold uppercase">Failed</span>
                </span>
            );
        default: return <Check className="h-3 w-3" aria-label={status} />;
    }
}

/** Seconds as "4m 12s" — raw seconds are hard to read at a glance. */
function formatDuration(s: number | null): string {
    if (s === null || s <= 0) return 'no answer';
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * A phone call in the thread.
 *
 * Rendered as a full-width event rather than a left/right bubble: a call isn't a message, and
 * making it look like one would imply it can be replied to. Transcript and summary are collapsed
 * because transcripts run long and would drown the conversation.
 */
function CallEventRow({ call }: { call: CallEvent }) {
    const [open, setOpen] = useState(false);
    const missed = !call.durationSeconds || call.outcome === 'MISSED_CALL';

    return (
        <div className="my-2">
            <div className={cn(
                'rounded-lg border px-3 py-2 text-xs',
                missed ? 'border-red-200 bg-red-50' : 'border-purple-200 bg-purple-50'
            )}>
                <div className="flex items-center gap-2">
                    <Phone className={cn('h-3.5 w-3.5 shrink-0', missed ? 'text-red-600' : 'text-purple-600')} />
                    <span className={cn('font-semibold', missed ? 'text-red-800' : 'text-purple-900')}>
                        {call.direction === 'inbound' ? 'Inbound call' : 'Outbound call'}
                        {' · '}{formatDuration(call.durationSeconds)}
                    </span>
                    {call.outcome && (
                        <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                            {call.outcome.replace(/_/g, ' ').toLowerCase()}
                        </span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-500">{timeLabel(call.createdAt)}</span>
                </div>

                {call.summary && (
                    <p className="mt-1.5 leading-relaxed text-slate-700">{call.summary}</p>
                )}

                {(call.transcript || call.recordingUrl) && (
                    <div className="mt-1.5 flex items-center gap-3">
                        {call.transcript && (
                            <button
                                onClick={() => setOpen((v) => !v)}
                                className="text-[11px] font-medium text-purple-700 underline underline-offset-2"
                            >
                                {open ? 'Hide transcript' : 'Show transcript'}
                            </button>
                        )}
                        {call.recordingUrl && (
                            <a
                                href={call.recordingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-medium text-purple-700 underline underline-offset-2"
                            >
                                Recording
                            </a>
                        )}
                    </div>
                )}

                {open && call.transcript && (
                    <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded bg-white/80 p-2 text-[11px] leading-relaxed text-slate-700">
                        {call.transcript}
                    </pre>
                )}
            </div>
        </div>
    );
}

function Card({ card, selected, onOpen }: { card: BoardCard; selected: boolean; onOpen: () => void }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            onClick={onOpen}
            className={cn(
                'rounded-lg border bg-white p-2.5 shadow-sm cursor-pointer hover:border-slate-400 transition-colors',
                isDragging && 'opacity-40',
                selected && 'ring-2 ring-slate-900 border-slate-900',
                card.wait.severity === 'breached' && 'border-l-4 border-l-red-600',
                card.wait.severity === 'due' && 'border-l-4 border-l-amber-500'
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{displayName(card)}</div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[11px] tabular-nums text-slate-400">{card.displayPhone}</span>
                        <ChannelIcons channels={card.channels} />
                    </div>
                </div>
                {card.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                        {card.unreadCount}
                    </span>
                )}
            </div>
            {card.lastMessagePreview && (
                <p className="mt-1.5 line-clamp-2 text-xs text-slate-600">{card.lastMessagePreview}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <WaitBadge wait={card.wait} />
                {card.windowOpen && (
                    <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                        {card.windowHoursLeft}h window
                    </span>
                )}
            </div>
        </div>
    );
}

function Column({ stage, cards, selectedId, onOpen }: {
    stage: string; cards: BoardCard[]; selectedId: string | null; onOpen: (c: BoardCard) => void;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: stage });
    const meta = STAGE_META[stage] ?? { label: stage, hint: '', accent: 'bg-slate-500' };
    const waiting = cards.filter((c) => c.wait.awaitingReply).length;

    return (
        <div className="flex w-[264px] shrink-0 flex-col">
            <div className={cn('rounded-t-lg px-3 py-2 text-white', meta.accent)}>
                <div className="flex items-center justify-between">
                    <span className="text-sm font-bold uppercase tracking-wide">{meta.label}</span>
                    <span className="rounded bg-black/20 px-1.5 py-0.5 text-xs font-bold tabular-nums">{cards.length}</span>
                </div>
                <div className="text-[11px] opacity-80">
                    {meta.hint}{waiting > 0 && ` · ${waiting} unanswered`}
                </div>
            </div>
            <div
                ref={setNodeRef}
                className={cn(
                    'min-h-[300px] flex-1 space-y-2 overflow-y-auto rounded-b-lg border border-t-0 bg-slate-50 p-2 transition-colors',
                    isOver && 'border-blue-400 bg-blue-50'
                )}
            >
                {cards.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">Nothing here</p>}
                {cards.map((c) => (
                    <Card key={c.id} card={c} selected={c.id === selectedId} onOpen={() => onOpen(c)} />
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- thread panel

/**
 * A machine-drafted reply, parked above the composer until Ben approves it. Bold amber block —
 * this is a decision demanding attention, not a notification.
 */
function DraftApprovalCard({ draft, windowOpen, onDone }: {
    draft: PendingDraft; windowOpen: boolean; onDone: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [body, setBody] = useState(draft.body);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const deliverable = windowOpen || !!draft.contentSid;

    async function act(action: 'approve' | 'reject') {
        setBusy(true); setError(null);
        try {
            // Save any edit first so what sends is what's on screen.
            if (editing && body.trim() !== draft.body) {
                const r = await fetch(`/api/drafts/${draft.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ body: body.trim() }),
                });
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Edit failed');
            }
            const res = await fetch(`/api/drafts/${draft.id}/${action}`, {
                method: 'POST', headers: getAuthHeaders(),
            });
            const detail = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(detail.message || detail.error || `${action} failed`);
            onDone();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-amber-800">
                <Bot className="h-3.5 w-3.5" /> Drafted reply — needs your approval
                {!deliverable && (
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[9px] text-white">window shut — can't send yet</span>
                )}
            </div>
            {draft.reason && <p className="mt-1 text-[11px] italic text-amber-700">{draft.reason}</p>}
            {editing ? (
                <>
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={Math.min(8, Math.max(2, body.split('\n').length + 1))}
                        className="mt-2 w-full rounded border border-amber-300 bg-white p-2 text-sm focus:border-amber-500 focus:outline-none"
                    />
                    <p className="mt-1 text-[10px] text-amber-600">A line with only --- splits into separate WhatsApp messages.</p>
                </>
            ) : (
                // Preview exactly what the customer gets: each part is its own bubble, sent
                // a moment apart — like a person texting, not a letter arriving.
                <div className="mt-2 space-y-1.5">
                    {body.split(/\n\s*---\s*\n/).map((part, i) => part.trim() && (
                        <p key={i} className="whitespace-pre-wrap rounded-lg rounded-bl-sm bg-white p-2 text-sm text-slate-800 shadow-sm">
                            {part.trim()}
                        </p>
                    ))}
                </div>
            )}
            {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
            <div className="mt-2 flex items-center gap-2">
                <button
                    onClick={() => act('approve')}
                    disabled={busy || !deliverable || !body.trim()}
                    className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Approve & send'}
                </button>
                <button
                    onClick={() => setEditing((v) => !v)}
                    disabled={busy}
                    className="rounded border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                >
                    {editing ? 'Preview' : 'Edit'}
                </button>
                <button
                    onClick={() => act('reject')}
                    disabled={busy}
                    className="ml-auto rounded px-2 py-1.5 text-xs text-slate-500 hover:text-red-700 disabled:opacity-40"
                >
                    Reject
                </button>
            </div>
        </div>
    );
}

/**
 * The agent asking Ben for a decision it won't make itself. Tapping an option answers it; the
 * agent's next run turns the answer into a draft (which still comes back here for approval).
 */
function AskBenCard({ q, onDone }: { q: AgentQuestion; onDone: () => void }) {
    const [custom, setCustom] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit(answer: string, action: 'answer' | 'dismiss' = 'answer') {
        setBusy(true); setError(null);
        try {
            const res = await fetch(`/api/agent-questions/${q.id}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: action === 'answer' ? JSON.stringify({ answer }) : undefined,
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
            onDone();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    if (q.status === 'answered') {
        return (
            <div className="rounded-lg border-l-4 border-indigo-300 bg-indigo-50/60 p-3 text-xs text-indigo-700">
                <span className="font-bold">Answered:</span> {q.question} → <em>{q.answer}</em>
                <span className="ml-1 text-indigo-400">(agent will draft from this on its next pass)</span>
            </div>
        );
    }

    return (
        <div className="rounded-lg border-l-4 border-indigo-600 bg-indigo-50 p-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-indigo-800">
                <HelpCircle className="h-3.5 w-3.5" /> Agent needs a decision
            </div>
            <p className="mt-1.5 text-sm font-semibold text-slate-900">{q.question}</p>
            {q.context && <p className="mt-0.5 text-xs text-indigo-700">{q.context}</p>}
            {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
                {(q.options ?? []).map((opt) => (
                    <button
                        key={opt}
                        disabled={busy}
                        onClick={() => submit(opt)}
                        className="rounded-full border border-indigo-500 bg-white px-3 py-1 text-xs font-semibold text-indigo-800 hover:bg-indigo-600 hover:text-white disabled:opacity-40"
                    >
                        {opt}
                    </button>
                ))}
            </div>
            <div className="mt-2 flex gap-1.5">
                <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) submit(custom.trim()); }}
                    disabled={busy}
                    placeholder="Or type your own answer…"
                    className="flex-1 rounded border border-indigo-200 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
                />
                <button
                    onClick={() => custom.trim() && submit(custom.trim())}
                    disabled={busy || !custom.trim()}
                    className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                    Answer
                </button>
                <button
                    onClick={() => submit('', 'dismiss')}
                    disabled={busy}
                    title="I'll handle this thread myself"
                    className="rounded px-2 py-1 text-xs text-slate-500 hover:text-red-700 disabled:opacity-40"
                >
                    Dismiss
                </button>
            </div>
        </div>
    );
}

function ThreadPanel({ card, onClose }: { card: BoardCard; onClose: () => void }) {
    const queryClient = useQueryClient();
    const [input, setInput] = useState('');
    const [showQuick, setShowQuick] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    const { data, isLoading } = useQuery<{
        messages: ThreadMessage[]; timeline?: TimelineItem[]; totalMessages: number; totalCalls?: number;
        truncated: boolean; drafts?: PendingDraft[]; questions?: AgentQuestion[];
    }>({
        queryKey: ['comms-thread', card.id],
        queryFn: async () => {
            const res = await fetch(`/api/inbox/conversations/${card.id}/thread`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to load thread');
            return res.json();
        },
        refetchInterval: 15_000,
    });

    // Which number to send from. Only appears once a second sender exists, so the common
    // single-number case stays uncluttered.
    const { data: senderData } = useQuery<{ senders: Sender[]; coexistenceOnboarded: boolean }>({
        queryKey: ['comms-senders'],
        queryFn: async () => {
            const r = await fetch('/api/inbox/senders', { headers: getAuthHeaders() });
            if (!r.ok) return { senders: [], coexistenceOnboarded: false };
            return r.json();
        },
        staleTime: 60_000,
    });
    const senders = senderData?.senders ?? [];
    const [senderId, setSenderId] = useState<string>('twilio');
    const activeSender = senders.find((s) => s.id === senderId) ?? senders[0];

    const { data: quickReplies } = useQuery<QuickReply[]>({
        queryKey: ['quick-replies'],
        queryFn: async () => {
            const res = await fetch('/api/quick-replies', { headers: getAuthHeaders() });
            if (!res.ok) return [];
            return (await res.json()).replies ?? [];
        },
        staleTime: 5 * 60_000,
    });

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [data?.timeline?.length ?? data?.messages?.length]);

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['comms-thread', card.id] });
        queryClient.invalidateQueries({ queryKey: ['comms-board'] });
    };

    const sendFreeform = useMutation({
        mutationFn: async (body: string) => {
            const res = await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                // 'via' picks the transport. A coexistence number cannot go through Twilio, so
                // omitting this would silently send from the wrong number.
                body: JSON.stringify({ to: card.phoneNumber, body, via: activeSender?.transport ?? 'twilio' }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Send failed (${res.status})`);
            return res.json();
        },
        onSuccess: () => { setInput(''); setError(null); refresh(); },
        onError: (e: Error) => setError(e.message),
    });

    const sendQuick = useMutation({
        mutationFn: async (reply: QuickReply) => {
            const res = await fetch(`/api/quick-replies/${reply.id}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ phone: card.phoneNumber, via: activeSender?.transport ?? 'twilio' }),
            });
            const detail = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(detail.error === 'OUTSIDE_WINDOW' ? detail.message : detail.error || 'Send failed');
            return detail;
        },
        onSuccess: () => { setShowQuick(false); setInput(''); setError(null); refresh(); },
        onError: (e: Error) => setError(e.message),
    });

    // With the window shut only template-backed replies can be delivered.
    const usableQuickReplies = useMemo(() => {
        const all = quickReplies ?? [];
        const usable = card.windowOpen ? all : all.filter((r) => r.contentSid);
        const q = input.trim().toLowerCase();
        if (!q.startsWith('/')) return usable;
        return usable.filter((r) => r.shortcut?.toLowerCase().startsWith(q) || r.label.toLowerCase().includes(q.slice(1)));
    }, [quickReplies, input, card.windowOpen]);

    // Voice notes: record in the browser, server transcodes to OGG/Opus and sends.
    // Voice is freeform-only (no template can carry audio), so it's gated on the window.
    const [recording, setRecording] = useState(false);
    const [recordSeconds, setRecordSeconds] = useState(0);
    const [sendingVoice, setSendingVoice] = useState(false);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    async function startRecording() {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const rec = new MediaRecorder(stream);
            chunksRef.current = [];
            rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            rec.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop());
                const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
                if (blob.size < 2000) return; // a fumbled tap, not a message
                setSendingVoice(true);
                try {
                    const form = new FormData();
                    form.append('audio', blob, 'note.webm');
                    form.append('to', card.phoneNumber);
                    const res = await fetch('/api/whatsapp/voice-note', {
                        method: 'POST', headers: getAuthHeaders(), body: form,
                    });
                    const detail = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(detail.message || detail.error || 'Voice note failed');
                    refresh();
                } catch (e: any) {
                    setError(e.message);
                } finally {
                    setSendingVoice(false);
                }
            };
            rec.start();
            recorderRef.current = rec;
            setRecording(true);
            setRecordSeconds(0);
            timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
        } catch {
            setError('Microphone unavailable — check browser permissions.');
        }
    }

    function stopRecording() {
        recorderRef.current?.stop();
        recorderRef.current = null;
        setRecording(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }

    useEffect(() => () => { // don't leave the mic running if the panel unmounts mid-recording
        recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
    }, []);

    const sending = sendFreeform.isPending || sendQuick.isPending || sendingVoice;

    return (
        <aside className="flex w-[440px] shrink-0 flex-col border-l border-slate-200 bg-white">
            <header className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
                <div className="min-w-0">
                    <h2 className="truncate text-base font-bold text-slate-900">{displayName(card)}</h2>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="tabular-nums">{card.displayPhone}</span>
                        <ChannelIcons channels={card.channels} />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {card.windowOpen ? (
                        <span className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold uppercase text-white">
                            {card.windowHoursLeft}h window
                        </span>
                    ) : (
                        <span className="rounded bg-slate-200 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">
                            Template only
                        </span>
                    )}
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
                </div>
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
                {isLoading ? (
                    <div className="flex h-full items-center justify-center text-slate-400">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
                    </div>
                ) : !(data?.timeline?.length ?? data?.messages?.length) ? (
                    <p className="py-10 text-center text-sm text-slate-400">No messages yet</p>
                ) : (
                    <>
                        {data.truncated && (
                            <p className="rounded bg-slate-200 px-2 py-1 text-center text-[11px] text-slate-600">
                                Showing the latest {data.messages.length} of {data.totalMessages.toLocaleString()} messages
                            </p>
                        )}
                        {(data.timeline ?? data.messages).map((item) => {
                            // Calls sit inline as full-width events — they are context around the
                            // conversation, not turns in it, so they are never bubbles.
                            if (item.kind === 'call') return <CallEventRow key={item.id} call={item} />;
                            const m = item;
                            const meta = CHANNEL_META[m.channel];
                            const Icon = meta?.icon;
                            const failed = m.status === 'failed' || m.status === 'undelivered';
                            return (
                                <div key={m.id} className={cn('flex', m.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                                    <div className={cn(
                                        'max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                                        m.direction === 'outbound'
                                            ? failed ? 'bg-red-600 text-white rounded-br-sm' : 'bg-emerald-600 text-white rounded-br-sm'
                                            : 'border border-slate-200 bg-white text-slate-800 rounded-bl-sm'
                                    )}>
                                        {m.mediaUrl && (
                                            (m.mediaType ?? '').startsWith('video/') || m.type === 'video' ? (
                                                <video src={m.mediaUrl} controls preload="metadata" className="mb-1.5 max-h-72 max-w-full rounded-lg" />
                                            ) : (m.mediaType ?? '').startsWith('audio/') || m.type === 'audio' ? (
                                                <audio src={m.mediaUrl} controls preload="metadata" className="mb-1.5 w-56 max-w-full" />
                                            ) : (
                                                // Click opens the original — Ben zooms into job photos constantly.
                                                <a href={m.mediaUrl} target="_blank" rel="noreferrer">
                                                    <img src={m.mediaUrl} alt="" loading="lazy" className="mb-1.5 max-h-72 max-w-full rounded-lg" />
                                                </a>
                                            )
                                        )}
                                        {!!m.content?.trim() && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                                        <div className={cn(
                                            'mt-1 flex items-center justify-end gap-1 text-[10px]',
                                            m.direction === 'outbound' ? 'opacity-80' : 'text-slate-400'
                                        )}>
                                            {/* Channel on every bubble — in a merged thread you must be able to
                                                tell at a glance whether something went by WhatsApp or SMS. */}
                                            {Icon && <Icon className="h-2.5 w-2.5" aria-label={meta.label} />}
                                            <span>{timeLabel(m.createdAt)}</span>
                                            {m.direction === 'outbound' && <DeliveryTick status={m.status} />}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={bottomRef} />
                    </>
                )}
            </div>

            {/* The agent's pending work on this thread: questions it's blocked on, then drafts
                awaiting approval. Above the composer so a decision is never below the fold. */}
            {((data?.questions?.length ?? 0) > 0 || (data?.drafts?.length ?? 0) > 0) && (
                <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3">
                    {data!.questions?.map((q) => <AskBenCard key={q.id} q={q} onDone={refresh} />)}
                    {data!.drafts?.map((d) => (
                        <DraftApprovalCard key={d.id} draft={d} windowOpen={card.windowOpen} onDone={refresh} />
                    ))}
                </div>
            )}

            <div className="border-t border-slate-200 p-3">
                {/* Only shown when there is genuinely a choice to make. */}
                {senders.length > 1 && (
                    <div className="mb-2 flex items-center gap-2 text-xs">
                        <span className="text-slate-500">From</span>
                        <select
                            value={senderId}
                            onChange={(e) => setSenderId(e.target.value)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
                        >
                            {senders.map((s) => (
                                <option key={s.id} value={s.id} disabled={!s.available}>
                                    {s.displayPhone} — {s.label}{s.available ? '' : ' (unavailable)'}
                                </option>
                            ))}
                        </select>
                        {activeSender?.note && (
                            <span className="truncate text-[11px] text-slate-400">{activeSender.note}</span>
                        )}
                    </div>
                )}

                {!card.windowOpen && (
                    <div className="mb-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span><strong>WhatsApp window closed.</strong> Only an approved template can be delivered until they message again.</span>
                    </div>
                )}
                {error && (
                    <div className="mb-2 flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="flex-1">{error}</span>
                        <button onClick={() => setError(null)}><X className="h-3.5 w-3.5" /></button>
                    </div>
                )}
                {showQuick && (
                    <div className="mb-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200">
                        {usableQuickReplies.length === 0 ? (
                            <p className="p-3 text-center text-xs text-slate-500">
                                {card.windowOpen ? 'No quick replies match.' : 'No template-backed replies available.'}
                            </p>
                        ) : usableQuickReplies.map((r) => (
                            <button
                                key={r.id}
                                disabled={sending}
                                onClick={() => sendQuick.mutate(r)}
                                className="w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50 disabled:opacity-50"
                            >
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold text-slate-900">{r.label}</span>
                                    {r.shortcut && <code className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">{r.shortcut}</code>}
                                    {r.contentSid && <span className="rounded bg-emerald-600 px-1 text-[9px] font-bold uppercase text-white">Template</span>}
                                </div>
                                <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{renderBody(r.body, card.contactName)}</p>
                            </button>
                        ))}
                    </div>
                )}
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowQuick((v) => !v)}
                        title="Quick replies (type / to filter)"
                        className={cn('rounded-lg border px-2.5 transition-colors',
                            showQuick ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-500 hover:text-slate-800')}
                    >
                        <Zap className="h-4 w-4" />
                    </button>
                    <input
                        value={input}
                        onChange={(e) => { setInput(e.target.value); if (e.target.value.startsWith('/')) setShowQuick(true); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && input.trim() && card.windowOpen) sendFreeform.mutate(input.trim()); }}
                        disabled={sending || !card.windowOpen}
                        placeholder={recording ? `Recording… ${recordSeconds}s — tap ■ to send` : card.windowOpen ? 'Reply, or / for quick replies…' : 'Window closed — use a template'}
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    <button
                        onClick={() => (recording ? stopRecording() : startRecording())}
                        disabled={(sending && !recording) || !card.windowOpen}
                        title={card.windowOpen ? (recording ? 'Stop and send' : 'Record a voice note') : 'Window closed — voice notes need an open window'}
                        className={cn('rounded-lg px-3 transition-colors',
                            recording ? 'animate-pulse bg-red-600 text-white'
                            : 'border border-slate-300 text-slate-500 hover:text-slate-800 disabled:opacity-40')}
                    >
                        {sendingVoice ? <Loader2 className="h-4 w-4 animate-spin" /> : recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </button>
                    <button
                        onClick={() => input.trim() && sendFreeform.mutate(input.trim())}
                        disabled={!input.trim() || sending || !card.windowOpen}
                        className="rounded-lg bg-emerald-600 px-3 text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
                    >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                </div>
            </div>
        </aside>
    );
}

// ---------------------------------------------------------------- page

export default function CommsPage() {
    const queryClient = useQueryClient();
    const [activeId, setActiveId] = useState<string | null>(null);
    const [selected, setSelected] = useState<BoardCard | null>(null);
    const [search, setSearch] = useState('');
    const [onlyUnanswered, setOnlyUnanswered] = useState(false);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

    const { data, isLoading, error } = useQuery<BoardResponse>({
        queryKey: ['comms-board'],
        queryFn: async () => {
            const res = await fetch('/api/inbox/board?limit=400', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to load board');
            return res.json();
        },
        refetchInterval: 30_000,
    });

    // Keep the open thread's header in sync with board refreshes (window countdown, unread).
    useEffect(() => {
        if (!selected || !data) return;
        const fresh = Object.values(data.columns).flat().find((c) => c.id === selected.id);
        if (fresh && JSON.stringify(fresh) !== JSON.stringify(selected)) setSelected(fresh);
    }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

    const move = useMutation({
        mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
            const res = await fetch(`/api/inbox/conversations/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ stage }),
            });
            if (!res.ok) throw new Error('Failed to move');
            return res.json();
        },
        onMutate: async ({ id, stage }) => {
            await queryClient.cancelQueries({ queryKey: ['comms-board'] });
            const previous = queryClient.getQueryData<BoardResponse>(['comms-board']);
            if (previous) {
                const columns: Record<string, BoardCard[]> = {};
                let moved: BoardCard | undefined;
                for (const [s, cards] of Object.entries(previous.columns)) {
                    columns[s] = cards.filter((c) => (c.id === id ? ((moved = c), false) : true));
                }
                if (moved) columns[stage] = [{ ...moved, stage }, ...(columns[stage] ?? [])];
                queryClient.setQueryData(['comms-board'], { ...previous, columns });
            }
            return { previous };
        },
        onError: (_e, _v, ctx) => { if (ctx?.previous) queryClient.setQueryData(['comms-board'], ctx.previous); },
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['comms-board'] }),
    });

    const filtered = useMemo(() => {
        if (!data) return null;
        const q = search.trim().toLowerCase();
        const columns: Record<string, BoardCard[]> = {};
        for (const [stage, cards] of Object.entries(data.columns)) {
            columns[stage] = cards.filter((c) => {
                if (onlyUnanswered && !c.wait.awaitingReply) return false;
                if (!q) return true;
                return (c.contactName || '').toLowerCase().includes(q)
                    || c.displayPhone.includes(q)
                    || (c.lastMessagePreview || '').toLowerCase().includes(q);
            });
        }
        return columns;
    }, [data, search, onlyUnanswered]);

    const activeCard = useMemo(
        () => (activeId && data ? Object.values(data.columns).flat().find((c) => c.id === activeId) ?? null : null),
        [activeId, data]
    );

    function onDragEnd(e: DragEndEvent) {
        setActiveId(null);
        const id = String(e.active.id);
        const stage = e.over ? String(e.over.id) : null;
        if (!stage || !data) return;
        const current = Object.values(data.columns).flat().find((c) => c.id === id);
        if (!current || current.stage === stage) return;
        move.mutate({ id, stage });
    }

    async function openThread(card: BoardCard) {
        setSelected(card);
        if (card.unreadCount > 0) {
            fetch(`/api/inbox/conversations/${card.id}/read`, { method: 'POST', headers: getAuthHeaders() })
                .then(() => queryClient.invalidateQueries({ queryKey: ['comms-board'] }))
                .catch(() => {});
        }
    }

    if (isLoading) {
        return <div className="flex h-64 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading comms…
        </div>;
    }
    if (error || !data || !filtered) {
        return <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Couldn't load comms. {(error as Error)?.message}
        </div>;
    }

    return (
        <div className="flex h-[calc(100vh-4rem)] flex-col">
            <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-3 pt-4">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                        <MessageCircle className="h-5 w-5" /> Comms
                    </h1>
                    <p className="text-xs text-slate-500">
                        WhatsApp, SMS and web enquiries in one thread per person. SLA is {data.slaWorkingHours} working hours.
                    </p>
                </div>
                <div className="flex items-center gap-5">
                    <Stat label="Unanswered" value={data.totals.awaitingReply} tone={data.totals.awaitingReply > 0 ? 'red' : 'green'} big />
                    {(data.totals.pendingDrafts ?? 0) > 0 && (
                        <Stat label="To approve" value={data.totals.pendingDrafts!} tone="red" big />
                    )}
                    {(data.totals.openQuestions ?? 0) > 0 && (
                        <Stat label="Agent asking" value={data.totals.openQuestions!} tone="red" big />
                    )}
                    <Stat label="Conversations" value={data.totals.conversations} />
                    <Stat label="Windows open" value={data.totals.windowsOpen} tone="green" />
                </div>
            </div>

            {data.totals.awaitingReply > 0 && (
                <div className="mx-5 mb-3 flex items-center gap-2 rounded-lg border-l-4 border-red-600 bg-red-50 px-4 py-2 text-sm text-red-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                        <strong>{data.totals.awaitingReply}</strong> {data.totals.awaitingReply === 1 ? 'person has' : 'people have'} messaged
                        and had no reply. Newest enquiry first — those are the ones still worth winning.
                    </span>
                </div>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-3 px-5">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search name, number or message…"
                        className="w-72 rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-slate-500 focus:outline-none"
                    />
                </div>
                <button
                    onClick={() => setOnlyUnanswered((v) => !v)}
                    className={cn('rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                        onlyUnanswered ? 'border-red-600 bg-red-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400')}
                >
                    Unanswered only
                </button>
            </div>

            <div className="flex min-h-0 flex-1">
                <DndContext
                    sensors={sensors}
                    onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
                    onDragEnd={onDragEnd}
                >
                    <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto px-5 pb-4">
                        {data.stages.map((stage) => (
                            <Column
                                key={stage}
                                stage={stage}
                                cards={filtered[stage] ?? []}
                                selectedId={selected?.id ?? null}
                                onOpen={openThread}
                            />
                        ))}
                    </div>
                    <DragOverlay>
                        {activeCard && (
                            <div className="w-[264px] rotate-2">
                                <Card card={activeCard} selected={false} onOpen={() => {}} />
                            </div>
                        )}
                    </DragOverlay>
                </DndContext>

                {selected && <ThreadPanel card={selected} onClose={() => setSelected(null)} />}
            </div>
        </div>
    );
}

function Stat({ label, value, tone, big }: { label: string; value: number; tone?: 'green' | 'red'; big?: boolean }) {
    const toneClass = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-900';
    return (
        <div className="text-right">
            <div className={cn('font-bold tabular-nums leading-none', big ? 'text-3xl' : 'text-xl', toneClass)}>{value}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
        </div>
    );
}
