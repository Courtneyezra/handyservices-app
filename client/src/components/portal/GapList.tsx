import { cn } from '@/lib/utils';
import type { PortalIntakeGap } from './types';

/**
 * The clerk's gaps: each one shows who can answer it (customer / Ben) and how much the
 * answer moves the job (impact label). Customer-audience gaps carry a "Queue ask" button —
 * that queues a draft into the human-approval gate (POST request-details); nothing sends
 * from here. Ben-audience gaps are things only he knows, so there is nothing to send.
 */
const IMPACT_UI: Record<string, { label: string; style: string }> = {
    none: { label: 'info only', style: 'bg-slate-100 text-slate-500' },
    small: { label: 'small change', style: 'bg-slate-100 text-slate-600' },
    large: { label: 'moves the price', style: 'bg-amber-100 text-amber-800' },
    forks_job: { label: 'forks the job', style: 'bg-red-100 text-red-700' },
};

export function GapList({ gaps, queuedQuestions, queueingQuestion, onQueueAsk }: {
    gaps: PortalIntakeGap[];
    /** Questions already queued this session, so the button flips to "Queued". */
    queuedQuestions: Set<string>;
    /** The question currently in flight, if any. */
    queueingQuestion: string | null;
    onQueueAsk: (question: string) => void;
}) {
    if (!gaps.length) return null;
    return (
        <div className="space-y-2">
            {gaps.map((gap, i) => {
                const impact = gap.impact ? IMPACT_UI[gap.impact] : null;
                const queued = queuedQuestions.has(gap.question);
                const busy = queueingQuestion === gap.question;
                return (
                    <div key={i} className="rounded-lg border border-slate-200 bg-white p-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className={cn(
                                'inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                                gap.audience === 'customer' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800',
                            )}>
                                {gap.audience === 'customer' ? 'Ask customer' : 'For Ben'}
                            </span>
                            {impact && (
                                <span className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', impact.style)}>
                                    {impact.label}
                                </span>
                            )}
                            {gap.lineIndex != null && (
                                <span className="text-[10px] font-semibold text-slate-400">line {gap.lineIndex}</span>
                            )}
                        </div>
                        <p className="mt-1.5 text-sm text-slate-800">{gap.question}</p>
                        {gap.audience === 'customer' && (
                            <button
                                disabled={queued || busy}
                                onClick={() => onQueueAsk(gap.question)}
                                className={cn(
                                    'mt-2 h-9 w-full rounded-lg text-sm font-bold',
                                    queued
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'border border-emerald-600 text-emerald-700 active:bg-emerald-50 disabled:opacity-60',
                                )}
                            >
                                {queued ? 'Queued for approval ✓' : busy ? 'Queueing…' : 'Queue this ask'}
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
