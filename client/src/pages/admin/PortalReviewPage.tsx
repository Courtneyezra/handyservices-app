/**
 * /admin/portal/review/:conversationId — the quote review view (T5, 29 Aug 2026).
 *
 * Everything Ben needs to act on a quote-prep verdict one-handed: the conversation and its
 * media, the clerk's lane verdict with the gap breakdown (audience + impact — lanes, never a
 * numeric score), the proposed line titles (the clerk produces no prices), and the actions:
 *
 *   - Approve & build      → opens the existing QuotePrepPanel as a slide-over RIGHT HERE
 *                            (no comms round-trip): it prices via the builder's engine and
 *                            Ben's click inside the panel is the send trigger — the review
 *                            page itself still never sends a quote.
 *   - Queue this ask       → POST /api/agents/quote-prep/:id/request-details — queues a draft
 *                            into the human-approval gate; nothing goes to the customer here.
 *   - Lane override        → POST /api/portal/conversations/:id/lane — reassigns the lane
 *                            (covers "mark visit-first" and the VA override), metadata only.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, Link } from 'wouter';
import { ArrowLeft, FileText, ListTodo, Loader2, MessageSquare, Pencil, Phone } from 'lucide-react';
import {
    QuotePrepPanel, type PrepThreadMedia, type QuoteIntake,
} from '@/components/comms/QuotePrepPanel';
import { LaneBadge, LANE_BLURB } from '@/components/portal/LaneBadge';
import { GapList } from '@/components/portal/GapList';
import { ThreadPreview } from '@/components/portal/ThreadPreview';
import { MediaStrip } from '@/components/portal/MediaStrip';
import { LaneOverride } from '@/components/portal/LaneOverride';
import { TaskInboxSheet } from '@/components/portal/TaskInboxSheet';
import {
    ageLabel, getAuthHeaders,
    type IntakeResponse, type Lane, type ThreadResponse,
} from '@/components/portal/types';

function telHref(phoneNumber: string): string {
    const digits = phoneNumber.replace('@c.us', '').replace(/\D/g, '');
    return `tel:+${digits}`;
}

export default function PortalReviewPage() {
    const [, params] = useRoute('/admin/portal/review/:conversationId');
    const conversationId = params?.conversationId ?? '';
    const queryClient = useQueryClient();
    const [queuedQuestions, setQueuedQuestions] = useState<Set<string>>(new Set());
    const [notice, setNotice] = useState<string | null>(null);
    // Quote-prep slide-over state. The panel stays mounted (edits intact) while closed;
    // "dismissed" is the explicit discard from inside the panel.
    const [prepOpen, setPrepOpen] = useState(false);
    const [prepDismissed, setPrepDismissed] = useState(false);
    // Task-inbox slide-over: the same list /admin/portal shows, mounted here so Ben can
    // hop between tasks without leaving the review flow.
    const [tasksOpen, setTasksOpen] = useState(false);

    const thread = useQuery<ThreadResponse>({
        queryKey: ['portal-thread', conversationId],
        enabled: !!conversationId,
        queryFn: async () => {
            const res = await fetch(`/api/inbox/conversations/${conversationId}/thread`, { headers: getAuthHeaders() });
            if (res.status === 401 || res.status === 403) throw new Error('AUTH');
            if (!res.ok) throw new Error('Failed to load the thread');
            return res.json();
        },
        refetchOnWindowFocus: true,
    });

    const intakeQuery = useQuery<IntakeResponse>({
        queryKey: ['portal-intake', conversationId],
        enabled: !!conversationId,
        queryFn: async () => {
            const res = await fetch(`/api/agents/quote-prep/${conversationId}/intake`, { headers: getAuthHeaders() });
            if (res.status === 401 || res.status === 403) throw new Error('AUTH');
            if (!res.ok) throw new Error('Failed to load the quote-prep verdict');
            return res.json();
        },
        refetchOnWindowFocus: true,
    });

    const queueAsk = useMutation({
        mutationFn: async (question: string) => {
            const res = await fetch(`/api/agents/quote-prep/${conversationId}/request-details`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ question }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error(body?.error ?? 'Failed to queue the ask');
            return { question, queued: !!body?.queued };
        },
        onSuccess: ({ question, queued }) => {
            setQueuedQuestions((prev) => new Set(prev).add(question));
            setNotice(queued
                ? 'Ask queued. It waits in the drafts panel for approval — nothing has been sent.'
                : 'An unsent draft already exists for this customer, so this ask was not queued twice.');
        },
        onError: (e: Error) => setNotice(e.message),
    });

    const overrideLane = useMutation({
        mutationFn: async (lane: Lane) => {
            const res = await fetch(`/api/portal/conversations/${conversationId}/lane`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ lane }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error(body?.message ?? body?.error ?? 'Failed to reassign the lane');
            return body as { lane: Lane };
        },
        onSuccess: ({ lane }) => {
            setNotice(`Lane reassigned to “${lane.replace(/_/g, ' ')}”.`);
            queryClient.invalidateQueries({ queryKey: ['portal-intake', conversationId] });
            queryClient.invalidateQueries({ queryKey: ['portal-board'] });
        },
        onError: (e: Error) => setNotice(e.message),
    });

    if ((thread.error as Error)?.message === 'AUTH' || (intakeQuery.error as Error)?.message === 'AUTH') {
        return <div className="m-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Your admin session has expired. <a href="/admin/login" className="font-bold underline">Log in again</a>.
        </div>;
    }

    const card = thread.data?.card;
    const intake = intakeQuery.data?.intake ?? null;
    const lane = intake?.readiness ?? intakeQuery.data?.readiness ?? null;
    const name = card?.contactName?.trim() || card?.displayPhone || '…';

    // The thread endpoint's card carries the live 24h-window state (server toCard) even though
    // the portal type doesn't declare it. Default shut: the panel then offers the template/queue
    // path instead of promising a freeform send it can't deliver.
    const windowOpen = (card as (typeof card & { windowOpen?: boolean }))?.windowOpen ?? false;

    // The thread's photos/videos for the panel's evidence strip — same rules as the comms
    // thread: deduped by URL, audio and documents skipped (they can't illustrate a quote).
    const prepMedia = useMemo<PrepThreadMedia[]>(() => {
        const seen = new Map<string, PrepThreadMedia>();
        for (const ev of thread.data?.timeline ?? []) {
            if (!ev.mediaUrl || seen.has(ev.mediaUrl)) continue;
            const mime = ev.mediaType ?? '';
            if (mime.startsWith('audio/') || ev.type === 'audio') continue;
            if (mime.startsWith('image/') || mime.startsWith('video/') || ev.type === 'image' || ev.type === 'video' || mime === '') {
                seen.set(ev.mediaUrl, { mediaUrl: ev.mediaUrl, mediaType: ev.mediaType ?? null, type: ev.type ?? '' });
            }
        }
        return [...seen.values()];
    }, [thread.data?.timeline]);

    const refreshAfterPrep = () => {
        queryClient.invalidateQueries({ queryKey: ['portal-thread', conversationId] });
        queryClient.invalidateQueries({ queryKey: ['portal-intake', conversationId] });
        queryClient.invalidateQueries({ queryKey: ['portal-board'] });
    };

    // The portal's read-only intake mirrors the same stored object the panel edits
    // (conversations.metadata.quotePrepIntake), so the widening to plain strings is safe
    // to narrow back for the panel.
    const prepIntake = !prepDismissed && intake ? (intake as QuoteIntake) : null;

    return (
        <div className="mx-auto max-w-lg space-y-3 p-3 pb-32 sm:p-5">
            {/* Header */}
            <div>
                <Link href="/admin/portal" className="inline-flex items-center gap-1 text-sm font-bold text-blue-700 active:underline">
                    <ArrowLeft className="h-4 w-4" /> Task inbox
                </Link>
                <div className="mt-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-black text-slate-900">{name}</h1>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                            {card && <span className="font-mono text-xs text-slate-500">{card.displayPhone}</span>}
                            {lane && <LaneBadge lane={lane} />}
                            {intake?.urgency === 'high' && (
                                <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">urgent</span>
                            )}
                            {/* The quote already built for this thread (quote_sent and beyond):
                                view what the customer sees, plus a shortcut into the editor. */}
                            {card?.quoteSlug && (
                                <span className="inline-flex items-center gap-1">
                                    <a
                                        href={`/quote/${card.quoteSlug}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-800 active:bg-emerald-200"
                                    >
                                        <FileText className="h-3 w-3" /> View quote
                                    </a>
                                    <Link
                                        href={`/admin/quotes/${card.quoteSlug}/edit`}
                                        aria-label="Edit quote"
                                        className="inline-flex items-center gap-0.5 rounded-full border border-slate-300 px-1.5 py-1 text-[10px] font-semibold text-slate-600 active:bg-slate-100"
                                    >
                                        <Pencil className="h-3 w-3" /> Edit
                                    </Link>
                                </span>
                            )}
                        </div>
                    </div>
                    {card && (
                        <span className="whitespace-nowrap font-mono text-xs text-slate-400">
                            {ageLabel(card.lastCustomerMessageAt ?? card.lastMessageAt)} ago
                        </span>
                    )}
                </div>
            </div>

            {notice && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800" onClick={() => setNotice(null)}>
                    {notice}
                </div>
            )}

            {/* The clerk's verdict */}
            {intakeQuery.isLoading ? (
                <div className="flex h-16 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading verdict…
                </div>
            ) : intake ? (
                <>
                    {lane && LANE_BLURB[lane] && (
                        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{LANE_BLURB[lane]}</p>
                    )}

                    {intake.lines.length > 0 && (
                        <div>
                            <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Proposed quote lines</h2>
                            <ol className="space-y-1 rounded-lg border border-slate-200 bg-white p-2.5">
                                {intake.lines.map((l, i) => (
                                    <li key={i} className="flex gap-2 text-sm text-slate-800">
                                        <span className="font-mono text-xs text-slate-400">{i + 1}.</span>
                                        <span className="font-semibold">{l.title}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {intake.gaps.length > 0 && (
                        <div>
                            <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Gaps &amp; proposed questions</h2>
                            <GapList
                                gaps={intake.gaps}
                                queuedQuestions={queuedQuestions}
                                queueingQuestion={queueAsk.isPending ? (queueAsk.variables ?? null) : null}
                                onQueueAsk={(q) => queueAsk.mutate(q)}
                            />
                        </div>
                    )}

                    <div>
                        <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Lane override</h2>
                        <LaneOverride
                            current={intake.readiness}
                            busy={overrideLane.isPending}
                            onOverride={(l) => overrideLane.mutate(l)}
                        />
                    </div>
                </>
            ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    The quote-prep clerk hasn't run on this thread yet. Use “Prep quote” in the full thread to run it.
                </div>
            )}

            {/* The conversation */}
            {thread.isLoading ? (
                <div className="flex h-24 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading conversation…
                </div>
            ) : thread.data ? (
                <>
                    <MediaStrip timeline={thread.data.timeline} />
                    <div>
                        <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                            Conversation{thread.data.truncated ? ' (recent)' : ''}
                        </h2>
                        <ThreadPreview timeline={thread.data.timeline} />
                    </div>
                </>
            ) : thread.error ? (
                <div className="rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700">
                    Couldn't load the conversation. {(thread.error as Error)?.message}
                </div>
            ) : null}

            {/* Thumb-reach action bar. Approve opens the prep panel right here — pricing runs
                the builder's engine and the actual send stays behind Ben's click in the panel.
                Disabled until the clerk has produced an intake (the empty-state card above
                explains how to run it). */}
            {card && (
                <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
                    <div className="mx-auto flex max-w-lg items-center gap-2">
                        <button
                            type="button"
                            onClick={() => { setPrepDismissed(false); setPrepOpen(true); }}
                            disabled={!intake}
                            className="flex h-12 flex-1 items-center justify-center rounded-xl bg-emerald-600 text-base font-bold text-white active:bg-emerald-700 disabled:opacity-40"
                        >
                            Approve &amp; build quote
                        </button>
                        <Link
                            href={`/admin/portal/thread/${conversationId}`}
                            className="flex h-12 items-center justify-center gap-1 rounded-xl border border-slate-300 px-3 text-sm font-bold text-blue-700 active:bg-slate-100"
                        >
                            <MessageSquare className="h-4 w-4" /> Thread
                        </Link>
                        <button
                            type="button"
                            onClick={() => setTasksOpen(true)}
                            className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-300 text-slate-700 active:bg-slate-100"
                            aria-label="Open task inbox"
                        >
                            <ListTodo className="h-5 w-5" />
                        </button>
                        <a
                            href={telHref(card.phoneNumber)}
                            className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-300 text-slate-700 active:bg-slate-100"
                            aria-label="Call customer"
                        >
                            <Phone className="h-5 w-5" />
                        </a>
                    </div>
                </div>
            )}

            {/* Task-inbox slide-over — mounts the /admin/portal list in place; tapping a row
                navigates to that thread's review page. */}
            <TaskInboxSheet open={tasksOpen} onOpenChange={setTasksOpen} />

            {/* Quote-prep slide-over — the same panel the comms thread mounts, with full builder
                parity. Keyed on preparedAt so a fresh clerk run remounts with the new intake
                while ordinary refetches keep Ben's in-panel edits. */}
            {prepIntake && card && (
                <QuotePrepPanel
                    key={intakeQuery.data?.preparedAt ?? 'prep'}
                    intake={prepIntake}
                    conversation={{ id: conversationId, phoneNumber: card.phoneNumber, windowOpen }}
                    media={prepMedia}
                    open={prepOpen}
                    onOpenChange={setPrepOpen}
                    onDismiss={() => { setPrepDismissed(true); setPrepOpen(false); }}
                    onRefresh={refreshAfterPrep}
                />
            )}
        </div>
    );
}
