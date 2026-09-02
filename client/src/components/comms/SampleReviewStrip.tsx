/**
 * "Yesterday's automatic sends to check" — the Phase 3 morning strip (COMMS_AGENTS_V3_DESIGN §4, §8).
 *
 * The sampler (server/spine/sampler.ts) queues 10% of yesterday's agent sends, plus every one with
 * a bad signal, as agent_questions rows with source 'sampler'. Each is one tap: fine, or not fine
 * with a reason chip. The tap goes through the existing answer endpoint, which records Ben's
 * verdict beside the judge's. Renders nothing when there is nothing to check, so the board looks
 * exactly as it did before the sampler was switched on.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VerdictReasonChips, type VerdictReason } from '@/components/comms/VerdictReasonChips';

interface SampleQuestion {
    id: string;
    conversationId: string;
    phone: string;
    question: string;
    context: string | null;
    options: string[] | null;
    status: string;
    createdAt: string;
    dueAt?: string | null;
}

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Split the sampler's context block into the send body and the judge line. */
function parseContext(context: string | null): { body: string; judge: string | null; signals: string | null } {
    if (!context) return { body: '', judge: null, signals: null };
    const lines = context.split('\n');
    const judge = lines.find((l) => l.startsWith('Judge')) ?? null;
    const signals = lines.find((l) => l.startsWith('Signals:')) ?? null;
    const bodyLines: string[] = [];
    let inBody = false;
    for (const l of lines) {
        if (l.startsWith('SENT')) { inBody = true; continue; }
        if (l.startsWith('Judge') || l.startsWith('Signals:')) break;
        if (inBody) bodyLines.push(l);
    }
    return { body: bodyLines.join('\n').trim(), judge, signals };
}

export function SampleReviewStrip({ onOpenThread }: { onOpenThread?: (conversationId: string) => void }) {
    const queryClient = useQueryClient();
    const [notFineFor, setNotFineFor] = useState<string | null>(null);
    const { data } = useQuery<{ questions: SampleQuestion[] }>({
        queryKey: ['sampler-questions'],
        queryFn: async () => {
            const res = await fetch('/api/agent-questions?status=open&source=sampler', { headers: authHeaders() });
            if (!res.ok) throw new Error('Failed to load sample reviews');
            return res.json();
        },
        refetchInterval: 300_000,
    });
    const answer = useMutation({
        mutationFn: async (input: { id: string; answer: 'fine' | 'not fine'; reason?: VerdictReason }) => {
            const res = await fetch(`/api/agent-questions/${input.id}/answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ answer: input.answer, reason: input.reason }),
            });
            if (!res.ok) throw new Error('Failed to record verdict');
            return res.json();
        },
        onSettled: () => {
            setNotFineFor(null);
            queryClient.invalidateQueries({ queryKey: ['sampler-questions'] });
            queryClient.invalidateQueries({ queryKey: ['comms-board'] });
        },
    });

    const items = data?.questions ?? [];
    if (!items.length) return null;

    return (
        <div className="mx-5 mb-3 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-2" data-testid="sample-review-strip">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-violet-800">
                <Sparkles className="h-3.5 w-3.5" /> Yesterday's automatic sends to check
                <span className="rounded-full bg-violet-200 px-1.5 text-[10px] tabular-nums text-violet-900">{items.length}</span>
                <span className="font-normal normal-case tracking-normal text-violet-700">One tap each. Your verdict outranks the judge's.</span>
            </div>
            <ul className="divide-y divide-violet-100">
                {items.map((q) => {
                    const { body, judge, signals } = parseContext(q.context);
                    const busy = answer.isPending && answer.variables?.id === q.id;
                    const judgeNotFine = !!judge && /NOT fine/.test(judge);
                    return (
                        <li key={q.id} className="flex flex-wrap items-start gap-3 py-2 text-sm">
                            <button
                                type="button"
                                onClick={() => onOpenThread?.(q.conversationId)}
                                className="min-w-0 flex-1 text-left"
                                title="Open the thread"
                            >
                                <div className="text-[11px] font-semibold text-slate-600">{q.question}</div>
                                <div className="mt-0.5 whitespace-pre-line text-slate-800">{body || '(no body)'}</div>
                                {(judge || signals) && (
                                    <div className={cn('mt-0.5 text-[11px]', judgeNotFine ? 'text-red-700' : 'text-slate-500')}>
                                        {judge}{signals ? ` · ${signals}` : ''}
                                    </div>
                                )}
                            </button>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                                {notFineFor === q.id ? (
                                    <VerdictReasonChips
                                        prompt="Why not fine?"
                                        tone="red"
                                        busy={busy}
                                        onCancel={() => setNotFineFor(null)}
                                        onPick={(reason) => answer.mutate({ id: q.id, answer: 'not fine', reason })}
                                    />
                                ) : (
                                    <div className="flex gap-1.5">
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => answer.mutate({ id: q.id, answer: 'fine', reason: 'fine' })}
                                            className="flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                                        >
                                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Fine
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => setNotFineFor(q.id)}
                                            className="flex items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
                                        >
                                            <X className="h-3.5 w-3.5" /> Not fine
                                        </button>
                                    </div>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
