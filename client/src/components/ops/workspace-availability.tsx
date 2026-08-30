/**
 * AvailabilityGridView — date-capacity grid for the Ops Workspace side panel
 * (C-WP3). Mirrors the ops-manager agent's get_contractor_availability tool:
 * per-date network capacity (free = available − booked contractors), plus an
 * optional per-contractor resolved day row when a contractorId is given.
 *
 * Read-only. Fetches GET /api/admin/availability/capacity with the admin
 * token. `dates` come from the agent's tool input; when empty we default to
 * the next 7 days (Europe/London day keys, same pattern as ActivityPage).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

interface CapacityDay {
    date: string;
    masterBlocked?: boolean;
    available?: number;
    booked?: number;
    free: number;
}

interface ContractorDay {
    date: string;
    isAvailable: boolean;
    source: 'master_blocked' | 'override' | 'pattern' | 'master_pattern' | 'default_off';
    startTime?: string | null;
    endTime?: string | null;
    notes?: string | null;
    reason?: string | null;
}

interface CapacityResponse {
    capacity: CapacityDay[];
    contractorDays?: ContractorDay[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Next `n` day keys starting today — Europe/London calendar days (sv-SE
 *  locale yields YYYY-MM-DD, same pattern as ActivityPage.tsx). */
function nextDays(n: number): string[] {
    const now = Date.now();
    return Array.from({ length: n }, (_, i) =>
        new Date(now + i * DAY_MS).toLocaleDateString('sv-SE', { timeZone: 'Europe/London' }));
}

/** "Mon 2 Sep" — UTC-midnight date rendered in Europe/London stays same-day. */
function dayLabel(dateStr: string): string {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London',
    });
}

function freeTone(free: number, blocked: boolean): string {
    if (blocked) return 'border-slate-200 bg-slate-100 text-slate-500';
    if (free <= 0) return 'border-red-200 bg-red-50 text-red-700';
    if (free === 1) return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

const SOURCE_LABEL: Record<ContractorDay['source'], string> = {
    master_blocked: 'blocked',
    override: 'override',
    pattern: 'pattern',
    master_pattern: 'default',
    default_off: 'off',
};

export function AvailabilityGridView({ dates, contractorId }: { dates: string[]; contractorId?: string }): JSX.Element {
    const effectiveDates = useMemo(() => {
        const cleaned = (dates ?? []).filter((d) => DATE_RE.test(d)).slice(0, 14);
        return cleaned.length > 0 ? cleaned : nextDays(7);
    }, [dates]);

    const { data, isLoading, error } = useQuery<CapacityResponse>({
        queryKey: ['ops-availability-capacity', effectiveDates.join(','), contractorId ?? ''],
        queryFn: async () => {
            const params = new URLSearchParams({ dates: effectiveDates.join(',') });
            if (contractorId) params.set('contractorId', contractorId);
            const res = await fetch(`/api/admin/availability/capacity?${params.toString()}`, {
                headers: authHeaders(),
            });
            if (!res.ok) throw new Error(`Capacity fetch failed (${res.status})`);
            return res.json() as Promise<CapacityResponse>;
        },
        staleTime: 30_000,
    });

    if (isLoading) {
        return (
            <div className="flex items-center gap-1.5 p-3 text-xs text-slate-500" data-testid="availability-grid-loading">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading capacity…
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center gap-1.5 p-3 text-xs text-red-600" data-testid="availability-grid-error">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error instanceof Error ? error.message : 'Failed to load capacity'}
            </div>
        );
    }

    const days = data?.capacity ?? [];
    if (days.length === 0) {
        return (
            <div className="flex items-center gap-1.5 p-3 text-xs text-slate-500" data-testid="availability-grid-empty">
                <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                No dates to show.
            </div>
        );
    }

    const contractorByDate = new Map<string, ContractorDay>(
        (data?.contractorDays ?? []).map((d) => [d.date, d]),
    );

    return (
        <div className="space-y-1 p-2 text-xs" data-testid="availability-grid">
            <div className="flex items-center gap-1.5 px-1 pb-1 font-medium text-slate-700">
                <CalendarRange className="h-3.5 w-3.5 text-slate-500" />
                Network capacity
                <span className="ml-auto text-[10px] font-normal text-slate-400">
                    {days.length} day{days.length === 1 ? '' : 's'}
                </span>
            </div>

            {days.map((day) => {
                const blocked = day.masterBlocked === true;
                const cDay = contractorByDate.get(day.date);
                return (
                    <div
                        key={day.date}
                        className={cn('rounded-md border px-2 py-1.5', freeTone(day.free, blocked))}
                        data-testid={`availability-day-${day.date}`}
                    >
                        <div className="flex items-baseline gap-2">
                            <span className="font-medium">{dayLabel(day.date)}</span>
                            {blocked ? (
                                <span className="ml-auto font-semibold uppercase tracking-wide text-[10px]">Blocked</span>
                            ) : (
                                <>
                                    <span className="ml-auto text-sm font-semibold tabular-nums">{day.free}</span>
                                    <span className="text-[10px] opacity-80">free</span>
                                </>
                            )}
                        </div>
                        {!blocked && (
                            <div className="mt-0.5 text-[10px] opacity-80">
                                {day.booked ?? 0} booked · {day.available ?? 0} available
                            </div>
                        )}

                        {cDay && (
                            <div
                                className={cn(
                                    'mt-1 flex items-center gap-1.5 rounded border bg-white/70 px-1.5 py-1 text-[10px]',
                                    cDay.isAvailable ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-500',
                                )}
                                data-testid={`availability-contractor-${day.date}`}
                            >
                                <span
                                    className={cn(
                                        'h-1.5 w-1.5 shrink-0 rounded-full',
                                        cDay.isAvailable ? 'bg-emerald-500' : 'bg-slate-400',
                                    )}
                                />
                                <span className="font-medium">
                                    {cDay.isAvailable ? 'Contractor available' : 'Contractor off'}
                                </span>
                                {cDay.isAvailable && cDay.startTime && cDay.endTime && (
                                    <span className="tabular-nums">{cDay.startTime}–{cDay.endTime}</span>
                                )}
                                <span className="ml-auto opacity-70">{SOURCE_LABEL[cDay.source] ?? cDay.source}</span>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
