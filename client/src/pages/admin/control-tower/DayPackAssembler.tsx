// client/src/pages/admin/control-tower/DayPackAssembler.tsx
//
// Module 08 — Control Tower View 2: Day-Pack Assembler (manual mode).
//
// Two-column layout:
//   Left  — filter pane (Builder unit, target date, area)
//   Right — candidate quotes that match
//
// Manual mode: dispatcher curates a list and POSTs to /manual-route per quote
// with action='send_to_unit'. Phase 5 day-pack solver will replace this with
// automated bin-packing once FF_DAY_PACK is on.
//
// If FF_DAY_PACK is off we surface an explicit banner: "Solver not yet
// enabled — use this view for manual dispatch."

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, X, Send, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { cn } from '@/lib/utils';
import { adminFetch } from '@/lib/adminFetch';
import type { InboundRow } from './InboundQueue';

interface Unit {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    businessName?: string | null;
    homePostcode?: string | null;
    contractorSegment?: string | null;
}

async function fetchInbound(): Promise<InboundRow[]> {
    const res = await adminFetch('/api/admin/dispatch/inbound');
    if (!res.ok) return [];
    return (await res.json()).data ?? [];
}

async function fetchUnits(): Promise<Unit[]> {
    const res = await adminFetch('/api/admin/units?segment=builder');
    if (!res.ok) return [];
    return (await res.json()).data ?? [];
}

function unitLabel(u: Unit): string {
    return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.businessName || u.id;
}

