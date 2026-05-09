// client/src/pages/admin/control-tower/ExceptionsQueue.tsx
//
// Module 08 — Control Tower View 4: Exceptions Queue.
// Things that need a human right now. Severity-then-age sorted.
//
// Data source: GET /api/admin/dispatch/exceptions.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { adminFetch } from '@/lib/adminFetch';

interface ExceptionRow {
    id: string;
    type: string;
    severity: 'crit' | 'warn' | 'info';
    booking_id: string | null;
    dispatch_id: string | null;
    message: string;
    suggested_action: string;
    created_at: string;
}

const SEVERITY_STYLES: Record<ExceptionRow['severity'], { card: string; icon: any; iconColor: string; label: string }> = {
    crit: {
        card: 'border-red-300 bg-red-50',
        icon: AlertTriangle,
        iconColor: 'text-red-700',
        label: 'CRITICAL',
    },
    warn: {
        card: 'border-amber-300 bg-amber-50',
        icon: AlertCircle,
        iconColor: 'text-amber-700',
        label: 'WARN',
    },
    info: {
        card: 'border-blue-300 bg-blue-50',
        icon: Info,
        iconColor: 'text-blue-700',
        label: 'INFO',
    },
};

async function fetchExceptions(severity: string): Promise<ExceptionRow[]> {
    const params = new URLSearchParams();
    if (severity !== 'all') params.set('severity', severity);
    const res = await adminFetch(`/api/admin/dispatch/exceptions?${params}`);
    if (!res.ok) throw new Error(`Failed to load exceptions: ${res.status}`);
    return (await res.json()).data ?? [];
}

const FILTER_CHIPS = [
    { id: 'all', label: 'All' },
    { id: 'crit', label: 'Critical' },
    { id: 'warn', label: 'Warning' },
    { id: 'info', label: 'Info' },
];

export default function ExceptionsQueue() {
    const [filter, setFilter] = useState<string>('all');
    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-control-tower-exceptions', filter],
        queryFn: () => fetchExceptions(filter),
        refetchInterval: 30_000,
    });

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                {FILTER_CHIPS.map((c) => (
                    <button
                        key={c.id}
                        onClick={() => setFilter(c.id)}
                        className={cn(
                            'px-3 py-1 text-xs rounded-full border transition-colors',
                            filter === c.id
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50',
                        )}
                    >
                        {c.label}
                    </button>
                ))}
            </div>

            {isLoading && (
                <Card><CardContent className="p-6 text-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></CardContent></Card>
            )}
            {error && (
                <Card className="border border-amber-200 bg-amber-50">
                    <CardContent className="p-3 text-sm text-amber-900">{(error as Error).message}</CardContent>
                </Card>
            )}
            {data && data.length === 0 && (
                <Card><CardContent className="p-6 text-center text-slate-500 text-sm">All clear — no exceptions matching filter.</CardContent></Card>
            )}

            <div className="space-y-2">
                {(data ?? []).map((row) => {
                    const styles = SEVERITY_STYLES[row.severity];
                    const Icon = styles.icon;
                    return (
                        <Card key={row.id} className={cn('border', styles.card)} data-testid={`exception-${row.id}`}>
                            <CardContent className="p-3 flex items-start gap-3">
                                <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', styles.iconColor)} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                        <span className={cn('text-[10px] font-bold tracking-wider', styles.iconColor)}>
                                            {styles.label}
                                        </span>
                                        <span className="text-[10px] uppercase tracking-wider text-slate-500">
                                            {row.type.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                    <div className="text-sm text-slate-900">{row.message}</div>
                                    <div className="text-xs text-slate-600 mt-1">
                                        Suggested: {row.suggested_action}
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    {row.booking_id && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                                // Resolution flow placeholder — open quote in new tab.
                                                window.open(`/admin/quotes/${row.booking_id}/edit`, '_blank');
                                            }}
                                            data-testid={`btn-resolve-${row.id}`}
                                        >
                                            Resolve
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
