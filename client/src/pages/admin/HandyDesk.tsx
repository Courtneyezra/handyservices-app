/**
 * Handy Desk (T1 of the captain's Claude Design handoff): the "Needs you" queue beside a light
 * answer surface. The queue is every held case file on the new desk (GET /api/comms-v2/queue,
 * server/comms-v2/api/queue.ts), longest office working-hours wait first, polled every fifteen
 * seconds like the board. The old desk (/api/desk) is not read.
 *
 * A card's buttons are the board's own human-send routes (POST /api/comms-v2/case-files/:id/...):
 * "Send as is" is send-held-draft, "Rewrite" and "Answer in words" are answer with Ben's words, and
 * "Release" (under "More" on a card with no draft) is release with his words for the file. The server decides who may act; whatever it
 * refuses is shown on the card as it said it, and a shut WhatsApp window offers the template reply
 * the board offers.
 *
 * Selecting a card sets the selected conversation (`DeskSelection`): the answer surface shows its
 * thread while idle, and the ask bar takes it as context. The mapping from a held file to the
 * card's copy lives in client/src/lib/handy-desk-queue.ts.
 *
 * The Today strip (B6, TodayStrip) sits under the header and opens the diary.
 *
 * The ask bar (T2) asks the new desk's ask agent (/api/comms-v2/ask, useAskSession); while it runs
 * the answer surface shows the thinking card, then the answer (AnswerCard), until Ben closes it.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useOldComms } from '@/hooks/useOldComms';
import { useAskSession } from '@/hooks/useAskSession';
import { cn } from '@/lib/utils';
import { AnswerCard } from '@/components/handy-desk/AnswerCard';
import { AskBar } from '@/components/handy-desk/AskBar';
import { TodayStrip } from '@/components/handy-desk/TodayStrip';
import type { AskVia } from '@shared/ops-types';
import type { CaseFileDetail, Turn } from '@/pages/admin/CommsV2BoardPage';
import {
    ACTION_ROUTE, isShutWindow, needsWords, queueCardCopy, queueQuery, refusalMessage, selectionOf,
    type DeskQueue, type DeskSelection, type QueueAction, type QueueItem,
} from '@/lib/handy-desk-queue';

const QUEUE_REFETCH_MS = 15_000;

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function post(fileId: string, route: string, body?: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
        const res = await fetch(`/api/comms-v2/case-files/${fileId}/${route}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.ok) return { ok: true };
        const data = await res.json().catch(() => ({}));
        return { ok: false, message: refusalMessage(res.status, data?.error) };
    } catch (e: any) {
        return { ok: false, message: e?.message || 'Could not reach the desk' };
    }
}

const EYEBROW = 'text-[10px] font-bold uppercase tracking-[0.1em]';
const PILL = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-5 text-sm font-semibold transition-colors duration-200 ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-50';
const PILL_PRIMARY = cn(PILL, 'bg-amber-400 text-slate-900 hover:bg-amber-300');
const PILL_SECONDARY = cn(PILL, 'border border-slate-600 text-white hover:border-amber-400 hover:text-amber-400');

// ---------------------------------------------------------------- header

function DeskHeader({ sandbox, handled, deskLive }: { sandbox: boolean; handled: number | null; deskLive: boolean | null }) {
    return (
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-800 px-4 sm:px-6">
            <span aria-hidden className="h-7 w-7 rounded-lg bg-amber-400" />
            <h1 className="text-lg font-extrabold tracking-[-0.02em] text-white">Handy Desk</h1>
            {sandbox && (
                <span data-testid="handy-desk-sandbox" className={cn(EYEBROW, 'rounded-full border border-amber-400/60 px-2.5 py-1 text-amber-400')}>Sandbox</span>
            )}
            <div className="ml-auto flex items-center gap-3">
                {handled !== null && (
                    <span data-testid="handy-desk-handled" title="Turns answered today, by the desk or a person" className="hidden text-xs text-slate-400 sm:inline">{handled} handled</span>
                )}
                {deskLive !== null && (
                    // Read-only: whether the new desk is the live desk (GET /api/comms-v2/old-comms). Switching it is the cutover runbook, not a tap here.
                    <span
                        data-testid="handy-desk-status"
                        title="Whether the new desk is the live desk. Switched by the cutover runbook, not here."
                        className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold', deskLive ? 'bg-amber-400 text-slate-900' : 'border border-slate-600 text-slate-300')}
                    >
                        <span aria-hidden className={cn('h-2 w-2 rounded-full', deskLive ? 'bg-slate-900' : 'bg-slate-500')} />
                        Desk {deskLive ? 'on' : 'off'}
                    </span>
                )}
            </div>
        </header>
    );
}

// ---------------------------------------------------------------- queue card

export function QueueCard({ item, active, showMode, onSelect, onHandled }: {
    item: QueueItem;
    active: boolean;
    showMode: boolean;
    onSelect: () => void;
    onHandled: (note: string) => void;
}) {
    const copy = queueCardCopy(item);
    const [composing, setComposing] = useState<QueueAction | null>(null);
    const [words, setWords] = useState('');
    const [busy, setBusy] = useState<QueueAction | 'template' | null>(null);
    const [moreOpen, setMoreOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [templateError, setTemplateError] = useState<string | null>(null);
    const disabled = !!copy.blocked || busy !== null;

    const run = async (action: QueueAction) => {
        if (needsWords(action) && composing !== action) {
            setComposing(action);
            setError(null);
            return;
        }
        setBusy(action);
        setError(null);
        setTemplateError(null);
        const result = await post(item.id, ACTION_ROUTE[action], needsWords(action) ? { words: words.trim() } : undefined);
        setBusy(null);
        if (!result.ok) { setError(result.message); return; }
        onHandled(action === 'release' ? `Released ${copy.name}` : `Sent to ${copy.name}`);
    };

    const sendTemplate = async () => {
        setBusy('template');
        setTemplateError(null);
        const result = await post(item.id, 'send-template');
        setBusy(null);
        if (!result.ok) { setTemplateError(result.message); return; }
        onHandled(`Template reply sent to ${copy.name}`);
    };

    return (
        <article
            data-testid={`queue-card-${item.id}`}
            aria-current={active ? 'true' : undefined}
            onClick={onSelect}
            className={cn(
                'cursor-pointer rounded-3xl border bg-[#111c33] p-4 transition-colors duration-200 ease-[var(--ease-out)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-[240ms]',
                active ? 'border-amber-400 bg-amber-400/10' : 'border-slate-800 hover:border-amber-400',
            )}
        >
            <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(); }} className="flex w-full items-center gap-3 text-left">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-slate-900">{copy.initials}</span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-white">{copy.name}</span>
                    {copy.sub && <span data-testid={`queue-card-sub-${item.id}`} className="block truncate text-xs text-slate-400">{copy.sub}</span>}
                </span>
                {showMode && <span className={cn(EYEBROW, 'shrink-0 text-slate-500')}>{item.mode}</span>}
            </button>
            <p data-testid={`queue-card-badge-${item.id}`} className={cn(EYEBROW, 'mt-3 text-amber-400')}>{copy.badge}</p>
            {copy.body && <p className="mt-2 line-clamp-3 text-[13px] text-slate-300">&ldquo;{copy.body}&rdquo;</p>}
            {item.benToRequest.length > 0 && (
                <p className="mt-2 text-xs text-slate-400"><span className="font-semibold text-slate-300">Ask for:</span> {item.benToRequest.join(', ')}</p>
            )}
            {copy.draft && (
                <div data-testid={`queue-card-draft-${item.id}`} className="mt-3 rounded-[14px] bg-white/5 px-3 py-2">
                    <p className={cn(EYEBROW, 'text-slate-400')}>The desk's draft</p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-200">{copy.draft}</p>
                </div>
            )}
            {copy.blocked && <p data-testid={`queue-card-blocked-${item.id}`} className="mt-3 text-xs text-amber-200/80">{copy.blocked}</p>}

            {composing && (
                <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                    <label className="sr-only" htmlFor={`queue-words-${item.id}`}>
                        {composing === 'release' ? 'Your words, for the file' : 'Your reply to the customer'}
                    </label>
                    <Textarea
                        id={`queue-words-${item.id}`}
                        value={words}
                        onChange={(e) => setWords(e.target.value)}
                        rows={3}
                        placeholder={composing === 'release' ? 'What was checked, and why this is released' : 'Your words go out as written, from you.'}
                        className="rounded-[14px] border-slate-700 bg-slate-900 text-sm text-white placeholder:text-slate-500"
                    />
                </div>
            )}

            {error && <p role="alert" data-testid={`queue-card-error-${item.id}`} className="mt-3 text-xs text-red-300">{error}</p>}
            {isShutWindow(error) && (
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    {templateError && <p role="alert" data-testid={`queue-card-template-error-${item.id}`} className="mb-2 text-xs text-red-300">{templateError}</p>}
                    <button type="button" className={PILL_SECONDARY} disabled={busy !== null} onClick={sendTemplate}>
                        {busy === 'template' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Send a template reply
                    </button>
                </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                {composing ? (
                    <>
                        <button type="button" className={PILL_PRIMARY} disabled={disabled || !words.trim()} onClick={() => run(composing)}>
                            {busy === composing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {composing === 'release' ? 'Release hold' : 'Send as me'}
                        </button>
                        <button type="button" className={PILL_SECONDARY} disabled={busy !== null} onClick={() => { setComposing(null); setError(null); }}>Cancel</button>
                    </>
                ) : (
                    <>
                        <button type="button" className={PILL_PRIMARY} disabled={disabled} onClick={() => run(copy.primary.action)}>
                            {busy === copy.primary.action && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {copy.primary.label}
                        </button>
                        {copy.secondary ? (
                            <button type="button" className={PILL_SECONDARY} disabled={disabled} onClick={() => run(copy.secondary!.action)}>
                                {copy.secondary.label}
                            </button>
                        ) : copy.more.length > 0 && (
                            <button type="button" className={PILL_SECONDARY} disabled={disabled} aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
                                More
                            </button>
                        )}
                    </>
                )}
            </div>
            {!composing && moreOpen && (
                <div className="mt-2 flex flex-wrap gap-3" onClick={(e) => e.stopPropagation()}>
                    {copy.more.map((b) => (
                        <button key={b.action} type="button" className="min-h-11 text-sm font-semibold text-slate-300 underline-offset-4 hover:text-amber-400 hover:underline disabled:opacity-50" disabled={disabled} onClick={() => { setMoreOpen(false); run(b.action); }}>
                            {b.label}
                        </button>
                    ))}
                </div>
            )}
        </article>
    );
}

// ---------------------------------------------------------------- answer surface (idle: the selected thread)

function timeOf(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

function whoOf(turn: Turn, customer: string, speakerNames: Record<string, string> = {}): { label: string; desk: boolean } {
    if (turn.direction === 'inbound') return { label: customer, desk: false };
    if (turn.approver?.startsWith('human:')) {
        const login = turn.approver.slice('human:'.length);
        return { label: speakerNames[login.toLowerCase()] || login.split('@')[0] || 'Staff', desk: true };
    }
    return { label: 'Desk', desk: true };
}

function SelectedThread({ selection }: { selection: DeskSelection }) {
    const { data, isLoading, error } = useQuery<CaseFileDetail>({
        queryKey: ['comms-v2-case-file', selection.caseFileId],
        queryFn: async () => {
            const res = await fetch(`/api/comms-v2/case-files/${selection.caseFileId}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`Failed to load conversation (${res.status})`);
            return res.json();
        },
        refetchInterval: QUEUE_REFETCH_MS,
    });

    if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
    if (error || !data) return <p className="text-sm text-red-600">Could not load this conversation.</p>;

    return (
        <section data-testid="handy-desk-thread" className="rounded-3xl bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.08)]">
            <p className={cn(EYEBROW, 'text-slate-500')}>Thread · {selection.name}</p>
            <ol className="mt-4 space-y-3">
                {data.turns.map((t) => {
                    const who = whoOf(t, selection.name, data.speakerNames);
                    return (
                        <li key={t.id} className="grid grid-cols-[70px_1fr] gap-3 text-sm">
                            <span className="pt-0.5 text-xs tabular-nums text-slate-400">{timeOf(t.at)}</span>
                            <div className="min-w-0">
                                <p className={cn(EYEBROW, who.desk ? 'text-amber-500' : 'text-slate-400')}>{who.label}</p>
                                <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{t.call ? (t.call.summary ?? t.call.headline) : t.body}</p>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

// ---------------------------------------------------------------- page

export default function HandyDesk() {
    const queryClient = useQueryClient();
    const [selection, setSelection] = useState<DeskSelection | null>(null);
    const [done, setDone] = useState<{ key: number; note: string }[]>([]);
    const [askText, setAskText] = useState('');
    const [showAnswer, setShowAnswer] = useState(false);
    const askSession = useAskSession();
    const exchange = askSession.exchange;

    const { data, isLoading, error } = useQuery<DeskQueue>({
        queryKey: ['comms-v2-queue'],
        queryFn: async () => {
            const res = await fetch(queueQuery(), { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`Failed to load the queue (${res.status})`);
            return res.json();
        },
        refetchInterval: QUEUE_REFETCH_MS,
    });
    const { data: oldComms } = useOldComms();

    const items = data?.items ?? [];
    const sandbox = data?.sandboxAvailable === true;

    const handleHandled = (note: string) => {
        setDone((d) => [{ key: Date.now(), note }, ...d].slice(0, 3));
        queryClient.invalidateQueries({ queryKey: ['comms-v2-queue'] });
        queryClient.invalidateQueries({ queryKey: ['comms-v2-case-file'] });
    };

    const ask = async (text: string, via: AskVia) => {
        const ok = await askSession.ask(text, via, selection);
        if (ok) setShowAnswer(true);
        return ok;
    };

    // Height leaves out the layout's 64px header and its scroll container's p-4 / lg:p-8
    // padding, top and bottom, so the ask bar stays in view without scrolling.
    return (
        <div data-testid="handy-desk" className="flex h-[calc(100vh-6rem)] flex-col lg:h-[calc(100vh-8rem)] overflow-hidden bg-slate-900 font-sans">
            <DeskHeader sandbox={sandbox} handled={data?.handledToday ?? null} deskLive={oldComms ? oldComms.retired : null} />
            <TodayStrip />

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(300px,400px)_1fr] lg:overflow-hidden">
                <section aria-label="Needs you" className="flex min-h-0 flex-col px-4 py-5 sm:px-6 lg:overflow-y-auto">
                    <p className={cn(EYEBROW, 'text-amber-400')}>Needs you</p>
                    <p data-testid="handy-desk-count" className="mt-1 text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-white">
                        {isLoading ? '…' : `${items.length} ${items.length === 1 ? 'thing' : 'things'}`}
                    </p>
                    <p className="mt-1 text-[13px] text-slate-400">Held by the desk, longest wait in working hours first.</p>

                    <div className="mt-5 space-y-3">
                        {error ? (
                            <p role="alert" className="rounded-3xl border border-red-400/40 p-4 text-sm text-red-300">Could not load the queue - retrying automatically.</p>
                        ) : isLoading ? (
                            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
                        ) : items.length === 0 ? (
                            <p data-testid="handy-desk-empty" className="rounded-3xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Nothing needs you.</p>
                        ) : (
                            items.map((item) => (
                                <QueueCard
                                    key={item.id}
                                    item={item}
                                    active={item.id === selection?.caseFileId}
                                    showMode={sandbox}
                                    onSelect={() => setSelection(selectionOf(item))}
                                    onHandled={handleHandled}
                                />
                            ))
                        )}
                        {done.map((d) => (
                            <p key={d.key} data-testid="handy-desk-done" className="flex items-center gap-2 rounded-3xl border border-slate-800 p-4 text-sm text-slate-300">
                                <Check className="h-4 w-4 text-green-500" /> {d.note}
                            </p>
                        ))}
                    </div>
                </section>

                <section aria-label="Answer" className="flex min-h-[50vh] flex-col bg-slate-50 lg:min-h-0">
                    <div className="flex-1 px-4 py-6 sm:px-8 lg:overflow-y-auto">
                        {exchange && (showAnswer || exchange.live) ? (
                            <AnswerCard exchange={exchange} onClose={() => setShowAnswer(false)} />
                        ) : selection ? (
                            <SelectedThread key={selection.caseFileId} selection={selection} />
                        ) : (
                            <p className="py-16 text-center text-sm text-slate-500">Pick something from the queue to see its conversation.</p>
                        )}
                    </div>
                    <AskBar
                        selection={selection}
                        ready={!!askSession.sessionId}
                        busy={askSession.busy}
                        error={askSession.error}
                        disabledReason={askSession.sessionError}
                        onAsk={ask}
                        text={askText}
                        onText={setAskText}
                    />
                </section>
            </div>
        </div>
    );
}