export default function DayPackAssembler() {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const flags = useFeatureFlags();
    const [selectedUnitId, setSelectedUnitId] = useState<string>('');
    const [areaFilter, setAreaFilter] = useState<string>('');
    const [skillFilter, setSkillFilter] = useState<string>('');
    const [pack, setPack] = useState<InboundRow[]>([]);

    const inboundQuery = useQuery({
        queryKey: ['admin-control-tower-assembler-inbound'],
        queryFn: fetchInbound,
        refetchInterval: 60_000,
    });

    const unitsQuery = useQuery({
        queryKey: ['admin-control-tower-builders'],
        queryFn: fetchUnits,
    });

    const builders = unitsQuery.data ?? [];
    const allInbound = inboundQuery.data ?? [];

    const candidates = useMemo(() => {
        const inPack = new Set(pack.map((p) => p.id));
        return allInbound
            .filter((r) => !inPack.has(r.id))
            .filter((r) => {
                if (areaFilter && !(r.postcode ?? '').toUpperCase().startsWith(areaFilter.toUpperCase())) {
                    return false;
                }
                if (skillFilter) {
                    const sk = skillFilter.toLowerCase();
                    const matches = r.profile.skills.some((s) => s.toLowerCase().includes(sk));
                    if (!matches) return false;
                }
                return true;
            });
    }, [allInbound, pack, areaFilter, skillFilter]);

    const sendPack = useMutation({
        mutationFn: async () => {
            if (!selectedUnitId) throw new Error('Select a Builder first');
            if (pack.length === 0) throw new Error('Pack is empty');
            const results: any[] = [];
            for (const job of pack) {
                const res = await adminFetch('/api/admin/dispatch/manual-route', {
                    method: 'POST',
                    body: JSON.stringify({
                        booking_id: job.id,
                        unit_id: selectedUnitId,
                        action: 'send_to_unit',
                        reason: `manual day-pack assembly to unit ${selectedUnitId}`,
                    }),
                });
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`Failed to dispatch ${job.id}: ${text}`);
                }
                results.push(await res.json());
            }
            return results;
        },
        onSuccess: (results) => {
            toast({
                title: 'Pack sent',
                description: `${results.length} jobs routed to unit ${selectedUnitId}`,
            });
            setPack([]);
            queryClient.invalidateQueries({ queryKey: ['admin-control-tower-assembler-inbound'] });
            queryClient.invalidateQueries({ queryKey: ['admin-control-tower-inbound'] });
        },
        onError: (err: any) => {
            toast({
                title: 'Pack send failed',
                description: err?.message ?? 'unknown error',
                variant: 'destructive',
            });
        },
    });

    return (
        <div className="space-y-4">
            {!flags.day_pack && (
                <Card className="border border-amber-200 bg-amber-50">
                    <CardContent className="p-3 text-sm text-amber-900">
                        Solver not yet enabled (FF_DAY_PACK=0) — use this view for manual dispatch.
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Left: filters + assembled pack */}
                <div className="space-y-3 lg:col-span-1">
                    <Card className="border border-slate-200">
                        <CardContent className="p-4 space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">
                                    Builder unit
                                </label>
                                <select
                                    value={selectedUnitId}
                                    onChange={(e) => setSelectedUnitId(e.target.value)}
                                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
                                    data-testid="select-builder"
                                >
                                    <option value="">— pick a Builder —</option>
                                    {builders.map((b) => (
                                        <option key={b.id} value={b.id}>
                                            {unitLabel(b)} {b.homePostcode ? `(${b.homePostcode})` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">
                                    Area (postcode prefix)
                                </label>
                                <Input
                                    value={areaFilter}
                                    onChange={(e) => setAreaFilter(e.target.value)}
                                    placeholder="NG1, NG7…"
                                    className="text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">
                                    Skill contains
                                </label>
                                <Input
                                    value={skillFilter}
                                    onChange={(e) => setSkillFilter(e.target.value)}
                                    placeholder="e.g. plumbing"
                                    className="text-sm"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-2 border-slate-300">
                        <CardContent className="p-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
                                    <Package className="h-4 w-4" />
                                    Pack ({pack.length})
                                </div>
                                <div className="text-xs text-slate-500">
                                    {pack.reduce((sum, p) => sum + (p.profile.duration_minutes ?? 0), 0)}m total
                                </div>
                            </div>
                            {pack.length === 0 ? (
                                <div className="text-xs text-slate-500 italic">
                                    Add candidates from the right pane.
                                </div>
                            ) : (
                                <ul className="space-y-1">
                                    {pack.map((p) => (
                                        <li key={p.id} className="text-xs flex items-center justify-between border border-slate-200 rounded px-2 py-1">
                                            <span className="truncate">{p.postcode ?? '??'} · {p.job_summary?.slice(0, 30) ?? p.id}</span>
                                            <button
                                                onClick={() => setPack((prev) => prev.filter((x) => x.id !== p.id))}
                                                className="text-slate-400 hover:text-red-600"
                                                data-testid={`btn-remove-${p.id}`}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <Button
                                disabled={!selectedUnitId || pack.length === 0 || sendPack.isPending}
                                onClick={() => sendPack.mutate()}
                                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900"
                                data-testid="btn-send-pack"
                            >
                                {sendPack.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <>
                                        <Send className="h-4 w-4 mr-1.5" /> Send pack to Builder
                                    </>
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* Right: candidates */}
                <div className="lg:col-span-2 space-y-2">
                    <div className="text-xs text-slate-500">
                        {candidates.length} candidate{candidates.length === 1 ? '' : 's'} match filters
                    </div>
                    {candidates.length === 0 && (
                        <Card className="border border-slate-200">
                            <CardContent className="p-6 text-center text-slate-500 text-sm">
                                No candidates. Loosen filters or wait for inbound quotes.
                            </CardContent>
                        </Card>
                    )}
                    {candidates.map((c) => (
                        <Card key={c.id} className="border border-slate-200" data-testid={`candidate-row-${c.id}`}>
                            <CardContent className="p-3 flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs text-slate-500 flex items-center gap-2 mb-0.5">
                                        <span>{c.postcode ?? '??'}</span>
                                        <span>·</span>
                                        <span className={cn(
                                            'px-1.5 py-0.5 rounded text-[10px] font-semibold',
                                            'bg-slate-100 text-slate-700',
                                        )}>{c.booking_state}</span>
                                        {c.flex_tier && <span className="text-[10px] uppercase">{c.flex_tier}</span>}
                                    </div>
                                    <div className="text-sm text-slate-800 truncate">
                                        {c.job_summary ?? '(no description)'}
                                    </div>
                                    <div className="text-[10px] text-slate-500 mt-0.5">
                                        crew {c.profile.crew_size} · {c.profile.duration_minutes}m · {c.profile.skills.slice(0, 3).join(', ')}
                                    </div>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setPack((prev) => [...prev, c])}
                                    data-testid={`btn-add-${c.id}`}
                                >
                                    <Plus className="h-3 w-3 mr-1" /> Add
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
}
