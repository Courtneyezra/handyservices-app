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
 * The ask bar (T2) asks the new desk's ask agent (/api/comms-v2/ask, useAskSession); while it runs
 * the answer surface shows the thinking card, then the answer, until Ben closes it. With no ask on
 * screen, the right-hand side shows the newest answer on the person's newest session until a card is
 * selected or the answer is closed; a selected card shows its thread through the same `thread`
 * renderer (client/src/lib/handy-desk-answer.ts). Both answers render in the one AnswerCard, whose
 * body (client/src/components/handy-desk/AnswerSurface.tsx, T3) carries the typed surface and confirm.
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MoreHorizontal } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useOldComms } from '@/hooks/useOldComms';
import { useAskSession } from '@/hooks/useAskSession';
import { cn } from '@/lib/utils';
import { AnswerCard } from '@/components/handy-desk/AnswerCard';
import { AskBar } from '@/components/handy-desk/AskBar';
import type { AskMessageDTO, AskVia, OpsSessionDTO } from '@shared/ops-types';
import { SurfaceBody } from '@/components/handy-desk/AnswerSurface';
import type { CaseFileDetail } from '@/pages/admin/CommsV2BoardPage';
import { exchangeOfAnswered, latestAnswered, threadSurfaceOfDetail, type AnsweredAsk } from '@/lib/handy-desk-answer';
import {
    ACTION_ROUTE, isShutWindow, needsWords, queueCardCopy, queueQuery, refusalMessage, selectionOf,
    type DeskQueue, type DeskSelection, type QueueAction, type QueueItem,
} from '@/lib/handy-desk-queue';
import { useLocation } from 'wouter';
import { QuickLinks, useHeldCount } from '@/components/layout/QuickLinks';
import handyLogo from '@/assets/handy-logo.webp';

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

const AdminNavMenu = lazy(() => import('@/components/layout/AdminNavMenu'));

function DeskMoreMenu() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);
    return (
        <div className="relative">
            <button
                type="button"
                data-testid="desk-more-button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={cn('flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors', open ? 'bg-slate-800 text-amber-400' : 'text-slate-300 hover:bg-slate-800 hover:text-white')}
            >
                <MoreHorizontal className="h-4 w-4" /> More
            </button>
            {open && (
                <>
                    <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-2 rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
                        <Suspense fallback={<Loader2 className="m-4 h-4 w-4 animate-spin text-slate-400" />}>
                            <AdminNavMenu onNavigate={() => setOpen(false)} />
                        </Suspense>
                    </div>
                </>
            )}
        </div>
    );
}

