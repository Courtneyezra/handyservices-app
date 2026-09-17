/**
 * Ben's diary (Handy Desk B6; design export "Handy Diary.dc.html"), read-only: every contractor's
 * week as AM / PM / Full / Off cells, never hours, with the "Not jobs" row under it, or a month of
 * half-day bars. Tapping a slot shows it in the side panel; a booked slot's only action is
 * "Open thread", which opens that job's case file on the comms board. There is no pool, no
 * "waiting for a seat" and no move, seat or block here (captain's answers Q8, Q9): nothing on this
 * page writes.
 *
 * Data: GET /api/comms-v2/diary/week (server/comms-v2/diary/). Below md the week shows as day pills
 * with each contractor's day stacked under them.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { adminAuthHeaders } from '@/lib/admin-auth';
import { cn } from '@/lib/utils';
import {
    addDays, addMonths, cellCopy, dayNumber, dowOf, halfDayCounts, londonToday, monthDays, monthLabel, monthOf, monthStart, mondayOf,
    shortDate, threadPath, visibleDates, weekLabel, weekQuery, weekdayDates, weeksInMonth,
    type CellKind, type DiaryCell, type DiaryLane, type DiaryView, type DiaryWeek,
} from '@/lib/diary';

const EYEBROW = 'text-[10px] font-bold uppercase tracking-[0.1em]';
const ROUND_BTN = 'flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 text-white transition-colors hover:border-amber-400 hover:text-amber-400';

const CELL_TONE: Record<CellKind, string> = {
    booked: 'border-solid border-slate-200 bg-slate-200 text-slate-900',
    held: 'border-dashed border-amber-400 bg-amber-400/10 text-amber-300',
    open: 'border-dashed border-slate-700 bg-transparent text-slate-400',
    off: 'border-solid border-[#111c33] bg-[#111c33] text-slate-600',
};

const BAR_TONE = { booked: 'bg-amber-400', open: 'bg-slate-700', off: 'border border-dashed border-slate-600 bg-slate-800' } as const;

async function fetchWeek(url: string): Promise<DiaryWeek> {
    const res = await fetch(url, { headers: adminAuthHeaders() });
    if (!res.ok) throw new Error(`Couldn't load the diary (${res.status})`);
    return res.json();
}

interface Selected {
    lane: DiaryLane;
    date: string;
    cell: DiaryCell;
}

// ---------------------------------------------------------------- cells

function Cell({ cell, laneId, date, active, onSelect, phone = false }: { cell: DiaryCell; laneId: string; date: string; active: boolean; onSelect: () => void; phone?: boolean }) {
    const copy = cellCopy(cell);
    return (
        <button
            type="button"
            data-testid={`diary-${phone ? 'phone-' : ''}cell-${laneId}-${date}-${cell.slot}`}
            data-kind={copy.kind}
            aria-pressed={active}
            onClick={onSelect}
            className={cn(
                'flex min-h-[52px] min-w-0 flex-col justify-center gap-0.5 rounded-[14px] border px-2.5 py-2 text-left transition-colors hover:border-amber-400',
                CELL_TONE[copy.kind],
                active && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900',
            )}
        >
            <span className="flex justify-between gap-1.5 text-[9px] font-bold uppercase tracking-[0.06em] opacity-80">
                <span>{copy.slot}</span>
                <span>{copy.tag}</span>
            </span>
            <span className="truncate text-xs font-bold">{copy.label}</span>
            {copy.sub && <span className="truncate text-[10px] opacity-80">{copy.sub}</span>}
        </button>
    );
}

function LaneName({ lane }: { lane: DiaryLane }) {
    return (
        <div className="flex min-w-0 flex-col gap-1 py-1">
            <div className="flex items-center gap-2">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-extrabold text-slate-900">{lane.initials}</span>
                <span className="truncate text-[13px] font-bold text-white">{lane.name}</span>
            </div>
            {lane.trades.length > 0 && <span className="truncate text-[10px] text-slate-500">{lane.trades.join(' · ')}</span>}
        </div>
    );
}

// ---------------------------------------------------------------- week

function WeekGrid({ week, selected, onSelect }: { week: DiaryWeek; selected: Selected | null; onSelect: (s: Selected) => void }) {
    const dates = visibleDates(week);
    const cols = { gridTemplateColumns: `110px repeat(${dates.length}, minmax(0, 1fr))` };
    const isSel = (laneId: string, date: string, cell: DiaryCell) => selected?.lane.contractorId === laneId && selected.date === date && selected.cell.slot === cell.slot;
    return (
        <div data-testid="diary-week" className="hidden md:block">
            <div className="grid gap-x-2 pb-2" style={cols}>
                <div />
                {dates.map((date) => {
                    const today = date === week.today;
                    return (
                        <div key={date} data-testid={`diary-day-head-${date}`} aria-current={today ? 'date' : undefined} className={cn('rounded-xl px-2.5 py-1.5', today && 'bg-amber-400/10')}>
                            <div className={cn(EYEBROW, today ? 'text-amber-400' : 'text-slate-500')}>{dowOf(date)}</div>
                            <div className="text-lg font-extrabold leading-tight text-white">{dayNumber(date)}</div>
                        </div>
                    );
                })}
            </div>
            {week.lanes.map((lane) => (
                <div key={lane.contractorId} data-testid={`diary-lane-${lane.contractorId}`} className="grid gap-x-2 border-t border-slate-800 py-2.5" style={cols}>
                    <LaneName lane={lane} />
                    {dates.map((date) => {
                        const day = lane.days.find((d) => d.date === date);
                        return (
                            <div key={date} className="flex min-w-0 flex-col gap-1.5">
                                {day?.cells.map((cell) => (
                                    <Cell key={cell.slot} cell={cell} laneId={lane.contractorId} date={date} active={isSel(lane.contractorId, date, cell)} onSelect={() => onSelect({ lane, date, cell })} />
                                ))}
                            </div>
                        );
                    })}
                </div>
            ))}
            <div data-testid="diary-not-jobs" className="grid gap-x-2 border-t border-slate-800 py-2.5" style={cols}>
                <div className={cn(EYEBROW, 'pt-1.5 text-slate-500')}>Not jobs</div>
                {dates.map((date) => (
                    <div key={date} className="flex min-w-0 flex-col gap-1.5">
                        {week.notJobs.filter((n) => n.date === date).map((n) => (
                            <div key={n.id} className={cn('rounded-xl border border-dashed border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-400', n.done && 'line-through opacity-60')}>{n.label}</div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Below md: day pills, then each contractor's chosen day stacked. */
