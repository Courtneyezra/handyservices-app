/**
 * B3 - the comms board's views, recreated from the Claude Design export (`Comms Board.dc.html` §2
 * for the structure, card anatomy and states; `Handy Desk.dc.html`'s board for the slate and amber
 * palette, captain's answers 94 and 95). Kanban and Floor are two renders of the same GET
 * /api/comms-v2/board response; the phone gets one column at a time and no Floor (answer 97).
 * Every card and Floor token opens the file (`onOpen`); the page decides where it opens.
 */
import { AlertTriangle, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { initialsOf, displayName } from '@/lib/handy-desk-queue';
import {
    ACCENT_STAGES, boardCounts, heldLabel, holdAge, jobLine, phoneCards, relativeTime, shortName, STAGE_LABELS, STAGES,
    type PhoneTab, type Stage,
} from '@/lib/comms-board';
import type { Board, BoardCard, BoardMode } from '@/pages/admin/CommsV2BoardPage';

export const EYEBROW = 'text-[10px] font-bold uppercase tracking-[0.1em]';
const EASE = 'transition-colors duration-200 ease-[var(--ease-out)]';
const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

export type BoardView = 'kanban' | 'floor';

// ---------------------------------------------------------------- header controls

/** A pill segment: the selected option in amber, the rest outlined on slate. */
function Segmented<T extends string>({ label, value, options, onChange, testId }: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (v: T) => void;
    testId: string;
}) {
    return (
        <div role="group" aria-label={label} data-testid={testId} className="inline-flex shrink-0 rounded-full border border-slate-700 p-[3px]">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    aria-pressed={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'min-h-8 rounded-full px-3.5 text-xs font-semibold', EASE,
                        value === o.value ? 'bg-amber-400 text-slate-900' : 'text-white hover:text-amber-400',
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function ViewToggle({ view, onChange }: { view: BoardView; onChange: (v: BoardView) => void }) {
    return (
        <Segmented
            label="Board view"
            testId="board-view-toggle"
            value={view}
            onChange={onChange}
            options={[{ value: 'kanban', label: 'Kanban' }, { value: 'floor', label: 'Floor' }]}
        />
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
            className={cn(
                'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium', EASE,
                on ? 'border-amber-400 bg-amber-400/10 text-amber-300' : 'border-slate-700 text-white hover:border-amber-400 hover:text-amber-400',
            )}
        >
            <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> Held only
        </button>
    );
}

// ---------------------------------------------------------------- card

function HeldPill({ card, nowMs }: { card: BoardCard; nowMs?: number }) {
    const label = heldLabel(card, nowMs);
    if (!label) return null;
    return (
        <span data-testid={`board-card-held-pill-${card.id}`} className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-slate-900">
            <AlertTriangle aria-hidden className="h-2.5 w-2.5" /> {label}
        </span>
    );
}

/** One file on the Kanban, and on the phone with its stage named. Held reads in amber, ring and border. */
export function BoardCardView({ card, onOpen, showMode = false, showStage = false, nowMs }: {
    card: BoardCard;
    onOpen: () => void;
    showMode?: boolean;
    showStage?: boolean;
    nowMs?: number;
}) {
    const name = displayName(card);
    const sandbox = showMode && card.mode === 'sandbox';
    return (
        <button
            type="button"
            onClick={onOpen}
            data-testid={`board-card-${card.id}`}
            data-held={card.held ? 'true' : undefined}
            className={cn(
                'flex w-full min-w-0 select-none flex-col gap-1.5 rounded-[18px] border p-3 text-left', EASE,
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
                card.held ? 'border-amber-400 bg-amber-400/10 ring-1 ring-amber-400' : 'border-slate-800 bg-[#111c33] hover:border-amber-400',
            )}
        >
            {(card.held || sandbox || showStage || (showMode && card.mode === 'live')) && (
                <span className="flex flex-wrap items-center gap-1.5">
                    <HeldPill card={card} nowMs={nowMs} />
                    {card.held && card.hasDraft && (
                        <span data-testid={`board-card-draft-${card.id}`} className="rounded-full border border-amber-400/60 px-2 py-0.5 text-[10px] font-semibold text-amber-300">Draft ready</span>
                    )}
                    {showStage && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">{STAGE_LABELS[card.stage]}</span>}
                    {showMode && (
                        <span
                            data-testid={`board-card-mode-${card.id}`}
                            className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', card.mode === 'sandbox' ? 'border border-dashed border-slate-600 text-slate-400' : 'bg-slate-800 text-slate-300')}
                        >
                            {card.mode}
                        </span>
                    )}
                </span>
            )}
            <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className={cn('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold text-slate-900', card.held ? 'bg-amber-400' : 'bg-slate-400')}>
                    {initialsOf(name)}
                </span>
                <span className="truncate text-[13px] font-bold text-white">{name}</span>
            </span>
            <span className="truncate text-[11px] text-slate-400">{jobLine(card)}</span>
            {card.held && card.holdReason && (
                <span data-testid={`board-card-hold-${card.id}`} className="border-l-2 border-amber-400/70 py-0.5 pl-2 text-[11px] leading-snug text-amber-200">
                    {card.holdReason}
                </span>
            )}
            {card.lastCustomerMessage && (
                <span className="line-clamp-2 text-xs leading-snug text-slate-300">&ldquo;{card.lastCustomerMessage}&rdquo;</span>
            )}
            {card.benToRequest.length > 0 && (
                <span data-testid={`board-card-ben-to-request-${card.id}`} className="flex flex-wrap gap-1">
                    {card.benToRequest.map((b) => (
                        <span key={b} className="rounded-full bg-slate-800 px-1.5 py-px text-[10px] text-slate-300">need {b}</span>
                    ))}
                </span>
            )}
            {card.quoteReissue && (
                <span data-testid={`board-card-reissue-${card.id}`} className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-slate-300">
                    <span className="font-semibold text-white">Quote reissued automatically:</span> {card.quoteReissue.amount} (was {card.quoteReissue.previous}),{' '}
                    {card.quoteReissue.sentAt ? `sent ${relativeTime(card.quoteReissue.sentAt, nowMs)}` : `not sent: ${card.quoteReissue.notSent ?? 'unknown'}`}
                </span>
            )}
            <span className="flex items-center justify-between gap-1.5 pt-0.5 text-[10px] font-semibold text-slate-500">
                <span className="flex items-center gap-1">
                    <MessageSquare aria-hidden className="h-3 w-3" />
                    {card.replyChannel ? CHANNEL_LABEL[card.replyChannel] ?? card.replyChannel : 'no channel'}
                </span>
                <span>{relativeTime(card.lastCustomerMessageAt ?? card.openedAt, nowMs)}</span>
            </span>
            {card.held && !card.holdApproverAssigned && (
                <span data-testid={`board-card-no-slot-${card.id}`} className="rounded-md bg-amber-400/10 px-1.5 py-1 text-[10px] text-amber-300">
                    Approver {card.holdApprover ?? 'unknown'} has no session slot
                </span>
            )}
        </button>
    );
}

// ---------------------------------------------------------------- kanban

function ColumnHeading({ stage, count }: { stage: Stage; count: number }) {
    return (
        <div className="flex items-baseline justify-between border-b border-slate-800 px-1 pb-2">
            <h3 className={cn(EYEBROW, ACCENT_STAGES.has(stage) ? 'text-amber-400' : 'text-slate-400')}>{STAGE_LABELS[stage]}</h3>
            <span className="text-xs font-bold text-white">{count}</span>
        </div>
    );
}

function ColumnEmpty({ stage }: { stage: Stage }) {
    return (
        <p className="rounded-[18px] border border-dashed border-slate-800 px-2.5 py-5 text-center text-xs text-slate-500">Nothing in {STAGE_LABELS[stage]}</p>
    );
}

export function BoardColumn({ stage, cards, onOpenCard, showMode = false, nowMs }: {
    stage: Stage;
    cards: BoardCard[];
    onOpenCard: (id: string) => void;
    showMode?: boolean;
    nowMs?: number;
}) {
    return (
        <section data-testid={`board-column-${stage}`} aria-label={STAGE_LABELS[stage]} className="flex min-w-0 flex-col gap-2.5">
            <ColumnHeading stage={stage} count={cards.length} />
            {cards.length === 0 ? <ColumnEmpty stage={stage} /> : cards.map((card) => (
                <BoardCardView key={card.id} card={card} onOpen={() => onOpenCard(card.id)} showMode={showMode} nowMs={nowMs} />
            ))}
        </section>
    );
}

export function BoardKanban({ board, onOpenCard, showMode, nowMs }: { board: Board; onOpenCard: (id: string) => void; showMode: boolean; nowMs?: number }) {
    return (
        <div data-testid="board-kanban" className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(7,minmax(150px,1fr))] items-start gap-3 overflow-auto px-5 py-5">
            {board.stages.map((stage) => (
                <BoardColumn key={stage} stage={stage} cards={board.columns[stage] ?? []} onOpenCard={onOpenCard} showMode={showMode} nowMs={nowMs} />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------- floor

/** The Floor: one bay per stage, one token per file; a held file wears the amber ring and its hold age. */
export function BoardFloor({ board, onOpenCard, nowMs }: { board: Board; onOpenCard: (id: string) => void; nowMs?: number }) {
    return (
        <div data-testid="board-floor" className="grid min-h-0 flex-1 grid-cols-[repeat(7,minmax(150px,1fr))] items-stretch gap-3 overflow-auto px-5 py-5">
            {board.stages.map((stage) => {
                const cards = board.columns[stage] ?? [];
                const accent = ACCENT_STAGES.has(stage);
                return (
                    <section
                        key={stage}
                        data-testid={`floor-bay-${stage}`}
                        aria-label={`${STAGE_LABELS[stage]} bay`}
                        className={cn(
                            'flex min-h-[260px] flex-col items-center gap-3.5 rounded-3xl px-2 py-4',
                            'bg-[linear-gradient(#1e293b_1px,transparent_1px),linear-gradient(90deg,#1e293b_1px,transparent_1px)] bg-[length:24px_24px]',
                            accent ? 'bg-amber-400/[0.08]' : 'bg-[#111c33]',
                        )}
                    >
                        <h3 className={cn(EYEBROW, accent ? 'text-amber-400' : 'text-slate-400')}>{STAGE_LABELS[stage]} · {cards.length}</h3>
                        <div className="flex flex-wrap justify-center gap-3.5">
                            {cards.map((card) => (
                                <button
                                    key={card.id}
                                    type="button"
                                    data-testid={`floor-token-${card.id}`}
                                    data-held={card.held ? 'true' : undefined}
                                    title={`${displayName(card)} · ${jobLine(card)}`}
                                    onClick={() => onOpenCard(card.id)}
                                    className="group flex w-16 flex-col items-center gap-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                                >
                                    <span
                                        aria-hidden
                                        className={cn(
                                            'flex h-11 w-11 items-center justify-center rounded-full text-[13px] font-extrabold text-slate-900', EASE,
                                            card.held ? 'bg-amber-400 shadow-[0_0_0_3px_#fbbf24]' : 'bg-slate-400 group-hover:bg-white',
                                        )}
                                    >
                                        {initialsOf(displayName(card))}
                                    </span>
                                    <span aria-hidden className="h-1 w-[22px] rounded-sm bg-slate-700" />
                                    <span className="max-w-16 truncate text-center text-[10px] font-semibold leading-tight text-slate-200">{shortName(card)}</span>
                                    <span className={cn('text-center text-[9px] font-bold', card.held ? 'text-amber-400' : 'text-slate-500')}>
                                        {card.held ? `held ${holdAge(card.holdSince, nowMs)}` : relativeTime(card.lastCustomerMessageAt ?? card.openedAt, nowMs)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------- phone

/** Below 1024px: a scrolling chip row, Held first, then one column at a time. No Floor here. */
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
    const chip = (active: boolean) => cn(
        'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium', EASE,
        active ? 'border-amber-400 bg-amber-400 text-slate-900' : 'border-slate-700 text-white',
    );
    return (
        <div data-testid="board-phone" className="flex min-h-0 flex-1 flex-col">
            <div role="tablist" aria-label="Stages" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-slate-800 px-4 py-2.5">
                <button type="button" role="tab" aria-selected={tab === 'held'} data-testid="phone-chip-held" onClick={() => onTab('held')}
                    className={cn(chip(tab === 'held'), 'font-semibold', tab !== 'held' && 'border-amber-400/60 text-amber-300')}>
                    Held · {held}
                </button>
                {board.stages.map((stage) => (
                    <button key={stage} type="button" role="tab" aria-selected={tab === stage} data-testid={`phone-chip-${stage}`} onClick={() => onTab(stage)} className={chip(tab === stage)}>
                        {STAGE_LABELS[stage]} <span className={tab === stage ? 'text-slate-700' : 'text-slate-400'}>{(board.columns[stage] ?? []).length}</span>
                    </button>
                ))}
            </div>
            <div role="tabpanel" data-testid={`phone-column-${tab}`} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
                {cards.length === 0 ? (
                    <p className="rounded-[18px] border border-dashed border-slate-800 px-2.5 py-6 text-center text-xs text-slate-500">
                        {tab === 'held' ? 'Nothing is held.' : `Nothing in ${STAGE_LABELS[tab]}`}
                    </p>
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
        <div data-testid="board-loading" aria-busy="true" aria-label="Loading the board" className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(7,minmax(150px,1fr))] gap-3 overflow-hidden px-5 py-5">
            {STAGES.map((stage, i) => (
                <div key={stage} className="flex flex-col gap-2.5">
                    <div className="border-b border-slate-800 px-1 pb-2"><p className={cn(EYEBROW, 'text-slate-500')}>{STAGE_LABELS[stage]}</p></div>
                    {Array.from({ length: i % 3 === 0 ? 2 : 1 }, (_, j) => (
                        <div key={j} className="h-24 rounded-[18px] bg-[#111c33] motion-safe:animate-pulse" />
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
                <div data-testid="board-empty-held" className="rounded-3xl border border-dashed border-amber-400/50 bg-amber-400/5 px-5 py-6">
                    <p className="text-sm font-bold text-amber-300">Nothing is waiting on you</p>
                    <p className="mt-1 text-xs text-slate-300">
                        0 held.{' '}
                        <button type="button" onClick={onShowAll} className="font-semibold text-amber-400 underline underline-offset-4 hover:text-amber-300">Show all files</button>
                    </p>
                </div>
            ) : (
                <div data-testid="board-empty" className="rounded-3xl border border-dashed border-slate-700 px-5 py-6">
                    <p className="text-sm font-bold text-white">No open files</p>
                    <p className="mt-1 text-xs text-slate-400">New enquiries appear here within 15 seconds of arriving.</p>
                </div>
            )}
        </div>
    );
}

/** A failed fetch: the last good copy stays on screen under this, and the poll keeps retrying. */
export function BoardError({ lastGoodAt, onRetry, retrying, nowMs }: { lastGoodAt: number | null; onRetry: () => void; retrying: boolean; nowMs?: number }) {
    return (
        <div role="alert" data-testid="board-error" className="mx-5 mt-4 flex items-start gap-2.5 rounded-2xl border border-red-400/40 bg-red-500/10 p-3.5">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <div className="flex flex-col gap-2">
                <p className="text-[13px] font-semibold text-red-200">Couldn't load the board</p>
                <p className="text-xs text-red-200/80">
                    {lastGoodAt ? `Showing the last good copy from ${relativeTime(new Date(lastGoodAt).toISOString(), nowMs)}. ` : ''}Retrying automatically.
                </p>
                <button
                    type="button"
                    onClick={onRetry}
                    disabled={retrying}
                    className={cn('min-h-9 self-start rounded-full border border-red-400/50 px-3.5 text-xs font-semibold text-red-200 hover:border-red-300 disabled:opacity-50', EASE)}
                >
                    Retry now
                </button>
            </div>
        </div>
    );
}

/** No approver slot for this session: the board reads, and every action on an open file is hidden. */
export function ReadOnlyNotice() {
    return (
        <div data-testid="board-read-only" className="mx-5 mt-4 rounded-2xl border border-slate-700 bg-white/5 p-3.5">
            <p className="text-[13px] font-semibold text-white">You can read this board but not act on it</p>
            <p className="mt-1 text-xs text-slate-400">No approver slot is assigned to your login. Cards open read-only; Send, Release and Answer are hidden.</p>
        </div>
    );
}
