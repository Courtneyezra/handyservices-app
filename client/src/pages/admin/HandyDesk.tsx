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
 * A quote waiting to be priced (answer Q12) is a card below the holds, oldest draft first - a person
 * waiting on a reply is never pushed down the list by a draft nobody has priced. Those come from the
 * price queue's own cached query (`usePriceQueue`), not from /queue, so the 15-second hold poll never
 * runs that database read; `withReadyToPrice` merges the two. It is not a
 * hold, so it puts no conversation on the right: tapping the card - anywhere on it, or its one
 * "Open & price" pill - opens Price and Send for that quote (/admin/price/:slug, PriceAndSendPage in
 * client/src/App.tsx), which this page neither replaces nor changes.
 *
 * The column reads from two independent queries, so what it may say is decided once from both of
 * their states (`needsYouView` in client/src/lib/handy-desk-queue.ts) rather than per element. React
 * Query keeps the last good payload when a refetch fails, so each read has a distinct "failed with
 * nothing" and "failed but the last payload is still on screen"; no cell below is unreachable,
 * because the desk sits open all day and both loading rows happen on every cold tab:
 *
 *   holds        | quotes      | count  | listed                     | empty state      | alert
 *   -------------|-------------|--------|----------------------------|------------------|------------------------
 *   loading      | loading     | hidden | spinner                    | -                | -
 *   loading      | ok          | hidden | spinner                    | -                | -
 *   loading      | err, none   | hidden | spinner                    | -                | quotes unread
 *   loading      | err, stale  | hidden | spinner                    | -                | quotes out of date
 *   ok           | loading     | hidden | holds, quotes loading      | -                | -
 *   ok           | ok          | SHOWN  | holds, then quotes         | "Nothing needs you." | -
 *   ok           | err, none   | hidden | holds only                 | "No held replies..." | quotes unread
 *   ok           | err, stale  | SHOWN  | holds, retained quotes     | "Nothing needs you." | quotes out of date
 *   err, none    | loading     | hidden | queue error                | -                | -
 *   err, none    | ok          | hidden | queue error, quotes below  | -                | -
 *   err, none    | err, none   | hidden | queue error                | -                | quotes unread
 *   err, none    | err, stale  | hidden | queue error, quotes below  | -                | quotes out of date
 *   err, stale   | loading     | hidden | retained holds, quotes loading | -            | holds out of date
 *   err, stale   | ok          | SHOWN  | retained holds, then quotes| "Nothing needs you." | holds out of date
 *   err, stale   | err, none   | hidden | retained holds only        | -                | holds out of date; quotes unread
 *   err, stale   | err, stale  | SHOWN  | both retained              | "Nothing needs you." | holds and quotes out of date
 *
 * The count appears only where both reads have a payload the desk can stand behind - a retained one
 * counts, being at most one poll old and what is on the screen - and "Nothing needs you." only where
 * both have a payload and both are empty. A read that failed with its last payload still listed is
 * called out of date, never unread, so no alert ever contradicts the cards beneath it.
 *
 * Selecting a card sets the selected conversation (`DeskSelection`): the answer surface opens that
 * customer's thread (client/src/components/comms-v2/ThreadView.tsx, B4), with the held draft and
 * Ben's own reply, docked on the right at 1024px and up and as a bottom sheet below; the ask bar
 * takes it as context. A ready-to-price card has no conversation, so it selects nothing. The sheet is
 * its own open state, so dismissing it leaves the card selected and the ask bar's context with it;
 * "Ask about this" in its header closes it back onto the ask bar. The thread's half-written reply is
 * the page's, kept per case file, so an answer taking the right-hand side never eats it. The mapping
 * from a held file to the card's copy lives in client/src/lib/handy-desk-queue.ts.
 *
 * The ask bar (T2) asks the new desk's ask agent (/api/comms-v2/ask, useAskSession); while it runs
 * the answer surface shows the thinking card, then the answer, until Ben closes it. With no ask on
 * screen, the right-hand side shows the newest answer on the person's newest session until a card is
 * selected or the answer is closed; then a selected card shows its thread. Both answers render in
 * the one AnswerCard, whose body (client/src/components/handy-desk/AnswerSurface.tsx, T3) carries
 * the typed surface and confirm.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MoreHorizontal } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useOldComms } from '@/hooks/useOldComms';
