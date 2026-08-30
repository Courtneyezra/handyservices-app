/**
 * DraftApprovalCard — inline approve/reject for a queue_draft tool result.
 *
 * Rendered wherever an ops-agent transcript shows a queue_draft tool_result
 * that parses as QueueDraftToolResult (shared/ops-types.ts). The card is the
 * human gate in miniature: preview + Approve/Reject against the existing
 * message-drafts rails (POST /api/drafts/:id/approve | /reject — the ONLY
 * send path), then settles its status pill from draft_delta SSE events.
 *
 * Exported for B-WP4 (Ben's Desk renders the same card).
 */
import { useCallback, useState } from 'react';
import { Check, Loader2, MessageSquareText, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCommsEvents, type CommsEvent } from '@/hooks/useCommsEvents';
import type { QueueDraftToolResult } from '@shared/ops-types';

type DraftStatus =
    | 'pending' | 'approved' | 'sent' | 'rejected' | 'blocked' | 'edited'
    | 'suppressed' | 'refused';

const STATUS_STYLES: Record<DraftStatus, string> = {
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    approved: 'bg-blue-100 text-blue-800 border-blue-200',
    sent: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    rejected: 'bg-slate-100 text-slate-600 border-slate-200',
    blocked: 'bg-red-100 text-red-700 border-red-200',
    edited: 'bg-blue-100 text-blue-800 border-blue-200',
    suppressed: 'bg-slate-100 text-slate-600 border-slate-200',
    refused: 'bg-red-100 text-red-700 border-red-200',
};

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Parse an unknown tool_result payload into a QueueDraftToolResult, or null.
 * The lean transcript may carry the result as an object or a JSON string.
 */
export function parseQueueDraftResult(raw: unknown): QueueDraftToolResult | null {
    let value = raw;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return null; }
    }
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if (!('draftId' in candidate) || !('status' in candidate)) return null;
    if (candidate.status !== 'pending' && candidate.status !== 'suppressed' && candidate.status !== 'refused') return null;
    return {
        draftId: typeof candidate.draftId === 'string' ? candidate.draftId : null,
        status: candidate.status,
        preview: typeof candidate.preview === 'string' ? candidate.preview : '',
        refusal: typeof candidate.refusal === 'string' ? candidate.refusal : undefined,
    };
}

export function DraftApprovalCard({ result }: { result: QueueDraftToolResult }) {
    const [status, setStatus] = useState<DraftStatus>(result.status);
    const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
    const [error, setError] = useState<string | null>(null);
    const draftId = result.draftId;

    // Settle from the bus: the approve endpoint (or anyone else acting on the
    // draft — the comms thread has its own approve button) emits draft_delta.
    useCommsEvents(useCallback((evt: CommsEvent) => {
        if (evt.type !== 'draft_delta' || !draftId) return;
        if (String(evt.draftId) !== draftId) return;
        setStatus(evt.status);
        if (evt.status === 'sent' || evt.status === 'rejected') setError(null);
    }, [draftId]));

    const act = async (action: 'approve' | 'reject') => {
        if (!draftId || busy) return;
        setBusy(action);
        setError(null);
        try {
            const res = await fetch(`/api/drafts/${draftId}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(String(data?.message ?? data?.error ?? `${action} failed (${res.status})`));
                return;
            }
            // draft_delta confirms the terminal state; this is just immediacy.
            setStatus(action === 'approve' ? 'approved' : 'rejected');
        } catch (err) {
            setError(err instanceof Error ? err.message : `${action} failed`);
        } finally {
            setBusy(null);
        }
    };

    const actionable = !!draftId && status === 'pending';

    return (
        <div
            className="mt-1.5 rounded-md border border-slate-200 bg-white p-2.5 text-xs shadow-sm"
            data-testid="draft-approval-card"
        >
            <div className="flex items-center gap-1.5">
                {draftId
                    ? <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    : <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                <span className="font-medium text-slate-700">
                    {draftId ? 'Draft queued for approval' : result.status === 'suppressed' ? 'Draft suppressed' : 'Draft refused'}
                </span>
                <span className={cn(
                    'ml-auto rounded-full border px-1.5 py-px text-[10px] font-medium capitalize',
                    STATUS_STYLES[status] ?? STATUS_STYLES.pending,
                )}
                >
                    {status}
                </span>
            </div>

            {result.preview && (
                <p className="mt-1.5 whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-600">
                    {result.preview}
                </p>
            )}
            {result.refusal && (
                <p className="mt-1.5 text-red-600">{result.refusal}</p>
            )}
            {error && <p className="mt-1.5 text-red-600">{error}</p>}

            {actionable && (
                <div className="mt-2 flex gap-2">
                    <button
                        type="button"
                        onClick={() => act('approve')}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {busy === 'approve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Approve &amp; send
                    </button>
                    <button
                        type="button"
                        onClick={() => act('reject')}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                        {busy === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        Reject
                    </button>
                </div>
            )}
        </div>
    );
}
