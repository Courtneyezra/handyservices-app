/**
 * The one thing worth keeping from the in-chat quote card (4 Sep 2026).
 *
 * QuoteIntakeCard rendered a full inline builder on every thread that had an intake. In practice
 * the clerk lands on `quote_ready` almost every time, Route A prices a draft, and the card spent
 * its whole life in the `price_and_send` state where its "Price and send" duplicated the thread
 * header's own button, its line editor had no save path (the save button is gated to
 * `save_draft`, the editor was not), "Open full builder" forked a SECOND competing quote from
 * those unsaved edits, and "Re-run clerk" could supersede the very draft the button pointed at.
 * Quote editing lives on /admin/price/<slug> now, which does strictly more (add, retitle and
 * remove lines, plus labour and materials per line since P18).
 *
 * What had no other home was the missing name / postcode ask: the rules layer's content-free
 * `ask_name` / `ask_postcode`, approved by the signed-in human. That is all this renders.
 *
 * Renders nothing when the thread has no intake, or when nothing is missing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';

type MissingField = 'name' | 'postcode';

/** The slice of GET /api/spine/quote-intake/:id this needs. `missing` is the server's own answer. */
interface IntakePayload {
    available: boolean;
    missing?: MissingField[];
}

const ASK_FOR: Record<MissingField, 'ask_name' | 'ask_postcode'> = {
    name: 'ask_name',
    postcode: 'ask_postcode',
};

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export function IntakeAskChips({ conversationId }: { conversationId: string }) {
    const queryClient = useQueryClient();

    const { data } = useQuery<IntakePayload | null>({
        queryKey: ['quote-intake', conversationId],
        queryFn: async () => {
            const res = await fetch(`/api/spine/quote-intake/${conversationId}`, { headers: authHeaders() });
            if (res.status === 404) return null; // no intake on this thread
            if (!res.ok) throw new Error('Failed to load the quote intake');
            return res.json();
        },
        staleTime: 30_000,
    });

    const ask = useMutation({
        mutationFn: async (kind: 'ask_name' | 'ask_postcode') => {
            const res = await fetch(`/api/spine/ask/${conversationId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ kind }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok && res.status !== 202) throw new Error(body.reason || body.detail || 'Ask failed');
            return body as { sent: boolean; reason: string; suppressedBy?: string | null };
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comms-thread', conversationId] }),
    });

    const missing = data?.available ? (data.missing ?? []) : [];
    if (!missing.length) return null;

    return (
        <>
            {missing.map((field) => (
                <span
                    key={field}
                    data-testid={`intake-ask-${field}`}
                    title={`The clerk has no ${field} for this thread`}
                    className="flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase text-amber-900"
                >
                    Needs {field}
                    <button
                        type="button"
                        disabled={ask.isPending}
                        onClick={() => ask.mutate(ASK_FOR[field])}
                        title={`Send the rules layer's content-free ${field} ask`}
                        className="ml-0.5 flex items-center gap-0.5 rounded bg-amber-200 px-1.5 hover:bg-amber-300 disabled:opacity-50"
                    >
                        {ask.isPending && ask.variables === ASK_FOR[field]
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Send className="h-3 w-3" />}
                        Ask
                    </button>
                </span>
            ))}
            {ask.data && !ask.data.sent && (
                <span className="text-[10px] font-semibold uppercase text-slate-500">
                    Not sent: {ask.data.suppressedBy ?? ask.data.reason}
                </span>
            )}
        </>
    );
}
