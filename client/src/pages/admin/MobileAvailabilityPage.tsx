import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { slotFromWindow } from '@shared/slot-times';
import { useToast } from '@/hooks/use-toast';
import { CalendarDays, Loader2, AlertCircle, Check } from 'lucide-react';

// ============================================================================
// Mobile Availability — VA/admin tool for opening up contractor booking days.
//
// Ben (role 'va') reaches admin endpoints via requireAdmin, which accepts both
// 'admin' and 'va'. This page reuses the exact same write path as the desktop
// Availability Board (PUT /api/admin/contractors/:id/availability) but is
// built phone-first: pick a contractor, then tap Off / AM / PM / All-day on a
// simple vertical day list. Each tap saves immediately (optimistic + rollback),
// so there's no "did it save?" ambiguity when Ben's working from his phone.
// ============================================================================

const getAdminToken = (): string => localStorage.getItem('adminToken') || '';

type Slot = 'off' | 'am' | 'pm' | 'full_day';

interface Contractor {
    id: string;
    firstName: string | null;
    lastName: string | null;
    isStaleAvailability?: boolean;
    weeklyPatterns: { dayOfWeek: number; startTime: string | null; endTime: string | null; isActive: boolean }[];
    upcomingOverrides: { date: string; isAvailable: boolean; startTime: string | null; endTime: string | null }[];
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SLOTS: { value: Slot; label: string; active: string }[] = [
    { value: 'off', label: 'Off', active: 'bg-slate-200 text-slate-700 border-slate-300' },
    { value: 'am', label: 'AM', active: 'bg-amber-500 text-white border-amber-500' },
    { value: 'pm', label: 'PM', active: 'bg-indigo-500 text-white border-indigo-500' },
    { value: 'full_day', label: 'All day', active: 'bg-emerald-600 text-white border-emerald-600' },
];

// Normalise a stored (start,end) window into one of our tappable slots.
function windowToSlot(start: string | null, end: string | null): Slot {
    const s = slotFromWindow(start, end);
    return s === 'other' ? 'full_day' : s;
}

// UTC "YYYY-MM-DD" key — matches how the server parses a bare date string
// (new Date('YYYY-MM-DD') → UTC midnight) and how the booking engine keys days.
function dateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function displayName(c: Contractor): string {
    const first = c.firstName?.trim() || '';
    const lastInitial = c.lastName?.trim()?.[0];
    return [first, lastInitial ? `${lastInitial}.` : ''].filter(Boolean).join(' ') || 'Contractor';
}

export default function MobileAvailabilityPage() {
    const { toast } = useToast();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [weeksToShow, setWeeksToShow] = useState(4);
    // Local edits + server baseline, keyed `${contractorId}:${dateKey}` → Slot.
    const [edits, setEdits] = useState<Record<string, Slot>>({});
    const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});

    const { data: contractors, isLoading, isError, refetch } = useQuery<Contractor[]>({
        queryKey: ['mobile-availability-contractors'],
        queryFn: async () => {
            const res = await fetch('/api/admin/contractors', {
                headers: { Authorization: `Bearer ${getAdminToken()}` },
            });
            if (!res.ok) throw new Error('Failed to load contractors');
            return res.json();
        },
    });

    // Contractors sorted for display — the pills and the default selection both
    // read from this so the highlighted (and shown) contractor is always the
    // first visible pill, not an off-screen most-recently-created row.
    const sorted = useMemo(
        () => (contractors ?? []).slice().sort((a, b) => displayName(a).localeCompare(displayName(b))),
        [contractors],
    );

    // Default the selection to the first sorted contractor once loaded.
    const selected = useMemo(() => {
        if (!sorted.length) return null;
        return sorted.find((c) => c.id === selectedId) ?? sorted[0];
    }, [sorted, selectedId]);

    // Server baseline slot for a given contractor + day: date override wins,
    // else the recurring weekly pattern, else Off.
    const baselineSlot = useMemo(() => {
        return (c: Contractor, key: string, dow: number): Slot => {
            const override = c.upcomingOverrides.find((o) => dateKey(new Date(o.date)) === key);
            if (override) return override.isAvailable ? windowToSlot(override.startTime, override.endTime) : 'off';
            const pattern = c.weeklyPatterns.find((p) => p.dayOfWeek === dow && p.isActive);
            if (pattern) return windowToSlot(pattern.startTime, pattern.endTime);
            return 'off';
        };
    }, []);

    const days = useMemo(() => {
        const now = new Date();
        const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        return Array.from({ length: weeksToShow * 7 }, (_, i) => {
            const d = new Date(start);
            d.setUTCDate(d.getUTCDate() + i);
            return d;
        });
    }, [weeksToShow]);

    function resolveSlot(c: Contractor, key: string, dow: number): Slot {
        const edited = edits[`${c.id}:${key}`];
        return edited ?? baselineSlot(c, key, dow);
    }

    async function setSlot(c: Contractor, key: string, dow: number, slot: Slot) {
        const editKey = `${c.id}:${key}`;
        const prev = resolveSlot(c, key, dow);
        if (prev === slot) return;

        setEdits((e) => ({ ...e, [editKey]: slot }));
        setSavingKeys((s) => ({ ...s, [editKey]: true }));
        try {
            const res = await fetch(`/api/admin/contractors/${c.id}/availability`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
                body: JSON.stringify({
                    dates: [{ date: key, slot, isAvailable: slot !== 'off', notes: null }],
                }),
            });
            if (!res.ok) throw new Error('Save failed');
        } catch (err) {
            // Roll back to what it was before the tap.
            setEdits((e) => ({ ...e, [editKey]: prev }));
            toast({ title: "Couldn't save", description: 'Check your connection and try again.', variant: 'destructive' });
        } finally {
            setSavingKeys((s) => {
                const next = { ...s };
                delete next[editKey];
                return next;
            });
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24 text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading contractors…
            </div>
        );
    }

    if (isError) {
        return (
            <div className="max-w-md mx-auto px-4 py-16 text-center">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
                <p className="text-slate-700 font-medium mb-4">Couldn't load contractors.</p>
                <button onClick={() => refetch()} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold">
                    Try again
                </button>
            </div>
        );
    }

    if (!contractors?.length) {
        return <div className="max-w-md mx-auto px-4 py-16 text-center text-slate-500">No contractors found.</div>;
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-5 pb-28">
            {/* Header */}
            <div className="mb-4">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <CalendarDays className="w-6 h-6 text-emerald-600" /> Availability
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    Open up days so customers can book. Tap a slot — it saves instantly.
                </p>
            </div>

            {/* Contractor picker — horizontal scroll pills */}
            <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/90 backdrop-blur border-b border-slate-100">
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {sorted.map((c) => {
                            const isSel = selected?.id === c.id;
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => setSelectedId(c.id)}
                                    className={
                                        'shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ' +
                                        (isSel
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-white text-slate-600 border-slate-200')
                                    }
                                >
                                    {displayName(c)}
                                    {c.isStaleAvailability && (
                                        <span
                                            className={'inline-block w-1.5 h-1.5 rounded-full ml-1.5 align-middle ' + (isSel ? 'bg-amber-300' : 'bg-amber-500')}
                                            title="No recent availability set"
                                        />
                                    )}
                                </button>
                            );
                        })}
                </div>
            </div>

            {/* Day list */}
            {selected && (
                <div className="mt-4 space-y-2">
                    {days.map((d) => {
                        const key = dateKey(d);
                        const dow = d.getUTCDay();
                        const current = resolveSlot(selected, key, dow);
                        const editKey = `${selected.id}:${key}`;
                        const saving = savingKeys[editKey];
                        const isMonday = dow === 1;

                        return (
                            <div key={key}>
                                {isMonday && (
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 px-1 pt-3 pb-1">
                                        Week of {d.getUTCDate()} {MONTH[d.getUTCMonth()]}
                                    </div>
                                )}
                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-base font-bold text-slate-900">{WEEKDAY[dow]}</span>
                                            <span className="text-sm text-slate-500">
                                                {d.getUTCDate()} {MONTH[d.getUTCMonth()]}
                                            </span>
                                        </div>
                                        {saving ? (
                                            <span className="text-[11px] text-slate-400 flex items-center gap-1">
                                                <Loader2 className="w-3 h-3 animate-spin" /> Saving
                                            </span>
                                        ) : current !== 'off' ? (
                                            <span className="text-[11px] text-emerald-600 flex items-center gap-1 font-medium">
                                                <Check className="w-3 h-3" /> Bookable
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {SLOTS.map((s) => {
                                            const isActive = current === s.value;
                                            return (
                                                <button
                                                    key={s.value}
                                                    onClick={() => setSlot(selected, key, dow, s.value)}
                                                    disabled={saving}
                                                    className={
                                                        'py-2.5 rounded-lg text-sm font-semibold border transition-colors ' +
                                                        (isActive ? s.active : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300') +
                                                        (saving ? ' opacity-60' : '')
                                                    }
                                                >
                                                    {s.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    <button
                        onClick={() => setWeeksToShow((w) => w + 4)}
                        className="w-full mt-3 py-3 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-500"
                    >
                        Show 4 more weeks
                    </button>
                </div>
            )}
        </div>
    );
}
