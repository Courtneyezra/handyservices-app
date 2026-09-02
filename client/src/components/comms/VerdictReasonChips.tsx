/**
 * Reason chips for a draft verdict (Phase 1 / C, COMMS_AGENTS_V3_DESIGN §4).
 *
 * Ben's verdict is the evidence that promotes an intent to SEND, and the reason is the half of it
 * the eval families can act on. One tap: picking a chip submits. Approve-as-is never shows this
 * (reason defaults to 'fine' server-side); edit-then-approve and reject do.
 */
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const VERDICT_REASONS = ['fine', 'tone', 'wrong_move', 'unsafe', 'missing_info'] as const;
export type VerdictReason = (typeof VERDICT_REASONS)[number];

export const REASON_LABELS: Record<VerdictReason, string> = {
    fine: 'fine',
    tone: 'tone',
    wrong_move: 'wrong move',
    unsafe: 'unsafe',
    missing_info: 'missing info',
};

export function VerdictReasonChips({ prompt, onPick, onCancel, busy, tone = 'amber' }: {
    prompt: string;
    onPick: (reason: VerdictReason) => void;
    onCancel: () => void;
    busy?: boolean;
    tone?: 'amber' | 'red';
}) {
    const ring = tone === 'red' ? 'border-red-300 hover:bg-red-100 text-red-800' : 'border-amber-400 hover:bg-amber-100 text-amber-900';
    return (
        <div className="mt-2 rounded border border-dashed border-slate-300 bg-white/70 p-2" data-testid="verdict-reason-chips">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-slate-600">
                <span>{prompt}</span>
                <button type="button" onClick={onCancel} disabled={busy} className="text-[10px] font-semibold normal-case text-slate-400 hover:text-slate-700">
                    cancel
                </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {VERDICT_REASONS.map((r) => (
                    <button
                        key={r}
                        type="button"
                        disabled={busy}
                        onClick={() => onPick(r)}
                        className={cn(
                            'rounded-full border px-2.5 py-1 text-xs font-semibold disabled:opacity-40',
                            r === 'unsafe' ? 'border-red-400 text-red-700 hover:bg-red-100' : ring,
                        )}
                    >
                        {REASON_LABELS[r]}
                    </button>
                ))}
                {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            </div>
        </div>
    );
}
