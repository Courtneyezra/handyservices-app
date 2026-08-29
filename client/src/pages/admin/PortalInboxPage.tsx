/**
 * /admin/portal — the unified task inbox (T5, 29 Aug 2026).
 *
 * The front door a quote_prep_ready Pushover opens on Ben's phone: one list of everything
 * currently needing a human — threads carrying a quote-prep verdict and threads parked on
 * Ben's desk (needs_ben, callback due, open questions, held drafts). Most urgent first,
 * each row one thumb-tap into the review view.
 *
 * Reads GET /api/inbox/board and filters client-side — no new list endpoint, the board is
 * already the single source of card truth. This surface will absorb the VA call tasks page
 * (T2) once both land, hence the small exported components in components/portal/.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Inbox, Loader2 } from 'lucide-react';
import { TaskRow } from '@/components/portal/TaskRow';
import { getAuthHeaders, type BoardResponse, type PortalCard } from '@/components/portal/types';

/** Most-urgent-first: complaints, then SLA breaches, then anything on Ben's desk, then the
 *  rest; newest customer activity first within each band. */
function urgencyRank(c: PortalCard): number {
    if (c.complaint) return 0;
    if (c.wait.severity === 'breached') return 1;
    if (c.bensDesk) return 2;
    return 3;
}

export default function PortalInboxPage() {
    const { data, isLoading, error, isFetching } = useQuery<BoardResponse>({
        queryKey: ['portal-board'],
        queryFn: async () => {
            const res = await fetch('/api/inbox/board', { headers: getAuthHeaders() });
            if (res.status === 401 || res.status === 403) throw new Error('AUTH');
            if (!res.ok) throw new Error('Failed to load the inbox');
            return res.json();
        },
        refetchInterval: 15_000,
        refetchOnWindowFocus: true, // a Pushover tap re-opens the tab — the list must be current
    });

    const tasks = useMemo(() => {
        if (!data) return [];
        const cards = Object.values(data.columns).flat();
        return cards
            // A readiness verdict alone only counts while the thread is still pre-quote: the
            // verdict survives in metadata as a historical record after the quote goes out
            // (finalizeQuoteSent retires the tags but not quotePrepIntake), so without the
            // stage check every dealt-with thread would sit in this inbox forever.
            .filter((c) => c.bensDesk || (c.intakeReadiness && (c.stage === 'enquiry' || c.stage === 'scoping')))
            .sort((a, b) => {
                const rank = urgencyRank(a) - urgencyRank(b);
                if (rank !== 0) return rank;
                return new Date(b.lastCustomerMessageAt ?? b.lastMessageAt ?? 0).getTime()
                     - new Date(a.lastCustomerMessageAt ?? a.lastMessageAt ?? 0).getTime();
            });
    }, [data]);

    if ((error as Error)?.message === 'AUTH') {
        return <div className="m-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Your admin session has expired. <a href="/admin/login" className="font-bold underline">Log in again</a> to view the inbox.
        </div>;
    }

    return (
        <div className="mx-auto max-w-lg space-y-3 p-3 pb-10 sm:p-5">
            <div>
                <h1 className="flex items-center gap-2 text-xl font-black text-slate-900 sm:text-2xl">
                    <Inbox className="h-6 w-6" /> Task inbox
                    {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                    Quote verdicts and flagged threads needing you. Most urgent first — tap to review.
                </p>
            </div>

            {isLoading ? (
                <div className="flex h-40 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
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
    );
}
