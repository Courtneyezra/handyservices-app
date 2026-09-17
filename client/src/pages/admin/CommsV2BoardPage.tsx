/**
 * Ben's comms board (Goal 2 of the clean-sheet comms desk rebuild), recreated from the Handy Desk
 * mock-up with a Kanban / Floor toggle (the views are `@/components/comms-board/BoardViews`). One
 * column per Contract 2 stage, read from GET /api/comms-v2/board. It renders full screen, outside
 * the admin shell, under the same slim header as the Handy Desk. Cards carry scanning information
 * only, held ones floating to the top of their column in amber. A tap opens the customer's thread
 * (client/src/components/comms-v2/ThreadView.tsx, Handy Desk B4), WhatsApp style: a panel over the
 * board's right edge at 1024px and up, a full-screen sheet below, with the customer's links, the
 * held draft, Ben's own reply, release and the shut-window template send. A session the server says holds no approver slot (`viewer.canAct`) sees the thread
 * without its actions.
 *
 * Below both, Close file (POST /case-files/:id/close): Ben closes a file by hand, with optional words
 * for the file, after a second tap to confirm. The file moves to Done under his name, a hold on it is
 * released by the same rule as the release form, and the customer's next message opens a new file.
 *
 * It doubles as the window onto the sandbox while the rest of the desk is built, so the header
 * carries a control that starts a sandbox thread and sends the next customer message through the
 * board's own sandbox door. The board itself polls every fifteen seconds; no websockets.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ThreadSheet, ThreadView } from '@/components/comms-v2/ThreadView';
import { cn } from '@/lib/utils';
import { FullScreenHeader } from '@/components/layout/FullScreenHeader';
import { useIsWideBoard } from '@/lib/handy-desk-path';
import { boardCounts, defaultPhoneTab, type HoldException, type PhoneTab, type Stage } from '@/lib/comms-board';
import {
    BoardEmpty, BoardError, BoardFloor, BoardKanban, BoardPhone, BoardSkeleton, HeldOnlyButton, ModeSwitch,
    ReadOnlyNotice, ViewToggle, type BoardView,
} from '@/components/comms-board/BoardViews';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------- shapes (mirror server/comms-v2/api/board.ts)

export { relativeTime, STAGE_LABELS, STAGES } from '@/lib/comms-board';
export type { Stage } from '@/lib/comms-board';

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
    /** The router exception that raised the hold, when one did; null otherwise (server/comms-v2/api/board.ts, always sent). */
    holdException?: HoldException | null;
    /** The hold carries a draft the desk held back: the card's "Draft ready" dot (always sent). */
    hasDraft?: boolean;
    /** Office working hours since the hold was raised; null when nothing is held (always sent). */
    waitingWorkingHours?: number | null;
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
    /** The approver slot this session occupies, and whether it holds one at all (server/comms-v2/api/routes.ts `viewerOf`). */
    viewer?: BoardViewer;
}

export interface BoardViewer {
    approver: string | null;
    canAct: boolean;
}

