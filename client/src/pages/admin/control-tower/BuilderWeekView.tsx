// client/src/pages/admin/control-tower/BuilderWeekView.tsx
//
// Module 08 — Control Tower View 3: Builder Week (read-only in manual mode).
//
// Calendar grid: rows = Builders, columns = next 7 days (rolling).
// Each cell shows commitment status + assigned pack value.
// Until Phase 5 ships the day-pack solver, this view is read-only.
//
// Data source: GET /api/admin/dispatch/builder-week.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { adminFetch } from '@/lib/adminFetch';

interface BuilderDay {
    date: string;
    commitment_id: string | null;
    status: string;
    target_pence: number | null;
    booked_pence: number;
    pack_id: string | null;
    pack_status: string | null;
    coverage_pct: number | null;
}

interface BuilderRow {
    unit_id: string;
    unit_name: string;
    day_rate_target_pence: number | null;
    days: BuilderDay[];
}

async function fetchWeek(): Promise<{ data: BuilderRow[]; meta: any }> {
    const res = await adminFetch('/api/admin/dispatch/builder-week');
    if (res.status === 503) throw new Error('Control Tower disabled (FF_CONTROL_TOWER=0)');
    if (!res.ok) throw new Error(`Failed to load builder week: ${res.status}`);
    return res.json();
}

function cellStyle(day: BuilderDay): { className: string; label: string } {
    if (day.status === 'none' || !day.commitment_id) {
        return {
            className: 'bg-slate-50 text-slate-400 border border-slate-200',
            label: '—',
        };
    }
    const cov = day.coverage_pct ?? 0;
    if (cov >= 1.0) {
        return {
            className: 'bg-emerald-100 text-emerald-900 border border-emerald-300',
            label: `✓ ${Math.round(cov * 100)}%`,
        };
    }
    if (cov >= 0.7) {
        return {
            className: 'bg-amber-100 text-amber-900 border border-amber-300',
            label: `⚠ ${Math.round(cov * 100)}%`,
        };
    }
    return {
        className: 'bg-red-100 text-red-900 border border-red-300',
        label: `✗ ${Math.round(cov * 100)}%`,
    };
}

function poundsFromPence(p: number | null): string {
    if (p == null) return '—';
    return `£${(p / 100).toFixed(0)}`;
}

function dayHeader(date: string): string {
    const d = new Date(date + 'T00:00:00Z');
    const w = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    const dn = d.getUTCDate();
    return `${w} ${dn}`;
}

export default function BuilderWeekView() {
    const [drawer, setDrawer] = useState<{ unit: BuilderRow; day: BuilderDay } | null>(null);
    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-control-tower-builder-week'],
        queryFn: fetchWeek,
        refetchInterval: 60_000,
    });

    if (isLoading) {
        return (
            <Card><CardContent className="p-8 text-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></CardContent></Card>
        );
    }

    if (error) {
        return (
            <Card className="border border-amber-200 bg-amber-50">
                <CardContent className="p-3 text-sm text-amber-900 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {(error as Error).message}
                </CardContent>
            </Card>
        );
    }

    const rows = data?.data ?? [];
    if (rows.length === 0) {
        return (
            <Card><CardContent className="p-8 text-center text-slate-500 text-sm">
                No Builder units. Add Builders via /admin/units to populate this view.
            </CardContent></Card>
        );
    }

    const days = rows[0].days.map((d) => d.date);

    return (
        <div className="space-y-3">
            <div className="text-xs text-slate-500">
                Read-only in manual mode. Phase 5 day-pack solver will fill cells automatically.
                Click a cell for details.
            </div>
            <Card className="border border-slate-200 overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                        <tr>
                            <th className="px-3 py-2 text-left font-semibold">Builder</th>
                            {days.map((d) => (
                                <th key={d} className="px-2 py-2 text-center font-semibold whitespace-nowrap">
                                    {dayHeader(d)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.unit_id} className="border-t border-slate-200">
                                <td className="px-3 py-2 font-medium text-slate-900 whitespace-nowrap">
                                    <div>{row.unit_name}</div>
                                    <div className="text-[10px] text-slate-500">target {poundsFromPence(row.day_rate_target_pence)}/day</div>
                                </td>
                                {row.days.map((day) => {
                                    const s = cellStyle(day);
                                    return (
                                        <td key={day.date} className="px-1.5 py-1.5 text-center">
                                            <button
                                                onClick={() => setDrawer({ unit: row, day })}
                                                className={cn(
                                                    'w-full px-2 py-2 rounded-md text-[11px] font-semibold transition-shadow hover:shadow-sm',
                                                    s.className,
                                                )}
                                                data-testid={`cell-${row.unit_id}-${day.date}`}
                                            >
                                                {s.label}
                                            </button>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>

            <Dialog open={drawer !== null} onOpenChange={(o) => !o && setDrawer(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {drawer?.unit.unit_name} · {drawer?.day.date}
                        </DialogTitle>
                    </DialogHeader>
                    {drawer && (
                        <div className="text-sm space-y-2 text-slate-700">
                            <div>Status: <code className="bg-slate-100 px-1 rounded">{drawer.day.status}</code></div>
                            <div>Target: {poundsFromPence(drawer.day.target_pence)}</div>
                            <div>Booked: {poundsFromPence(drawer.day.booked_pence)}</div>
                            <div>
                                Coverage: {drawer.day.coverage_pct == null
                                    ? '—'
                                    : `${Math.round(drawer.day.coverage_pct * 100)}%`}
                            </div>
                            <div>Pack: {drawer.day.pack_id ?? <span className="italic text-slate-400">none</span>}</div>
                            {drawer.day.pack_status && <div>Pack status: {drawer.day.pack_status}</div>}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
