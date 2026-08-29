import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { Lane } from './types';

const LANE_OPTIONS: Array<{ lane: Lane; label: string }> = [
    { lane: 'quote_ready', label: 'Quote ready' },
    { lane: 'needs_info', label: 'Needs info' },
    { lane: 'visit_first', label: 'Visit first' },
];

/**
 * The human override: a segmented control over the three lanes with the clerk's current
 * verdict highlighted. Tapping a different lane asks once, then reassigns (covers both
 * "mark visit-first" and the VA lane override). Lanes, never scores.
 */
export function LaneOverride({ current, busy, onOverride }: {
    current: string;
    busy: boolean;
    onOverride: (lane: Lane) => void;
}) {
    const [confirming, setConfirming] = useState<Lane | null>(null);

    if (confirming) {
        const label = LANE_OPTIONS.find((o) => o.lane === confirming)?.label ?? confirming;
        return (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-sm font-semibold text-amber-900">Move this to “{label}”?</p>
                <div className="mt-2 flex gap-2">
                    <button
                        disabled={busy}
                        onClick={() => { onOverride(confirming); setConfirming(null); }}
                        className="h-10 flex-1 rounded-lg bg-amber-600 text-sm font-bold text-white active:bg-amber-700 disabled:opacity-50"
                    >
                        {busy ? '…' : 'Yes, reassign lane'}
                    </button>
                    <button
                        disabled={busy}
                        onClick={() => setConfirming(null)}
                        className="h-10 flex-1 rounded-lg border border-slate-300 text-sm font-bold text-slate-600 active:bg-slate-100"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {LANE_OPTIONS.map((o, i) => {
                const active = o.lane === current;
                return (
                    <button
                        key={o.lane}
                        disabled={busy || active}
                        onClick={() => setConfirming(o.lane)}
                        className={cn(
                            'h-10 flex-1 text-xs font-bold',
                            i > 0 && 'border-l border-slate-300',
                            active ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 active:bg-slate-100 disabled:opacity-60',
                        )}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}
