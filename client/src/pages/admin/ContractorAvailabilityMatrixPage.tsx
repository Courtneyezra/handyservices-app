import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ContractorFormPanel } from './ContractorsPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
    Calendar,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Save,
    RotateCcw,
    Users,
    AlertCircle,
    StickyNote,
    Info,
} from 'lucide-react';
import { getTradeIcon, getTradeLabel, type BroadTradeId } from '@shared/categories';
import { useToast } from '@/hooks/use-toast';
import { slotFromWindow, SLOT_TIMES, LUNCH_BREAK, timeToMinutes } from '@shared/slot-times';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Slot = 'am' | 'pm' | 'full_day' | 'off';

interface MatrixContractor {
    id: string;
    name: string;
    postcode: string | null;
    availabilityStatus: string;
    trades: string[];
    skillCount: number;
    weeklyPatterns: { dayOfWeek: number; startTime: string | null; endTime: string | null }[];
    overrides: { date: string; isAvailable: boolean; startTime: string | null; endTime: string | null; notes: string | null }[];
    jobs: { date: string; slot: string; start: string; durationMinutes: number; status: string; customerName: string | null; jobDescription: string | null; scheduledTime: string | null; travelMinutes?: number | null; travelSource?: string | null }[];
}

interface MatrixResponse {
    from: string;
    days: number;
    contractors: MatrixContractor[];
}

interface StagedChange {
    slot: Slot;
    notes: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getAdminToken = (): string => localStorage.getItem('adminToken') || '';

const SLOT_ORDER: Slot[] = ['full_day', 'am', 'pm', 'off'];
const SLOT_LABEL: Record<Slot, string> = { full_day: 'Full day', am: 'Morning', pm: 'Afternoon', off: 'Off' };
const SLOT_SHORT: Record<Slot, string> = { full_day: 'FD', am: 'AM', pm: 'PM', off: 'Off' };

/** Local calendar date string YYYY-MM-DD (avoids UTC drift from toISOString on local midnight). */
function ymd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function overrideToSlot(o: { isAvailable: boolean; startTime: string | null; endTime: string | null }): Slot {
    if (!o.isAvailable) return 'off';
    const s = slotFromWindow(o.startTime, o.endTime);
    if (s === 'am' || s === 'pm') return s;
    return 'full_day';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Week view — read-only team schedule: contractors x 7 days, job time-blocks
// (start + duration) with free-hours per day. Editing lives on profiles.
// ---------------------------------------------------------------------------

function WeekScheduleView({ contractors, dayColumns, onEdit }: {
    contractors: MatrixContractor[];
    dayColumns: { date: Date; key: string; dow: number; weekday: string; dayNum: number; month: string; isWeekend: boolean }[];
    onEdit: (id: string) => void;
}) {
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h * 60) + (m || 0); };
    const fmtH = (min: number) => `${Math.round((min / 60) * 10) / 10}h`;

    // One slot bar (AM or PM): job segments sized by est-hours / slot capacity, remainder = free.
    const SlotBar = (label: string, cap: number, jobs: any[], free: number, alloc: (j: any) => number) => {
        if (cap <= 0) return null;
        return (
            <div className="flex items-center gap-1">
                <span className="text-[8px] text-muted-foreground/60 w-4 shrink-0">{label}</span>
                <div className="flex-1 flex h-3.5 rounded overflow-hidden bg-zinc-200 dark:bg-zinc-800 ring-1 ring-border">
                    {jobs.map((j, i) => {
                        const m = alloc(j);
                        if (m <= 0) return null;
                        const travelStr = (j.travelMinutes && j.travelMinutes > 0) ? ` · 🚗 ${j.travelMinutes}min travel${j.travelSource === 'haversine' ? ' (est)' : ''}` : '';
                        return <div key={i} className="bg-red-500 border-r border-white/40" style={{ width: `${(m / cap) * 100}%` }} title={`${(j.customerName || 'Job').replace('[DEMO] ', '')} · ${fmtH(j.durationMinutes)} job${travelStr}${j.jobDescription ? ' · ' + j.jobDescription : ''}`} />;
                    })}
                    {free > 0 && <div className="bg-emerald-500" style={{ width: `${(free / cap) * 100}%` }} title={`${fmtH(free)} free`} />}
                </div>
                <span className={`text-[8px] w-8 text-right shrink-0 ${free > 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-muted-foreground/50'}`}>{free > 0 ? fmtH(free) : 'full'}</span>
            </div>
        );
    };