// The desk renders full screen outside the admin shell (client/src/App.tsx), so this header carries
// the Handy Services logo, the shell's quick links with their held-count badge, and a More menu of the
// sidebar's destinations and Log out, itself.
function DeskHeader({ sandbox, handled, deskLive }: { sandbox: boolean; handled: number | null; deskLive: boolean | null }) {
    const [location] = useLocation();
    const { heldCount, updatedAt } = useHeldCount(true);
    return (
        <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-800 px-4 py-2 sm:px-6">
            <img data-testid="handy-desk-logo" src={handyLogo} alt="Handy Services" width={32} height={32} className="h-8 w-8 shrink-0 rounded-full object-cover" />
            <h1 className="text-lg font-extrabold tracking-[-0.02em] text-white">Handy Desk</h1>
            <div className="order-last w-full overflow-x-auto md:order-none md:w-auto">
                <QuickLinks variant="desk" location={location} heldCount={heldCount} updatedAt={updatedAt} />
            </div>
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
                <DeskMoreMenu />
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

    const surface = threadSurfaceOfDetail(data);
    return (
        <section data-testid="handy-desk-thread" className="rounded-3xl bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.08)]">
            <p className={cn(EYEBROW, 'mb-4 text-slate-500')}>Thread · {selection.name}</p>
            <SurfaceBody surface={{ ...surface, customerName: surface.customerName ?? selection.name }} speakerNames={data.speakerNames} />
        </section>
    );
}

/**
 * The newest answer on the signed-in person's newest ask session (GET /api/comms-v2/ask/sessions,
 * then the session). Read only: the page never opens a session; the ask bar does. Polled like the
 * queue, so an answer given anywhere shows here within fifteen seconds.
 */
function useLatestAnswer() {
    return useQuery<AnsweredAsk | null>({
        queryKey: ['comms-v2-ask-latest'],
        queryFn: async () => {
            const list = await fetch('/api/comms-v2/ask/sessions?limit=1', { headers: getAuthHeaders() });
            if (!list.ok) throw new Error(`Failed to load ask sessions (${list.status})`);
            const sessions: OpsSessionDTO[] = await list.json();
            if (!sessions[0]) return null;
            const res = await fetch(`/api/comms-v2/ask/sessions/${encodeURIComponent(sessions[0].id)}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`Failed to load the ask session (${res.status})`);
            const body: { messages: AskMessageDTO[] } = await res.json();
            return latestAnswered(body.messages ?? []);
        },
        refetchInterval: QUEUE_REFETCH_MS,
    });
}

// ---------------------------------------------------------------- page

const FIRST_LOAD = Symbol('first answer load');

export default function HandyDesk() {
    const queryClient = useQueryClient();
    const [selection, setSelection] = useState<DeskSelection | null>(null);
    const [done, setDone] = useState<{ key: number; note: string }[]>([]);
    const [askText, setAskText] = useState('');
    const [showAnswer, setShowAnswer] = useState(false);
    const askSession = useAskSession();
    const exchange = askSession.exchange;
    // Every answer put away; `FIRST_LOAD` stands for the answer a card selected before the first load puts away.
    const [dismissed, setDismissed] = useState<ReadonlySet<string | typeof FIRST_LOAD>>(() => new Set());
    const dismiss = (id: string | typeof FIRST_LOAD) => setDismissed((d) => (d.has(id) ? d : new Set(d).add(id)));

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
    const { data: latest } = useLatestAnswer();
    useEffect(() => {
        if (!dismissed.has(FIRST_LOAD) || latest === undefined) return;
        const next = new Set(dismissed);
        next.delete(FIRST_LOAD);
        if (latest) next.add(latest.id);
        setDismissed(next);
    }, [dismissed, latest]);
    const answered = latest && !dismissed.has(FIRST_LOAD) && !dismissed.has(latest.id) ? latest : null;

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

    // Closing the asked answer puts that answer away, so a later read of the newest answer does not bring it back.
    const closeAsked = () => {
        setShowAnswer(false);
        const shown = exchange?.answer?.id;
        if (shown) dismiss(shown);
    };

    const select = (item: QueueItem) => {
        setSelection(selectionOf(item));
        if (latest === undefined) dismiss(FIRST_LOAD);
        else if (latest) dismiss(latest.id);
    };

    // The desk is the whole screen (no admin shell around it), so the ask bar stays in view without scrolling.
    return (
        <div data-testid="handy-desk" className="flex h-dvh flex-col overflow-hidden bg-slate-900 font-sans">
            <DeskHeader sandbox={sandbox} handled={data?.handledToday ?? null} deskLive={oldComms ? oldComms.retired : null} />

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
                                    onSelect={() => select(item)}
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
                            <AnswerCard exchange={exchange} onClose={closeAsked} onChange={setAskText} onConfirmed={handleHandled} />
                        ) : answered ? (
                            <AnswerCard
                                key={answered.id}
                                exchange={exchangeOfAnswered(answered)}
                                onClose={() => dismiss(answered.id)}
                                onChange={answered.ask?.text ? setAskText : undefined}
                                onConfirmed={handleHandled}
                            />
                        ) : selection ? (
                            <SelectedThread key={selection.caseFileId} selection={selection} />
                        ) : (
                            <p data-testid="handy-desk-idle" className="py-16 text-center text-sm text-slate-500">Pick something from the queue to see its conversation.</p>
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
