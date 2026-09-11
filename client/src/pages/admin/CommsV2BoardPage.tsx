/**
 * Ben's desk, kanban style (Goal 2 of the clean-sheet comms desk rebuild). One column per
 * Contract 2 stage, read from GET /api/comms-v2/board. Held cards float to the top of their
 * column with the hold reason and approver visible; a tap opens the file read-only and, when
 * held, the release form (Contract 2's release: the signed-in approver and their words, enforced
 * by the case file itself, not here).
 *
 * Not polished, just visible and operable: it doubles as the window onto the sandbox while the
 * rest of the desk is built, so the header carries a control that starts a sandbox thread and
 * sends the next customer message through the board's own sandbox door. Polls every fifteen
 * seconds; no websockets.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Loader2, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

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
}

export interface Board {
    stages: readonly Stage[];
    columns: Record<Stage, BoardCard[]>;
}

export interface Turn {
    id: string;
    at: string;
    channel: string;
    direction: 'inbound' | 'outbound';
    kind: string;
    body: string;
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

export function BoardCardView({ card, onOpen }: { card: BoardCard; onOpen: () => void }) {
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
                <Badge variant={card.mode === 'live' ? 'default' : 'secondary'} className="shrink-0 text-[10px] uppercase">{card.mode}</Badge>
            </div>
            {(card.jobType || card.location) && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                    {card.jobType ?? 'job not yet known'}{card.location ? ` · ${card.location}` : ''}
                </p>
            )}
            {card.lastCustomerMessage && (
                <p className="mt-2 line-clamp-2 text-xs italic text-muted-foreground">&ldquo;{card.lastCustomerMessage}&rdquo;</p>
            )}
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {relativeTime(card.lastCustomerMessageAt ?? card.openedAt)}</span>
                {card.replyChannel && <span>{CHANNEL_LABEL[card.replyChannel] ?? card.replyChannel}</span>}
            </div>
        </button>
    );
}

// ---------------------------------------------------------------- column

export function BoardColumn({ stage, cards, onOpenCard }: { stage: Stage; cards: BoardCard[]; onOpenCard: (id: string) => void }) {
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
                    <p className="py-6 text-center text-xs text-muted-foreground/60">No case files</p>
                ) : (
                    cards.map((card) => <BoardCardView key={card.id} card={card} onOpen={() => onOpenCard(card.id)} />)
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- release form

export function ReleaseForm({ fileId, holdReason, holdApprover, holdApproverAssigned, draft, onReleased }: {
    fileId: string;
    holdReason: string;
    holdApprover: string;
    holdApproverAssigned: boolean;
    draft: string | null;
    onReleased: () => void;
}) {
    const [words, setWords] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

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

// ---------------------------------------------------------------- case file detail

export function CaseFileDetailView({ fileId, onReleased }: { fileId: string; onReleased: () => void }) {
    const { data, isLoading, error } = useQuery<CaseFileDetail>({
        queryKey: ['comms-v2-case-file', fileId],
        queryFn: async () => {
            const res = await fetch(`/api/comms-v2/case-files/${fileId}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`Failed to load case file (${res.status})`);
            return res.json();
        },
    });

    if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    if (error || !data) return <p className="text-sm text-red-600">Could not load this case file.</p>;

    return (
        <div className="space-y-4">
            <div>
                <p className="text-sm font-semibold">{data.party?.name || data.party?.address || 'Unknown'}</p>
                <p className="text-xs text-muted-foreground">{data.party?.role} · {STAGE_LABELS[data.stage]} · {data.mode}</p>
                {(data.job.type || data.job.location) && (
                    <p className="mt-1 text-xs text-muted-foreground">{data.job.type ?? 'job unknown'}{data.job.location ? ` · ${data.job.location}` : ''}</p>
                )}
            </div>

            {data.hold && (
                <ReleaseForm
                    fileId={data.id}
                    holdReason={data.hold.reason}
                    holdApprover={data.hold.approver.id}
                    holdApproverAssigned={data.holdApproverAssigned}
                    draft={data.hold.draft}
                    onReleased={onReleased}
                />
            )}

            <div>
                <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
                    <MessageSquare className="h-3 w-3" /> Turns
                </h4>
                <ul className="space-y-2">
                    {data.turns.map((t) => (
                        <li
                            key={t.id}
                            className={cn(
                                'rounded-md border px-2 py-1.5 text-sm',
                                t.direction === 'inbound' ? 'bg-background' : 'ml-6 bg-primary/5',
                            )}
                        >
                            <p>{t.body}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">{t.channel} · {relativeTime(t.at)}</p>
                        </li>
                    ))}
                </ul>
            </div>

            {data.facts.length > 0 && (
                <div>
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

export function FilterBar({ filters, onChange }: { filters: BoardFilters; onChange: (f: BoardFilters) => void }) {
    return (
        <div className="flex items-center gap-2">
            <Button
                size="sm"
                variant={filters.heldOnly ? 'default' : 'outline'}
                onClick={() => onChange({ ...filters, heldOnly: !filters.heldOnly })}
            >
                Held only
            </Button>
            {(['all', 'sandbox', 'live'] as const).map((m) => (
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
    const [openCardId, setOpenCardId] = useState<string | null>(null);

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
                    <h1 className="text-xl font-bold tracking-tight">Comms Desk v2 - Board</h1>
                    <p className="text-xs text-muted-foreground">{total} case file{total === 1 ? '' : 's'} · sandbox window onto the clean-sheet desk</p>
                </div>
                <FilterBar filters={filters} onChange={setFilters} />
                <div className="w-full border-t pt-3">
                    <SandboxThreadControl onChanged={refresh} />
                </div>
            </div>

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
                            />
                        ))}
                    </div>
                </div>
            )}

            <Sheet open={!!openCardId} onOpenChange={(open) => !open && setOpenCardId(null)}>
                <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
                    <SheetHeader>
                        <SheetTitle>Case file</SheetTitle>
                        <SheetDescription>Turns and facts, read-only.</SheetDescription>
                    </SheetHeader>
                    {openCardId && <div className="mt-4"><CaseFileDetailView fileId={openCardId} onReleased={handleReleased} /></div>}
                </SheetContent>
            </Sheet>
        </div>
    );
}
