// client/src/pages/admin/control-tower/InboundQueue.tsx
//
// Module 08 — Control Tower View 1: Inbound Queue.
// Lists quotes in booked_pending_routing / reserved_for_pack / offer_round_*,
// sorted age-oldest-first. 30s polling. Click → opens quote in new tab.
//
// Data source: GET /api/admin/dispatch/inbound (control-tower-routes.ts).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, ExternalLink, Clock, MapPin, Wrench, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { adminFetch } from '@/lib/adminFetch';

interface InboundProfile {
    crew_size: number;
    skills: string[];
    certs: string[];
    duration_minutes: number;
    requires_team: boolean;
    requires_specialist: boolean;
    customer_flexibility: string;
}

export interface InboundRow {
    id: string;
    slug: string | null;
    postcode: string | null;
    booking_state: string;
    flex_tier: string | null;
    booked_at: string | null;
    age_minutes: number;
    lane_selected: string | null;
    suggested_unit_id: string | null;
    profile: InboundProfile;
    job_summary: string | null;
}

const STATE_BADGE: Record<string, string> = {
    booked_pending_routing: 'bg-blue-100 text-blue-900 border border-blue-200',
    reserved_for_pack: 'bg-indigo-100 text-indigo-900 border border-indigo-200',
    offer_round_1: 'bg-amber-100 text-amber-900 border border-amber-200',
    offer_round_2: 'bg-amber-200 text-amber-900 border border-amber-300',
    offer_round_3: 'bg-orange-200 text-orange-900 border border-orange-300',
    cross_lane_fallback: 'bg-red-200 text-red-900 border border-red-300',
};

async function fetchInbound(filters: { ageThresholdMin?: number }): Promise<InboundRow[]> {
    const params = new URLSearchParams();
    if (filters.ageThresholdMin) params.set('age_threshold_min', String(filters.ageThresholdMin));
    const res = await adminFetch(`/api/admin/dispatch/inbound?${params}`);
    if (res.status === 503) {
        throw new Error('Control Tower disabled (FF_CONTROL_TOWER=0)');
    }
    if (!res.ok) {
        throw new Error(`Failed to load inbound queue: ${res.status}`);
    }
    const json = await res.json();
    return json.data ?? [];
}

function ageLabel(min: number): string {
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    const remM = min % 60;
    return remM === 0 ? `${hr}h` : `${hr}h ${remM}m`;
}

const AGE_FILTERS: Array<{ id: string; label: string; minutes?: number }> = [
    { id: 'all', label: 'All ages' },
    { id: '30m', label: '> 30m', minutes: 30 },
    { id: '2h', label: '> 2h', minutes: 120 },
    { id: '24h', label: '> 24h', minutes: 60 * 24 },
];