import { useAskSession } from '@/hooks/useAskSession';
import { cn } from '@/lib/utils';
import { AnswerCard } from '@/components/handy-desk/AnswerCard';
import { AskBar } from '@/components/handy-desk/AskBar';
import type { AskMessageDTO, AskVia, OpsSessionDTO } from '@shared/ops-types';
import { ThreadSheet, ThreadView } from '@/components/comms-v2/ThreadView';
import { useIsWideBoard } from '@/hooks/useIsWideBoard';
import { exchangeOfAnswered, latestAnswered, type AnsweredAsk } from '@/lib/handy-desk-answer';
import {
    ACTION_ROUTE, QUEUE_KEY, isReadyToPrice, isShutWindow, needsWords, needsYouView, queueCardCopy, queueQuery, readStateOf, readyToPriceCardCopy, refusalMessage, selectionOf,
    type DeskQueue, type DeskSelection, type QueueAction, type QueueItem, type ReadyToPriceItem,
} from '@/lib/handy-desk-queue';
import { usePriceQueue } from '@/hooks/usePriceQueue';
import { Link, useLocation } from 'wouter';
import { QuickLinks } from '@/components/layout/QuickLinks';
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
// sidebar's destinations and Log out, itself. The badge is counted off the page's own queue read, not
// a second one: `useHeldCount` is for the admin shell, which has no queue data of its own.
function DeskHeader({ sandbox, handled, deskLive, heldCount, updatedAt }: {
    sandbox: boolean;
    handled: number | null;
    deskLive: boolean | null;
    heldCount: number | null;
    updatedAt: number;
}) {
    const [location] = useLocation();
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

// ---------------------------------------------------------------- ready-to-price card

export function ReadyToPriceCard({ item }: { item: ReadyToPriceItem }) {
    const copy = readyToPriceCardCopy(item);
    const [, navigate] = useLocation();
    // A held card's tap selects the conversation; this card has none, so the whole card goes where Ben
    // can act on it - Price and Send for this quote (/admin/price/:slug), a big enough tap target on a
    // phone. The pill is that same destination as a real link, the keyboard's way in, so it keeps its
    // own click from firing the card's.
    const open = () => navigate(copy.primary.href);
    return (
        <article
            data-testid={`queue-card-${item.id}`}
            onClick={open}
            className="cursor-pointer rounded-3xl border border-slate-800 bg-[#111c33] p-4 transition-colors duration-200 ease-[var(--ease-out)] hover:border-amber-400 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-[240ms]"
        >
            <div className="flex w-full items-center gap-3 text-left">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-white">{copy.initials}</span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-white">{copy.name}</span>
                    {copy.sub && <span className="block truncate text-xs text-slate-400">{copy.sub}</span>}
                </span>
            </div>
            <p data-testid={`queue-card-badge-${item.id}`} className={cn(EYEBROW, 'mt-3 text-slate-300')}>{copy.badge}</p>
            <p data-testid={`queue-card-body-${item.id}`} className="mt-2 text-[13px] text-slate-300">{copy.body}</p>
            <div className="mt-4 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                <Link href={copy.primary.href} className={PILL_PRIMARY}>{copy.primary.label}</Link>
            </div>
        </article>
    );
}

// ---------------------------------------------------------------- latest answer

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
    const [sheetOpen, setSheetOpen] = useState(false);
    // The thread's half-written reply, kept per case file so an ask answer taking the right-hand side never eats it.
    const [threadWords, setThreadWords] = useState<Record<string, string>>({});
    const [done, setDone] = useState<{ key: number; note: string }[]>([]);
    const [askText, setAskText] = useState('');
    const [showAnswer, setShowAnswer] = useState(false);
    const askSession = useAskSession();
    const exchange = askSession.exchange;
    // Every answer put away; `FIRST_LOAD` stands for the answer a card selected before the first load puts away.
    const [dismissed, setDismissed] = useState<ReadonlySet<string | typeof FIRST_LOAD>>(() => new Set());
    const dismiss = (id: string | typeof FIRST_LOAD) => setDismissed((d) => (d.has(id) ? d : new Set(d).add(id)));
    const wide = useIsWideBoard();
    const askInput = useRef<HTMLInputElement>(null);

    const { data, isError, dataUpdatedAt } = useQuery<DeskQueue>({
        queryKey: QUEUE_KEY,
        queryFn: async () => {
            const res = await fetch(queueQuery(), { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`Failed to load the queue (${res.status})`);
            return res.json();
        },
        refetchInterval: QUEUE_REFETCH_MS,
    });
    // The quotes to price come off the price queue's own cached query, on its slower clock: this
    // page must not put that database read behind the 15-second hold poll.
    const prices = usePriceQueue();
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

    const sandbox = data?.sandboxAvailable === true;
    // Two reads answer at different speeds and fail independently, so everything the column says -
    // the count, the cards, the empty sentence and every alert - is decided once from both of their
    // states (handy-desk-queue.ts `needsYouView`). Nothing below re-reads the queries.
    const view = needsYouView(
        { state: readStateOf({ isError, data }), items: data?.items ?? [] },
        { state: readStateOf(prices), payload: prices.data },
    );
    const canAct = data?.viewer?.canAct !== false;
    const viewerApprover = data?.viewer?.approver ?? null;
    const refreshQueue = () => queryClient.invalidateQueries({ queryKey: QUEUE_KEY });

    const handleHandled = (note: string) => {
        setDone((d) => [{ key: Date.now(), note }, ...d].slice(0, 3));
        queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
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
        setSheetOpen(!wide);
        if (latest === undefined) dismiss(FIRST_LOAD);
        else if (latest) dismiss(latest.id);
    };

    // The desk is the whole screen (no admin shell around it), so the ask bar stays in view without scrolling.
    return (
        <div data-testid="handy-desk" className="flex h-dvh flex-col overflow-hidden bg-slate-900 font-sans">
            <DeskHeader
                sandbox={sandbox}
                handled={data?.handledToday ?? null}
                deskLive={oldComms ? oldComms.retired : null}
                heldCount={view.heldCount}
                updatedAt={dataUpdatedAt}
            />

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(300px,400px)_1fr] lg:overflow-hidden">
                <section aria-label="Needs you" className="flex min-h-0 flex-col px-4 py-5 sm:px-6 lg:overflow-y-auto">
                    <p className={cn(EYEBROW, 'text-amber-400')}>Needs you</p>
                    {view.countText && (
                        <p data-testid="handy-desk-count" className="mt-1 text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-white">
                            {view.countText}
                        </p>
                    )}
                    <p className="mt-1 text-[13px] text-slate-400">Held replies first, longest wait in working hours; then the quotes to price, oldest first.</p>
                    {view.alerts.map((alert) => (
                        <p
                            key={alert.id}
                            role="alert"
                            data-testid={`handy-desk-alert-${alert.id}`}
                            className={cn('mt-2 text-xs', alert.tone === 'error' ? 'text-red-300' : 'text-amber-300')}
                        >
                            {alert.text}
                        </p>
                    ))}

                    <div className="mt-5 space-y-3">
                        {view.showSpinner && (
                            <div data-testid="handy-desk-loading" className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
                        )}
                        {view.items.map((item) => isReadyToPrice(item) ? (
                            <ReadyToPriceCard key={item.id} item={item} />
                        ) : (
                            <QueueCard
                                key={item.id}
                                item={item}
                                active={item.id === selection?.caseFileId}
                                showMode={sandbox}
                                onSelect={() => select(item)}
                                onHandled={handleHandled}
                            />
                        ))}
                        {view.quotesLoading && (
                            <p data-testid="handy-desk-quotes-loading" className="flex items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading the quotes to price…
                            </p>
                        )}
                        {view.emptyText && (
                            <p data-testid="handy-desk-empty" className="rounded-3xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
                                {view.emptyText}
                            </p>
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
                        ) : selection && wide ? (
                            <section data-testid="handy-desk-thread" className="h-[min(760px,calc(100vh-14rem))] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.08)]">
                                <ThreadView
                                    key={selection.caseFileId}
                                    fileId={selection.caseFileId}
                                    layout="panel"
                                    backTo="Queue"
                                    words={threadWords[selection.caseFileId] ?? ''}
                                    onWords={(w) => setThreadWords((kept) => ({ ...kept, [selection.caseFileId]: w }))}
                                    fallbackName={selection.name}
                                    onClose={() => setSelection(null)}
                                    onChanged={refreshQueue}
                                    canAct={canAct}
                                    viewerApprover={viewerApprover}
                                    showMode={sandbox}
                                />
                            </section>
                        ) : (
                            <p data-testid="handy-desk-idle" className="py-16 text-center text-sm text-slate-500">Pick something from the queue to see its conversation.</p>
                        )}
                    </div>
                    <AskBar
                        inputRef={askInput}
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
            {!wide && (
                <ThreadSheet
                    fileId={sheetOpen ? selection?.caseFileId ?? null : null}
                    backTo="Queue"
                    words={selection ? threadWords[selection.caseFileId] ?? '' : ''}
                    onWords={(w) => selection && setThreadWords((kept) => ({ ...kept, [selection.caseFileId]: w }))}
                    fallbackName={selection?.name}
                    onClose={() => setSheetOpen(false)}
                    onAskAbout={() => askInput.current?.focus()}
                    onChanged={refreshQueue}
                    canAct={canAct}
                    viewerApprover={viewerApprover}
                    showMode={sandbox}
                />
            )}
        </div>
    );
}
