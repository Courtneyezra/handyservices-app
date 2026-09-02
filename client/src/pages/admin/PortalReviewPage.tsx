/**
 * /admin/portal/review/:conversationId — the quote review view (T5, 29 Aug 2026; P8 / C, 3 Sep).
 *
 * Everything Ben needs to act on a quote intake one-handed: the conversation and its media, the
 * clerk's lane (ONE vocabulary, shared/intake-readiness.ts; ONE source, server/intake.ts), the
 * same QuoteIntakeCard the comms thread shows (lines, gaps, media ticks, "Price and send" once the
 * chain has priced a draft), the gap list with "Queue this ask", and the lane override.
 *
 *   - Price and send       → /admin/price/<slug> (pane B) when a priced draft exists; the card's
 *                            "Save draft quote" / "Open full builder" otherwise. Nothing is sent
 *                            from this page.
 *   - Queue this ask       → POST /api/agents/quote-prep/:id/request-details — queues a draft
 *                            into the human-approval gate; nothing goes to the customer here.
 *   - Lane override        → POST /api/portal/conversations/:id/lane — reassigns the lane,
 *                            metadata only; `decline` queues the polite no as a DRAFT to approve.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, Link } from 'wouter';
import { ArrowLeft, FileText, ListTodo, Loader2, MessageSquare, Pencil, Phone, PoundSterling } from 'lucide-react';
import { QuoteIntakeCard } from '@/components/comms/QuoteIntakeCard';
import { LaneBadge, LANE_BLURB } from '@/components/portal/LaneBadge';
import { GapList } from '@/components/portal/GapList';
import { ThreadPreview } from '@/components/portal/ThreadPreview';
import { MediaStrip } from '@/components/portal/MediaStrip';
import { LaneOverride } from '@/components/portal/LaneOverride';
import { TaskInboxSheet } from '@/components/portal/TaskInboxSheet';
import {
    ageLabel, getAuthHeaders,
    type IntakeResponse, type OverridableLane, type ThreadResponse,
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
            if (!res.ok) throw new Error('Failed to load the quote intake');
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

    const refreshIntake = () => {
        queryClient.invalidateQueries({ queryKey: ['portal-intake', conversationId] });
        queryClient.invalidateQueries({ queryKey: ['quote-intake', conversationId] });
        queryClient.invalidateQueries({ queryKey: ['portal-board'] });
    };

    const overrideLane = useMutation({
        mutationFn: async (lane: OverridableLane) => {
            const res = await fetch(`/api/portal/conversations/${conversationId}/lane`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ lane }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error(body?.message ?? body?.error ?? 'Failed to reassign the lane');
            return body as { lane: OverridableLane; draftId?: string | null };
        },
        onSuccess: ({ lane, draftId }) => {
            setNotice(lane === 'decline'
                ? (draftId ? 'Lane set to decline. The polite no is in your drafts queue — approve it to send.' : 'Lane set to decline. An unsent draft already waits for this customer.')
                : `Lane reassigned to “${lane.replace(/_/g, ' ')}”.`);
            refreshIntake();
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
    const lane = intakeQuery.data?.readiness ?? intake?.readiness ?? null;
    const priceSlug = intakeQuery.data?.estimate?.draftSlug ?? card?.priceDraftSlug ?? null;
    const name = card?.contactName?.trim() || card?.displayPhone || '…';

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

            {/* The clerk's verdict — the same card the comms thread shows */}
            {intakeQuery.isLoading ? (
                <div className="flex h-16 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading verdict…
                </div>
            ) : intake ? (
                <>
                    {lane && LANE_BLURB[lane] && (
                        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{LANE_BLURB[lane]}</p>
                    )}

                    <QuoteIntakeCard conversationId={conversationId} variant="portal" onSaved={refreshIntake} />

                    {(intake.gaps?.length ?? 0) > 0 && (
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
                            current={lane ?? intake.readiness}
                            busy={overrideLane.isPending}
                            onOverride={(l) => overrideLane.mutate(l)}
                        />
                    </div>
                </>
            ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    The quote clerk hasn't run on this thread yet. It runs by itself when the thread is ready to price; use “Re-run clerk” on the thread to ask for one now.
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

            {/* Thumb-reach action bar (P8): "Price and send" when the chain has priced a draft;
                otherwise the card above carries the draft-save / full-builder actions and this bar
                keeps the thread, the task inbox and the call one tap away. Nothing sends here. */}
            {card && (
                <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
                    <div className="mx-auto flex max-w-lg items-center gap-2">
                        {priceSlug ? (
                            <a
                                href={`/admin/price/${priceSlug}`}
                                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-bold text-white active:bg-emerald-700"
                            >
                                <PoundSterling className="h-4 w-4" /> Price and send
                            </a>
                        ) : lane === 'quote_pending' ? (
                            <button
                                type="button"
                                disabled
                                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-500 text-base font-bold text-white opacity-80"
                            >
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Estimating…
                            </button>
                        ) : (
                            <Link
                                href={`/admin/portal/thread/${conversationId}`}
                                className="flex h-12 flex-1 items-center justify-center gap-1 rounded-xl bg-slate-800 text-base font-bold text-white active:bg-slate-900"
                            >
                                <MessageSquare className="h-4 w-4" /> Open thread
                            </Link>
                        )}
                        {priceSlug || lane === 'quote_pending' ? (
                            <Link
                                href={`/admin/portal/thread/${conversationId}`}
                                className="flex h-12 items-center justify-center gap-1 rounded-xl border border-slate-300 px-3 text-sm font-bold text-blue-700 active:bg-slate-100"
                            >
                                <MessageSquare className="h-4 w-4" /> Thread
                            </Link>
                        ) : null}
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
        </div>
    );
}
