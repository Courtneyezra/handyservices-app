import { useState } from 'react';
import { cn } from '@/lib/utils';
import { READINESS_OVERRIDE_OPTIONS, type OverridableReadiness } from '@shared/intake-readiness';

/**
 * The human override: a segmented control over the lanes a person may set, with the clerk's
 * current verdict highlighted. Tapping a different lane asks once, then reassigns (covers "mark
 * visit-first", the VA override and — P8 — confirming a decline, which queues the polite no as
 * a DRAFT for approval; nothing is sent from here). Lanes, never scores. Options come from the
 * ONE vocabulary (shared/intake-readiness.ts); `quote_pending` is system-only and not offered.
 */
export function LaneOverride({ current, busy, onOverride }: {
    current: string;
    busy: boolean;
    onOverride: (lane: OverridableReadiness) => void;
}) {
    const [confirming, setConfirming] = useState<OverridableReadiness | null>(null);

    if (confirming) {
        const label = READINESS_OVERRIDE_OPTIONS.find((o) => o.readiness === confirming)?.label ?? confirming;
        const decline = confirming === 'decline';
        return (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5" data-testid="lane-override-confirm">
                <p className="text-sm font-semibold text-amber-900">Move this to “{label}”?</p>
                {decline && (
                    <p className="mt-1 text-xs text-amber-800">
                        The polite no is queued as a draft for you to approve. Nothing goes to the customer until you tap approve.
                    </p>
                )}
                <div className="mt-2 flex gap-2">
                    <button
                        disabled={busy}
                        onClick={() => { onOverride(confirming); setConfirming(null); }}
                        className="h-10 flex-1 rounded-lg bg-amber-600 text-sm font-bold text-white active:bg-amber-700 disabled:opacity-50"
                    >
                        {busy ? '…' : decline ? 'Yes, draft the polite no' : 'Yes, reassign lane'}
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
        <div className="flex overflow-hidden rounded-lg border border-slate-300" data-testid="lane-override">
            {READINESS_OVERRIDE_OPTIONS.map((o, i) => {
                const active = o.readiness === current;
                return (
                    <button
                        key={o.readiness}
                        disabled={busy || active}
                        onClick={() => setConfirming(o.readiness)}
                        className={cn(
                            'h-10 flex-1 text-xs font-bold',
                            i > 0 && 'border-l border-slate-300',
                            active ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 active:bg-slate-100 disabled:opacity-60',
                            o.readiness === 'decline' && !active && 'text-red-700',
                        )}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}
