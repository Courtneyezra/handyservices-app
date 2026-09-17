/**
 * Handy Desk T3 - the answer surface: what the desk just did or was asked to show, as one of the
 * typed surfaces of shared/ops-types.ts (thread, diary, map, quote, ledger, floor, words), then
 * "What goes out when you confirm", then the one confirm / change footer.
 *
 * The answer is the ask agent's OpsAnswer (server/comms-v2/ask/surface.ts); every figure on it was
 * read off the new desk by the server. The confirm is the only write, and today the only action is
 * `draft.release`: POST /api/comms-v2/case-files/:id/send-held-draft, the board's human send path,
 * with the tile's draft as `expectedDraft`: a draft the desk replaced since is refused, re-read and
 * shown for another confirm. An answer from an earlier London day offers no send.
 * Whatever that refuses is shown as the desk said it, and a shut WhatsApp window offers the template
 * reply the queue card offers. AnswerCard (the one answer card the ask bar renders) shows the ask,
 * the thinking state and the reply line, then hands the answer to AnswerSurfaceBody here.
 */
import { useState } from 'react';
import { Check, Loader2, MapPin } from 'lucide-react';
import { HELD_DRAFT_CHANGED, type AnswerSurface, type OpsAnswer } from '@shared/ops-types';
import { adminAuthHeaders } from '@/hooks/usePriceQueue';
import type { CaseFileDetail } from '@/pages/admin/CommsV2BoardPage';
import { cn } from '@/lib/utils';
import { isShutWindow, refusalMessage } from '@/lib/handy-desk-queue';
import {
    CHANNEL_LABEL, STAGE_LABEL, addressLabel, ageLabel, confirmCaseFileId, confirmRequest, confirmedNote,
    diaryCellLook, expectedDraftOf, formatPence, isChangedCell, isEarlierDay, isLate, tokenOf, turnLabel, turnText,
    type DiaryCellLook,
} from '@/lib/handy-desk-answer';

const EYEBROW = 'text-[10px] font-bold uppercase tracking-[0.1em]';
const PILL = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-5 text-sm font-semibold transition-colors duration-200 ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-50';
const PILL_PRIMARY = cn(PILL, 'bg-amber-400 text-slate-900 hover:bg-amber-300');
const PILL_OUTLINE = cn(PILL, 'border border-slate-300 text-slate-700 hover:border-amber-500 hover:text-amber-700');
const RISE = 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-[240ms]';

function timeOf(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

function dayOf(iso: string): string {
    return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'Europe/London' });
}

async function post(url: string, body?: unknown): Promise<{ ok: true } | { ok: false; message: string; draftChanged?: boolean }> {
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() }, body: body === undefined ? undefined : JSON.stringify(body) });
        if (res.ok) return { ok: true };
        const data = await res.json().catch(() => ({}));
        return { ok: false, message: refusalMessage(res.status, data?.error), draftChanged: res.status === 409 && data?.error === HELD_DRAFT_CHANGED };
    } catch (e: any) {
        return { ok: false, message: e?.message || 'Could not reach the desk' };
    }
}

// ---------------------------------------------------------------- the typed bodies