export interface TurnMedia {
    id: string;
    kind: 'image' | 'video';
    mime: string;
    url: string | null;
    /** Set once the desk has described the photo or video (server/comms-v2/desk/case-file.ts `MediaDescriptionRecord`). */
    description?: { description: string; confidence: 'low' | 'medium' | 'high' } | null;
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
    hold: {
        approver: { kind: string; id: string };
        reason: string;
        since: string;
        draft: string | null;
        /** The router exception that raised the hold, when one did. */
        exception?: string | null;
        /** The guard failures, when a guard hold raised it. */
        failures?: string[];
        /** Whether a second reason has been added to the card since it was raised. */
        notedOn?: boolean;
    } | null;
    holdApproverAssigned: boolean;
    /** The channel a reply from the thread would go on (desk/human-reply.ts `replyRouteOf`); null with `replyRefusal` when none can be routed. */
    replyChannel?: 'whatsapp' | 'sms' | 'email' | null;
    /** That channel's window: WhatsApp's 24-hour window open until `closesAt`, or shut; any other channel is open with no closing time. */
    replyWindow?: { state: 'open' | 'shut'; reason: string; closesAt: string | null } | null;
    /** Why no reply can be routed, in the send's own words. */
    replyRefusal?: string | null;
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

// ---------------------------------------------------------------- sandbox thread control

/**
 * Starts a sandbox thread, or sends the next customer message on the open one, through the board's
 * own sandbox door (POST /api/comms-v2/sandbox/start and /message). Start clears the door, so the
 * board shows one sandbox thread at a time, the one being watched.
 */
const SANDBOX_INPUT = 'mt-0.5 min-h-9 rounded-full border border-slate-700 bg-slate-900 px-3 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none';
const SANDBOX_BUTTON = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-600 px-3.5 text-xs font-semibold text-white transition-colors duration-200 ease-[var(--ease-out)] hover:border-amber-400 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50';

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
                <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400" htmlFor="sandbox-name">Customer</label>
                <input id="sandbox-name" value={name} onChange={(e) => setName(e.target.value)} className={cn(SANDBOX_INPUT, 'w-24')} />
            </div>
            <div className="min-w-64 flex-1">
                <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400" htmlFor="sandbox-text">Customer says</label>
                <input
                    id="sandbox-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Hi, can I get a quote for a leaking tap?"
                    className={cn(SANDBOX_INPUT, 'w-full')}
                />
            </div>
            <button type="button" className={SANDBOX_BUTTON} disabled={!!busy || !text.trim()} onClick={() => post('start')}>
                {busy === 'start' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Start sandbox thread
            </button>
            <button type="button" className={SANDBOX_BUTTON} disabled={!!busy || !text.trim()} onClick={() => post('message')}>
                {busy === 'message' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Send as customer
            </button>
            {error && <p className="w-full text-xs text-red-300">{error}</p>}
        </div>
    );
}

// ---------------------------------------------------------------- page

/**
 * The comms board (B3): header controls, then Kanban or Floor on a laptop and one column at a time
 * on a phone, over GET /api/comms-v2/board polled every fifteen seconds. A card or token opens the
 * file in a panel over the board at 1024px and up, in a full-screen sheet below.
 */
export default function CommsV2BoardPage() {
    const queryClient = useQueryClient();
    const [filters, setFilters] = useState<BoardFilters>({ heldOnly: false, mode: 'all' });
    const [view, setView] = useState<BoardView>('kanban');
    const [phoneTab, setPhoneTab] = useState<PhoneTab | null>(null);
    const [openCardId, setOpenCardId] = useState<string | null>(null);
    const wide = useIsWideBoard();
    // The phone has no Held only button: its Held chip is that filter, over the whole board.
    const query = wide ? filters : { ...filters, heldOnly: false };

    const { data, isLoading, error, dataUpdatedAt, refetch, isFetching, isPlaceholderData } = useQuery<Board>({
        queryKey: ['comms-v2-board', query],
        queryFn: async () => {
            const res = await fetch(boardQuery(query), { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`Failed to load board (${res.status})`);
            return res.json();
        },
        refetchInterval: 15_000,
        // A filter change keeps the previous board on screen, dimmed and marked busy, while the new
        // one loads. TanStack only uses it while the new fetch is pending, so a failed fetch for this
        // filter shows the error, never another filter's cards.
        placeholderData: (previous) => previous,
    });

    const counts = useMemo(() => boardCounts(data), [data]);
    // Fails towards hiding: only a confirmed `true` from the server (live-database.ts's
    // commsV2DatabaseCheck) shows sandbox-only controls; missing, loading or errored data hides them.
    const sandboxAvailable = data?.sandboxAvailable === true;
    const tab = phoneTab ?? defaultPhoneTab(data);

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['comms-v2-board'] });
        queryClient.invalidateQueries({ queryKey: ['comms-v2-case-file'] });
    };
    const canAct = data?.viewer?.canAct !== false;
    const viewerApprover = data?.viewer?.approver ?? null;
    const closeThread = () => setOpenCardId(null);

    let body: ReactNode;
    if (!data) {
        body = isLoading ? <BoardSkeleton /> : <div className="flex-1" />;
    } else if (counts.total === 0) {
        body = <BoardEmpty heldOnly={query.heldOnly} onShowAll={() => setFilters({ ...filters, heldOnly: false })} />;
    } else if (!wide) {
        body = <BoardPhone board={data} tab={tab} onTab={setPhoneTab} onOpenCard={setOpenCardId} showMode={sandboxAvailable} />;
    } else if (view === 'floor') {
        body = <BoardFloor board={data} onOpenCard={setOpenCardId} />;
    } else {
        body = <BoardKanban board={data} onOpenCard={setOpenCardId} showMode={sandboxAvailable} />;
    }

    // The board is the whole screen (no admin shell around it, client/src/App.tsx), like the Handy Desk.
    return (
        <div data-testid="comms-board" className="flex h-dvh flex-col overflow-hidden bg-slate-900 font-sans">
            <FullScreenHeader title="Comms board" logoTestId="comms-board-logo">
                <div className="ml-auto">{wide && <ViewToggle view={view} onChange={setView} />}</div>
            </FullScreenHeader>
            <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-slate-800 px-4 py-3 sm:px-6">
                {wide && <HeldOnlyButton on={filters.heldOnly} onToggle={() => setFilters({ ...filters, heldOnly: !filters.heldOnly })} />}
                {sandboxAvailable && <ModeSwitch mode={filters.mode} onChange={(mode) => setFilters({ ...filters, mode })} />}
                <p data-testid="board-counts" className="ml-auto text-xs text-slate-400">
                    {data ? `${counts.total} open file${counts.total === 1 ? '' : 's'} · ${counts.held} held` : '…'}
                </p>
                {sandboxAvailable && (
                    <div className="w-full border-t border-slate-800 pt-3">
                        <SandboxThreadControl onChanged={refresh} />
                    </div>
                )}
            </div>
            {!canAct && <ReadOnlyNotice />}
            {error && <BoardError lastGoodAt={data ? dataUpdatedAt : null} onRetry={() => { void refetch(); }} retrying={isFetching} />}

            <div className="relative flex min-h-0 flex-1">
                <div
                    data-testid="board-body"
                    aria-busy={isPlaceholderData || undefined}
                    className={cn('flex min-w-0 flex-1 flex-col transition-opacity duration-200', isPlaceholderData && 'opacity-60')}
                >
                    {body}
                </div>
                {wide && openCardId && (
                    // Over the board's right edge, only while a file is open; the cards it leaves uncovered still open theirs.
                    <aside
                        data-testid="thread-panel"
                        aria-label="Conversation"
                        className="absolute inset-y-0 right-0 flex w-[440px] max-w-full flex-col overflow-hidden border-l border-slate-800 bg-white shadow-[-12px_0_32px_rgba(2,6,23,0.45)] motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:fade-in-0 motion-safe:duration-200"
                    >
                        {/* Keyed by the open file so a cached conversation never inherits the last one's typed words or send state. */}
                        <ThreadView key={openCardId} fileId={openCardId} layout="panel" onClose={closeThread} onChanged={refresh} canAct={canAct} viewerApprover={viewerApprover} showMode={sandboxAvailable} />
                    </aside>
                )}
            </div>

            {!wide && (
                <ThreadSheet fileId={openCardId} onClose={closeThread} onChanged={refresh} canAct={canAct} viewerApprover={viewerApprover} showMode={sandboxAvailable} />
            )}
        </div>
    );
}
