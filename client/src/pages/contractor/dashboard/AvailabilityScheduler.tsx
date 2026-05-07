/**
 * AvailabilityScheduler — 14-day rolling grid for contractors to publish
 * per-`(date, slot)` availability against the v2 availability engine.
 *
 * Replaces `CalendarTab` when FF_AVAILABILITY_ENGINE is ON.
 *
 * Module 04 — Availability Engine spec §6.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { addDays, format, parseISO, startOfDay } from 'date-fns';
import SlotToggle, {
    type SlotKey,
    type SlotStatus,
} from '@/components/contractor/SlotToggle';
import { useToast } from '@/hooks/use-toast';

interface UnitAvailabilityRow {
    id: string;
    unit_id: string;
    date: string;          // YYYY-MM-DD
    slot: SlotKey;
    status: SlotStatus;
    crew_available_count: number;
    hold_expires_at: string | null;
    hold_for_booking_id: string | null;
}

interface ProfileResp {
    id: string;
    crewMax?: number;
    unitType?: 'single' | 'team';
}

function getCleanToken(): string | null {
    const token = localStorage.getItem('contractorToken');
    return token?.trim().replace(/[^a-zA-Z0-9._-]/g, '') ?? null;
}

function dateStr(d: Date): string {
    return format(d, 'yyyy-MM-dd');
}

const WINDOW_DAYS = 14;
const SLOTS: SlotKey[] = ['am', 'pm', 'full'];

export default function AvailabilityScheduler() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const today = useMemo(() => startOfDay(new Date()), []);
    const days = useMemo(
        () =>
            Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i + 1)),
        [today],
    );
    const fromStr = dateStr(days[0]);
    const toStr = dateStr(days[days.length - 1]);

    // Resolve own unit_id + crewMax via the v2 whoami endpoint.
    const { data: profile } = useQuery<ProfileResp>({
        queryKey: ['contractor-unit-min'],
        queryFn: async () => {
            const token = getCleanToken();
            const res = await fetch('/api/contractor/me/unit', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch profile');
            return res.json();
        },
    });

    const unitId = profile?.id;
    const crewMax = Number(profile?.crewMax ?? 1);
    const isTeam = crewMax > 1;

    const { data: availData, isLoading } = useQuery<{ data: UnitAvailabilityRow[] }>({
        queryKey: ['unit-availability', unitId, fromStr, toStr],
        enabled: Boolean(unitId),
        queryFn: async () => {
            const token = getCleanToken();
            const res = await fetch(
                `/api/units/${unitId}/availability?from=${fromStr}&to=${toStr}`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!res.ok) throw new Error('Failed to fetch availability');
            return res.json();
        },
    });

    // Index rows by `${date}|${slot}`
    const rowsByKey = useMemo(() => {
        const map = new Map<string, UnitAvailabilityRow>();
        for (const r of availData?.data ?? []) {
            map.set(`${r.date}|${r.slot}`, r);
        }
        return map;
    }, [availData]);

    function statusOf(date: string, slot: SlotKey): SlotStatus {
        const r = rowsByKey.get(`${date}|${slot}`);
        if (!r) {
            // No row → treat as 'unavailable' (contractor hasn't opted in)
            return 'unavailable';
        }
        return r.status;
    }

    function crewOf(date: string, slot: SlotKey): number {
        return rowsByKey.get(`${date}|${slot}`)?.crew_available_count ?? crewMax;
    }

    const writeMutation = useMutation({
        mutationFn: async (slots: Array<{ date: string; slot: SlotKey; status: SlotStatus; crew_available_count?: number }>) => {
            const token = getCleanToken();
            const res = await fetch(`/api/units/${unitId}/availability`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ slots }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to save');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['unit-availability', unitId] });
        },
        onError: (err: Error) => {
            toast({
                title: 'Could not save',
                description: err.message,
                variant: 'destructive',
            });
        },
    });

    const handleSlotChange = (date: string, slot: SlotKey, next: SlotStatus) => {
        // If user toggles 'full' ON, the server will drop am/pm; if user
        // toggles am/pm ON, server drops 'full'. We just send what we want.
        writeMutation.mutate([
            {
                date,
                slot,
                status: next,
                crew_available_count: next === 'available' ? crewMax : 1,
            },
        ]);
    };

    const handleCrewChange = (date: string, slot: SlotKey, nextCount: number) => {
        writeMutation.mutate([
            {
                date,
                slot,
                status: 'available',
                crew_available_count: nextCount,
            },
        ]);
    };

    // Stats
    const availableCount = useMemo(() => {
        let n = 0;
        for (const d of days) {
            const ds = dateStr(d);
            for (const s of SLOTS) {
                if (statusOf(ds, s) === 'available') n += 1;
            }
        }
        return n;
    }, [days, rowsByKey]);

    const bookedCount = useMemo(() => {
        let n = 0;
        for (const d of days) {
            const ds = dateStr(d);
            for (const s of SLOTS) {
                if (statusOf(ds, s) === 'booked') n += 1;
            }
        }
        return n;
    }, [days, rowsByKey]);

    return (
        <div className="px-4 pt-5 pb-24" data-testid="availability-scheduler">
            <div className="flex items-center justify-between mb-2">
                <h1 className="text-xl font-bold text-white">Your Availability</h1>
                <div className="flex items-center gap-3 text-[11px]">
                    {availableCount > 0 && (
                        <span className="text-emerald-400 font-semibold">
                            {availableCount} slots free
                        </span>
                    )}
                    {bookedCount > 0 && (
                        <span className="text-blue-400 font-semibold">
                            {bookedCount} booked
                        </span>
                    )}
                </div>
            </div>
            <p className="text-xs text-slate-500 mb-5">
                14-day window. Tap any slot to toggle on/off.
                {isTeam ? ` Team mode: set crew per slot up to ${crewMax}.` : ''}
            </p>

            {!unitId && !profile && (
                <div className="text-center text-slate-500 text-sm py-8">
                    Loading your unit…
                </div>
            )}

            {isLoading && (
                <div className="space-y-2">
                    {[...Array(WINDOW_DAYS)].map((_, i) => (
                        <div key={i} className="h-20 bg-slate-900/60 rounded-xl animate-pulse" />
                    ))}
                </div>
            )}

            {!isLoading && unitId && (
                <div className="space-y-2">
                    {days.map((d) => {
                        const ds = dateStr(d);
                        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                        return (
                            <div
                                key={ds}
                                className={`rounded-xl border p-2 ${
                                    isWeekend
                                        ? 'bg-slate-900/40 border-slate-800/40'
                                        : 'bg-slate-900/70 border-slate-800/70'
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1.5 px-1">
                                    <div>
                                        <div className="text-[11px] uppercase tracking-wider text-slate-500">
                                            {format(d, 'EEEE')}
                                        </div>
                                        <div className="text-sm font-bold text-white">
                                            {format(d, 'd MMM')}
                                        </div>
                                    </div>
                                    {isWeekend && (
                                        <span className="text-[9px] text-amber-400 uppercase tracking-wider">
                                            Weekend
                                        </span>
                                    )}
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {SLOTS.map((slot) => {
                                        const status = statusOf(ds, slot);
                                        const crew = crewOf(ds, slot);
                                        const row = rowsByKey.get(`${ds}|${slot}`);
                                        return (
                                            <SlotToggle
                                                key={slot}
                                                slot={slot}
                                                status={status}
                                                onChange={(next) =>
                                                    handleSlotChange(ds, slot, next)
                                                }
                                                isTeam={isTeam}
                                                crewAvailable={crew}
                                                crewMax={crewMax}
                                                onCrewChange={(n) =>
                                                    handleCrewChange(ds, slot, n)
                                                }
                                                bookedLabel={
                                                    row?.hold_for_booking_id
                                                        ? `Job ${row.hold_for_booking_id.slice(0, 6)}`
                                                        : undefined
                                                }
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="mt-5 text-center text-[10px] text-slate-600">
                Your availability gates customer date pickers — only days you cover are bookable.
            </div>
        </div>
    );
}
