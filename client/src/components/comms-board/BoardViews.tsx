/**
 * B3 - the comms board's views, over GET /api/comms-v2/board: Kanban on a laptop, one column at a
 * time on a phone. Plain and minimal (captain, 18 Sep 2026): plain rectangles and words, no pills,
 * avatars or icons. A card says who, how long, and on a held card why it is held; everything else is
 * in the thread a tap opens (`onOpen`), and the page decides where it opens. The Floor view is gone:
 * Kanban only (his answer, 18 Sep 2026).
 */
import { cn } from '@/lib/utils';
import { displayName } from '@/lib/handy-desk-queue';
import { channelWord } from '@/lib/comms-v2-thread';
import {
    boardCounts, cardWait, holdChip, phoneCards, relativeTime, STAGE_LABELS, STAGES,
    type PhoneTab, type Stage,
} from '@/lib/comms-board';
import type { Board, BoardCard, BoardMode } from '@/pages/admin/CommsV2BoardPage';

const EASE = 'transition-colors duration-200 ease-[var(--ease-out)]';
/** The Kanban's columns: wide enough that a name, a channel word and a wait sit on one line. */
const KANBAN_COLUMNS = 'grid-cols-[repeat(7,minmax(168px,1fr))]';

// ---------------------------------------------------------------- header controls