    return (
        <div className="overflow-x-auto">
            <table className="border-separate border-spacing-1 w-full">
                <thead>
                    <tr>
                        <th className="sticky left-0 z-10 bg-card text-left text-xs font-medium text-muted-foreground px-2 min-w-[160px]">Contractor</th>
                        {dayColumns.map((col) => (
                            <th key={col.key} className={`text-center text-[11px] font-medium px-1 min-w-[7rem] ${col.isWeekend ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
                                <div>{col.weekday}</div>
                                <div className="font-bold text-foreground">{col.dayNum} {col.month}</div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {contractors.map((c) => (
                        <tr key={c.id}>
                            <td className="sticky left-0 z-10 bg-card px-2 align-top min-w-[160px]">
                                <button onClick={() => onEdit(c.id)} className="font-medium text-sm leading-tight text-left hover:text-primary hover:underline">{c.name}</button>
                                {c.postcode && <div className="text-[10px] text-muted-foreground mt-0.5">{c.postcode}</div>}
                            </td>
                            {dayColumns.map((col) => {
                                const dayJobs = c.jobs.filter((j) => j.date === col.key);
                                const ov = c.overrides.find((o) => o.date === col.key);
                                const pat = c.weeklyPatterns.find((p) => p.dayOfWeek === col.dow);
                                let isOff = false, hasWindow = false, winStart = SLOT_TIMES.full_day.start, winEnd = SLOT_TIMES.full_day.end;
                                if (ov) { if (!ov.isAvailable) isOff = true; else { winStart = ov.startTime || SLOT_TIMES.full_day.start; winEnd = ov.endTime || SLOT_TIMES.full_day.end; hasWindow = true; } }
                                else if (pat) { winStart = pat.startTime || SLOT_TIMES.full_day.start; winEnd = pat.endTime || SLOT_TIMES.full_day.end; hasWindow = true; }
                                // AM ends at LUNCH_BREAK.start (13:00); PM starts at LUNCH_BREAK.end (14:00).
                                // The 1h gap between is unbookable and never counts toward either cap.
                                const wsM = toMin(winStart), weM = toMin(winEnd);
                                const lunchStartM = timeToMinutes(LUNCH_BREAK.start);
                                const lunchEndM = timeToMinutes(LUNCH_BREAK.end);
                                const amCap = Math.max(0, Math.min(weM, lunchStartM) - wsM);
                                const pmCap = Math.max(0, weM - Math.max(wsM, lunchEndM));
                                const amJobs = dayJobs.filter((j) => j.slot === 'am' || j.slot === 'full');
                                const pmJobs = dayJobs.filter((j) => j.slot === 'pm' || j.slot === 'full');
                                const amAlloc = (j: any) => j.slot === 'full' ? Math.min(j.durationMinutes, amCap) : j.durationMinutes;
                                const pmAlloc = (j: any) => j.slot === 'full' ? Math.max(0, j.durationMinutes - amCap) : j.durationMinutes;
                                const amBooked = Math.min(amCap, amJobs.reduce((s, j) => s + amAlloc(j), 0));
                                const pmBooked = Math.min(pmCap, pmJobs.reduce((s, j) => s + pmAlloc(j), 0));
                                return (
                                    <td key={col.key} className="align-top p-0">
                                        <div className="min-h-[3rem] rounded-md border border-border bg-card p-1 space-y-1.5 flex flex-col justify-center">
                                            {isOff ? (
                                                <div className="text-[10px] text-muted-foreground/60 text-center py-1">Off</div>
                                            ) : (!hasWindow && dayJobs.length === 0) ? (
                                                <div className="text-[10px] text-muted-foreground/30 text-center py-1">—</div>
                                            ) : (
                                                <>
                                                    {SlotBar('AM', amCap, amJobs, Math.max(0, amCap - amBooked), amAlloc)}
                                                    {SlotBar('PM', pmCap, pmJobs, Math.max(0, pmCap - pmBooked), pmAlloc)}
                                                </>
                                            )}
                                        </div>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function ContractorAvailabilityMatrixPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [fromDate, setFromDate] = useState<Date>(startOfToday);
    const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
    const days = viewMode === 'week' ? 7 : 28;
    const [staged, setStaged] = useState<Record<string, Record<string, StagedChange>>>({});
    const [editId, setEditId] = useState<string | null>(null);
    const { data: fullContractors } = useQuery<any[]>({
        queryKey: ['admin-contractors'],
        queryFn: async () => {
            const res = await fetch('/api/admin/contractors', { headers: { Authorization: `Bearer ${getAdminToken()}` } });
            if (!res.ok) throw new Error('Failed to load contractors');
            return res.json();
        },
    });
    const editingContractor = (fullContractors || []).find((x: any) => x.id === editId) ?? null;

    const dayColumns = useMemo(() => {
        const cols: { date: Date; key: string; dow: number; weekday: string; dayNum: number; month: string; isWeekend: boolean }[] = [];
        for (let i = 0; i < days; i++) {
            const d = new Date(fromDate);
            d.setDate(fromDate.getDate() + i);
            cols.push({
                date: d,
                key: ymd(d),
                dow: d.getDay(),
                weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }),
                dayNum: d.getDate(),
                month: d.toLocaleDateString('en-GB', { month: 'short' }),
                isWeekend: d.getDay() === 0 || d.getDay() === 6,
            });
        }
        return cols;
    }, [fromDate, days]);

    const { data, isLoading, isError } = useQuery<MatrixResponse>({
        queryKey: ['availability-matrix', ymd(fromDate), days],
        queryFn: async () => {
            const res = await fetch(`/api/admin/availability/matrix?from=${ymd(fromDate)}&days=${days}`, {
                headers: { Authorization: `Bearer ${getAdminToken()}` },
            });
            if (!res.ok) throw new Error('Failed to load availability matrix');
            return res.json();
        },
    });

    const dirtyCount = useMemo(
        () => Object.values(staged).reduce((sum, m) => sum + Object.keys(m).length, 0),
        [staged],
    );

    const saveMutation = useMutation({
        mutationFn: async () => {
            const entries = Object.entries(staged);
            await Promise.all(entries.map(([contractorId, dateMap]) => {
                const dates = Object.entries(dateMap).map(([date, change]) => ({
                    date,
                    slot: change.slot,
                    isAvailable: change.slot !== 'off',
                    notes: change.notes || null,
                }));
                return fetch(`/api/admin/contractors/${contractorId}/availability`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
                    body: JSON.stringify({ dates }),
                }).then((r) => {
                    if (!r.ok) throw new Error('Failed to save availability');
                    return r.json();
                });
            }));
        },
        onSuccess: () => {
            setStaged({});
            queryClient.invalidateQueries({ queryKey: ['availability-matrix'] });
            toast({ title: 'Availability saved', description: 'Contractor calendars updated.' });
        },
        onError: (err: Error) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    const setCell = (contractorId: string, dateKey: string, slot: Slot, notes: string) => {
        setStaged((prev) => ({
            ...prev,
            [contractorId]: { ...(prev[contractorId] || {}), [dateKey]: { slot, notes } },
        }));
    };

    const resolveSlot = (c: MatrixContractor, dateKey: string): Slot | 'unset' => {
        const st = staged[c.id]?.[dateKey];
        if (st) return st.slot;
        const o = c.overrides.find((ov) => ov.date === dateKey);
        if (o) return overrideToSlot(o);
        return 'unset';
    };

    const resolveNotes = (c: MatrixContractor, dateKey: string): string => {
        const st = staged[c.id]?.[dateKey];
        if (st) return st.notes;
        return c.overrides.find((ov) => ov.date === dateKey)?.notes || '';
    };

    const shiftPeriod = (dir: 1 | -1) =>
        setFromDate((prev) => {
            const d = new Date(prev);
            d.setDate(prev.getDate() + dir * days);
            return d;
        });

    const periodLabel = dayColumns.length
        ? `${dayColumns[0].date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${dayColumns[dayColumns.length - 1].date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
        : '';

    const contractors = data?.contractors || [];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Calendar className="h-6 w-6" />
                        Contractor Availability
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                        <Info className="h-3.5 w-3.5" />
                        Internal planning board — call contractors and set their availability. Does not change live quote dates.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {dirtyCount > 0 && (
                        <Button variant="ghost" onClick={() => setStaged({})} disabled={saveMutation.isPending}>
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Discard
                        </Button>
                    )}
                    <Button onClick={() => saveMutation.mutate()} disabled={dirtyCount === 0 || saveMutation.isPending}>
                        {saveMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Save className="h-4 w-4 mr-2" />
                        )}
                        Save{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
                    </Button>
                </div>
            </div>

            <Card className="bg-card border border-border rounded-xl">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" onClick={() => shiftPeriod(-1)}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="min-w-[150px] text-center text-base font-semibold">{periodLabel}</span>
                        <Button variant="ghost" size="icon" onClick={() => shiftPeriod(1)}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setFromDate(startOfToday())}>
                            Today
                        </Button>
                    </CardTitle>
                    <div className="flex items-center gap-1 rounded-lg border border-border p-1">
                        <Button variant={viewMode === 'week' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('week')}>
                            Week
                        </Button>
                        <Button variant={viewMode === 'month' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('month')}>
                            Month
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {/* Legend */}
                    <div className="flex flex-wrap gap-4 mb-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500" /> Available / free</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500" /> Booked</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-zinc-300 dark:bg-zinc-700" /> Off</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-dashed border-muted-foreground/40" /> Not set</span>
                        <span className="flex items-center gap-1.5"><StickyNote className="w-3 h-3" /> Has note</span>
                    </div>

                    {isLoading ? (
                        <div className="flex items-center justify-center py-16 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading availability…
                        </div>
                    ) : isError ? (
                        <div className="flex items-center justify-center py-16 text-destructive">
                            <AlertCircle className="h-5 w-5 mr-2" /> Failed to load. Try again.
                        </div>
                    ) : contractors.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                            <Users className="h-8 w-8 mb-2 opacity-50" />
                            No contractors found.
                        </div>
                    ) : viewMode === 'week' ? (
                        <WeekScheduleView contractors={contractors} dayColumns={dayColumns} onEdit={setEditId} />
                    ) : (
                        <TooltipProvider delayDuration={200}>
                            <div className="overflow-x-auto">
                                <table className="border-separate border-spacing-1">
                                    <thead>
                                        <tr>
                                            <th className="sticky left-0 z-10 bg-card text-left text-xs font-medium text-muted-foreground px-2 min-w-[180px]">
                                                Contractor
                                            </th>
                                            {dayColumns.map((col) => (
                                                <th
                                                    key={col.key}
                                                    className={`text-center text-[11px] font-medium px-1 min-w-[3.25rem] ${col.isWeekend ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
                                                >
                                                    <div>{col.weekday}</div>
                                                    <div className="font-bold text-foreground">{col.dayNum}</div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {contractors.map((c) => (
                                            <tr key={c.id}>
                                                {/* Contractor cell */}
                                                <td className="sticky left-0 z-10 bg-card px-2 align-top min-w-[180px]">
                                                    <button onClick={() => setEditId(c.id)} className="font-medium text-sm leading-tight text-left hover:text-primary hover:underline">
                                                        {c.name}
                                                    </button>
                                                    <div className="flex items-center gap-1 mt-0.5">
                                                        {c.trades.length > 0 ? (
                                                            c.trades.map((t) => (
                                                                <Tooltip key={t}>
                                                                    <TooltipTrigger asChild>
                                                                        <span className="text-sm cursor-default">{getTradeIcon(t as BroadTradeId)}</span>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>{getTradeLabel(t as BroadTradeId)}</TooltipContent>
                                                                </Tooltip>
                                                            ))
                                                        ) : (
                                                            <span className="text-[10px] text-muted-foreground/60">No skills set</span>
                                                        )}
                                                    </div>
                                                    {c.postcode && (
                                                        <div className="text-[10px] text-muted-foreground mt-0.5">{c.postcode}</div>
                                                    )}
                                                </td>

                                                {/* Day cells */}
                                                {dayColumns.map((col) => {
                                                    const dayJobs = c.jobs.filter((j) => j.date === col.key);
                                                    const amJob = dayJobs.find((j) => j.slot === 'am' || j.slot === 'full');
                                                    const pmJob = dayJobs.find((j) => j.slot === 'pm' || j.slot === 'full');
                                                    const slotExplicit = resolveSlot(c, col.key);
                                                    const notes = resolveNotes(c, col.key);
                                                    const isDirty = !!staged[c.id]?.[col.key];
                                                    const patternActive = c.weeklyPatterns.some((p) => p.dayOfWeek === col.dow);
                                                    const effSlot = slotExplicit === 'unset' && patternActive ? 'full_day' : slotExplicit;
                                                    const availAM = effSlot === 'full_day' || effSlot === 'am';
                                                    const availPM = effSlot === 'full_day' || effSlot === 'pm';
                                                    const fullyBooked = !!amJob && !!pmJob;

                                                    const halfState = (booked: boolean, avail: boolean): 'booked' | 'available' | 'off' | 'unset' =>
                                                        booked ? 'booked' : avail ? 'available' : effSlot === 'off' ? 'off' : 'unset';
                                                    const halfClass = (s: string) =>
                                                        s === 'booked' ? 'bg-red-500 text-white'
                                                            : s === 'available' ? 'bg-emerald-500 text-white'
                                                                : s === 'off' ? 'bg-zinc-200 dark:bg-zinc-700 text-muted-foreground'
                                                                    : 'bg-muted/40 text-muted-foreground/40';
                                                    const shortName = (n: string | null) => (n ? n.split(' ')[0].slice(0, 7) : 'JOB');
                                                    const amState = halfState(!!amJob, availAM);
                                                    const pmState = halfState(!!pmJob, availPM);

                                                    const cellInner = (
                                                        <div className={`relative h-12 w-full rounded-md overflow-hidden border ${fullyBooked ? 'border-red-500' : 'border-border'} ${isDirty ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}>
                                                            <div className={`h-1/2 flex items-center justify-center text-[9px] font-bold leading-none border-b border-background/40 ${halfClass(amState)}`}>
                                                                {amState === 'booked' ? shortName(amJob!.customerName) : amState === 'available' ? 'AM' : ''}
                                                            </div>
                                                            <div className={`h-1/2 flex items-center justify-center text-[9px] font-bold leading-none ${halfClass(pmState)}`}>
                                                                {pmState === 'booked' ? shortName(pmJob!.customerName) : pmState === 'available' ? 'PM' : ''}
                                                            </div>
                                                            {notes && <StickyNote className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-amber-400" />}
                                                        </div>
                                                    );

                                                    if (fullyBooked) {
                                                        return (
                                                            <td key={col.key} className="p-0">
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild><div className="cursor-default">{cellInner}</div></TooltipTrigger>
                                                                    <TooltipContent className="max-w-[240px] space-y-1">
                                                                        {dayJobs.map((j, i) => (
                                                                            <div key={i}>
                                                                                <span className="font-semibold">{j.customerName || 'Booked job'}</span>
                                                                                <span className="text-xs opacity-70"> · {j.slot === 'full' ? 'Full day' : j.slot.toUpperCase()}{j.scheduledTime ? ` ${j.scheduledTime}` : ''}</span>
                                                                                {j.jobDescription && <div className="text-xs">{j.jobDescription}</div>}
                                                                            </div>
                                                                        ))}
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </td>
                                                        );
                                                    }

                                                    return (
                                                        <td key={col.key} className="p-0">
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <button className="w-full" title={`${c.name} — ${col.weekday} ${col.dayNum}`}>{cellInner}</button>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="w-60" align="center">
                                                                    <div className="space-y-3">
                                                                        <div className="text-sm font-semibold">
                                                                            {c.name}
                                                                            <span className="block text-xs font-normal text-muted-foreground">
                                                                                {col.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                                                                            </span>
                                                                        </div>
                                                                        {(amJob || pmJob) && (
                                                                            <div className="text-[11px] text-white bg-red-500 rounded px-2 py-1">
                                                                                Booked {amJob ? `AM — ${amJob.customerName || 'job'}` : ''}{amJob && pmJob ? ' · ' : ''}{pmJob ? `PM — ${pmJob.customerName || 'job'}` : ''}
                                                                            </div>
                                                                        )}
                                                                        <div className="text-[10px] text-muted-foreground">Set availability</div>
                                                                        <div className="grid grid-cols-4 gap-1">
                                                                            {SLOT_ORDER.map((s) => (
                                                                                <Button
                                                                                    key={s}
                                                                                    size="sm"
                                                                                    variant={slotExplicit === s ? 'default' : 'outline'}
                                                                                    className="px-1 text-xs"
                                                                                    onClick={() => setCell(c.id, col.key, s, notes)}
                                                                                >
                                                                                    {SLOT_SHORT[s]}
                                                                                </Button>
                                                                            ))}
                                                                        </div>
                                                                        <Textarea
                                                                            placeholder={slotExplicit === 'unset' ? 'Set a status to add a note' : 'Call notes (e.g. "back from holiday Mon")'}
                                                                            value={notes}
                                                                            disabled={slotExplicit === 'unset'}
                                                                            rows={2}
                                                                            className="text-xs"
                                                                            onChange={(e) => setCell(c.id, col.key, slotExplicit === 'unset' ? 'off' : slotExplicit, e.target.value)}
                                                                        />
                                                                    </div>
                                                                </PopoverContent>
                                                            </Popover>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </TooltipProvider>
                    )}

                    {contractors.length > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-4">
                            Tip: each cell splits into morning (top) and afternoon (bottom) — red = booked (hover for the job), green = free, grey = off. Click a cell to set availability or log a call note; fully-booked days can't be edited.
                        </p>
                    )}
                </CardContent>
            </Card>

            <ContractorFormPanel
                open={!!editingContractor}
                onOpenChange={(o) => {
                    if (!o) {
                        setEditId(null);
                        queryClient.invalidateQueries({ queryKey: ['availability-matrix'] });
                    }
                }}
                editingContractor={editingContractor}
            />
        </div>
    );
}