function ThreadBody({ surface, speakerNames }: { surface: Extract<AnswerSurface, { type: 'thread' }>; speakerNames?: Record<string, string> }) {
    if (surface.turns.length === 0) return <p className="text-sm text-slate-500">No turns on this file yet.</p>;
    return (
        <ol data-testid="surface-thread" className="space-y-3">
            {surface.turns.map((t) => {
                const who = turnLabel(t, surface.customerName, speakerNames);
                return (
                    <li key={t.id} data-testid={`surface-turn-${t.id}`} className="grid grid-cols-[70px_1fr] gap-3 text-sm">
                        <span className="pt-0.5 text-xs tabular-nums text-slate-400">{timeOf(t.at)}</span>
                        <div className="min-w-0">
                            <p className={cn(EYEBROW, who.amber ? 'text-amber-600' : 'text-slate-400')}>
                                {who.label}{t.kind === 'call_transcript' ? ' · call' : ''}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap break-words text-slate-800">{turnText(t)}</p>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

const CELL_CLASS: Record<DiaryCellLook, string> = {
    booked: 'bg-slate-200 text-slate-600',
    changed: 'border border-amber-400 bg-amber-100 text-amber-800',
    open: 'border border-dashed border-slate-300 bg-white text-slate-400',
    off: 'bg-transparent text-slate-300',
};

function DiaryBody({ surface }: { surface: Extract<AnswerSurface, { type: 'diary' }> }) {
    const days = surface.lanes[0]?.cells.map((c) => c.date) ?? [];
    return (
        <div data-testid="surface-diary" className="overflow-x-auto">
            <div className="grid min-w-[520px] gap-2" style={{ gridTemplateColumns: `90px repeat(${Math.max(days.length, 1)}, minmax(0, 1fr))` }}>
                <span />
                {days.map((d) => <span key={d} className={cn(EYEBROW, 'text-center text-slate-500')}>{dayOf(d)}</span>)}
                {surface.lanes.map((lane) => (
                    <div key={lane.contractorId} className="contents">
                        <span className="self-center truncate text-sm font-semibold text-slate-800">{lane.name}</span>
                        {lane.cells.map((cell) => (
                            <div key={cell.date} className="space-y-1">
                                {(['am', 'pm'] as const).map((slot) => {
                                    const look = diaryCellLook(cell[slot], isChangedCell(surface.changed, lane.contractorId, cell.date, slot));
                                    return (
                                        <div key={slot} data-testid={`diary-${lane.contractorId}-${cell.date}-${slot}`} data-look={look} className={cn('rounded-xl px-2 py-1.5 text-center text-[11px] font-semibold', CELL_CLASS[look])}>
                                            {slot.toUpperCase()}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function MapBody({ surface }: { surface: Extract<AnswerSurface, { type: 'map' }> }) {
    // A placeholder grid, as the design ships it; a real map (Mapbox or Leaflet) is a later task.
    return (
        <div data-testid="surface-map" className="rounded-[18px] bg-slate-100 p-4">
            <p className="text-xs text-slate-500">{surface.jobs.length} jobs · {surface.contractors.length} contractors (map to come)</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {surface.jobs.map((j) => (
                    <li key={j.quoteId} className={cn('flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm', surface.focus === j.quoteId && 'ring-2 ring-amber-400')}>
                        <MapPin className="h-4 w-4 shrink-0 text-amber-500" />
                        <span className="truncate text-slate-800">{j.customerName}</span>
                        <span className="ml-auto shrink-0 text-xs text-slate-500">{j.postcode ?? ''}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function QuoteBody({ surface }: { surface: Extract<AnswerSurface, { type: 'quote' }> }) {
    return (
        <div data-testid="surface-quote">
            <ul className="space-y-2">
                {surface.lines.map((l, i) => (
                    <li key={i} className="flex items-baseline gap-3 text-sm">
                        <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-800">{l.label}</p>
                            {l.note && <p className="text-xs text-slate-500">{l.note}</p>}
                        </div>
                        <span className="tabular-nums text-slate-800">{formatPence(l.pence)}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-3 flex items-baseline justify-between border-t-2 border-slate-900 pt-2">
                <span className="text-sm font-semibold text-slate-700">Total</span>
                <span data-testid="surface-quote-total" className="text-base font-extrabold tabular-nums text-slate-900">{formatPence(surface.totalPence)}</span>
            </div>
        </div>
    );
}

function LedgerBody({ surface }: { surface: Extract<AnswerSurface, { type: 'ledger' }> }) {
    return (
        <div data-testid="surface-ledger" className="text-sm">
            <div className={cn(EYEBROW, 'grid grid-cols-4 gap-3 border-b border-slate-200 pb-2 text-slate-500')}>
                <span>Owed</span><span className="text-right">£</span><span className="text-right">Late</span><span>Desk did</span>
            </div>
            {surface.rows.map((r) => (
                <div key={r.phone} className="grid grid-cols-4 gap-3 border-b border-slate-100 py-2">
                    <span className="truncate text-slate-800">{r.name}</span>
                    <span className="text-right tabular-nums text-slate-800">{formatPence(r.pence)}</span>
                    <span data-testid={`ledger-late-${r.phone}`} className={cn('text-right tabular-nums', isLate(r.daysLate) ? 'font-semibold text-amber-700' : 'text-slate-600')}>{r.daysLate}d</span>
                    <span className="truncate text-slate-600">{r.chased}</span>
                </div>
            ))}
        </div>
    );
}

function FloorBody({ surface }: { surface: Extract<AnswerSurface, { type: 'floor' }> }) {
    return (
        <div data-testid="surface-floor" className="overflow-x-auto rounded-[18px] bg-slate-900 p-3">
            <div className="grid min-w-[560px] grid-cols-7 gap-2">
                {surface.bays.map((bay) => (
                    <div key={bay.stage} data-testid={`floor-bay-${bay.stage}`} className="min-h-24 rounded-xl bg-[#111c33] p-2">
                        <p className={cn(EYEBROW, 'truncate text-slate-400')}>{STAGE_LABEL[bay.stage]} · {bay.cards.length}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {bay.cards.map((c) => (
                                <span
                                    key={c.id}
                                    data-testid={`floor-token-${c.id}`}
                                    data-held={c.held ? 'true' : 'false'}
                                    title={[c.customerName ?? addressLabel(c.customerAddress), c.jobType, c.held ? `held: ${c.holdReason ?? ''}` : null].filter(Boolean).join(' · ')}
                                    className={cn(
                                        'flex h-[26px] w-[26px] items-center justify-center rounded-full bg-slate-700 text-[10px] font-bold text-white',
                                        c.held && 'ring-2 ring-amber-400 ring-offset-1 ring-offset-[#111c33]',
                                    )}
                                >
                                    {tokenOf(c.customerName, c.customerAddress)}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Amber ring: held for a person.</p>
        </div>
    );
}

export function SurfaceBody({ surface, speakerNames }: { surface: AnswerSurface; speakerNames?: Record<string, string> }) {
    switch (surface.type) {
        case 'thread': return <ThreadBody surface={surface} speakerNames={speakerNames} />;
        case 'diary': return <DiaryBody surface={surface} />;
        case 'map': return <MapBody surface={surface} />;
        case 'quote': return <QuoteBody surface={surface} />;
        case 'ledger': return <LedgerBody surface={surface} />;
        case 'floor': return <FloorBody surface={surface} />;
        case 'words': return null;
    }
}

// ---------------------------------------------------------------- below the reply card

export interface AnswerSurfaceBodyProps {
    answer: OpsAnswer;
    /** When the answer was given (the answer row's createdAt): the tile's age and the earlier-day rule. */
    answeredAt: string;
    speakerNames?: Record<string, string>;
    /** "Change something": hands the sentence back to the ask bar. */
    onChange?: () => void;
    /** A confirm went through; the page refreshes its queue. */
    onConfirmed?: (note: string) => void;
}

/**
 * The typed surface, "What goes out when you confirm" and the confirm footer, under the reply card.
 * Keyed by the answer row on the card, so a re-read draft or a done state never outlives its answer.
 */
export function AnswerSurfaceBody({ answer, answeredAt, speakerNames, onChange, onConfirmed }: AnswerSurfaceBodyProps) {
    const [busy, setBusy] = useState<'confirm' | 'template' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [templateError, setTemplateError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    // The held draft as re-read after the desk replaced it; the tile shows it and the confirm expects it.
    const [reread, setReread] = useState<string | null>(null);
    const [draftGone, setDraftGone] = useState(false);
    const now = new Date();
    const staleDay = isEarlierDay(answeredAt, now);
    const expectedDraft = reread ?? expectedDraftOf(answer);
    const outgoing = answer.outgoing && reread !== null ? [{ ...answer.outgoing[0], text: reread }] : answer.outgoing;

    const rereadDraft = async (caseFileId: string) => {
        try {
            const res = await fetch(`/api/comms-v2/case-files/${encodeURIComponent(caseFileId)}`, { headers: adminAuthHeaders() });
            if (!res.ok) { setError(`The held draft changed since you saw it, and the case file could not be read again (${res.status}).`); return; }
            const detail: CaseFileDetail = await res.json();
            const draft = detail.hold?.draft;
            if (!draft) {
                setDraftGone(true);
                setError('The held draft changed since you saw it, and there is no held draft on this file now.');
                return;
            }
            setReread(draft);
            setError('The held draft changed since you saw it. This is the draft as it stands now; confirm again to send it.');
        } catch (e: any) {
            setError(e?.message || 'Could not reach the desk');
        }
    };

    const confirm = async () => {
        if (!answer.confirm || expectedDraft === undefined) return;
        setBusy('confirm');
        setError(null);
        setTemplateError(null);
        const result = await post(confirmRequest(answer.confirm.action).url, { expectedDraft });
        if (!result.ok && result.draftChanged) {
            await rereadDraft(confirmCaseFileId(answer.confirm.action));
            setBusy(null);
            return;
        }
        setBusy(null);
        if (!result.ok) { setError(result.message); return; }
        const note = confirmedNote({ ...answer, outgoing });
        setDone(note);
        onConfirmed?.(note);
    };

    const sendTemplate = async () => {
        if (!answer.confirm) return;
        setBusy('template');
        setTemplateError(null);
        const result = await post(`/api/comms-v2/case-files/${encodeURIComponent(confirmCaseFileId(answer.confirm.action))}/send-template`);
        setBusy(null);
        if (!result.ok) { setTemplateError(result.message); return; }
        const note = 'Template reply sent.';
        setDone(note);
        onConfirmed?.(note);
    };

    return (
        <div data-testid="handy-desk-surface" data-surface={answer.surface.type} className="space-y-4">
            {answer.surface.type !== 'words' && (
                <div data-testid={`answer-body-${answer.surface.type}`} className={cn('rounded-3xl bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.08)]', RISE)}>
                    {answer.surface.type === 'thread' && (
                        <p className={cn(EYEBROW, 'mb-3 text-slate-500')}>
                            Thread · {answer.surface.customerName ?? addressLabel(answer.surface.phone)} · {STAGE_LABEL[answer.surface.stage]}
                        </p>
                    )}
                    <SurfaceBody surface={answer.surface} speakerNames={speakerNames} />
                </div>
            )}

            {outgoing && outgoing.length > 0 && !draftGone && (
                <div data-testid="answer-outgoing">
                    <p className={cn(EYEBROW, 'text-slate-500')}>What goes out when you confirm</p>
                    <ul className="mt-2 space-y-2">
                        {outgoing.map((o, i) => (
                            <li key={i} data-testid="answer-outgoing-tile" className="rounded-2xl bg-slate-100 p-3">
                                <p className="text-xs font-semibold text-slate-600">
                                    {CHANNEL_LABEL[o.channel]} · {addressLabel(o.to)}
                                    <span data-testid="answer-outgoing-age" className="font-normal text-slate-500"> · {reread !== null ? 'as it stands now' : `drafted ${ageLabel(answeredAt, now)}`}</span>
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{o.text}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <footer className="space-y-2">
                {error && <p role="alert" data-testid="answer-confirm-error" className="text-sm text-red-700">{error}</p>}
                {staleDay && answer.confirm && !done && (
                    <p data-testid="answer-stale-day" className="text-sm text-slate-600">This answer is from an earlier day, so its draft is not offered for sending. Ask again for the draft as it stands today.</p>
                )}
                {error && isShutWindow(error) && !done && (
                    <div>
                        {templateError && <p role="alert" data-testid="answer-template-error" className="mb-2 text-sm text-red-700">{templateError}</p>}
                        <button type="button" className={PILL_OUTLINE} disabled={busy !== null} onClick={sendTemplate}>
                            {busy === 'template' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Send a template reply
                        </button>
                    </div>
                )}
                {done ? (
                    <p data-testid="answer-done" className={cn('flex items-center gap-2 text-sm font-semibold text-slate-800', RISE)}>
                        <Check className="h-4 w-4 text-green-600" /> {done}
                    </p>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        {answer.note && <p data-testid="handy-desk-note" className="mr-auto min-w-0 flex-1 basis-60 text-xs text-slate-500">{answer.note}</p>}
                        {onChange && (
                            <button type="button" className={cn(PILL_OUTLINE, !answer.note && 'ml-auto')} disabled={busy !== null} onClick={onChange}>
                                Change something
                            </button>
                        )}
                        {answer.confirm && expectedDraft !== undefined && !staleDay && !draftGone && (
                            <button type="button" data-testid="answer-confirm" className={cn(PILL_PRIMARY, !answer.note && !onChange && 'ml-auto')} disabled={busy !== null} onClick={confirm}>
                                {busy === 'confirm' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {answer.confirm.label}
                            </button>
                        )}
                    </div>
                )}
            </footer>
        </div>
    );
}