/** Words side by side, the chosen one white and underlined. */
function Segmented<T extends string>({ label, value, options, onChange, testId }: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (v: T) => void;
    testId: string;
}) {
    return (
        <div role="group" aria-label={label} data-testid={testId} className="inline-flex shrink-0 gap-3">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    aria-pressed={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'min-h-9 text-[13px]', EASE,
                        value === o.value ? 'text-white underline underline-offset-4' : 'text-slate-400 hover:text-white',
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function ModeSwitch({ mode, onChange }: { mode: 'all' | BoardMode; onChange: (m: 'all' | BoardMode) => void }) {
    return (
        <Segmented
            label="Live or sandbox files"
            testId="board-mode-switch"
            value={mode}
            onChange={onChange}
            options={[{ value: 'all', label: 'All' }, { value: 'live', label: 'Live' }, { value: 'sandbox', label: 'Sandbox' }]}
        />
    );
}

export function HeldOnlyButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            aria-pressed={on}
            onClick={onToggle}
            className={cn('min-h-9 shrink-0 text-[13px]', EASE, on ? 'text-amber-300 underline underline-offset-4' : 'text-slate-300 hover:text-white')}
        >
            Held only
        </button>
    );
}

// ---------------------------------------------------------------- card

/**
 * One file, on the Kanban and on the phone. A plain rectangle: the name, then on the right the
 * channel as a word only when it is not WhatsApp and the wait; a held card adds one amber line, the
 * hold's reason and "draft ready" when the desk wrote one, and wears a thin amber edge. The stage
 * joins that line where the column does not name it. The picked card is outlined.
 */
export function BoardCardView({ card, onOpen, picked = false, showMode = false, showStage = false, nowMs }: {
    card: BoardCard;
    onOpen: () => void;
    picked?: boolean;
    showMode?: boolean;
    showStage?: boolean;
    nowMs?: number;
}) {
    const name = displayName(card);
    const chip = holdChip(card);
    const channel = channelWord(card.replyChannel);
    const secondLine = chip || showStage || showMode;
    return (
        <button
            type="button"
            onClick={onOpen}
            data-testid={`board-card-${card.id}`}
            data-held={card.held ? 'true' : undefined}
            aria-pressed={picked}
            className={cn(
                'block w-full min-w-0 select-none rounded-md border px-3 py-2.5 text-left text-white', EASE,
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
                picked ? 'border-white bg-slate-800' : 'border-slate-800 bg-[#111c33] hover:border-slate-600',
                card.held && 'shadow-[inset_3px_0_0_#fbbf24]',
            )}
        >
            <span className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
                <span data-testid={`board-card-wait-${card.id}`} title={card.held ? 'How long the hold has stood' : 'Customer last wrote'} className="shrink-0 text-[11px] tabular-nums text-slate-400">
                    {channel && <span data-testid={`board-card-channel-${card.id}`}>{channel} · </span>}
                    {cardWait(card, nowMs)}
                </span>
            </span>
            {secondLine && (
                <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                    {chip && <span data-testid={`board-card-hold-${card.id}`} title={card.holdReason ?? undefined} className="text-amber-300">{chip}</span>}
                    {card.held && card.hasDraft && <span data-testid={`board-card-draft-${card.id}`} className="text-amber-300"> · draft ready</span>}
                    {showStage && <span data-testid={`board-card-stage-${card.id}`}>{chip ? ' · ' : ''}{STAGE_LABELS[card.stage]}</span>}
                    {showMode && <span data-testid={`board-card-mode-${card.id}`}>{chip || showStage ? ' · ' : ''}{card.mode}</span>}
                </span>
            )}
        </button>
    );
}

// ---------------------------------------------------------------- kanban

export function BoardColumn({ stage, cards, onOpenCard, pickedId = null, showMode = false, nowMs }: {
    stage: Stage;
    cards: BoardCard[];
    onOpenCard: (id: string) => void;
    pickedId?: string | null;
    showMode?: boolean;
    nowMs?: number;
}) {
    return (
        <section data-testid={`board-column-${stage}`} aria-label={STAGE_LABELS[stage]} className="flex min-w-0 flex-col gap-2">
            <div className="flex items-baseline justify-between border-b border-slate-800 px-0.5 pb-2 text-xs">
                <h3 className="font-medium text-slate-400">{STAGE_LABELS[stage]}</h3>
                <span className="font-semibold text-white">{cards.length}</span>
            </div>
            {cards.length === 0 ? <p className="px-0.5 text-xs text-slate-500">None</p> : cards.map((card) => (
                <BoardCardView key={card.id} card={card} onOpen={() => onOpenCard(card.id)} picked={card.id === pickedId} showMode={showMode} nowMs={nowMs} />
            ))}
        </section>
    );
}

export function BoardKanban({ board, onOpenCard, pickedId = null, showMode, nowMs }: {
    board: Board;
    onOpenCard: (id: string) => void;
    pickedId?: string | null;
    showMode: boolean;
    nowMs?: number;
}) {
    return (
        <div data-testid="board-kanban" className={cn('grid min-h-0 flex-1 auto-rows-min items-start gap-3.5 overflow-auto px-5 py-5', KANBAN_COLUMNS)}>
            {board.stages.map((stage) => (
                <BoardColumn key={stage} stage={stage} cards={board.columns[stage] ?? []} onOpenCard={onOpenCard} pickedId={pickedId} showMode={showMode} nowMs={nowMs} />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------- phone

/** Below 1024px: word tabs, Held first, then one column at a time. */
export function BoardPhone({ board, tab, onTab, onOpenCard, showMode, nowMs }: {
    board: Board;
    tab: PhoneTab;
    onTab: (t: PhoneTab) => void;
    onOpenCard: (id: string) => void;
    showMode: boolean;
    nowMs?: number;
}) {
    const { held } = boardCounts(board);
    const cards = phoneCards(board, tab);
    const tabClass = (active: boolean) => cn(
        'min-h-11 shrink-0 whitespace-nowrap border-b-2 pb-1 pt-2 text-[13px]', EASE,
        active ? 'border-white text-white' : 'border-transparent text-slate-400',
    );
    return (
        <div data-testid="board-phone" className="flex min-h-0 flex-1 flex-col">
            <div role="tablist" aria-label="Stages" className="flex shrink-0 gap-4 overflow-x-auto border-b border-slate-800 px-4">
                <button type="button" role="tab" aria-selected={tab === 'held'} data-testid="phone-chip-held" onClick={() => onTab('held')}
                    className={cn(tabClass(tab === 'held'), 'text-amber-300', tab === 'held' && 'border-amber-400')}>
                    Held {held}
                </button>
                {board.stages.map((stage) => (
                    <button key={stage} type="button" role="tab" aria-selected={tab === stage} data-testid={`phone-chip-${stage}`} onClick={() => onTab(stage)} className={tabClass(tab === stage)}>
                        {STAGE_LABELS[stage]} {(board.columns[stage] ?? []).length}
                    </button>
                ))}
            </div>
            <div role="tabpanel" data-testid={`phone-column-${tab}`} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
                {cards.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-500">{tab === 'held' ? 'Nothing is held.' : `Nothing in ${STAGE_LABELS[tab]}`}</p>
                ) : cards.map((card) => (
                    <BoardCardView key={card.id} card={card} onOpen={() => onOpenCard(card.id)} showMode={showMode} showStage={tab === 'held'} nowMs={nowMs} />
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- states

/** First fetch only: seven column headings and skeleton cards. The 15s poll after it is silent. */
export function BoardSkeleton() {
    return (
        <div data-testid="board-loading" aria-busy="true" aria-label="Loading the board" className={cn('grid min-h-0 flex-1 auto-rows-min gap-3.5 overflow-hidden px-5 py-5', KANBAN_COLUMNS)}>
            {STAGES.map((stage, i) => (
                <div key={stage} className="flex flex-col gap-2">
                    <div className="border-b border-slate-800 px-0.5 pb-2"><p className="text-xs text-slate-500">{STAGE_LABELS[stage]}</p></div>
                    {Array.from({ length: i % 3 === 0 ? 2 : 1 }, (_, j) => (
                        <div key={j} className="h-10 rounded-md bg-[#111c33] motion-safe:animate-pulse" />
                    ))}
                </div>
            ))}
        </div>
    );
}

export function BoardEmpty({ heldOnly, onShowAll }: { heldOnly: boolean; onShowAll: () => void }) {
    return (
        <div className="px-5 py-5">
            {heldOnly ? (
                <div data-testid="board-empty-held" className="rounded-md border border-slate-800 px-5 py-6">
                    <p className="text-sm font-semibold text-amber-300">Nothing is waiting on you</p>
                    <p className="mt-1 text-xs text-slate-300">
                        0 held.{' '}
                        <button type="button" onClick={onShowAll} className="font-semibold text-white underline underline-offset-4 hover:text-amber-300">Show all files</button>
                    </p>
                </div>
            ) : (
                <div data-testid="board-empty" className="rounded-md border border-slate-800 px-5 py-6">
                    <p className="text-sm font-semibold text-white">No open files</p>
                    <p className="mt-1 text-xs text-slate-400">New enquiries appear here within 15 seconds of arriving.</p>
                </div>
            )}
        </div>
    );
}

/** A failed fetch: the last good copy stays on screen under this, and the poll keeps retrying. */
export function BoardError({ lastGoodAt, onRetry, retrying, nowMs }: { lastGoodAt: number | null; onRetry: () => void; retrying: boolean; nowMs?: number }) {
    return (
        <div role="alert" data-testid="board-error" className="mx-5 mt-4 flex flex-col gap-2 rounded-md border border-red-400/40 bg-red-500/10 p-3.5">
            <p className="text-[13px] font-semibold text-red-200">Couldn't load the board</p>
            <p className="text-xs text-red-200/80">
                {lastGoodAt ? `Showing the last good copy from ${relativeTime(new Date(lastGoodAt).toISOString(), nowMs)}. ` : ''}Retrying automatically.
            </p>
            <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className={cn('min-h-9 self-start text-xs font-semibold text-red-200 underline underline-offset-4 hover:text-red-100 disabled:opacity-50', EASE)}
            >
                Retry now
            </button>
        </div>
    );
}

/** No approver slot for this session: the board reads, and every action on an open file is hidden. */
export function ReadOnlyNotice() {
    return (
        <div data-testid="board-read-only" className="mx-5 mt-4 rounded-md border border-slate-800 p-3.5">
            <p className="text-[13px] font-semibold text-white">You can read this board but not act on it</p>
            <p className="mt-1 text-xs text-slate-400">No approver slot is assigned to your login. Cards open read-only; Send, Release and Answer are hidden.</p>
        </div>
    );
}