function PhoneWeek({ week, selected, onSelect }: { week: DiaryWeek; selected: Selected | null; onSelect: (s: Selected) => void }) {
    const dates = visibleDates(week);
    const [day, setDay] = useState(() => (dates.includes(week.today) ? week.today : dates[0]));
    useEffect(() => {
        if (!dates.includes(day)) setDay(dates.includes(week.today) ? week.today : dates[0]);
    }, [week.start]); // eslint-disable-line react-hooks/exhaustive-deps
    const notJobs = week.notJobs.filter((n) => n.date === day);
    return (
        <div data-testid="diary-phone" className="md:hidden">
            <div role="tablist" aria-label="Day" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }}>
                {dates.map((date) => (
                    <button
                        key={date}
                        type="button"
                        role="tab"
                        aria-selected={date === day}
                        data-testid={`diary-day-pill-${date}`}
                        onClick={() => setDay(date)}
                        className={cn('flex h-12 flex-col items-center justify-center rounded-xl text-white', date === day ? 'bg-amber-400 text-slate-900' : 'bg-[#111c33]', date === week.today && date !== day && 'text-amber-400')}
                    >
                        <span className="text-[10px] font-semibold opacity-80">{dowOf(date)}</span>
                        <span className="text-[15px] font-bold">{dayNumber(date)}</span>
                    </button>
                ))}
            </div>
            <p className="mt-4 text-xs font-semibold text-slate-400">{shortDate(day)}</p>
            <div className="mt-2 flex flex-col gap-3">
                {week.lanes.map((lane) => {
                    const d = lane.days.find((x) => x.date === day);
                    return (
                        <div key={lane.contractorId} className="rounded-2xl border border-slate-800 p-3">
                            <LaneName lane={lane} />
                            <div className="mt-2 grid grid-cols-2 gap-1.5">
                                {d?.cells.map((cell) => (
                                    <div key={cell.slot} className={cell.slot === 'full' ? 'col-span-2' : undefined}>
                                        <Cell phone cell={cell} laneId={lane.contractorId} date={day} active={selected?.lane.contractorId === lane.contractorId && selected.date === day && selected.cell.slot === cell.slot} onSelect={() => onSelect({ lane, date: day, cell })} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
                {notJobs.length > 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-700 p-3">
                        <p className={cn(EYEBROW, 'text-slate-500')}>Not jobs</p>
                        {notJobs.map((n) => <p key={n.id} className="mt-1 text-xs text-slate-400">{n.label}</p>)}
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- month

function MonthGrid({ week, month, onPickWeek }: { week: DiaryWeek; month: string; onPickWeek: (monday: string) => void }) {
    const days = monthDays(week, month);
    return (
        <div data-testid="diary-month" className="flex flex-col gap-2">
            <div className={cn(EYEBROW, 'grid grid-cols-5 gap-2 px-1 text-slate-500')}>
                <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div>
            </div>
            <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {days.map((m) => {
                    const today = m.date === week.today;
                    return (
                        <button
                            key={m.date}
                            type="button"
                            data-testid={`diary-month-day-${m.date}`}
                            onClick={() => onPickWeek(mondayOf(m.date))}
                            className={cn(
                                'flex min-h-[72px] flex-col gap-1.5 rounded-2xl border p-2 text-left transition-colors hover:border-amber-400 sm:min-h-[104px] sm:px-3 sm:py-2.5',
                                today ? 'border-amber-400 bg-amber-400/10' : 'border-slate-800 bg-[#111c33]',
                                !m.inMonth && 'opacity-40',
                            )}
                        >
                            <span className="flex items-baseline justify-between">
                                <span className={cn('text-[15px] font-extrabold', today ? 'text-amber-400' : 'text-white')}>{dayNumber(m.date)}</span>
                                {m.total > 0 && <span className={cn('text-[10px] font-bold', m.booked >= m.total ? 'text-amber-400' : 'text-slate-400')}>{m.booked}/{m.total}</span>}
                            </span>
                            <span aria-hidden className="flex h-2 gap-[3px]">
                                {m.bars.map((b, i) => <span key={i} className={cn('flex-1 rounded-[2px]', BAR_TONE[b])} />)}
                            </span>
                            {m.note && <span className="hidden text-[11px] leading-snug text-slate-300 sm:block">{m.note}</span>}
                        </button>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-3.5 px-1 py-1.5 text-[11px] text-slate-400">
                <span className="flex items-center gap-1.5"><span className={cn('h-2 w-3 rounded-[2px]', BAR_TONE.booked)} />booked</span>
                <span className="flex items-center gap-1.5"><span className={cn('h-2 w-3 rounded-[2px]', BAR_TONE.open)} />open</span>
                <span className="flex items-center gap-1.5"><span className={cn('h-2 w-3 rounded-[2px]', BAR_TONE.off)} />off</span>
                <span className="sm:ml-auto">Each bar = one contractor half-day · tap a day for the week</span>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- side panel

function SidePanel({ selected }: { selected: Selected | null }) {
    if (!selected) {
        return <p data-testid="diary-side-empty" className="text-sm text-slate-500">Tap a slot to see it here.</p>;
    }
    const { lane, date, cell } = selected;
    const copy = cellCopy(cell);
    const first = lane.name.split(/\s+/)[0];
    const kicker = `${first} · ${shortDate(date)} · ${copy.slot}`;
    let title: string;
    let body: string;
    if (cell.state === 'booked') {
        title = copy.label;
        body = '';
    } else if (cell.state === 'open') {
        title = 'Open slot';
        body = 'Nothing booked.';
    } else {
        title = `${first} is off`;
        body = 'Not offered on this day. Availability lives in the contractor’s own week.';
    }
    return (
        <div data-testid="diary-side" className="flex flex-col gap-2.5">
            <p className={cn(EYEBROW, 'text-amber-400')}>{kicker}</p>
            <h2 className="text-xl font-extrabold leading-tight tracking-[-0.01em] text-white">{title}</h2>
            {body && <p className="text-[13px] leading-relaxed text-slate-300">{body}</p>}
            {cell.jobs.map((job) => (
                <div key={job.bookingId} data-testid={`diary-side-job-${job.bookingId}`} className={cn('rounded-2xl border p-3', job.held ? 'border-amber-400' : 'border-slate-800')}>
                    <p className="text-sm font-bold text-white">{job.customerName}</p>
                    {job.description && <p className="mt-0.5 text-xs text-slate-400">{job.description}</p>}
                    <p className="mt-1 text-xs text-slate-400">
                        {[
                            job.spanDays > 1 ? `Day ${job.spanDay} of ${job.spanDays}` : null,
                            job.startTime ? `from ${job.startTime}` : null,
                            job.onSite === 'on_site' ? 'On site now' : job.onSite === 'en_route' ? 'On the way' : null,
                            job.accepted ? null : 'Not yet accepted by the contractor',
                        ].filter(Boolean).join(' · ')}
                    </p>
                    {job.held && <p className={cn(EYEBROW, 'mt-2 text-amber-400')}>Held on the desk</p>}
                    {job.caseFileId ? (
                        <Link
                            href={threadPath(job.caseFileId)}
                            data-testid={`diary-open-thread-${job.bookingId}`}
                            className="mt-3 inline-flex min-h-11 items-center rounded-full border border-amber-400 bg-amber-400 px-4 text-[13px] font-bold text-slate-900 hover:bg-amber-300"
                        >
                            Open thread
                        </Link>
                    ) : (
                        <p data-testid={`diary-no-thread-${job.bookingId}`} className="mt-3 text-xs text-slate-500">No conversation on the desk for this job.</p>
                    )}
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------- page

export default function DiaryPage({ initialToday }: { initialToday?: string } = {}) {
    const today = useMemo(() => initialToday ?? londonToday(), [initialToday]);
    const [view, setView] = useState<DiaryView>('week');
    const [weekStart, setWeekStart] = useState(() => mondayOf(today));
    const [month, setMonth] = useState(() => monthOf(today));
    const [selected, setSelected] = useState<Selected | null>(null);

    const url = view === 'week' ? weekQuery(weekStart) : weekQuery(monthStart(month), weeksInMonth(month));
    const { data, isLoading, error, refetch, isFetching } = useQuery<DiaryWeek>({
        queryKey: ['comms-v2-diary', url],
        queryFn: () => fetchWeek(url),
        refetchInterval: 60_000,
    });

    useEffect(() => setSelected(null), [url]);

    // The figures describe what is on screen: the days this view draws, in contractor half-days.
    const counts = useMemo(() => (data ? halfDayCounts(data, view === 'month' ? weekdayDates(data) : visibleDates(data)) : null), [data, view]);

    const step = (n: number) => (view === 'week' ? setWeekStart((w) => addDays(w, 7 * n)) : setMonth((m) => addMonths(m, n)));
    const goToday = () => { setView('week'); setWeekStart(mondayOf(today)); setMonth(monthOf(today)); };
    const pickWeek = (monday: string) => { setWeekStart(monday); setView('week'); };
    const rangeLabel = view === 'week' ? weekLabel(weekStart) : monthLabel(month);

    const toggle = (v: DiaryView) => cn('rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors', view === v ? 'bg-amber-400 text-slate-900' : 'text-white hover:text-amber-400');

    return (
        <div data-testid="diary-page" className="flex min-h-[calc(100vh-6rem)] flex-col bg-slate-900 font-sans lg:h-[calc(100vh-8rem)] lg:min-h-0 lg:overflow-hidden">
            <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 px-4 py-3 sm:px-6 lg:h-16 lg:py-0">
                <Link href="/admin/handy-desk" className="text-xs text-slate-400 hover:text-amber-400">‹ Queue</Link>
                <h1 className="text-[15px] font-bold text-white">Diary</h1>
                <div role="group" aria-label="View" className="flex rounded-full border border-slate-700 p-[3px]">
                    <button type="button" aria-pressed={view === 'week'} className={toggle('week')} onClick={() => setView('week')}>Week</button>
                    <button type="button" aria-pressed={view === 'month'} className={toggle('month')} onClick={() => { setMonth(monthOf(addDays(weekStart, 3))); setView('month'); }}>Month</button>
                </div>
                <div className="flex items-center gap-1.5">
                    <button type="button" aria-label="Previous" className={ROUND_BTN} onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></button>
                    <span data-testid="diary-range" className="min-w-[150px] text-center text-[13px] font-semibold text-white">{rangeLabel}</span>
                    <button type="button" aria-label="Next" className={ROUND_BTN} onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></button>
                    <button type="button" className="h-9 rounded-full border border-slate-700 px-3 text-xs text-slate-400 hover:border-amber-400 hover:text-amber-400" onClick={goToday}>Today</button>
                </div>
                {counts && (
                    <div data-testid="diary-counts" className="flex gap-4 text-xs text-slate-400 lg:ml-auto">
                        <span><span className="font-bold text-white">{counts.booked}</span> half-days booked</span>
                        <span><span className="font-bold text-amber-400">{counts.open}</span> half-days open</span>
                    </div>
                )}
            </header>

            <div className={cn('grid min-h-0 flex-1 grid-cols-1', view === 'week' && 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
                <main className="min-h-0 px-4 py-5 sm:px-6 lg:overflow-auto">
                    {error ? (
                        <div role="alert" data-testid="diary-error" className="flex flex-col items-start gap-2 rounded-2xl border border-red-400/40 bg-red-500/10 p-4">
                            <p className="text-sm font-semibold text-red-300">Couldn't load the {view}</p>
                            <button type="button" disabled={isFetching} onClick={() => refetch()} className="h-9 rounded-full border border-red-400/60 px-4 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">Retry</button>
                        </div>
                    ) : isLoading || !data ? (
                        <div data-testid="diary-loading" aria-busy="true" className="grid grid-cols-[80px_repeat(3,1fr)] gap-1.5">
                            {Array.from({ length: 12 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-800" />)}
                        </div>
                    ) : view === 'month' ? (
                        <MonthGrid week={data} month={month} onPickWeek={pickWeek} />
                    ) : data.lanes.length === 0 ? (
                        <div data-testid="diary-empty" className="rounded-2xl border border-dashed border-slate-700 p-4 text-[13px] leading-relaxed text-slate-400">
                            <p className="font-bold text-white">Nobody is offered this week.</p>
                            <p>Contractors set availability in their own app; the week shows once someone is marked available.</p>
                        </div>
                    ) : (
                        <>
                            <WeekGrid week={data} selected={selected} onSelect={setSelected} />
                            <PhoneWeek week={data} selected={selected} onSelect={setSelected} />
                        </>
                    )}
                </main>
                {view === 'week' && (
                    <aside aria-label="Selected slot" className="border-t border-slate-800 p-5 lg:overflow-auto lg:border-l lg:border-t-0">
                        <SidePanel selected={selected} />
                    </aside>
                )}
            </div>
        </div>
    );
}

