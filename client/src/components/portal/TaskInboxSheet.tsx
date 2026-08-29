/**
 * TaskInboxSheet — the portal task inbox mounted as a slide-over sheet (29 Aug 2026).
 *
 * Lets the review page's sticky bar open the same task list /admin/portal shows without
 * navigating away: the sheet fetches GET /api/inbox/board itself and mirrors
 * PortalInboxPage's filter and ordering exactly (cards on Ben's desk, or carrying a
 * pre-quote readiness verdict). Rows are the shared TaskRow — tapping one navigates to
 * that thread's review page, and the sheet closes itself so it isn't still covering the
 * destination.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Inbox, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { TaskRow } from '@/components/portal/TaskRow';
import { getAuthHeaders, type BoardResponse, type PortalCard } from '@/components/portal/types';

/** Same urgency bands as PortalInboxPage: complaints, SLA breaches, Ben's desk, the rest. */
function urgencyRank(c: PortalCard): number {
    if (c.complaint) return 0;
    if (c.wait.severity === 'breached') return 1;
    if (c.bensDesk) return 2;
    return 3;
}

export function TaskInboxSheet({ open, onOpenChange }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { data, isLoading, error, isFetching } = useQuery<BoardResponse>({
        queryKey: ['portal-board'],
        enabled: open,
        queryFn: async () => {
            const res = await fetch('/api/inbox/board', { headers: getAuthHeaders() });
            if (res.status === 401 || res.status === 403) throw new Error('AUTH');
            if (!res.ok) throw new Error('Failed to load the inbox');
            return res.json();
        },
        refetchInterval: 15_000,
        refetchOnWindowFocus: true,
    });

    const tasks = useMemo(() => {
        if (!data) return [];
        const cards = Object.values(data.columns).flat();
        return cards
            // Mirrors PortalInboxPage: a readiness verdict only counts pre-quote (the verdict
            // survives in metadata after the quote goes out), so gate on stage too.
            .filter((c) => c.bensDesk || (c.intakeReadiness && (c.stage === 'enquiry' || c.stage === 'scoping')))
            .sort((a, b) => {
                const rank = urgencyRank(a) - urgencyRank(b);
                if (rank !== 0) return rank;
                return new Date(b.lastCustomerMessageAt ?? b.lastMessageAt ?? 0).getTime()
                     - new Date(a.lastCustomerMessageAt ?? a.lastMessageAt ?? 0).getTime();
            });
    }, [data]);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="bottom" className="flex h-[85vh] flex-col gap-0 rounded-t-2xl p-0">
                <div className="border-b border-slate-200 px-4 py-3">
                    <SheetTitle className="flex items-center gap-2 text-base font-black text-slate-900">
                        <Inbox className="h-5 w-5" /> Task inbox
                        {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                    </SheetTitle>
                    <SheetDescription className="mt-0.5 text-xs text-slate-500">
                        Quote verdicts and flagged threads needing you. Most urgent first — tap to review.
                    </SheetDescription>
                </div>

                {/* TaskRow links to the review page; closing here keeps the sheet from covering it. */}
                <div className="flex-1 overflow-y-auto p-3" onClick={() => onOpenChange(false)}>
                    {(error as Error)?.message === 'AUTH' ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                            Your admin session has expired. <a href="/admin/login" className="font-bold underline">Log in again</a> to view the inbox.
                        </div>
                    ) : isLoading ? (
                        <div className="flex h-32 items-center justify-center text-sm text-slate-500">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading tasks…
                        </div>
                    ) : error ? (
                        <div className="rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700">
                            Couldn't load the inbox. {(error as Error)?.message}
                        </div>
                    ) : tasks.length === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                            Nothing needs you right now.
                        </div>
                    ) : (
                        <div className="space-y-2.5">
                            {tasks.map((c) => <TaskRow key={c.id} card={c} />)}
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
