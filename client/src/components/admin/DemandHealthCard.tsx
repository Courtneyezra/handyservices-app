// client/src/components/admin/DemandHealthCard.tsx
//
// Module 08 — Control Tower top-of-page metric.
// Compact card with the live demand-health ratio (flex quotes vs Builder
// commits) plus a status chip (healthy / warning / critical).
//
// Data source: GET /api/admin/dispatch/demand-health  (control-tower-routes.ts).
// Refs: docs/architecture/modules/08-control-tower.md §2.5.

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Activity, TrendingUp, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { adminFetch } from '@/lib/adminFetch';

export interface DemandHealth {
    window_days: number;
    quotes_in_window: number;
    builder_commits_in_window: number;
    builder_commit_target_pence: number;
    ratio: number | null;
    status: 'healthy' | 'warning' | 'critical';
    capacity_pressure: 'low' | 'moderate' | 'high';
}

const STATUS_STYLES: Record<DemandHealth['status'], { chip: string; iconBg: string; label: string }> = {
    healthy: {
        chip: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
        iconBg: 'bg-emerald-50 text-emerald-700',
        label: 'Healthy',
    },
    warning: {
        chip: 'bg-amber-100 text-amber-900 border border-amber-200',
        iconBg: 'bg-amber-50 text-amber-700',
        label: 'Tightening',
    },
    critical: {
        chip: 'bg-red-100 text-red-800 border border-red-200',
        iconBg: 'bg-red-50 text-red-700',
        label: 'Pressure',
    },
};

async function fetchDemandHealth(): Promise<DemandHealth> {
    const res = await adminFetch('/api/admin/dispatch/demand-health');
    if (res.status === 503) {
        throw new Error('Control Tower disabled (FF_CONTROL_TOWER=0)');
    }
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to load demand health: ${res.status} ${body}`);
    }
    return res.json();
}

export default function DemandHealthCard() {
    const { data, isError, error, isLoading } = useQuery({
        queryKey: ['admin-demand-health'],
        queryFn: fetchDemandHealth,
        refetchInterval: 60_000, // refresh once a minute
    });

    if (isLoading) {
        return (
            <Card className="border border-slate-200">
                <CardContent className="p-4 text-sm text-slate-500">
                    Loading demand health…
                </CardContent>
            </Card>
        );
    }

    if (isError || !data) {
        return (
            <Card className="border border-amber-200 bg-amber-50">
                <CardContent className="p-4 text-sm text-amber-900">
                    Demand health unavailable: {(error as Error)?.message ?? 'unknown'}
                </CardContent>
            </Card>
        );
    }

    const styles = STATUS_STYLES[data.status];
    const ratioStr = data.ratio == null ? '—' : data.ratio.toFixed(2) + '×';

    return (
        <TooltipProvider delayDuration={150}>
            <Card className="border border-slate-200" data-testid="demand-health-card">
                <CardContent className="p-4 flex items-center gap-4">
                    <div className={cn('rounded-md p-2.5', styles.iconBg)}>
                        {data.status === 'healthy'
                            ? <TrendingUp className="h-5 w-5" />
                            : data.status === 'warning'
                                ? <Activity className="h-5 w-5" />
                                : <AlertTriangle className="h-5 w-5" />}
                    </div>
                    <div className="flex-1">
                        <div className="flex items-baseline gap-3">
                            <div className="text-3xl font-bold tracking-tight text-slate-900">
                                {ratioStr}
                            </div>
                            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                                Demand Health
                            </div>
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="cursor-help underline decoration-dotted underline-offset-4">
                                        {data.quotes_in_window} flex quotes / {data.builder_commits_in_window} builder commits
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-xs text-xs">
                                    Window: next {data.window_days} days for flex quotes (Flexible + Relaxed
                                    in inbound states); 7 days for Builder commits.
                                    Target Builder coverage: £{(data.builder_commit_target_pence / 100).toFixed(0)}.
                                    Healthy ≥ 3.5×; Warning 2–3.5×; Critical &lt; 2×.
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    </div>
                    <div>
                        <span
                            className={cn(
                                'inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full',
                                styles.chip,
                            )}
                            data-testid="demand-health-status"
                        >
                            {styles.label}
                        </span>
                    </div>
                </CardContent>
            </Card>
        </TooltipProvider>
    );
}