export default function InboundQueue() {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [ageFilter, setAgeFilter] = useState<string>('all');
    const [activeRow, setActiveRow] = useState<InboundRow | null>(null);
    const [overrideUnitId, setOverrideUnitId] = useState('');
    const [overrideReason, setOverrideReason] = useState('');

    const ageThresholdMin = AGE_FILTERS.find((f) => f.id === ageFilter)?.minutes;

    const inboundQuery = useQuery({
        queryKey: ['admin-control-tower-inbound', ageFilter],
        queryFn: () => fetchInbound({ ageThresholdMin }),
        refetchInterval: 30_000, // 30s polling per Module 08 spec
    });

    const manualRoute = useMutation({
        mutationFn: async (payload: { booking_id: string; unit_id: string; reason: string }) => {
            const res = await adminFetch('/api/admin/dispatch/manual-route', {
                method: 'POST',
                body: JSON.stringify({
                    booking_id: payload.booking_id,
                    unit_id: payload.unit_id,
                    action: 'send_to_unit',
                    reason: payload.reason,
                }),
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Manual route failed: ${res.status} ${text}`);
            }
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Override recorded', description: 'Routing decision audit row written.' });
            queryClient.invalidateQueries({ queryKey: ['admin-control-tower-inbound'] });
            setActiveRow(null);
            setOverrideUnitId('');
            setOverrideReason('');
        },
        onError: (err: any) => {
            toast({
                title: 'Manual route failed',
                description: err?.message ?? 'unknown error',
                variant: 'destructive',
            });
        },
    });

    const rows = inboundQuery.data ?? [];
    const error = inboundQuery.error as Error | null;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">Age:</span>
                    {AGE_FILTERS.map((f) => (
                        <button
                            key={f.id}
                            onClick={() => setAgeFilter(f.id)}
                            className={cn(
                                'px-3 py-1 text-xs rounded-full border transition-colors',
                                ageFilter === f.id
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50',
                            )}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <div className="text-xs text-slate-500">
                    {inboundQuery.isFetching ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null}
                    {' '}{rows.length} rows · auto-refresh 30s
                </div>
            </div>

            {error && (
                <Card className="border border-amber-200 bg-amber-50">
                    <CardContent className="p-3 text-sm text-amber-900 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        {error.message}
                    </CardContent>
                </Card>
            )}

            {!error && rows.length === 0 && (
                <Card className="border border-slate-200">
                    <CardContent className="p-8 text-center text-slate-500 text-sm">
                        Inbound queue is clear.
                    </CardContent>
                </Card>
            )}

            <div className="space-y-2">
                {rows.map((row) => (
                    <Card
                        key={row.id}
                        className="border border-slate-200 hover:shadow-md transition-shadow"
                        data-testid={`inbound-row-${row.id}`}
                    >
                        <CardContent className="p-4">
                            <div className="flex flex-wrap items-start gap-4 justify-between">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                        <span className={cn(
                                            'text-xs px-2 py-0.5 rounded-full font-semibold',
                                            STATE_BADGE[row.booking_state] ?? 'bg-slate-100 text-slate-700 border border-slate-200',
                                        )}>
                                            {row.booking_state}
                                        </span>
                                        <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {ageLabel(row.age_minutes)}
                                        </span>
                                        {row.postcode && (
                                            <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                                                <MapPin className="h-3 w-3" />
                                                {row.postcode}
                                            </span>
                                        )}
                                        {row.flex_tier && (
                                            <Badge variant="secondary" className="text-[10px]">
                                                flex: {row.flex_tier}
                                            </Badge>
                                        )}
                                        <span className="text-xs text-slate-400">
                                            lane: {row.lane_selected ?? '—'}
                                        </span>
                                    </div>
                                    <div className="text-sm text-slate-800 line-clamp-2">
                                        {row.job_summary ?? <span className="italic text-slate-400">no description</span>}
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap mt-2">
                                        <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                                            <Wrench className="h-3 w-3" />
                                            crew {row.profile.crew_size}
                                        </span>
                                        {row.profile.skills.slice(0, 4).map((s) => (
                                            <span key={s} className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-700">
                                                {s}
                                            </span>
                                        ))}
                                        {row.profile.certs.length > 0 && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 rounded text-emerald-800 font-semibold">
                                                cert: {row.profile.certs.join(', ')}
                                            </span>
                                        )}
                                        {row.profile.duration_minutes > 0 && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-700">
                                                {row.profile.duration_minutes}m
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setActiveRow(row)}
                                        data-testid={`btn-manual-route-${row.id}`}
                                    >
                                        Manual route
                                    </Button>
                                    {row.slug && (
                                        <a
                                            href={`/quote/${row.slug}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 px-2 py-1 border border-slate-300 rounded-md"
                                        >
                                            <ExternalLink className="h-3 w-3" /> Quote
                                        </a>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Dialog open={activeRow !== null} onOpenChange={(open) => !open && setActiveRow(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Manual route override</DialogTitle>
                    </DialogHeader>
                    {activeRow && (
                        <div className="space-y-3 text-sm">
                            <div className="text-slate-600">
                                Booking <code className="bg-slate-100 px-1 rounded">{activeRow.id}</code> ·
                                state <code className="bg-slate-100 px-1 rounded">{activeRow.booking_state}</code>
                            </div>
                            <label className="block">
                                <span className="text-xs font-medium text-slate-700">Unit ID</span>
                                <Input
                                    value={overrideUnitId}
                                    onChange={(e) => setOverrideUnitId(e.target.value)}
                                    placeholder="e.g. unit_abc123"
                                    data-testid="input-unit-id"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-slate-700">Reason (audit)</span>
                                <Input
                                    value={overrideReason}
                                    onChange={(e) => setOverrideReason(e.target.value)}
                                    placeholder="why are you overriding?"
                                    data-testid="input-reason"
                                />
                            </label>
                            <div className="flex justify-end gap-2 pt-1">
                                <Button variant="ghost" onClick={() => setActiveRow(null)}>Cancel</Button>
                                <Button
                                    disabled={!overrideUnitId || !overrideReason || manualRoute.isPending}
                                    onClick={() => manualRoute.mutate({
                                        booking_id: activeRow.id,
                                        unit_id: overrideUnitId,
                                        reason: overrideReason,
                                    })}
                                    className="bg-amber-500 text-slate-900 hover:bg-amber-400"
                                    data-testid="btn-confirm-override"
                                >
                                    {manualRoute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send to unit'}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
